import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { CapacitorHttp, CapacitorCookies, registerPlugin } from '@capacitor/core';
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  Maximize, Minimize, Settings, Subtitles,
  RotateCcw, RotateCw, ArrowLeft
} from 'lucide-react';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import './AniPlayer.css';

const EmbedScraper = registerPlugin('EmbedScraper');


/* ─── Way 4: CapacitorHttp hls.js loader ──────────────────────
   On Android, each HLS manifest and fragment is fetched through
   CapacitorHttp which bypasses CORS at the OS network layer.
   This eliminates the need for any backend HLS proxy server.
──────────────────────────────────────────────────────────────── */
const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

function base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function buildCapacitorHlsLoader(DefaultLoader, refererUrl, embedUrl) {
  return class CapacitorHlsLoader extends DefaultLoader {
    constructor(config) {
      super(config);
      this._aborted = false;
    }

    destroy() {
      this._aborted = true;
      super.destroy();
    }

    abort() {
      this._aborted = true;
      super.abort();
    }

    load(context, config, callbacks) {
      if (!isNative) {
        // On desktop browser, fall back to the default fetch-based loader
        return super.load(context, config, callbacks);
      }

      const url = context.url;
      const isPlaylist = context.type === 'manifest' || context.type === 'level';
      const t0 = performance.now();
      this._aborted = false;

      (async () => {
        try {
          const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
            'Accept': isPlaylist ? 'application/vnd.apple.mpegurl, */*' : '*/*',
          };

          if (refererUrl) {
            reqHeaders['Origin'] = refererUrl.replace(/\/$/, '');
            reqHeaders['Referer'] = refererUrl;
          } else {
            reqHeaders['Origin'] = 'https://animetsu.net';
            reqHeaders['Referer'] = 'https://animetsu.net/';
          }

          if (embedUrl && isNative) {
            const targetHost = new URL(url).origin;
            // Native CookieManager has the cookies from the hidden WebView scrape
            const cookies = await CapacitorCookies.getCookies({ url: targetHost });
            if (cookies && Object.keys(cookies).length > 0) {
              const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
              reqHeaders['Cookie'] = cookieStr;
            }
          }

          if (this._aborted) return;

          const response = await CapacitorHttp.request({
            url,
            method: 'GET',
            headers: reqHeaders,
            // Playlists are text, binary TS segments are returned as base64 string when using 'blob' responseType in Capacitor
            responseType: isPlaylist ? 'text' : 'blob',
          });

          if (this._aborted) return;

          if (response.status >= 400) {
            callbacks.onError(
              { code: response.status, text: `HTTP ${response.status}` },
              context, null
            );
            return;
          }

          const now = performance.now();
          let data = response.data;

          if (!isPlaylist && typeof data === 'string') {
            // Capacitor returns 'blob' as a base64 encoded string
            data = base64ToArrayBuffer(data);
          }

          const stats = {
            aborted: false,
            loaded: data.byteLength || data.length || 0,
            retry: 0,
            total: data.byteLength || data.length || 0,
            chunkCount: 0,
            bwEstimate: 0,
            loading: { start: t0, first: now, end: now },
            parsing: { start: now, end: now },
            buffering: { start: now, first: now, end: now },
          };
          callbacks.onSuccess({ data, url: response.url || url }, stats, context, response);
        } catch (err) {
          if (this._aborted) return;
          callbacks.onError({ code: 0, text: err.message || String(err) }, context, null);
        }
      })();
    }
  };
}


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
export default function AniPlayer({ url, title, subtitles, referer, embedUrl, onBack, onFullscreenChange }) {
  const wrapRef = useRef(null);
  const videoRef   = useRef(null);
  const hlsRef     = useRef(null);
  const seekRef    = useRef(null);
  const hideTimer  = useRef(null);
  const tapTimer   = useRef(null);
  const lastTap    = useRef(0);
  const lastTouchTime = useRef(0);
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
  const [subs,      setSubs]      = useState(subtitles || []);
  const [activeSub, setActiveSub] = useState(-1);
  const [cues,      setCues]      = useState([]);
  const [showQ,     setShowQ]     = useState(false);
  const [showSub,   setShowSub]   = useState(false);
  const [ripple,    setRipple]    = useState(null);
  const [swipeVol,  setSwipeVol]  = useState(false);
  const [swipeBri,  setSwipeBri]  = useState(false);
  const [fitMode,   setFitMode]   = useState('contain');
  const [needsTap,  setNeedsTap]  = useState(false);  // autoplay blocked
  const [hlsErr,    setHlsErr]    = useState(null);   // fatal stream error
  const [hasStarted, setHasStarted] = useState(false); // first play event occurred
  const [subToast,  setSubToast]  = useState(null);   // subtitle unavailable toast message

  // Debug & Diagnostics
  const [logs,       setLogs]       = useState([]);
  const [showDebug,  setShowDebug]  = useState(false);
  const [titleTaps,  setTitleTaps]  = useState(0);
  const [stuckCount, setStuckCount] = useState(0);

  const log = useCallback((msg) => {
    const time = new Date().toTimeString().split(' ')[0];
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 40));
    console.log(`[AniPlayer] ${msg}`);
  }, []);


  /* ── HLS ──────────────────────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;

    log(`Initializing stream: ${url.slice(0, 100)}...`);

    // Reset all state on URL change
    setNeedsTap(false);
    setHlsErr(null);
    setWaiting(true);
    setHasStarted(false);
    setQualities([]);
    setActiveQ(-1);
    setSubs(subtitles || []);
    setActiveSub(-1);
    setShowQ(false);
    setShowSub(false);
    setStuckCount(0);

    v.removeAttribute('src');
    v.load();

    const tryPlay = () => {
      log('Calling video.play()...');
      v.play().then(() => {
        log('video.play() SUCCEEDED');
        setNeedsTap(false);
      }).catch(err => {
        log(`video.play() FAILED: ${err.name} - ${err.message}`);
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
      log('Hls.js is supported. Spawning player...');
      hls = new Hls({
        // enableWorker:false — avoids Web Worker CSP issues inside Capacitor WebView
        enableWorker: false,
        startLevel: -1,
        maxMaxBufferLength: 60,
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1500,
        levelLoadingMaxRetry: 5,
        levelLoadingRetryDelay: 1500,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1500,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetries: 10,
        // Inject custom Capacitor Loader to bypass CORS on Android natively
        pLoader: isNative ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, referer, embedUrl) : Hls.DefaultConfig.loader,
        fLoader: isNative ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, referer, embedUrl) : Hls.DefaultConfig.loader,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_, data) => {
        log(`HLS Error: type=${data.type}, details=${data.details}, fatal=${data.fatal}`);
        if (!data.fatal) return;
        
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          log('Fatal network error, retrying startLoad...');
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrRetries < 2) {
          mediaErrRetries++;
          log(`Fatal media error, retrying recoverMediaError (${mediaErrRetries}/2)...`);
          hls.recoverMediaError();
        } else {
          log('Fatal HLS error unrecoverable. Displaying error overlay.');
          setHlsErr(`Stream error: ${data.details || data.type}. Tap retry.`);
          setWaiting(false);
        }
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        log('Media attached to Hls.js, loading source...');
        hls.loadSource(url);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
        log(`Manifest parsed: found ${d.levels.length} quality levels`);
        setQualities(d.levels.map((l, i) => ({
          id: i,
          label: l.height ? `${l.height}p` : `Level ${i + 1}`
        })));
        tryPlay();
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, d) => {
        log(`Subtitle tracks updated: found ${d.subtitleTracks?.length || 0} tracks`);
        if (d.subtitleTracks?.length)
          setSubs(d.subtitleTracks.map((t, i) => ({
            id: i,
            label: t.name || t.lang || `Track ${i + 1}`
          })));
      });

      hls.attachMedia(v);

    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      log('Native HLS support detected (Safari/iOS), playing directly...');
      v.src = url;
      v.load();
      tryPlay();
    } else {
      log('HLS.js not supported and native HLS not supported.');
      setHlsErr('HLS is not supported in this browser.');
    }

    return () => {
      log('Cleaning up player instance.');
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [url, log]);


  // Sync subtitle tracks when props change (using stringify for stable comparison)
  const subTracksJson = JSON.stringify(subtitles);
  useEffect(() => {
    const loadedSubs = subtitles || [];
    setSubs(loadedSubs);
    // Auto-select English subtitle track by default if available
    if (loadedSubs.length > 0) {
      setActiveSub(0);
    } else {
      setActiveSub(-1);
    }
  }, [subTracksJson]);

  useEffect(() => { if (hlsRef.current) hlsRef.current.currentLevel  = activeQ;  }, [activeQ]);
  
  useEffect(() => { 
    // Sync Hls.js embedded tracks
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = activeSub; 
    }
  }, [activeSub]);

  // Fetch and parse subtitles when activeSub changes
  useEffect(() => {
    if (activeSub === -1 || !subs[activeSub]?.file) {
      setCues([]);
      return;
    }

    const url = subs[activeSub].file;
    log(`Fetching subtitles from: ${url}`);

    const loadSubtitlesText = async () => {
      // Per-subtitle referer takes priority over player-level referer prop
      const subReferer = subs[activeSub]?.referer || referer;
      if (isNative) {
        const reqHeaders = {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
        };
        if (subReferer) {
          reqHeaders['Origin'] = subReferer.replace(/\/$/, '');
          reqHeaders['Referer'] = subReferer;
        } else {
          try {
            const urlObj = new URL(url);
            reqHeaders['Origin'] = urlObj.origin;
            reqHeaders['Referer'] = urlObj.origin + '/';
          } catch {}
        }

        const response = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers: reqHeaders,
          responseType: 'text',
        });
        return response.data;
      } else {
        const res = await fetch(url);
        return await res.text();
      }
    };

    loadSubtitlesText()
      .then(text => {
        if (text && typeof text === 'object') {
          log('Subtitle response auto-parsed as JSON object, converting to string...');
          try {
            text = JSON.stringify(text);
          } catch (e) {
            log(`JSON stringify failed: ${e.message}`);
          }
        }

        log(`Subtitle response type: ${typeof text}, length: ${text ? text.length : 0}`);
        if (text && typeof text === 'string') {
          log(`Subtitle start snippet: ${text.slice(0, 100)}`);
        }

        if (!text) {
          log('Subtitle response was empty or blocked');
          setCues([]);
          return;
        }
        // Try JSON first (some scrapers return [{startTime, endTime, text}])
        if (typeof text === 'string' && (text.trimStart().startsWith('[') || text.trimStart().startsWith('{'))) {
          try {
            const data = JSON.parse(text);
            log(`Loaded ${data.length} subtitle cues (JSON format)`);
            setCues(Array.isArray(data) ? data : []);
            return;
          } catch {}
        }

        // Parse WebVTT format
        if (text.includes('WEBVTT') || text.includes('-->')) {
          const parsed = [];
          // Split on double newline (cue separator)
          const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
          for (const block of blocks) {
            const lines = block.trim().split('\n');
            // Find the timestamp line
            const tsIdx = lines.findIndex(l => l.includes('-->'));
            if (tsIdx === -1) continue;
            const tsParts = lines[tsIdx].split('-->');
            if (tsParts.length < 2) continue;

            const parseTime = (t) => {
              // Handle HH:MM:SS.mmm or MM:SS.mmm
              const parts = t.trim().replace(',', '.').split(':');
              let secs = 0;
              if (parts.length === 3) secs = +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
              else if (parts.length === 2) secs = +parts[0] * 60 + parseFloat(parts[1]);
              return secs;
            };

            const startTime = parseTime(tsParts[0]);
            const endTime = parseTime(tsParts[1].trim().split(/\s+/)[0]);
            const text = lines.slice(tsIdx + 1).join('\n').trim();

            if (text && isFinite(startTime) && isFinite(endTime)) {
              parsed.push({ startTime, endTime, text });
            }
          }
          log(`Loaded ${parsed.length} subtitle cues (WebVTT format)`);
          setCues(parsed);
          return;
        }

        log('Unknown subtitle format — could not parse');
        setCues([]);
      })
      .catch(err => {
        log(`Failed to fetch subtitles: ${err.message}`);
        setCues([]);
        // Show toast notification so user knows subtitles failed
        setSubToast('Subtitles unavailable');
        setTimeout(() => setSubToast(null), 3500);
      });
  }, [activeSub, subs, referer, log]);

  /* ── Video events ─────────────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = (e) => {
      setPlaying(!v.paused);
      if (!v.paused) {
        setNeedsTap(false);
        setHasStarted(true);
      }
      setCurTime(v.currentTime);
      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
      // Only log non-timeupdate events to avoid flooding re-renders
      if (e.type !== 'timeupdate') {
        log(`Video state sync (event: ${e.type}, curTime=${v.currentTime.toFixed(1)}, paused=${v.paused})`);
      }
    };
    const onMeta = () => {
      log(`Video loadedmetadata: duration=${v.duration.toFixed(1)}`);
      setDuration(v.duration);
    };
    const onWait = () => {
      log('Video event: waiting (buffering)');
      setWaiting(true);
    };
    const onPlay = (e) => {
      log(`Video event: playing/canplay (event: ${e.type})`);
      setWaiting(false);
      if (e.type === 'playing') {
        setNeedsTap(false);
        setHasStarted(true);
      }
    };

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
  }, [log]);

  // Monitor stuck state (triggers retry state after 30 seconds of loading or buffering)
  useEffect(() => {
    const isLoading = (waiting || !hasStarted) && !hlsErr;
    if (!isLoading) {
      setStuckCount(0);
      return;
    }
    const interval = setInterval(() => {
      setStuckCount(c => {
        const next = c + 1;
        if (next >= 30) {
          log('Playback loading timed out after 30 seconds. Displaying retry.');
          setHlsErr('Playback loading timed out. Please try again.');
          setWaiting(false);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [waiting, hasStarted, hlsErr, log]);

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

  // Sync orientation, statusbar AND nav bar for native mobile clients
  useEffect(() => {
    if (onFullscreenChange) {
      onFullscreenChange(fs);
    }
    const syncNativeFullscreen = async () => {
      if (!isNative) return;
      try {
        if (fs) {
          // Lock landscape + full immersive (hides both status bar AND nav bar)
          await ScreenOrientation.lock({ orientation: 'landscape' });
          if (EmbedScraper?.setImmersiveMode) {
            await EmbedScraper.setImmersiveMode({ enabled: true });
          } else {
            // Fallback: at least hide status bar
            await StatusBar.hide();
          }
        } else {
          // Unlock orientation + restore system bars
          try { await ScreenOrientation.unlock(); } catch {}
          if (EmbedScraper?.setImmersiveMode) {
            await EmbedScraper.setImmersiveMode({ enabled: false });
          } else {
            await StatusBar.show();
          }
        }
      } catch (e) {
        console.warn('[AniPlayer] Fullscreen native sync error:', e.message);
      }
    };
    syncNativeFullscreen();
  }, [fs]);

  // Always restore system bars + unlock orientation on unmount
  useEffect(() => {
    return () => {
      if (isNative) {
        ScreenOrientation.unlock().catch(() => {});
        if (EmbedScraper?.setImmersiveMode) {
          EmbedScraper.setImmersiveMode({ enabled: false }).catch(() => {});
        } else {
          StatusBar.show().catch(() => {});
        }
      }
    };
  }, []);

  /* ── Controls auto-hide ───────────────────────────────────── */
  const schedHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setCtrlVis(false);
    }, 3500);
  }, []);

  const showCtrl = useCallback(() => { setCtrlVis(true); schedHide(); }, [schedHide]);

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
    // CSS-only fullscreen — no requestFullscreen() API (not supported in Android WebView)
    // ScreenOrientation + immersive mode is handled by the fs useEffect above
    setFs(prev => !prev);
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

  // Programmatic touch event binding to support preventDefault() during swipes on Android
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const handleTouchStart = (e) => {
      lastTouchTime.current = Date.now();
      const t = e.touches[0];
      if (t) onGestureStart(t.clientX, t.clientY);
    };

    const handleTouchMove = (e) => {
      // Prevent Android scroll/bounce if actively swiping volume/brightness or dragging seek
      if (seekDrag.current || (gesture.current && gesture.current.moved)) {
        if (e.cancelable) e.preventDefault();
      }
      const t = e.touches[0];
      if (t) onGestureMove(t.clientX, t.clientY);
    };

    const handleTouchEnd = (e) => {
      lastTouchTime.current = Date.now();
      // ── Fix: if we were dragging the seek bar, consume the event and return ──
      // Without this guard, the outer touchend fires after seek and triggers handleTap
      if (seekDrag.current) {
        seekDrag.current = false;
        return;
      }
      const t = e.changedTouches[0] || e.touches[0];
      if (t) {
        onGestureEnd(t.clientX, t.clientY);
      } else {
        gesture.current = null;
        setTimeout(() => { setSwipeBri(false); setSwipeVol(false); }, 900);
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onGestureStart, onGestureMove, onGestureEnd]);

  /* ─── Derived ─────────────────────────────────────────────── */
  const pct    = duration ? (curTime  / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  const VolIco = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const activeCue = Array.isArray(cues) && cues.length > 0 ? cues.find(c => curTime >= c.startTime && curTime <= c.endTime) : null;
  // Convert VTT HTML tags (<i>, <b> etc) to real HTML, strip unknown ones cleanly
  const cueHtml = activeCue ? activeCue.text
    .replace(/<i>/g, '<em>').replace(/<\/i>/g, '</em>')
    .replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>')
    .replace(/<[^>]+>/g, '') // strip remaining unknown tags
    : '';

  /* ─── Render ──────────────────────────────────────────────── */
  const playerContent = (
    <div
      ref={wrapRef}
      className={['anip', fs ? 'anip--fs' : '', ctrlVis ? 'anip--ctrl' : '', isTouch() ? 'anip--touch' : ''].filter(Boolean).join(' ')}
      onMouseMove={() => { if (!isTouch()) showCtrl(); }}
      onMouseLeave={() => { if (!isTouch() && playing) setCtrlVis(false); }}
    >
      {/* ── video ───────────────────────────────────────────── */}
      <video
        ref={videoRef}
        className="anip__video"
        style={{ objectFit: fitMode }}
        playsInline
        preload="auto"
        autoPlay
        poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
      />

      {/* ── BLACK LOADING BG: Covers grey browser poster/play icon ── */}
      {(!hasStarted || needsTap) && !hlsErr && (
        <div 
          className="anip__loading-bg" 
          onClick={() => {
            const v = videoRef.current;
            if (v) v.play().then(() => setNeedsTap(false)).catch(e => console.log('Tap to play failed:', e));
          }}
          style={{ cursor: 'pointer' }}
        />
      )}

      {/* ── Custom Subtitle Overlay ─────────────────────────── */}
      {activeCue && cueHtml && (
        <div className="anip__subtitle-overlay">
          <span
            className="anip__subtitle-text"
            dangerouslySetInnerHTML={{ __html: cueHtml.replace(/\n/g, '<br/>') }}
          />
        </div>
      )}

      {/* ── Subtitle unavailable toast ────────────────────────── */}
      {subToast && (
        <div className="anip__sub-toast">
          <span>⚠️ {subToast}</span>
        </div>
      )}

      {/* ── Fatal HLS error overlay (Generic non-technical message with soft gradient retry button) ── */}
      {hlsErr && (
        <div className="anip__error" style={{ background: '#0c0c0e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <p className="anip__error__msg" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
            Playback error. Please try again or select another server.
          </p>
          <button
            className="anip__error__retry"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              border: 'none',
              padding: '10px 24px',
              borderRadius: 20,
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
            }}
            onClick={() => {
              setHlsErr(null);
              setNeedsTap(false);
              const v = videoRef.current;
              const h = hlsRef.current;
              if (h && v) { h.detachMedia(); h.attachMedia(v); h.loadSource(url); }
            }}
          >
            ↺ Retry
          </button>
        </div>
      )}

      {/* ── buffering spinner / loading spinner ─────────────── */}
      {(waiting || !hasStarted || needsTap) && !hlsErr && (
        <div className="anip__spinner">
          <div className="anip__spinner-ring" />
        </div>
      )}

      {/* ── skip ripples ────────────────────────────────────── */}
      {ripple && <SkipRipple key={ripple.id} side={ripple.side} label={ripple.label} />}

      {/* ── swipe indicators ────────────────────────────────── */}
      <SwipeBar type="brightness" value={clamp(bright/2,0,1)} visible={swipeBri} />
      <SwipeBar type="volume"     value={muted ? 0 : volume}  visible={swipeVol} />



      {/* ── Controls overlay — opacity animated, back button removed from here ── */}
      <div className="anip__overlay">

        {/* ── Top bar (no back button here anymore) ──────────────────── */}
        <div className="anip__top-bar"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
        >
          {/* Spacer where back button used to be, keeps title right-aligned */}
          <div style={{ width: 34, flexShrink: 0 }} />
          <span 
            className="anip__title"
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              setTitleTaps(t => {
                const next = t + 1;
                log(`Title tapped ${next}/5 times`);
                if (next >= 5) {
                  setShowDebug(d => !d);
                  log(`Toggled developer console: ${!showDebug}`);
                  return 0;
                }
                return next;
              });
            }}
          >
            {title}
          </span>
        </div>


        {/* ── Spacer (click to toggle controls) ──────────────── */}
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

      {/* Debug & stuck loading diagnostics removed to hide backend details */}

    </div>
  );

  return playerContent;
}
