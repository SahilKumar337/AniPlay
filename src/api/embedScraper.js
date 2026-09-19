/**
 * EmbedScraper — JavaScript bridge for the native EmbedScraperPlugin
 *
 * On Android (Capacitor native):
 *   Uses the native EmbedScraperPlugin which opens a hidden WebView,
 *   loads the embed URL with a custom Referer header (like Cloudstream),
 *   and intercepts network requests to capture the .m3u8 URL.
 *
 * On desktop (dev browser):
 *   Falls back to a timeout-based no-op — the IframePlayer blob approach
 *   handles scraping in dev mode via the local proxy.
 */

import { registerPlugin, Capacitor, CapacitorHttp } from '@capacitor/core';
import { resolveMegaPlayStream } from '../utils/megaplayDecrypt.js';

const isNative = typeof window !== 'undefined' && (
  Capacitor.isNativePlatform() || 
  !!window.Capacitor?.isNativePlatform?.()
);

// Register the native plugin (only active on Android)
const NativeEmbedScraper = isNative
  ? registerPlugin('EmbedScraper')
  : null;

/**
 * Session-level m3u8 URL cache.
 * When a stream URL is successfully resolved (during playback), it's stored here.
 * If the same embed URL is requested again (e.g. for download), the cached URL
 * is returned immediately without re-solving Cloudflare (saves 10-30s).
 * TTL: 90 minutes (typical CDN token lifetime).
 */
const m3u8Cache = new Map(); // embedUrl (normalized) → { url, timestamp }
const M3U8_CACHE_TTL = 90 * 60 * 1000; // 90 minutes

/** Store a resolved m3u8 URL in the session cache. */
export function cacheM3U8Url(embedUrl, m3u8Url) {
  if (embedUrl && m3u8Url) {
    const key = embedUrl.split('?')[0]; // normalize: strip query params
    m3u8Cache.set(key, { url: m3u8Url, timestamp: Date.now() });
    console.log('[EmbedScraper] Cached m3u8 for', key.slice(0, 60));
  }
}

/** Get a cached m3u8 URL if still valid. */
export function getCachedM3U8(embedUrl) {
  if (!embedUrl) return null;
  const key = embedUrl.split('?')[0];
  const cached = m3u8Cache.get(key);
  if (cached && Date.now() - cached.timestamp < M3U8_CACHE_TTL) {
    console.log('[EmbedScraper] Cache hit for', key.slice(0, 60));
    return cached.url;
  }
  return null;
}

export function guessSubtitleLabel(file, defaultLabel = 'Unknown') {
  if (!file) return defaultLabel;
  const f = file.toLowerCase();
  if (f.includes('/ar.') || f.includes('_ara') || f.includes('arabic')) return 'Arabic';
  if (f.includes('/es.') || f.includes('_spa') || f.includes('spanish')) return 'Spanish';
  if (f.includes('/fr.') || f.includes('_fre') || f.includes('french')) return 'French';
  if (f.includes('/de.') || f.includes('_ger') || f.includes('german')) return 'German';
  if (f.includes('/it.') || f.includes('_ita') || f.includes('italian')) return 'Italian';
  if (f.includes('/pt.') || f.includes('_por') || f.includes('portuguese')) return 'Portuguese';
  if (f.includes('/ru.') || f.includes('_rus') || f.includes('russian')) return 'Russian';
  if (f.includes('/ja.') || f.includes('_jpn') || f.includes('japanese')) return 'Japanese';
  if (f.includes('/en.') || f.includes('_eng') || f.includes('english')) return 'English';
  return defaultLabel;
}

/**
 * Universal unpacker for packed JavaScript (eval(function(p,a,c,k,e,d)...))
 */
