/**
 * IframePlayer — Way 4 Client-Side WebView Scraping
 *
 * On Android (Capacitor native):
 *   1. Fetches the embed page HTML via CapacitorHttp (CORS-free, native)
 *   2. Injects an m3u8 interceptor script + <base> tag into the HTML
 *   3. Loads the modified HTML as a blob: URL in the iframe
 *   4. When the embed player fetches its .m3u8, the injector fires postMessage
 *   5. We capture the URL and hand it to AniPlayer (native HLS) — zero server calls
 *
 * On desktop browser dev:
 *   Falls back to loading the src directly in the iframe (proxy handles injection there).
 */

import { useEffect, useRef, useState } from 'react';
import { CapacitorHttp } from '@capacitor/core';
import { Loader } from 'lucide-react';

const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

/* The JS snippet injected into embed pages to intercept HLS fetch/XHR calls */
const INTERCEPTOR_SCRIPT = `
(function() {
  var _captured = false;
  var _errorSent = false;

  function capture(url) {
    if (_captured) return;
    if (!url || typeof url !== 'string') return;
    var lower = url.toLowerCase().split('?')[0];
    if (!lower.endsWith('.m3u8') && !lower.includes('.m3u8')) return;
    _captured = true;
    console.log('[Interceptor] Captured HLS URL:', url.slice(0, 120));
    window.parent.postMessage({ type: 'NATIVE_STREAM_URL', url: url }, '*');
  }

  /* Scan DOM for "file deleted" error messages (echovideo, vidplay, megacloud etc.) */
  function scanForError() {
    if (_captured || _errorSent) return;
    var body = document.body && document.body.innerText;
    if (!body) return;
    var errorPhrases = [
      "we can't find the file",
      "file you are looking for",
      "deleted by the owner",
      "copyright violation",
      "404",
      "not found",
      "video not available",
      "this video is unavailable",
      "we're sorry",
      "we are sorry",
    ];
    var lower = body.toLowerCase();
    for (var i = 0; i < errorPhrases.length; i++) {
      if (lower.includes(errorPhrases[i])) {
        _errorSent = true;
        console.log('[Interceptor] Detected embed error:', errorPhrases[i]);
        window.parent.postMessage({ type: 'EMBED_ERROR', reason: errorPhrases[i] }, '*');
        return;
      }
    }
  }

  /* Intercept fetch */
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    capture(url);
    return _fetch.apply(this, arguments);
  };

  /* Intercept XMLHttpRequest */
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    capture(url);
    return _open.apply(this, arguments);
  };

  /* Intercept video src assignments */
  var _srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (_srcDesc && _srcDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      set: function(val) {
        capture(val);
        return _srcDesc.set.call(this, val);
      },
      get: _srcDesc.get,
    });
  }

  /* Periodic scan for video sources added dynamically */
  setInterval(function() {
    document.querySelectorAll('video[src],source[src]').forEach(function(el) {
      capture(el.src || el.getAttribute('src'));
    });
    scanForError(); // also check for error pages
  }, 800);

  /* Check immediately on DOMContentLoaded */
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(scanForError, 1500);
    setTimeout(scanForError, 4000);
  });
})();
`;

/**
 * On Android: fetch embed HTML natively, inject interceptor, return blob URL.
 * On desktop: return the src as-is (relies on local dev proxy to inject).
 */
