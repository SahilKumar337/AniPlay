import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  RotateCcw, RotateCw, Loader, Settings, ChevronLeft
} from 'lucide-react';

const fmt = (sec) => {
  if (!sec || isNaN(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m}:${s.toString().padStart(2,'0')}`;
};

export default function VideoPlayer({ src, isM3U8 = false, poster, onError, title }) {
  const videoRef       = useRef(null);
  const hlsRef         = useRef(null);
  const containerRef   = useRef(null);
  const hideTimer      = useRef(null);
  const seekFeedback   = useRef(null);
  const progressRef    = useRef(null);
  const dragging       = useRef(false);

  const [playing,    setPlaying]    = useState(false);
  const [muted,      setMuted]      = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [errored,    setErrored]    = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [buffered,   setBuff]       = useState(0);
  const [duration,   setDuration]   = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showCtrl,   setShowCtrl]   = useState(true);
  const [seekLabel,  setSeekLabel]  = useState(null); // { dir, secs }
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [quality,    setQuality]    = useState('Auto');
  const [showQual,   setShowQual]   = useState(false);
  const [qualities,  setQualities]  = useState([]);

  // ── Source loading ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!src || !video) return;

    setLoading(true);
    setErrored(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (isM3U8 && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        startLevel: -1,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetries: 10,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setLoading(false);
        // Extract quality levels
        const levels = data.levels || [];
        const quals = levels.map((l, i) => ({ label: l.height ? `${l.height}p` : `Level ${i}`, index: i }));
        setQualities(quals.length > 1 ? [{ label: 'Auto', index: -1 }, ...quals] : []);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { setErrored(true); setLoading(false); onError?.(); }
      });
      hlsRef.current = hls;
    } else if (isM3U8 && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (iOS Safari)
      video.src = src;
      video.load();
    } else {
      video.src = src;
      video.load();
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [src, isM3U8, onError]);

  // ── Auto-hide controls ──────────────────────────────────────
  const resetHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current);
    setShowCtrl(true);
    if (playing) {
      hideTimer.current = setTimeout(() => setShowCtrl(false), 3500);
    }
  }, [playing]);

  useEffect(() => {
    if (playing) {
      hideTimer.current = setTimeout(() => setShowCtrl(false), 3500);
    } else {
      clearTimeout(hideTimer.current);
      setShowCtrl(true);
    }
    return () => clearTimeout(hideTimer.current);
  }, [playing]);

  // ── Fullscreen detection ─────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Tap to toggle controls ──────────────────────────────────
  const handleContainerClick = (e) => {
    // Ignore clicks on control elements
    if (e.target.closest('#ctrl-bar') || e.target.closest('#ctrl-top')) return;
    resetHideTimer();
    if (showCtrl && playing) {
      // Second tap = hide controls immediately
      clearTimeout(hideTimer.current);
      setShowCtrl(false);
    }
  };

  const handleVideoClick = () => {
    togglePlay();
    resetHideTimer();
  };

  // ── Double-tap seek (left = -10s, right = +10s) ─────────────
  const lastTap = useRef({ time: 0, x: 0 });
  const handleDoubleTap = (e) => {
    const now = Date.now();
    const containerW = containerRef.current?.offsetWidth || 400;
    const tapX = e.changedTouches?.[0]?.clientX || e.clientX;
    const isLeft = tapX < containerW / 2;

    if (now - lastTap.current.time < 300) {
      // Double tap
      e.preventDefault();
      e.stopPropagation();
      const video = videoRef.current;
      if (!video) return;
      const delta = isLeft ? -10 : 10;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
      setSeekLabel({ dir: isLeft ? 'left' : 'right', secs: Math.abs(delta) });
      clearTimeout(seekFeedback.current);
      seekFeedback.current = setTimeout(() => setSeekLabel(null), 800);
    } else {
      // Single tap — toggle play/pause
      if (!e.target.closest('#ctrl-bar') && !e.target.closest('#ctrl-top')) {
        togglePlay();
      }
    }
    lastTap.current = { time: now, x: tapX };
  };

  // ── Controls actions ─────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seekBy = (delta) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    resetHideTimer();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const setQualityLevel = (index) => {
    setShowQual(false);
    setQuality(index === -1 ? 'Auto' : qualities.find(q => q.index === index)?.label || 'Auto');
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
    }
  };

  // ── Progress bar drag ─────────────────────────────────────────
  const getProgressRatio = (e) => {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onProgressPointerDown = (e) => {
    e.preventDefault();
    dragging.current = true;
    resetHideTimer();
    const ratio = getProgressRatio(e);
    setProgress(ratio * 100);
    if (videoRef.current?.duration) {
      videoRef.current.currentTime = ratio * videoRef.current.duration;
    }
  };

  const onProgressPointerMove = (e) => {
    if (!dragging.current) return;
    const ratio = getProgressRatio(e);
    setProgress(ratio * 100);
    if (videoRef.current?.duration) {
      videoRef.current.currentTime = ratio * videoRef.current.duration;
    }
  };

  const onProgressPointerUp = () => { dragging.current = false; };

  // ── Error state ───────────────────────────────────────────────
  if (errored) return (
    <div style={{
      aspectRatio: '16/9', background: '#000',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', padding: '0 20px' }}>
        Stream failed — try another server
      </p>
    </div>
  );

  const controlsVisible = showCtrl || !playing;

  return (
    <div
      ref={containerRef}
      id="video-player-container"
      style={{
        position: 'relative',
        background: '#000',
        aspectRatio: '16/9',
        overflow: 'hidden',
        userSelect: 'none',
        cursor: controlsVisible ? 'default' : 'none',
        touchAction: 'manipulation',
      }}
      onTouchEnd={handleDoubleTap}
      onClick={(e) => { if (window.PointerEvent) return; handleContainerClick(e); }}
      onPointerUp={(e) => { onProgressPointerUp(e); }}
      onPointerMove={(e) => { onProgressPointerMove(e); }}
    >
      {/* ── Video Element (completely clean, no browser controls) ── */}
      <video
        ref={videoRef}
        poster={poster || undefined}
        controls={false}
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }}
        onPlay={() => { setPlaying(true); }}
        onPause={() => { setPlaying(false); }}
        onTimeUpdate={e => {
          const v = e.target;
          if (v.duration) {
            setProgress((v.currentTime / v.duration) * 100);
            setCurrentTime(v.currentTime);
          }
        }}
        onProgress={e => {
          const v = e.target;
          if (v.duration && v.buffered.length) {
            setBuff((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
          }
        }}
        onLoadedMetadata={e => { setDuration(e.target.duration); setLoading(false); }}
        onCanPlay={() => setLoading(false)}
        onError={() => { setErrored(true); setLoading(false); onError?.(); }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
      />

      {/* ── Loading Spinner (pure black bg) ─────────────────── */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: '#000',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 10,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#e50914',
            animation: 'spin 0.85s linear infinite',
          }} />
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Loading stream…</p>
        </div>
      )}

      {/* ── Double Tap Seek Feedback ─────────────────────────── */}
      {seekLabel && (
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0,
          [seekLabel.dir === 'left' ? 'left' : 'right']: 0,
          width: '45%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: seekLabel.dir === 'left' ? '0 999px 999px 0' : '999px 0 0 999px',
          pointerEvents: 'none', zIndex: 8,
          gap: 4,
          animation: 'fadeIn 0.15s ease',
        }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 0, height: 0,
                borderStyle: 'solid',
                borderWidth: seekLabel.dir === 'left' ? '7px 12px 7px 0' : '7px 0 7px 12px',
                borderColor: seekLabel.dir === 'left'
                  ? 'transparent #fff transparent transparent'
                  : 'transparent transparent transparent #fff',
                opacity: 0.4 + i * 0.3,
              }} />
            ))}
          </div>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
            {seekLabel.secs}s
          </span>
        </div>
      )}

      {/* ── Controls Overlay ─────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', inset: 0, zIndex: 5,
          opacity: controlsVisible ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: controlsVisible ? 'auto' : 'none',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          background: controlsVisible
            ? 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 65%, rgba(0,0,0,0.8) 100%)'
            : 'none',
        }}
        onClick={handleContainerClick}
      >
        {/* ── TOP BAR ──────────────────────────────────────── */}
        <div id="ctrl-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
          {title && (
            <span style={{
              color: '#fff', fontSize: 13, fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '70%', textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}>{title}</span>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {qualities.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={e => { e.stopPropagation(); setShowQual(v => !v); resetHideTimer(); }}
                  style={{
                    background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6,
                    color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 8px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Settings size={11} /> {quality}
                </button>
                {showQual && (
                  <div style={{
                    position: 'absolute', top: '110%', right: 0,
                    background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, overflow: 'hidden', minWidth: 90, zIndex: 20,
                  }}>
                    {qualities.map(q => (
                      <button
                        key={q.label}
                        onClick={e => { e.stopPropagation(); setQualityLevel(q.index); }}
                        style={{
                          display: 'block', width: '100%', padding: '8px 14px',
                          background: quality === q.label ? 'rgba(229,9,20,0.2)' : 'none',
                          color: quality === q.label ? '#e50914' : '#fff',
                          border: 'none', fontSize: 13, fontWeight: 500,
                          textAlign: 'left', cursor: 'pointer',
                        }}
                      >{q.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER CONTROLS (Play/Pause + Skip) ──────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Rewind 10s */}
          <button
            onClick={e => { e.stopPropagation(); seekBy(-10); }}
            style={{
              background: 'rgba(255,255,255,0.12)', border: 'none',
              borderRadius: '50%', width: 48, height: 48,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(4px)',
            }}
          >
            <RotateCcw size={20} color="#fff" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={e => { e.stopPropagation(); togglePlay(); resetHideTimer(); }}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none',
              borderRadius: '50%', width: 64, height: 64,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 20px rgba(0,0,0,0.5)',
            }}
          >
            {loading
              ? <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.8s linear infinite' }} />
              : playing
                ? <Pause size={28} fill="#fff" color="#fff" />
                : <Play size={28} fill="#fff" color="#fff" style={{ marginLeft: 3 }} />
            }
          </button>

          {/* Forward 10s */}
          <button
            onClick={e => { e.stopPropagation(); seekBy(10); }}
            style={{
              background: 'rgba(255,255,255,0.12)', border: 'none',
              borderRadius: '50%', width: 48, height: 48,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(4px)',
            }}
          >
            <RotateCw size={20} color="#fff" />
          </button>
        </div>

        {/* ── BOTTOM CONTROLS ──────────────────────────────── */}
        <div id="ctrl-bar" onClick={e => e.stopPropagation()} style={{ padding: '0 12px 10px' }}>
          {/* Progress bar */}
          <div
            ref={progressRef}
            style={{ height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '8px 0' }}
            onPointerDown={onProgressPointerDown}
          >
            <div style={{ position: 'relative', width: '100%', height: 4 }}>
              {/* Track */}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.2)', borderRadius: 4 }} />
              {/* Buffered */}
              <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: 'rgba(255,255,255,0.35)', borderRadius: 4, width: `${buffered}%` }} />
              {/* Played */}
              <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: '#e50914', borderRadius: 4, width: `${progress}%` }} />
              {/* Thumb */}
              <div style={{
                position: 'absolute', top: '50%', left: `${progress}%`,
                width: 14, height: 14, borderRadius: '50%',
                background: '#e50914', border: '2px solid #fff',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 6px rgba(229,9,20,0.7)',
              }} />
            </div>
          </div>

          {/* Bottom row: time + right controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: play, volume, time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={e => { e.stopPropagation(); togglePlay(); resetHideTimer(); }}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                {playing
                  ? <Pause size={20} color="#fff" fill="#fff" />
                  : <Play size={20} color="#fff" fill="#fff" />
                }
              </button>
              <button
                onClick={e => { e.stopPropagation(); toggleMute(); }}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                {muted
                  ? <VolumeX size={18} color="#fff" />
                  : <Volume2 size={18} color="#fff" />
                }
              </button>
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: 500, letterSpacing: 0.3 }}>
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>

            {/* Right: fullscreen */}
            <button
              onClick={e => { e.stopPropagation(); toggleFullscreen(); }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              {isFullscreen
                ? <Minimize size={18} color="#fff" />
                : <Maximize size={18} color="#fff" />
              }
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  );
}