export function unpackUniversalJS(html) {
  if (!html) return null;

  const adDomains = ['doubleclick', 'googleads', 'adserver', 'popads', 'adsystem', '/ad-tags/', 'ibyteimg', 'vivibebe', 'bibiemb', 'vibevibe'];
  const cleanHtml = html.replace(/\\\//g, '/');

  // 1. Direct .m3u8 link scan in HTML (including unescaped and escaped)
  const allM3u8Matches = [
    ...(cleanHtml.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/gi) || []),
    ...(html.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/gi) || [])
  ];
  for (const m of allM3u8Matches) {
    const clean = m.replace(/\\/g, '');
    if (!adDomains.some(d => clean.includes(d))) {
      console.log('[EmbedScraper] Found stream via direct HTML scan:', clean.slice(0, 80));
      return clean;
    }
  }

  // 2. Scan Playerjs / jwplayer / videojs file configs
  const fileConfigMatch = cleanHtml.match(/(?:file|sources?|src)\s*[:=]\s*["'](https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)[^"'\s<>]*)["']/i);
  if (fileConfigMatch && !adDomains.some(d => fileConfigMatch[1].includes(d))) {
    console.log('[EmbedScraper] Found stream via player config:', fileConfigMatch[1].slice(0, 80));
    return fileConfigMatch[1];
  }

  // 2B. Direct HTML5 <source src="..." or 1anime / plyr stream endpoints
  const sourceTagMatch = cleanHtml.match(/<source[^>]+src=["'](https?:\/\/[^"'\s<>]*(?:\/stream\/|\.mp4|\.m3u8)[^"'\s<>]*)["']/i);
  if (sourceTagMatch && !adDomains.some(d => sourceTagMatch[1].includes(d))) {
    console.log('[EmbedScraper] Found stream via <source> tag:', sourceTagMatch[1].slice(0, 80));
    return sourceTagMatch[1];
  }

  const streamEndpointMatch = cleanHtml.match(/(https?:\/\/(?:my\.)?1anime\.site\/stream\/[a-zA-Z0-9]+)/i);
  if (streamEndpointMatch) {
    console.log('[EmbedScraper] Found 1anime stream endpoint:', streamEndpointMatch[1]);
    return streamEndpointMatch[1];
  }

  // 3. Packed JS unpacker (StreamHG, Earnvids, VidHide, StreamWish, etc.)
  // Strategy: find the args string directly instead of trying to regex-match the full eval() block.
  // The old regex used lazy [\s\S]*? which matched prematurely on long packed blocks (4 chars vs 9247).
  // New approach: scan for the closing pattern `}.split('|'))` working backwards from each occurrence.
  const packedArgRegex = /}\s*\(\s*'([\s\S]+?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'\s*\.split\s*\(\s*'\\?\|'\s*\)/g;
  let packMatch;
  while ((packMatch = packedArgRegex.exec(html)) !== null) {
    try {
      let p = packMatch[1];
      const a = parseInt(packMatch[2], 10);
      let c = parseInt(packMatch[3], 10);
      const k = packMatch[4].split('|');
      while (c--) if (k[c]) p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);

      const unpackedM3u8 = p.replace(/\\\//g, '/').match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/gi) || [];
      for (const m of unpackedM3u8) {
        const clean = m.replace(/\\/g, '');
        if (!adDomains.some(d => clean.includes(d))) {
          console.log('[EmbedScraper] Resolved stream from unpacked JS:', clean.slice(0, 80));
          return clean;
        }
      }
    } catch (e) {
      console.warn('[EmbedScraper] Unpack block error:', e.message);
    }
  }

  return null;
}

/**
 * Fast direct HTTP extractor for known embed providers.
 * Resolves streams directly via HTTP in ~1-2 seconds without opening a heavy native WebView.
 */