async function prepareIframeSrc(embedUrl) {
  if (!isNative || !embedUrl) return embedUrl;

  try {
    // Extract the actual embed URL and original referer if wrapped in proxy query
    let targetUrl = embedUrl;
    let refererHeader = '';
    try {
      const parsed = new URL(embedUrl);
      const inner = parsed.searchParams.get('url');
      if (inner) targetUrl = inner;
      const refParam = parsed.searchParams.get('referer');
      if (refParam) refererHeader = refParam;
    } catch {}

    if (!refererHeader) {
      try {
        refererHeader = new URL(targetUrl).origin + '/';
      } catch {}
    }

    console.log('[IframePlayer] Fetching embed HTML via CapacitorHttp:', targetUrl.slice(0, 100));
    console.log('[IframePlayer] Using Referer header:', refererHeader);

    const resp = await CapacitorHttp.request({
      url: targetUrl,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        'Referer': refererHeader,
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      responseType: 'text',
    });

    if (resp.status >= 400) {
      console.warn('[IframePlayer] Embed fetch failed with status', resp.status);
      return targetUrl; // fallback: load directly
    }

    let html = resp.data;
    const origin = new URL(targetUrl).origin;

    // Inject <base href> so relative URLs resolve correctly against the embed origin
    const baseTag = `<base href="${origin}/">`;
    // Inject our interceptor script right after <head> (or at top if no head)
    const interceptorTag = `<script>${INTERCEPTOR_SCRIPT}<\/script>`;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}${interceptorTag}`);
    } else if (html.includes('<head ')) {
      html = html.replace(/(<head[^>]*>)/, `$1${baseTag}${interceptorTag}`);
    } else {
      html = interceptorTag + baseTag + html;
    }

    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    console.log('[IframePlayer] Blob URL created with injected interceptor');
    return blobUrl;
  } catch (e) {
    console.warn('[IframePlayer] HTML injection failed, falling back to direct load:', e.message);
    return embedUrl;
  }
}

export default function IframePlayer({ src, onBack, onStreamCaptured }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'playing'
  const [iframeSrc, setIframeSrc] = useState('');
  const blobUrlRef = useRef(null);
  const iframeRef = useRef(null);

  // Prepare the iframe src with JS injection on mount / src change
  useEffect(() => {
    if (!src) return;
    setStatus('loading');
    setIframeSrc('');

    // Revoke previous blob URL to avoid memory leaks
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    prepareIframeSrc(src).then(prepared => {
      if (prepared.startsWith('blob:')) {
        blobUrlRef.current = prepared;
      }
      // Add cache-buster to avoid cache issues
      const withBust = prepared.startsWith('blob:')
        ? prepared
        : (prepared.includes('?') 
            ? `${prepared}&_t=${Date.now()}` 
            : `${prepared}?_t=${Date.now()}`);
      setIframeSrc(withBust);
    });

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [src]);

  // Listen for postMessage from the injected interceptor
  useEffect(() => {
    const handleMessage = (event) => {
      const data = event.data;
      if (!data) return;

      // ── Stream captured successfully ─────────────────────────
      if (data.type === 'NATIVE_STREAM_URL' && data.url) {
        const streamUrl = data.url;
        console.log('[IframePlayer] Captured stream URL:', streamUrl.slice(0, 120));

        let referer = 'https://aniwaves.ru/';
        try {
          const srcObj = new URL(src);
          const embedUrl = srcObj.searchParams.get('url');
          if (embedUrl) referer = new URL(embedUrl).origin + '/';
          else referer = new URL(src).origin + '/';
        } catch {}

        onStreamCaptured(streamUrl, referer);
        setStatus('playing');
      }

      // ── Embed page shows a file-deleted / error — log silently, keep spinner ──
      if (data.type === 'EMBED_ERROR') {
        console.warn('[IframePlayer] Embed error detected (continuing to wait):', data.reason);
      }
    };

    window.addEventListener('message', handleMessage);
    // No timeout — spinner stays until stream is captured

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [src, onStreamCaptured]);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      paddingTop: '56.25%',
      background: '#000',
      overflow: 'hidden',
    }}>
      {/* iframe — hidden behind the overlay until stream is captured */}
      {iframeSrc && (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups"
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="Video Player"
        />
      )}

      {/* ── Infinite loading overlay (shown until stream is captured) ── */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: '#000',
          zIndex: 10, pointerEvents: 'none',
        }}>
          <Loader size={38} color="rgba(255,255,255,0.7)" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
