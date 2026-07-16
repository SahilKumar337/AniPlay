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

const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

// Register the native plugin (only active on Android)
const NativeEmbedScraper = isNative
  ? registerPlugin('EmbedScraper')
  : null;

/**
 * Fast direct HTTP extractor for known embed providers.
 * Resolves streams in <200ms without opening a heavy native WebView.
 */
async function scrapeEmbedDirectly(embedUrl, referer) {
  try {
    if (!embedUrl) return null;
    const urlObj = new URL(embedUrl);
    const origin = urlObj.origin;
    
    console.log(`[EmbedScraper] scrapeEmbedDirectly: ${embedUrl.slice(0, 120)}`);
    
    let html = '';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
      'Referer': referer || (origin + '/')
    };
    
    if (Capacitor.isNativePlatform()) {
      const resp = await CapacitorHttp.request({
        url: embedUrl,
        method: 'GET',
        headers,
        responseType: 'text'
      });
      html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    } else {
      let fetchUrl = embedUrl;
      if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        fetchUrl = `/api/scrape?url=${encodeURIComponent(embedUrl)}&referer=${encodeURIComponent(referer || origin + '/')}`;
      }
      const res = await fetch(fetchUrl, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    }
    
    if (!html) return null;
    
    // 1. Direct .m3u8 scan (e.g. vivibebe.site)
    const directM3u8Match = html.match(/const\s+src\s*=\s*"([^"]+\.m3u8[^"]*)"/i) ||
                           html.match(/src\s*:\s*"([^"]+\.m3u8[^"]*)"/i) ||
                           html.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i) ||
                           html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
                           
    if (directM3u8Match) {
      const m3u8Url = directM3u8Match[1].replace(/\\/g, '');
      console.log('[EmbedScraper] Found direct .m3u8 link: ' + m3u8Url.slice(0, 100));
      return m3u8Url;
    }
    
    // 2. getSourcesNew API scan (e.g. megaplay.buzz, vidtube.site, vidwish.live)
    let fileId = '';
    const fileIdHtmlMatch = html.match(/File\s+(\d+)/i) || 
                            html.match(/"id"\s*:\s*(\d+)/i) ||
                            html.match(/cid\s*:\s*'([^']+)'/i);
                            
    if (fileIdHtmlMatch) {
      fileId = fileIdHtmlMatch[1];
    } else {
      const idInPathMatch = embedUrl.match(/\/(?:stream|embed)\/[^/]+\/(\d+)/i) ||
                            embedUrl.match(/\/(?:stream|embed)\/(\d+)/i);
      if (idInPathMatch) fileId = idInPathMatch[1];
    }
    
    if (fileId) {
      const playType = embedUrl.toLowerCase().includes('dub') ? 'dub' : 'sub';
      const apiUrl = `${origin}/stream/getSourcesNew?id=${fileId}&type=${playType}&id=${fileId}&type=${playType}`;
      console.log(`[EmbedScraper] Querying getSourcesNew: ${apiUrl}`);
      
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
          responseType: 'text'
        });
        apiText = typeof apiResp.data === 'string' ? apiResp.data : JSON.stringify(apiResp.data);
      } else {
        let fetchApiUrl = apiUrl;
        if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          fetchApiUrl = `/api/scrape?url=${encodeURIComponent(apiUrl)}&referer=${encodeURIComponent(embedUrl)}`;
        }
        const apiRes = await fetch(fetchApiUrl, { headers: apiHeaders });
        apiText = await apiRes.text();
      }
      
      if (apiText) {
        const json = JSON.parse(apiText);
        const m3u8Url = json.sources?.file || json.sources?.[0]?.file;
        if (m3u8Url) {
          console.log('[EmbedScraper] Resolved stream from getSourcesNew: ' + m3u8Url.slice(0, 100));
          return m3u8Url;
        }
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
 * @returns {Promise<string>} The captured .m3u8 URL
 */
export function scrapeEmbedNative(embedUrl, referer, timeoutMs = 40000) {
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

    // 1. Try fast direct HTTP resolution first
    scrapeEmbedDirectly(embedUrl, referer)
      .then(directUrl => {
        if (directUrl) {
          settled = true;
          resolve(directUrl);
          return;
        }
        // Direct resolve returned null, proceed with native WebView fallback
        startWebViewScrape();
      })
      .catch(err => {
        console.warn('[EmbedScraper] Direct HTTP resolve failed, using WebView fallback:', err.message);
        startWebViewScrape();
      });

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
        console.log('[EmbedScraper] Native captured m3u8:', data.url.slice(0, 100));
        resolve(data.url);
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

