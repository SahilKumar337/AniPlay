/**
 * IframePlayer — Sandboxed embed player wrapper
 *
 * Renders a third-party embed page inside a properly-sized iframe.
 * The iframe page has a JS interceptor injected server-side (via /api/iframe-proxy).
 * When the embed player loads its .m3u8, the injected script fires a postMessage.
 * This component catches that message and calls onStreamCaptured(m3u8Url, referer).
 *
 * Also shows a "Loading player..." overlay while waiting, and an error after 40 seconds.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader, AlertCircle, ExternalLink } from 'lucide-react';

export default function IframePlayer({ src, onBack, onStreamCaptured }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'playing' | 'timeout' | 'error'
  const timerRef = useRef(null);
  const iframeRef = useRef(null);

  // Compute the iframe src — add a cache-buster to force fresh load
  const iframeSrc = src
    ? (src.includes('?') ? `${src}&_t=${Date.now()}` : `${src}?_t=${Date.now()}`)
    : '';

  useEffect(() => {
    if (src && !src.includes('iframe-proxy')) {
      setStatus('playing');
    }
  }, [src]);

  useEffect(() => {
    // Handle postMessage from the sandboxed iframe
    const handleMessage = (event) => {
      const data = event.data;
      if (!data || data.type !== 'NATIVE_STREAM_URL' || !data.url) return;

      const streamUrl = data.url;
      console.log('[IframePlayer] Captured stream URL:', streamUrl.slice(0, 120));

      // Skip already-proxied URLs
      if (
        streamUrl.includes('anilab-backend.onrender.com') ||
        streamUrl.includes('localhost:4000')
      ) {
        onStreamCaptured(streamUrl, '');
        setStatus('playing');
        return;
      }

      // Determine referer from the embed src URL
      let referer = 'https://aniwaves.ru/';
      try {
        const srcObj = new URL(src);
        const embedUrl = srcObj.searchParams.get('url');
        if (embedUrl) {
          referer = new URL(embedUrl).origin;
        }
      } catch {}

      onStreamCaptured(streamUrl, referer);
      setStatus('playing');
    };

    window.addEventListener('message', handleMessage);

    // Show timeout warning after 40 seconds if no stream captured
    timerRef.current = setTimeout(() => {
      setStatus(prev => prev === 'loading' ? 'timeout' : prev);
    }, 40000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timerRef.current);
    };
  }, [src, onStreamCaptured]);

  // Mark as playing once iframe loads (content may start playing)
  const handleIframeLoad = () => {
    // Don't hide spinner immediately — wait for postMessage to confirm stream is ready
    // But do hide after a short grace period in case postMessage already fired
    setTimeout(() => setStatus(prev => prev === 'loading' ? 'playing' : prev), 5000);
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      paddingTop: '56.25%', /* 16:9 aspect ratio via padding trick */
      background: '#000',
      overflow: 'hidden',
    }}>
      {/* ── iframe fills the padded box absolutely ─────────── */}
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        onLoad={handleIframeLoad}
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

      {/* ── Loading overlay ─────────────────────────────────── */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 14, background: 'rgba(0,0,0,0.82)',
          zIndex: 10, pointerEvents: 'none',
        }}>
          <Loader size={44} color="#e50914" style={{ animation: 'spin 0.9s linear infinite' }} />
          <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0 }}>
            Loading stream…
          </p>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, margin: 0 }}>
            Connecting to server
          </p>
        </div>
      )}

      {/* ── Timeout overlay ─────────────────────────────────── */}
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
            The embedded player is slow. Try dismissing this overlay to interact with the player directly.
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

      {/* ── Back button (always on top) ──────────────────────── */}
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