export async function scrapeEmbedDirectly(embedUrl, referer) {
  try {
    if (!embedUrl) return null;
    const urlObj = new URL(embedUrl);
    const origin = urlObj.origin;

    console.log(`[EmbedScraper] scrapeEmbedDirectly: ${embedUrl.slice(0, 100)}`);

    let html = '';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': referer || (origin + '/'),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };

    if (Capacitor.isNativePlatform()) {
      const resp = await CapacitorHttp.request({
        url: embedUrl,
        method: 'GET',
        headers,
        responseType: 'text',
        connectTimeout: 8000,
        readTimeout: 8000
      });
      if (resp && resp.status === 200) {
        html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      }
    } else {
      let fetchUrl = embedUrl;
      if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        fetchUrl = `/api/scrape?url=${encodeURIComponent(embedUrl)}&referer=${encodeURIComponent(referer || origin + '/')}`;
      }
      const res = await fetch(fetchUrl, { headers });
      if (res.ok) {
        html = await res.text();
      }
    }

    if (!html) return null;

    // Run universal unpacker & scan
    const directM3u8 = unpackUniversalJS(html);
    if (directM3u8) {
      // Only guess the subtitle sidecar path for CDNs known to serve it.
    // Nexabloom / Streamzone family: kryntal, norami, imgnex, shiora, mikora, akirax, dokicloud.
    // For all other CDNs (otakuhg, otakuvid, echovideo) this path 404s — skip the guess.
    const NEXABLOOM_CDN = /kryntal|norami|imgnex|shiora|mikora|akirax|dokicloud/i;
    let subs = [];
    if (NEXABLOOM_CDN.test(directM3u8) &&
        (directM3u8.includes('/master.m3u8') || directM3u8.includes('/index.m3u8'))) {
      subs.push({
        id: 0,
        label: 'English',
        file: directM3u8.replace(/\/(?:master|index)\.m3u8.*$/, '/subtitles/track_0_eng.vtt'),
        referer: referer || (origin + '/'),
        default: true
      });
    }
      const isHLS = directM3u8.includes('.m3u8');
      return {
        url: directM3u8,
        streamUrl: directM3u8,
        videoUrl: directM3u8,
        isHLS,
        referer: embedUrl || referer || (origin + '/'),
        subtitles: subs,
        toString() { return directM3u8; },
        valueOf() { return directM3u8; }
      };
    }

    // Fallback: getSources API scan (e.g. megaplay.buzz, vidtube.site, vidwish.live)
    let fileId = '';
    const fileIdHtmlMatch = html.match(/File\s+(\d+)/i) ||
                            html.match(/"id"\s*:\s*(\d+)/i) ||
                            html.match(/data-id="(\d+)"/i) ||
                            html.match(/cid\s*:\s*'([^']+)'/i);

    if (fileIdHtmlMatch) {
      fileId = fileIdHtmlMatch[1];
    } else {
      const isMegaPlayOrCloud = embedUrl.includes('megaplay') || embedUrl.includes('megacloud');
      if (!isMegaPlayOrCloud) {
        const idInPathMatch = embedUrl.match(/\/(?:stream|embed)\/[^/]+\/(\d+)/i) ||
                              embedUrl.match(/\/(?:stream|embed)\/(\d+)/i);
        if (idInPathMatch) fileId = idInPathMatch[1];
      }
    }

    if (fileId) {
      let embedUrlObj = null;
      try { embedUrlObj = new URL(embedUrl); } catch {}
      const sParam = embedUrlObj ? embedUrlObj.searchParams.get('s') : null;
      const apiUrl = sParam
        ? `${origin}/stream/getSources?id=${fileId}&s=${sParam}`
        : `${origin}/stream/getSources?id=${fileId}`;

      let apiText = '';
      const apiHeaders = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        'Referer': embedUrl,
        'X-Requested-With': 'XMLHttpRequest'
      };

      if (Capacitor.isNativePlatform()) {
        const apiResp = await CapacitorHttp.request({
          url: apiUrl,
          method: 'GET',
          headers: apiHeaders,
          responseType: 'text',
          connectTimeout: 4000,
          readTimeout: 4000
        });
        if (apiResp && apiResp.status === 200) {
          apiText = typeof apiResp.data === 'string' ? apiResp.data : JSON.stringify(apiResp.data);
        }
      } else {
        let fetchApiUrl = apiUrl;
        if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          fetchApiUrl = `/api/scrape?url=${encodeURIComponent(apiUrl)}&referer=${encodeURIComponent(embedUrl)}`;
        }
        const apiRes = await fetch(fetchApiUrl, { headers: apiHeaders });
        if (apiRes.ok) apiText = await apiRes.text();
      }

      if (apiText) {
        try {
          const json = JSON.parse(apiText);
          const m3u8Url = await resolveMegaPlayStream(json);
          if (m3u8Url) {
            console.log('[EmbedScraper] Resolved stream from getSources: ' + m3u8Url.slice(0, 80));
            let subs = [];
            const tracks = json.tracks || [];
            const isHardSub = (embedUrl || '').toLowerCase().includes('hardsub') || (embedUrl || '').toLowerCase().includes('hard');
            if (tracks.length) {
              subs = tracks.filter(t => t.kind === 'captions' || t.kind === 'subtitles').map((t, idx) => ({
                id: idx,
                label: t.label || guessSubtitleLabel(t.file, `Track ${idx + 1}`),
                file: t.file,
                referer: origin + '/',
                default: !!t.default
              }));
            } else {
              // Only guess the sidecar path for Nexabloom/Streamzone family CDNs.
              const NEXABLOOM_CDN = /kryntal|norami|imgnex|shiora|mikora|akirax|dokicloud/i;
              if (!isHardSub && NEXABLOOM_CDN.test(m3u8Url) &&
                  (m3u8Url.includes('/master.m3u8') || m3u8Url.includes('/index.m3u8'))) {
                subs.push({
                  id: 0,
                  label: 'English',
                  file: m3u8Url.replace(/\/(?:master|index)\.m3u8.*$/, '/subtitles/track_0_eng.vtt'),
                  referer: origin + '/',
                  default: true
                });
              }
            }
            return {
              url: m3u8Url,
              streamUrl: m3u8Url,
              videoUrl: m3u8Url,
              subtitles: subs,
              referer: origin + '/',
              toString() { return m3u8Url; },
              valueOf() { return m3u8Url; }
            };
          }
        } catch {}
      }
    }

    return null;
  } catch (err) {
    console.warn('[EmbedScraper] scrapeEmbedDirectly error:', err.message);
    return null;
  }
}

