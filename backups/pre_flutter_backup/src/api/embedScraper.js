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
