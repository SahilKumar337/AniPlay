import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  Maximize, Minimize, Settings, Subtitles,
  RotateCcw, RotateCw, ArrowLeft
} from 'lucide-react';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import './AniPlayer.css';

/* ─── helpers ──────────────────────────────────────────────── */
function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
}
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/* ─── Skip ripple ───────────────────────────────────────────── */
function SkipRipple({ side, label }) {
  return (
    <div className={`anip-ripple anip-ripple--${side}`}>
      <div className="anip-ripple__ring" />
      <div className="anip-ripple__ring anip-ripple__ring--2" />
      <div className="anip-ripple__inner">
        {side === 'left' ? <RotateCcw size={24} /> : <RotateCw size={24} />}
        <span>{label}</span>
      </div>
    </div>
  );
}

/* ─── Swipe indicator ───────────────────────────────────────── */
function SwipeBar({ type, value, visible }) {
  return (
    <div className={`anip-swipe anip-swipe--${type} ${visible ? 'anip-swipe--on' : ''}`}>
      <span className="anip-swipe__icon">{type === 'brightness' ? '☀️' : '🔊'}</span>
      <div className="anip-swipe__track">
        <div className="anip-swipe__fill" style={{ height:`${Math.round(value*100)}%` }} />
      </div>
      <span className="anip-swipe__pct">{Math.round(value*100)}%</span>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────── */
export default function AniPlayer({ url, title, subtitleTracks = [], onBack }) {
  const wrapRef    = useRef(null);
  const videoRef   = useRef(null);
  const hlsRef     = useRef(null);
  const seekRef    = useRef(null);
  const hideTimer  = useRef(null);
  const tapTimer   = useRef(null);
  const lastTap    = useRef(0);
  const gesture    = useRef(null);
  const seekDrag   = useRef(false);

  /* state */
  const [playing,   setPlaying]   = useState(false);
  const [curTime,   setCurTime]   = useState(0);
  const [duration,  setDuration]  = useState(0);
  const [buffered,  setBuffered]  = useState(0);
  const [volume,    setVolume]    = useState(1);
  const [muted,     setMuted]     = useState(false);
  const [bright,    setBright]    = useState(1);
  const [fs,        setFs]        = useState(false);
  const [waiting,   setWaiting]   = useState(false);
  const [ctrlVis,   setCtrlVis]   = useState(true);
  const [qualities, setQualities] = useState([]);
  const [activeQ,   setActiveQ]   = useState(-1);
  const [subs,      setSubs]      = useState(subtitleTracks);
  const [activeSub, setActiveSub] = useState(-1);
  const [showQ,     setShowQ]     = useState(false);
  const [showSub,   setShowSub]   = useState(false);
  const [ripple,    setRipple]    = useState(null);
  const [swipeVol,  setSwipeVol]  = useState(false);
  const [swipeBri,  setSwipeBri]  = useState(false);
  const [fitMode,   setFitMode]   = useState('contain');
  const [needsTap,  setNeedsTap]  = useState(false);  // autoplay blocked
  const [hlsErr,    setHlsErr]    = useState(null);   // fatal stream error

  /* ── HLS ──────────────────────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;

    // Reset all state on URL change
    setNeedsTap(false);
    setHlsErr(null);
    setWaiting(true);
    setQualities([]);
    setActiveQ(-1);
    setSubs(subtitleTracks || []);
    setActiveSub(-1);
    setShowQ(false);
    setShowSub(false);

    v.removeAttribute('src');
    v.load();

    const tryPlay = () => {
      v.play().then(() => {
        setNeedsTap(false);
      }).catch(err => {
        // NotAllowedError = browser blocked autoplay → show tap-to-play
        // AbortError = previous play() was interrupted (harmless)
        if (err.name === 'NotAllowedError') {
          setNeedsTap(true);
        } else if (err.name !== 'AbortError') {
          console.warn('[AniPlayer] play() error:', err.name, err.message);
        }
      });
    };

    let hls;
    let mediaErrRetries = 0;

    if (Hls.isSupported()) {
      hls = new Hls({
        // enableWorker:false — avoids Web Worker CSP issues inside Capacitor WebView
        enableWorker: false,
        startLevel: -1,
        maxMaxBufferLength: 30,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1500,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1500,
        fragLoadingMaxRetry: 3,
        fragLoadingRetryDelay: 1500,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        console.error('[HLS fatal]', data.type, data.details, data.reason || '');
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // retry once on network errors
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrRetries < 2) {
          mediaErrRetries++;
          hls.recoverMediaError();
        } else {
          // Give up — show a visible error so user can retry
          setHlsErr(`Stream error: ${data.details || data.type}. Tap retry.`);
          setWaiting(false);
        }
      });

      hls.attachMedia(v);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(url);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
        setQualities(d.levels.map((l, i) => ({
          id: i,
          label: l.height ? `${l.height}p` : `Level ${i + 1}`
        })));
        tryPlay();
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, d) => {
        if (d.subtitleTracks?.length)
          setSubs(d.subtitleTracks.map((t, i) => ({
            id: i,
            label: t.name || t.lang || `Track ${i + 1}`
          })));
      });

    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / native HLS
      v.src = url;
      v.load();
      tryPlay();
    } else {
      setHlsErr('HLS is not supported in this browser.');
    }

    return () => {
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [url]);

  // Sync subtitle tracks when props change (using stringify for stable comparison)
  const subTracksJson = JSON.stringify(subtitleTracks);
  useEffect(() => {
    setSubs(subtitleTracks || []);
    setActiveSub(-1);
  }, [subTracksJson]);

  useEffect(() => { if (hlsRef.current) hlsRef.current.currentLevel  = activeQ;  }, [activeQ]);
  useEffect(() => { if (hlsRef.current) hlsRef.current.subtitleTrack = activeSub; }, [activeSub]);

  /* ── Video events ─────────────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setPlaying(!v.paused);
      setCurTime(v.currentTime);
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onMeta = () => setDuration(v.duration);
    const onWait = () => setWaiting(true);
    const onPlay = () => setWaiting(false);
    v.addEventListener('play',            sync);
    v.addEventListener('pause',           sync);
    v.addEventListener('timeupdate',      sync);
    v.addEventListener('loadedmetadata',  onMeta);
    v.addEventListener('waiting',         onWait);
    v.addEventListener('playing',         onPlay);
    v.addEventListener('canplay',         onPlay);
    return () => {
      v.removeEventListener('play',           sync);
      v.removeEventListener('pause',          sync);
      v.removeEventListener('timeupdate',     sync);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('waiting',        onWait);
      v.removeEventListener('playing',        onPlay);
      v.removeEventListener('canplay',        onPlay);
    };
  }, []);

  /* ── Fullscreen events ────────────────────────────────────── */
  useEffect(() => {
    const cb = () => setFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', cb);
    document.addEventListener('webkitfullscreenchange', cb);
    return () => {
      document.removeEventListener('fullscreenchange', cb);
      document.removeEventListener('webkitfullscreenchange', cb);
    };
  }, []);

  // Sync orientation and statusbar for native mobile clients
  useEffect(() => {
    const syncNativeFullscreen = async () => {
      if (window.Capacitor) {
        try {
          if (fs) {
            await ScreenOrientation.lock({ orientation: 'landscape' });
            await StatusBar.hide();
          } else {
            // Unlock orientation so it follows system/portrait flow naturally, and restore status bar
            try { await ScreenOrientation.unlock(); } catch (err) {}
            await StatusBar.show();
          }
        } catch (e) {
          console.warn('[AniPlayer] Native orientation/statusbar error:', e.message);
        }
      }
    };
    syncNativeFullscreen();
  }, [fs]);

  const toggleFitMode = useCallback(() => {
    setFitMode(curr => {
      if (curr === 'contain') return 'cover';
      if (curr === 'cover') return 'fill';
      return 'contain';
    });
    showCtrl();
  }, [showCtrl]);

  /* ── Keyboard ─────────────────────────────────────────────── */
  useEffect(() => {
    if (isTouch()) return;
    const onKey = e => {
      const v = videoRef.current;
      if (!v || e.target.tagName === 'INPUT') return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); skip(-5); }
      if (e.key === 'ArrowRight') { e.preventDefault(); skip(5); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); applyVol(clamp(v.volume + 0.1, 0, 1)); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); applyVol(clamp(v.volume - 0.1, 0, 1)); }
      if (e.key === 'f')          { e.preventDefault(); toggleFs(); }
      if (e.key === 'm')          { e.preventDefault(); toggleMute(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line
  }, []);

  /* ── Controls auto-hide ───────────────────────────────────── */
  const schedHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setCtrlVis(false);
    }, 3500);
  }, []);

  const showCtrl = useCallback(() => { setCtrlVis(true); schedHide(); }, [schedHide]);

  /* ── Playback actions ─────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); schedHide(); }
    else          { v.pause(); setCtrlVis(true); clearTimeout(hideTimer.current); }
  }, [schedHide]);

  const skip = useCallback((s) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(v.currentTime + s, 0, v.duration || 0);
    const id = Date.now();
    setRipple({ side: s < 0 ? 'left' : 'right', label: `${Math.abs(s)}s`, id });
    setTimeout(() => setRipple(r => r?.id === id ? null : r), 750);
    showCtrl();
  }, [showCtrl]);

  const applyVol = useCallback((val) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val; v.muted = val === 0;
    setVolume(val); setMuted(val === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted; setMuted(v.muted);
  }, []);

  const toggleFs = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const cur = document.fullscreenElement || document.webkitFullscreenElement;
    if (!cur) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    else      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }, []);

  /* ── Seek ─────────────────────────────────────────────────── */
  const doSeek = useCallback((clientX) => {
    const bar = seekRef.current;
    const v   = videoRef.current;
    if (!bar || !v || !duration) return;
    const r = bar.getBoundingClientRect();
    v.currentTime = clamp((clientX - r.left) / r.width, 0, 1) * duration;
  }, [duration]);

  /* ── Tap / double-tap ─────────────────────────────────────── */
  const handleTap = useCallback((cx, cy) => {
    const el = wrapRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const xPct = (cx - left) / width;
    const now  = Date.now();
    if (now - lastTap.current < 300 && now - lastTap.current > 0) {
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (xPct < 0.35) skip(-10);
      else if (xPct > 0.65) skip(10);
      else togglePlay();
    } else {
      lastTap.current = now;
      tapTimer.current = setTimeout(() => {
        lastTap.current = 0;
        setCtrlVis(c => {
          if (!c) { schedHide(); return true; }
          if (videoRef.current?.paused) return true;
          return false;
        });
      }, 300);
    }
  }, [skip, togglePlay, schedHide]);

  /* ── Swipe gesture ────────────────────────────────────────── */
  const onGestureStart = useCallback((cx, cy) => {
    const el = wrapRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    gesture.current = {
      startX: cx, startY: cy,
      isLeft: (cx - left) / width < 0.5,
      startVol: volume, startBri: bright,
      moved: false,
    };
  }, [volume, bright]);

  const onGestureMove = useCallback((cx, cy) => {
    if (!gesture.current || seekDrag.current) return;
    const dx = Math.abs(cx - gesture.current.startX);
    const dy = Math.abs(cy - gesture.current.startY);
    if (!gesture.current.moved) {
      if (dx > 10 || dy > 10) {
        if (dx > dy) { gesture.current = null; return; } // horizontal = skip, handled by double-tap
        gesture.current.moved = true;
      } else return;
    }
    const delta = (gesture.current.startY - cy) / 200;
    if (gesture.current.isLeft) {
      const nb = clamp(gesture.current.startBri + delta, 0.1, 2);
      setBright(nb);
      if (videoRef.current) videoRef.current.style.filter = `brightness(${nb})`;
      setSwipeBri(true);
    } else {
      applyVol(clamp(gesture.current.startVol + delta, 0, 1));
      setSwipeVol(true);
    }
  }, [applyVol]);

  const onGestureEnd = useCallback((cx, cy) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved) handleTap(cx, cy);
    setTimeout(() => { setSwipeBri(false); setSwipeVol(false); }, 900);
  }, [handleTap]);

  /* ─── Derived ─────────────────────────────────────────────── */
  const pct    = duration ? (curTime  / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  const VolIco = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  /* ─── Render ──────────────────────────────────────────────── */
  return (
    <div
      ref={wrapRef}
      className={['anip', fs ? 'anip--fs' : '', ctrlVis ? 'anip--ctrl' : '', isTouch() ? 'anip--touch' : ''].filter(Boolean).join(' ')}
      onMouseMove={() => { if (!isTouch()) showCtrl(); }}
      onMouseLeave={() => { if (!isTouch() && playing) setCtrlVis(false); }}
      /* touch */
      onTouchStart={e => {
        const t = e.touches[0];
        onGestureStart(t.clientX, t.clientY);
      }}
      onTouchMove={e => {
        if (seekDrag.current) return;
        const t = e.touches[0];
        onGestureMove(t.clientX, t.clientY);
      }}
      onTouchEnd={e => {
        if (seekDrag.current) { seekDrag.current = false; return; }
        const t = e.changedTouches[0];
        onGestureEnd(t.clientX, t.clientY);
      }}
      /* mouse */
      onMouseDown={e => onGestureStart(e.clientX, e.clientY)}
      onMouseUp={e   => onGestureEnd(e.clientX, e.clientY)}
    >
      {/* ── video ───────────────────────────────────────────── */}
      <video
        ref={videoRef}
        className="anip__video"
        style={{ objectFit: fitMode }}
        playsInline
        preload="auto"
        autoPlay
        crossOrigin="anonymous"
      />

      {/* ── Tap-to-play overlay (autoplay blocked by browser) ── */}
      {needsTap && !hlsErr && (
        <div
          className="anip__tap-play"
          onClick={() => {
            const v = videoRef.current;
            if (v) v.play().then(() => setNeedsTap(false)).catch(() => {});
          }}
        >
          <div className="anip__tap-play__circle">
            <Play size={38} fill="#fff" strokeWidth={0} />
          </div>
          <span className="anip__tap-play__label">Tap to Play</span>
        </div>
      )}

      {/* ── Fatal HLS error overlay ───────────────────────────── */}
      {hlsErr && (
        <div className="anip__error">
          <span className="anip__error__icon">⚠️</span>
          <p className="anip__error__msg">{hlsErr}</p>
          <button
            className="anip__error__retry"
            onClick={() => {
              setHlsErr(null);
              setNeedsTap(false);
              // Force reload by toggling url via parent — simulate by re-attaching
              const v = videoRef.current;
              const h = hlsRef.current;
              if (h && v) { h.detachMedia(); h.attachMedia(v); h.loadSource(url); }
            }}
          >
            ↺ Retry
          </button>
        </div>
      )}

      {/* ── buffering spinner ───────────────────────────────── */}
      {waiting && (
        <div className="anip__spinner">
          <div className="anip__spinner-ring" />
        </div>
      )}

      {/* ── skip ripples ────────────────────────────────────── */}
      {ripple && <SkipRipple key={ripple.id} side={ripple.side} label={ripple.label} />}

      {/* ── swipe indicators ────────────────────────────────── */}
      <SwipeBar type="brightness" value={clamp(bright/2,0,1)} visible={swipeBri} />
      <SwipeBar type="volume"     value={muted ? 0 : volume}  visible={swipeVol} />

      {/* ═══════════════════════════════════════════════════════
          CONTROLS OVERLAY — flex column, top + bottom-group
          ═══════════════════════════════════════════════════════ */}
      <div className="anip__overlay">

        {/* ── Top bar ──────────────────────────────────────── */}
        <div className="anip__top-bar"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
        >
          {onBack && (
            <button className="anip__back-btn" onClick={onBack} title="Back">
              <ArrowLeft size={19} strokeWidth={2.5} />
            </button>
          )}
          <span className="anip__title">{title}</span>
        </div>

        {/* ── Spacer (click to toggle controls) ────────────── */}
        <div className="anip__spacer" />

        {/* ── Bottom group: seek bar + controls bar ────────── */}
        <div className="anip__bottom-group"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
        >

          {/* Seek bar */}
          <div className="anip__seek-wrap"
            onClick={e => { e.stopPropagation(); doSeek(e.clientX); showCtrl(); }}
            onTouchStart={e => {
              e.stopPropagation();
              seekDrag.current = true;
              doSeek(e.touches[0].clientX);
              showCtrl();
            }}
            onTouchMove={e => {
              if (!seekDrag.current) return;
              e.stopPropagation();
              e.preventDefault();
              doSeek(e.touches[0].clientX);
            }}
            onTouchEnd={e => { e.stopPropagation(); seekDrag.current = false; }}
          >
            <div ref={seekRef} className="anip__seek-track">
              <div className="anip__seek-buf"    style={{ width:`${bufPct}%` }} />
              <div className="anip__seek-played" style={{ width:`${pct}%` }}>
                <div className="anip__seek-knob" />
              </div>
            </div>
          </div>

          {/* Controls bar */}
          <div className="anip__bar">

            {/* Left cluster */}
            <div className="anip__cluster">
              {/* Play / Pause */}
              <button className="anip__btn anip__btn--play"
                onClick={e => { e.stopPropagation(); togglePlay(); }}
              >
                {playing
                  ? <Pause  size={20} fill="currentColor" strokeWidth={0} />
                  : <Play   size={20} fill="currentColor" strokeWidth={0} />}
              </button>

              {/* Rewind */}
              <button className="anip__btn anip__btn--skip"
                onClick={e => { e.stopPropagation(); skip(-10); }}
                title="Rewind 10s"
              >
                <RotateCcw size={17} />
                <span className="anip__skip-num">10</span>
              </button>

              {/* Forward */}
              <button className="anip__btn anip__btn--skip"
                onClick={e => { e.stopPropagation(); skip(10); }}
                title="Forward 10s"
              >
                <RotateCw size={17} />
                <span className="anip__skip-num">10</span>
              </button>



              {/* Time */}
              <span className="anip__time">{fmt(curTime)} / {fmt(duration)}</span>
            </div>

            {/* Right cluster */}
            <div className="anip__cluster anip__cluster--right">

              {/* Subtitles */}
              <div className="anip__menu-anchor">
                <button
                  className={`anip__btn ${activeSub !== -1 ? 'anip__btn--active' : ''}`}
                  onClick={e => { e.stopPropagation(); setShowSub(x => !x); setShowQ(false); }}
                  title="Subtitles"
                >
                  <Subtitles size={17} />
                </button>
                {showSub && (
                  <div className="anip__menu">
                    <p className="anip__menu-hd">Subtitles</p>
                    {[{ id:-1, label:'Off' }, ...subs].map(s => (
                      <button key={s.id}
                        className={`anip__menu-item ${activeSub===s.id ? 'anip__menu-item--on':''}`}
                        onClick={e => { e.stopPropagation(); setActiveSub(s.id); setShowSub(false); }}
                      >
                        {activeSub===s.id && <span className="anip__chk">✓</span>}{s.label}
                      </button>
                    ))}
                    {subs.length===0 && <p className="anip__menu-empty">No subtitles</p>}
                  </div>
                )}
              </div>

              {/* Quality */}
              <div className="anip__menu-anchor">
                <button className="anip__btn"
                  onClick={e => { e.stopPropagation(); setShowQ(x => !x); setShowSub(false); }}
                  title="Quality"
                >
                  <Settings size={17} />
                  <span className="anip__badge">{activeQ===-1?'Auto':qualities[activeQ]?.label||'Auto'}</span>
                </button>
                {showQ && (
                  <div className="anip__menu">
                    <p className="anip__menu-hd">Quality</p>
                    {[{ id:-1, label:'Auto' }, ...[...qualities].reverse()].map(q => (
                      <button key={q.id}
                        className={`anip__menu-item ${activeQ===q.id ? 'anip__menu-item--on':''}`}
                        onClick={e => { e.stopPropagation(); setActiveQ(q.id); setShowQ(false); }}
                      >
                        {activeQ===q.id && <span className="anip__chk">✓</span>}{q.label}
                      </button>
                    ))}
                    {qualities.length===0 && <p className="anip__menu-empty">No options</p>}
                  </div>
                )}
              </div>

              {/* Aspect Ratio Toggle */}
              <button className="anip__btn"
                onClick={e => { e.stopPropagation(); toggleFitMode(); }}
                title="Aspect Ratio"
                style={{ minWidth: '48px', justifyContent: 'center' }}
              >
                <span className="anip__badge" style={{ fontSize: '10px', textTransform: 'uppercase', opacity: 0.95 }}>
                  {fitMode === 'contain' ? 'Fit' : fitMode === 'cover' ? 'Zoom' : 'Stretch'}
                </span>
              </button>

              {/* Fullscreen */}
              <button className="anip__btn"
                onClick={e => { e.stopPropagation(); toggleFs(); }}
                title="Fullscreen (f)"
              >
                {fs ? <Minimize size={17}/> : <Maximize size={17}/>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