/**
 * Scrape an embed URL using the native hidden WebView.
 *
 * @param {string} embedUrl  - The embed page URL (e.g. https://play.echovideo.ru/embed-1/...)
 * @param {string} referer   - The parent page URL (e.g. https://aniwaves.ru/watch/...)
 * @param {number} timeoutMs - Max ms to wait for capture (default 40000)
 * @returns {Promise<Object|string>} The captured .m3u8 URL and subtitle tracks
 */
export function scrapeEmbedNative(embedUrl, referer, timeoutMs = 8000, options = {}) {
  // ── Fast path: return cached URL if available (e.g. already watched this episode) ──
  const cachedUrl = getCachedM3U8(embedUrl);
  if (cachedUrl) {
    console.log('[EmbedScraper] Using cached m3u8 URL (instant, no Cloudflare needed)');
    const isHardSub = (embedUrl || '').toLowerCase().includes('hardsub') || (embedUrl || '').toLowerCase().includes('hard');
    const NEXABLOOM_CDN = /kryntal|norami|imgnex|shiora|mikora|akirax|dokicloud/i;
    let subs = [];
    if (!isHardSub && NEXABLOOM_CDN.test(cachedUrl) &&
        typeof cachedUrl === 'string' &&
        (cachedUrl.includes('/master.m3u8') || cachedUrl.includes('/index.m3u8'))) {
      subs.push({
        id: 0,
        label: 'English',
        file: cachedUrl.replace(/\/(?:master|index)\.m3u8.*$/, '/subtitles/track_0_eng.vtt'),
        referer: referer || (new URL(embedUrl).origin + '/'),
        default: true
      });
    }
    return Promise.resolve({
      url: cachedUrl,
      streamUrl: cachedUrl,
      videoUrl: cachedUrl,
      subtitles: subs,
      toString() { return cachedUrl; },
      valueOf() { return cachedUrl; }
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let listenerHandle = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (listenerHandle) listenerHandle.remove();
      if (isNative && NativeEmbedScraper) {
        NativeEmbedScraper.stopScrape({ sessionId }).catch(() => {});
      }
    };

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Fast path: Attempt direct HTTP & WebCrypto decryption first (<500ms)
    // resolveMegaPlayStream decrypts enc tokens in <1ms and unpackUniversalJS handles packed JS in <200ms
    if (options?.skipDirect) {
      startWebViewScrape();
    } else {
      scrapeEmbedDirectly(embedUrl, referer)
        .then(directResult => {
          if (directResult) {
            settled = true;
            const directUrl = directResult.url || directResult.videoUrl || String(directResult);
            cacheM3U8Url(embedUrl, directUrl);
            resolve(directResult);
            return;
          }
          startWebViewScrape();
        })
        .catch(err => {
          console.warn('[EmbedScraper] Direct HTTP resolve failed, using WebView fallback:', err.message);
          startWebViewScrape();
        });
    }

    function startWebViewScrape() {
      if (!isNative || !NativeEmbedScraper) {
        // Dev browser fallback — wait forever, IframePlayer handles it
        return;
      }

      // Listen for the native plugin to fire the captured URL
      NativeEmbedScraper.addListener('streamCaptured', (data) => {
        if (settled) return;
        if (data.sessionId !== sessionId) return;
        settled = true;
        cleanup();
        console.log('[EmbedScraper] Native captured m3u8:', (data.url || '').slice(0, 100));
        cacheM3U8Url(embedUrl, data.url); // cache for future downloads

        let embedOrigin = '';
        try {
          if (embedUrl) embedOrigin = new URL(embedUrl).origin + '/';
        } catch (_) {}

        let finalSubs = (data.subtitles || []).map((s, idx) => ({
          id: idx,
          label: s.label || guessSubtitleLabel(s.file, `Track ${idx + 1}`),
          file: s.file,
          referer: embedOrigin || referer,
          default: !!s.default
        }));

        const isHardSub = (embedUrl || '').toLowerCase().includes('hardsub') || (embedUrl || '').toLowerCase().includes('hard');
        const NEXABLOOM_CDN = /kryntal|norami|imgnex|shiora|mikora|akirax|dokicloud/i;
        // Only guess the sidecar subtitle path for Nexabloom/Streamzone CDN domains.
        // For other CDNs (otakuhg, otakuvid, echovideo) the path 404s — skip the guess.
        if (!isHardSub && finalSubs.length === 0 && data.url &&
            NEXABLOOM_CDN.test(data.url) &&
            (data.url.includes('/master.m3u8') || data.url.includes('/index.m3u8'))) {
          finalSubs.push({
            id: 0,
            label: 'English',
            file: data.url.replace(/\/(?:master|index)\.m3u8.*$/, '/subtitles/track_0_eng.vtt'),
            referer: embedOrigin || referer,
            default: true
          });
        }

        const resultObj = {
          url: data.url,
          streamUrl: data.url,
          videoUrl: data.url,
          subtitles: finalSubs,
          referer,
          toString() { return data.url; },
          valueOf() { return data.url; }
        };

        resolve(resultObj);
      }).then(handle => {
        listenerHandle = handle;
      });

      // Start the native hidden WebView scrape
      NativeEmbedScraper.startScrape({ url: embedUrl, referer, sessionId })
        .catch(err => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`EmbedScraper.startScrape failed: ${err.message}`));
          }
        });

      // Timeout
      timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('EmbedScraper: timed out waiting for stream'));
        }
      }, timeoutMs);
    }
  });
}

