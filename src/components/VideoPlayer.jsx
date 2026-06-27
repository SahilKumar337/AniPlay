import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { Settings, Maximize, Volume2, VolumeX, Play, Pause, Loader } from 'lucide-react';

export default function VideoPlayer({ src, isM3U8 = false, poster, onError }) {
  const videoRef  = useRef(null);
  const hlsRef    = useRef(null);
  const [playing,  setPlaying]  = useState(false);
  const [muted,    setMuted]    = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [errored,  setErrored]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Load source ──────────────────────────────────────────────
  useEffect(() => {
    if (!src || !videoRef.current) return;
    const video = videoRef.current;
    setLoading(true);
    setErrored(false);
    setProgress(0);

    // Cleanup previous
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (isM3U8 && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { setErrored(true); setLoading(false); onError?.(); }
      });
      hlsRef.current = hls;
    } else {
      video.src = src;
      video.load();
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [src, isM3U8, onError]);

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

  const seek = (e) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    v.currentTime = ratio * duration;
  };

  const fullscreen = () => videoRef.current?.requestFullscreen?.();

  if (errored) return (
    <div style={{ aspectRatio: '16/9', background: '#050505', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <div style={{ fontSize: 36 }}>⚠️</div>
      <p style={{ color: '#fff', fontSize: 14 }}>Stream unavailable — try another server</p>
    </div>
  );

  return (
    <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9', cursor: 'pointer', userSelect: 'none' }}
      onClick={togglePlay}
      id="video-player-container"
    >
      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', zIndex: 2,
        }}>
          <Loader size={36} color="#e50914" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      <video
        ref={videoRef}
        poster={poster}
        controls={false}
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={e => {
          const v = e.target;
          if (v.duration) setProgress((v.currentTime / v.duration) * 100);
        }}
        onProgress={e => {
          const v = e.target;
          if (v.duration && v.buffered.length) {
            setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
          }
        }}
        onLoadedMetadata={e => { setDuration(e.target.duration); setLoading(false); }}
        onCanPlay={() => setLoading(false)}
        onError={() => { setErrored(true); setLoading(false); onError?.(); }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
      />

      {/* Center play/pause icon */}
      {!loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 1,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: playing ? 0 : 1, transition: 'opacity 0.3s',
          }}>
            <Play size={26} fill="#fff" color="#fff" />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)',
        padding: '20px 12px 8px',
        display: 'flex', flexDirection: 'column', gap: 6, zIndex: 3,
      }}
        onClick={e => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: 'rgba(255,255,255,0.2)', borderRadius: 3, cursor: 'pointer', position: 'relative' }}
          onClick={seek}
        >
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', background: 'rgba(255,255,255,0.2)', borderRadius: 3, width: `${buffered}%` }} />
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', background: '#e50914', borderRadius: 3, width: `${progress}%` }} />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={togglePlay} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {playing ? <Pause size={18} color="#fff" /> : <Play size={18} fill="#fff" color="#fff" />}
            </button>
            <button onClick={toggleMute} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
            </button>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>
              {fmt(videoRef.current?.currentTime)} / {fmt(duration)}
            </span>
          </div>
          <button onClick={fullscreen} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Maximize size={16} color="#fff" />
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
