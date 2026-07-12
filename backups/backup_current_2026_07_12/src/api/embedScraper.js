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

import { registerPlugin } from '@capacitor/core';

const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

// Register the native plugin (only active on Android)
const NativeEmbedScraper = isNative
  ? registerPlugin('EmbedScraper')
  : null;

/**
 * Scrape an embed URL using the native hidden WebView.
 *
 * @param {string} embedUrl  - The embed page URL (e.g. https://play.echovideo.ru/embed-1/...)
 * @param {string} referer   - The parent page URL (e.g. https://aniwaves.ru/watch/...)
 * @param {number} timeoutMs - Max ms to wait for capture (default 40000)
 * @returns {Promise<string>} The captured .m3u8 URL
 */
export function scrapeEmbedNative(embedUrl, referer, timeoutMs = 40000) {
  if (!isNative || !NativeEmbedScraper) {
    // Dev browser fallback — never resolves, IframePlayer handles it
    return new Promise(() => {});
  }

  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let listenerHandle = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (listenerHandle) listenerHandle.remove();
      NativeEmbedScraper.stopScrape({ sessionId }).catch(() => {});
    };

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