/**
 * Loads a domain in the background native WebView to resolve Cloudflare
 * Turnstile challenges. The WebView is kept alive after solving so that
 * fetchViaWebViewNative() can reuse the same authenticated session.
 *
 * @param {string} domainUrl   - The homepage URL to open (e.g. https://animepahe.com/)
 * @param {string} referer     - Referer header
 * @param {number} waitMs      - Max ms to wait for Turnstile to auto-solve
 * @param {boolean} keepAlive  - Keep the WebView alive after (default: true)
 */
export function solveCloudflareNative(domainUrl, referer, waitMs = 12000, keepAlive = true) {
  if (!isNative || !NativeEmbedScraper) {
    return Promise.resolve();
  }

  let cleanDomain = 'Website';
  try {
    cleanDomain = new URL(domainUrl).hostname.replace('www.', '');
  } catch {}

  const sessionId = `cf-solve-${Date.now()}`;
  return new Promise((resolve) => {
    console.log(`[EmbedScraper] solveCloudflareNative: Opening ${domainUrl} (keepAlive=${keepAlive})`);
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('show-cf-modal', { 
        detail: { domain: cleanDomain, visible: true } 
      }));
    }
    
    setWebViewVisibilityNative(true);

    NativeEmbedScraper.startScrape({ url: domainUrl, referer, sessionId })
      .catch(err => {
        console.warn('[EmbedScraper] solveCloudflareNative start failed:', err.message);
      });

    setTimeout(async () => {
      await setWebViewVisibilityNative(false);
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('show-cf-modal', { 
          detail: { domain: cleanDomain, visible: false } 
        }));
      }

      // CRITICAL: Only destroy WebView if keepAlive=false.
      // When keepAlive=true (default), we preserve the WebView session so that
      // fetchViaWebViewNative() can immediately reuse the cf_clearance cookies.
      if (!keepAlive) {
        NativeEmbedScraper.stopScrape({ sessionId }).catch(() => {});
      }
      console.log(`[EmbedScraper] solveCloudflareNative: Done waiting for ${domainUrl}`);
      resolve();
    }, waitMs);
  });
}

