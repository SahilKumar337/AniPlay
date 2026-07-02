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
import { ArrowLeft, Loader, AlertCircle } from 'lucide-react';

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
    // Extract the actual embed URL if wrapped in iframe-proxy query
    let targetUrl = embedUrl;
    try {
      const parsed = new URL(embedUrl);
      const inner = parsed.searchParams.get('url');
      if (inner) targetUrl = inner;
    } catch {}

    console.log('[IframePlayer] Fetching embed HTML via CapacitorHttp:', targetUrl.slice(0, 100));

    const resp = await CapacitorHttp.request({
      url: targetUrl,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        'Referer': new URL(targetUrl).origin + '/',
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
  const [status, setStatus] = useState('loading'); // 'loading' | 'playing' | 'timeout'
  const [iframeSrc, setIframeSrc] = useState('');
  const timerRef = useRef(null);
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
      // Add cache-buster only for non-blob URLs
      const withBust = prepared.startsWith('blob:')
        ? prepared
        : (prepared.includes('?') ? `${prepared}&_t=${Date.now()}` : `${prepared}?_t=${Date.now()}`);
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

      // ── Embed page shows a file-deleted / error page ─────────
      if (data.type === 'EMBED_ERROR') {
        console.warn('[IframePlayer] Embed error detected:', data.reason);
        // Notify parent so it can auto-switch to next server
        onStreamCaptured(null, null, { error: true, reason: data.reason });
        setStatus('error');
      }
    };

    window.addEventListener('message', handleMessage);

    // Timeout after 40 seconds if no stream captured
    timerRef.current = setTimeout(() => {
      setStatus(prev => prev === 'loading' ? 'timeout' : prev);
    }, 40000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timerRef.current);
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

      {/* ── Black loading overlay ──────────────────────────────── */}
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

      {/* ── Timeout overlay ───────────────────────────────────── */}
      {status === 'timeout' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 14, background: 'rgba(0,0,0,0.88)', zIndex: 10,
          padding: 24, textAlign: 'center',
        }}>
          <AlertCircle size={44} color="#e50914" style={{ opacity: 0.75 }} />
          <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0 }}>
            Stream taking too long
          </p>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0, maxWidth: 260, lineHeight: 1.6 }}>
            The player is loading. Tap below to interact with it directly.
          </p>
          <button
            onClick={() => setStatus('playing')}
            style={{
              marginTop: 6, padding: '10px 22px',
              background: '#e50914', color: '#fff',
              border: 'none', borderRadius: 20,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Show Player
          </button>
        </div>
      )}

      {/* ── Back button ───────────────────────────────────────── */}
      {onBack && (
        <button
          onClick={onBack}
          style={{
            position: 'absolute', top: 10, left: 10, zIndex: 20,
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff',
          }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