/**
 * Reads the native WebView CookieManager cookies for a given URL.
 */
export async function getCookiesForUrlNative(url) {
  if (!isNative || !NativeEmbedScraper) {
    return "";
  }
  try {
    const res = await NativeEmbedScraper.getCookiesForUrl({ url });
    return res?.cookies || "";
  } catch (e) {
    console.error('[EmbedScraper] getCookiesForUrlNative failed:', e.message);
    return "";
  }
}

export function setWebViewVisibilityNative(visible) {
  if (isNative && NativeEmbedScraper && NativeEmbedScraper.setWebViewVisibility) {
    return NativeEmbedScraper.setWebViewVisibility({ visible }).catch(e => {
      console.warn('[EmbedScraper] setWebViewVisibility failed:', e.message);
    });
  }
  return Promise.resolve();
}

/**
 * Fetches a URL FROM INSIDE the Android WebView's session.
 * This bypasses Cloudflare cookie binding — the fetch() runs in the same
 * browser context that solved Turnstile, so cf_clearance is automatically included.
 *
 * Returns the response body as a string, or null on failure.
 */
export async function fetchViaWebViewNative(url, referer, domainUrl) {
  if (!isNative || !NativeEmbedScraper || !NativeEmbedScraper.fetchViaWebView) {
    return null;
  }
  try {
    const res = await NativeEmbedScraper.fetchViaWebView({ url, referer: referer || '', domainUrl: domainUrl || '' });
    if (res && res.body) {
      // The body is a JSON string: { status, body } or { error }
      try {
        const parsed = JSON.parse(res.body);
        if (parsed.error) throw new Error(parsed.error);
        return parsed.body || null;
      } catch {
        // Body itself is the raw response
        return res.body;
      }
    }
    return null;
  } catch (e) {
    console.error('[EmbedScraper] fetchViaWebViewNative failed:', e.message);
    return null;
  }
}

/**
 * Extracts data-embed-id attribute values from a URL using the WebView's fetch() context.
 * Unlike fetchViaWebViewNative (which returns full HTML and has size/escaping issues with 273KB pages),
 * this runs the regex extraction IN JavaScript and returns only the tiny embed-ID array.
 * Returns string[] of embed IDs, or null on failure.
 */
export async function extractEmbedIdsNative(url, referer) {
  if (!isNative || !NativeEmbedScraper || !NativeEmbedScraper.extractEmbedIds) {
    return null;
  }
  try {
    const origin = new URL(url).origin;
    const res = await NativeEmbedScraper.extractEmbedIds({
      url,
      referer: referer || origin + '/',
      domainUrl: origin
    });
    if (res && res.body) {
      try {
        const parsed = JSON.parse(res.body);
        if (parsed.ok && Array.isArray(parsed.ids)) {
          console.log(`[EmbedScraper] extractEmbedIdsNative: found ${parsed.ids.length} embed IDs`);
          return parsed.ids;
        }
        if (parsed.error) throw new Error(parsed.error);
      } catch (parseErr) {
        console.warn('[EmbedScraper] extractEmbedIdsNative parse failed:', parseErr.message);
      }
    }
    return null;
  } catch (e) {
    console.error('[EmbedScraper] extractEmbedIdsNative failed:', e.message);
    return null;
  }
}

/**
 * Loads an anime series page in background WebView and extracts the exact episode watch URL.
 */
export async function extractWatchLinkNative(animeUrl, episode) {
  if (!isNative || !NativeEmbedScraper || !NativeEmbedScraper.extractWatchLink) {
    return null;
  }
  try {
    const origin = new URL(animeUrl).origin;
    const res = await NativeEmbedScraper.extractWatchLink({
      url: animeUrl,
      episode: Number(episode),
      referer: origin + '/'
    });
    if (res && res.body) {
      try {
        const parsed = JSON.parse(res.body);
        if (parsed.ok && parsed.watchUrl) {
          console.log(`[EmbedScraper] extractWatchLinkNative found link for ep ${episode}: ${parsed.watchUrl}`);
          return parsed.watchUrl;
        }
      } catch (parseErr) {
        console.warn('[EmbedScraper] extractWatchLinkNative parse failed:', parseErr.message);
      }
    }
    return null;
  } catch (e) {
    console.warn('[EmbedScraper] extractWatchLinkNative failed:', e.message);
    return null;
  }
}

/**
 * Loads any URL in native WebView and returns the full rendered HTML.
 * This bypasses Cloudflare challenges because it uses a real browser engine.
 * Used as a fallback for fetching pages that require JavaScript rendering.
 */
export async function fetchHtmlNative(url, referer, timeoutMs = 10000) {
  if (!isNative || !NativeEmbedScraper || !NativeEmbedScraper.fetchHtml) {
    return null;
  }
  try {
    const res = await NativeEmbedScraper.fetchHtml({
      url,
      referer: referer || '',
      timeoutMs: Number(timeoutMs)
    });
    if (res && res.html && res.html.length > 100) {
      console.log(`[EmbedScraper] fetchHtmlNative success for ${url}: ${res.html.length} chars`);
      return res.html;
    }
    return null;
  } catch (e) {
    console.warn('[EmbedScraper] fetchHtmlNative failed:', e.message);
    return null;
  }
}

/**
 * fetchSegmentViaBrowser — Downloads an HLS binary segment (TS/M4S) via the WebView's
 * full browser context (Chrome TLS, CDN session cookies, cf_clearance).
 *
 * This is the ONLY way to bypass Cloudflare Bot Management on CDNs like vidplay.site:
 * - WebView has Chromium's TLS fingerprint (Chrome JA3/JA4) — OkHttp does not
 * - WebView has all CDN cookies including cf_clearance
 * - fetch() runs in same security origin context as the embed player
 *
 * @param {string} url - HLS segment URL (.ts or .m4s)
 * @param {string} referer - Referer header to include
 * @returns {Promise<string>} base64-encoded binary segment data
 */
export async function fetchSegmentViaBrowser(url, referer = '') {
  if (!isNative || !NativeEmbedScraper) {
    throw new Error('[EmbedScraper] Native plugin not available');
  }
  try {
    const result = await NativeEmbedScraper.fetchSegmentBinary({ url, referer });
    if (!result || !result.data) throw new Error('Empty segment data');
    return result.data; // base64-encoded binary
  } catch (e) {
    throw new Error(`fetchSegmentViaBrowser failed for ${url.slice(0, 60)}: ${e.message}`);
  }
}
