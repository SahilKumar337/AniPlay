import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { CapacitorHttp, CapacitorCookies, registerPlugin } from '@capacitor/core';
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  Maximize, Minimize, Settings, Subtitles,
  RotateCcw, RotateCw, ArrowLeft, Clock, SkipForward, SkipBack, X
} from 'lucide-react';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import './AniPlayer.css';

const EmbedScraper = registerPlugin('EmbedScraper');

/* ─── Native Brightness plugin ─────────────────────────────────
   Uses LAZY initialization so the plugin is only resolved after
   Capacitor is fully loaded (avoids "plugin not found" at import time).
──────────────────────────────────────────────────────────────── */
let _BrightnessPlugin = undefined; // lazy-loaded on first use

function getBrightnessPlugin() {
  if (_BrightnessPlugin !== undefined) return _BrightnessPlugin;
  // Only attempt on native platforms
  if (!window.Capacitor?.isNativePlatform?.()) {
    _BrightnessPlugin = null;
    return null;
  }
  try {
    _BrightnessPlugin = registerPlugin('Brightness');
  } catch (e) {
    _BrightnessPlugin = null;
  }
  return _BrightnessPlugin;
}

async function setDeviceBrightness(value) {
  const v = Math.min(1, Math.max(0.01, value));
  const plugin = getBrightnessPlugin();
  if (plugin) {
    try { await plugin.setBrightness({ value: v }); } catch (_) {}
  }
}

async function resetDeviceBrightness() {
  const plugin = getBrightnessPlugin();
  if (plugin) {
    try { await plugin.resetBrightness(); } catch (_) {}
  }
}


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
      const url = context.url;
      const isLocalhost = url.includes('localhost:8081') || url.includes('127.0.0.1:8081');
      if (!isNative || isLocalhost) {
        // Use default fetch loader for localhost/local downloads to ensure offline play works without CapacitorHttp checking internet state
        return super.load(context, config, callbacks);
      }

      const isPlaylist = context.type === 'manifest' || context.type === 'level';
      this._aborted = false;

      const fetchViaCapacitorHttp = () => {
        if (this._aborted) return;
        const t0 = performance.now();

        (async () => {
          try {
            const reqHeaders = {
              'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
              'Accept': isPlaylist ? 'application/vnd.apple.mpegurl, */*' : '*/*',
            };

            let targetReferer = refererUrl;
            if (embedUrl) {
              try {
                const parsedEmbed = new URL(embedUrl);
                targetReferer = parsedEmbed.origin + '/';
              } catch (e) {}
            }

            if (targetReferer) {
              try {
                reqHeaders['Origin'] = new URL(targetReferer).origin;
              } catch (e) {
                reqHeaders['Origin'] = targetReferer.replace(/\/$/, '');
              }
              reqHeaders['Referer'] = targetReferer;
            } else {
              reqHeaders['Origin'] = 'https://anineko.to';
              reqHeaders['Referer'] = 'https://anineko.to/';
            }

            if (embedUrl && isNative) {
              try {
                const targetHost = new URL(url).origin;
                const cookies = await CapacitorCookies.getCookies({ url: targetHost });
                if (cookies && Object.keys(cookies).length > 0) {
                  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
                  reqHeaders['Cookie'] = cookieStr;
                }
              } catch (_) {}
            }

            if (this._aborted) return;

            const response = await CapacitorHttp.request({
              url,
              method: 'GET',
              headers: reqHeaders,
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
      };

      if (!isPlaylist) {
        // Video fragments: Try direct fetch first for high line-speed throughput.
        // If direct fetch is blocked by CORS/Referer, seamlessly fall back to CapacitorHttp!
        const wrappedCallbacks = {
          ...callbacks,
          onError: (error, ctx, networkDetails) => {
            if (this._aborted) return;
            console.log(`[CapacitorHlsLoader] Direct fragment fetch failed (${error?.text || error?.code}), falling back to CapacitorHttp for: ${url.slice(0, 60)}`);
            fetchViaCapacitorHttp();
          }
        };
        try {
          return super.load(context, config, wrappedCallbacks);
        } catch (e) {
          fetchViaCapacitorHttp();
          return;
        }
      }

      // Playlists (manifests/levels) require strict Referer & Origin headers on mobile
      fetchViaCapacitorHttp();
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

const isGestureTarget = (target) => {
  if (!target) return true;
  const selectors = [
    '.anip__ctrls', 
    '.anip__menu', 
    '.anip__btn', 
    '.anip__sync-panel', 
    '.anip__sync-btn', 
    'button', 
    'input', 
    'select', 
    'a',
    '.anip__center-btn'
  ];
  for (const s of selectors) {
    if (target.closest && target.closest(s)) return false;
  }
  return true;
};

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
export default function AniPlayer({
  url,
  title,
  subtitles,
  extraSubtitles,
  referer,
  embedUrl,
  onBack,
  onFullscreenChange,
  currentEpisode = 1,
  totalEpisodes = 1,
  onEpisodeChange,
  autoplay = true,
  subtitleSettings = null,
  loading = false,
  onStreamExpired = null,
  startInFs = false,
  keepFsOnEpChange = null,
  isLocal = false,
  initialSeekTime = 0,      // seconds to seek to on first load
  onSeekProgress = null,    // (currentTime, duration) => void — called every 10s while playing
}) {
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
  const [fs,        setFs]        = useState(isLocal || startInFs); // isLocal downloads always start in fullscreen landscape
  const [waiting,   setWaiting]   = useState(false);
  const [ctrlVis,   setCtrlVis]   = useState(true);
  const [qualities, setQualities] = useState([]);
  const [activeQ,   setActiveQ]   = useState(-1);
  const [subs,      setSubs]      = useState(subtitles || []);
  const [activeSub, setActiveSub] = useState(-1);
  const [cues,      setCues]      = useState([]);
  // Single mutual-exclusive panel state — prevents two menus overlapping at once
  // null = closed, 'quality' | 'subtitles' | 'sync' | 'speed' = open panel
  const [activePanel, setActivePanel] = useState(null);
  const showQ    = activePanel === 'quality';
  const showSub  = activePanel === 'subtitles';
  const showSync = activePanel === 'sync';
  const showSpeed_inner = activePanel === 'speed';
  const [subDelay, setSubDelay] = useState(0); // subtitle sync offset in seconds
  const [ripple,    setRipple]    = useState(null);
  const [swipeVol,  setSwipeVol]  = useState(false);
  const [swipeBri,  setSwipeBri]  = useState(false);
  const [fitMode,   setFitMode]   = useState('contain');
  const [needsTap,  setNeedsTap]  = useState(false);  // autoplay blocked
  const [hlsErr,    setHlsErr]    = useState(null);   // fatal stream error
  const [hasStarted, setHasStarted] = useState(false); // first play event occurred
  const [subToast,  setSubToast]  = useState(null);   // subtitle unavailable toast message
  const [autoplayCountdown, setAutoplayCountdown] = useState(null); // null or number (5..0)

  const [showSkipIntro,    setShowSkipIntro]    = useState(false);
  const [showSkipOutro,    setShowSkipOutro]    = useState(false);
  const [skipNotification, setSkipNotification] = useState('');

  const introSkippedRef = useRef(false);
  const outroSkippedRef = useRef(false);

  // Playback speed
  const [speed, setSpeed] = useState(1);
  // showSpeed is derived from activePanel above (showSpeed_inner)
  const showSpeed = showSpeed_inner;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Debug & Diagnostics
  const logsRef      = useRef([]);
  const [logs,       setLogs]       = useState([]);
  const [showDebug,  setShowDebug]  = useState(false);
  const [titleTaps,  setTitleTaps]  = useState(0);
  const [stuckCount, setStuckCount] = useState(0);

  const log = useCallback((msg) => {
    const time = new Date().toTimeString().split(' ')[0];
    const entry = `[${time}] ${msg}`;
    logsRef.current = [entry, ...logsRef.current].slice(0, 40);
    console.log(`[AniPlayer] ${msg}`);
  }, []);


  /* ── HLS ──────────────────────────────────────────────────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;

    log(`Initializing stream: ${url.slice(0, 100)}...`);

    // Save current playback position so we can resume at the same point
    // when switching servers mid-episode (not for episode changes — those start fresh)
    const savedTime = (videoRef.current?.currentTime > 2) ? videoRef.current.currentTime : 0;

    // Reset all state on URL change
    introSkippedRef.current = false;
    outroSkippedRef.current = false;
    setShowSkipIntro(false);
    setShowSkipOutro(false);
    setSkipNotification('');
    setNeedsTap(false);
    setHlsErr(null);
    setWaiting(true);
    setHasStarted(false);
    setQualities([]);
    setActiveQ(-1);
    setSubs(subtitles || []);
    setActiveSub(-1);
    setActivePanel(null); // close all menus when URL/server changes
    setStuckCount(0);

    v.removeAttribute('src');
    v.load();

    const tryPlay = () => {
      log('Calling video.play()...');
      v.play().then(() => {
        log('video.play() SUCCEEDED');
        setNeedsTap(false);
        // Resume at same position when switching servers mid-episode
        if (savedTime > 0) {
          log(`Resuming from saved position: ${savedTime.toFixed(1)}s`);
          v.currentTime = savedTime;
        }
      }).catch(err => {
        log(`video.play() FAILED: ${err.name} - ${err.message}`);
        if (err.name === 'NotAllowedError') {
          // Autoplay policy: start muted to guarantee instant playback, then unmute on first user tap
          v.muted = true;
          v.play().then(() => {
            log('Autoplay started with muted audio fallback');
            setNeedsTap(false);
          }).catch(() => {
            setNeedsTap(true);
          });
        } else if (err.name !== 'AbortError') {
          console.warn('[AniPlayer] play() error:', err.name, err.message);
        }
      });
    };

    let hls;
    let mediaErrRetries = 0;
    let networkErrRetries = 0;

    // ── LOCAL FILE MODE: bypass HLS.js, use native video element directly ──
    // content:// MediaStore URIs work natively in Capacitor's Android WebView
    // but HLS.js cannot handle them (it would try to fetch them via XHR which fails).
    if (isLocal) {
      log('Local file mode: setting src directly on native video element');
      v.src = url;
      v.load();
      tryPlay();
      return () => {
        v.removeAttribute('src');
        v.load();
      };
    }

    if (Hls.isSupported()) {
      log('Hls.js is supported. Spawning player...');
      hls = new Hls({
        enableWorker: true,
        startFragPrefetch: true,
        testBandwidth: false,
        capLevelToPlayerSize: true,
        startLevel: -1,
        abrEwmaDefaultEstimate: 4000000,
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        maxBufferLength: 40,
        maxMaxBufferLength: 80,
        maxBufferSize: 60 * 1000 * 1000,
        backBufferLength: 15,
        maxBufferHole: 0.5,
        manifestLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 12000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 500,
        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 500,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetries: 10,
        autoStartLoad: true,
        // Inject custom Capacitor Loader to bypass CORS on Android natively
        pLoader: isNative ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, referer, embedUrl) : Hls.DefaultConfig.loader,
        fLoader: isNative ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, referer, embedUrl) : Hls.DefaultConfig.loader,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_, data) => {
        log(`HLS Error: type=${data.type}, details=${data.details}, fatal=${data.fatal}`);
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkErrRetries < 1) {
          // First network error: try a simple startLoad (handles transient blips)
          networkErrRetries++;
          log(`Fatal network error (retry ${networkErrRetries}/1), calling startLoad...`);
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && onStreamExpired) {
          // Second network error: CDN token has expired. Silently request a fresh URL.
          log('Fatal network error after retry — CDN token likely expired. Requesting fresh stream URL...');
          setWaiting(true);
          setHlsErr(null);
          hls.destroy();
          hlsRef.current = null;
          onStreamExpired();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrRetries < 2) {
          mediaErrRetries++;
          log(`Fatal media error, retrying recoverMediaError (${mediaErrRetries}/2)...`);
          hls.recoverMediaError();
        } else {
          log('Fatal HLS error unrecoverable. Displaying error overlay.');
          // Pass error type key so JSX can show the right contextual message
          const errKey = data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network'
            : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media'
            : 'unknown';
          setHlsErr(errKey);
          setWaiting(false);
        }
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        log('Media attached to Hls.js, loading source...');
        hls.loadSource(url);
      });

      let cleanPlayStarted = false;
      const startCleanPlayback = () => {
        if (cleanPlayStarted) return;
        cleanPlayStarted = true;
        setWaiting(false);
        tryPlay();
      };

      hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
        log(`Manifest parsed: found ${d.levels.length} quality levels`);
        setQualities(d.levels.map((l, i) => ({
          id: i,
          label: l.height ? `${l.height}p` : `Level ${i + 1}`
        })));
      });

      // Smooth zero-clipping start: trigger play when initial media frames are safely in decoder buffer
      hls.on(Hls.Events.BUFFER_APPENDED, () => {
        if (!cleanPlayStarted && v.buffered.length > 0 && v.buffered.end(0) > 0.2) {
          startCleanPlayback();
        }
      });

      const onCanPlay = () => startCleanPlayback();
      v.addEventListener('canplay', onCanPlay, { once: true });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, d) => {
        log(`Subtitle tracks updated: found ${d.subtitleTracks?.length || 0} tracks`);
        if (d.subtitleTracks?.length) {
          const mapped = d.subtitleTracks.map((t, i) => ({
            id: i,
            label: t.name || t.lang || `Track ${i + 1}`
          }));
          const filtered = mapped.filter(t => 
            (t.label || '').toLowerCase().includes('english') || 
            (t.label || '').toLowerCase().includes('eng')
          ).map(t => ({ ...t, label: 'English' }));
          
          const finalTracks = filtered.length > 0 ? filtered : mapped;
          const unique = [];
          const seenLabels = new Set();
          for (const track of finalTracks) {
            if (!seenLabels.has(track.label)) {
              seenLabels.add(track.label);
              unique.push(track);
            }
          }
          setSubs(unique);
        }
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


  // Sync subtitle tracks when props change — merge server-specific + global source tracks
  const subTracksJson = JSON.stringify(subtitles);
  const extraTracksJson = JSON.stringify(extraSubtitles);
  useEffect(() => {
    const serverSubs = (subtitles || []).map((s, idx) => ({
      id: s.id !== undefined ? s.id : idx,
      label: s.label || s.lang || `Track ${idx + 1}`,
      file: s.file || s.url || '',
      content: s.content || null,
      kind: s.kind || 'captions',
      default: s.default || false,
    }));
    const globalExtras = (extraSubtitles || []).map((s, idx) => ({
      id: s.id !== undefined ? s.id : idx + 100,
      label: s.label || s.lang || `Track ${idx + 1}`,
      file: s.file || s.url || '',
      content: s.content || null,
      kind: s.kind || 'captions',
      default: s.default || false,
    }));

    const filterEnglish = (list) => {
      return list.filter(s => {
        const labelLower = (s.label || 'english').toLowerCase();
        return labelLower.includes('english') || labelLower.includes('eng');
      }).map(s => ({
        ...s,
        label: 'English'
      }));
    };

    let filteredServer = filterEnglish(serverSubs);
    let filteredExtras = filterEnglish(globalExtras);

    if (filteredServer.length === 0 && filteredExtras.length === 0 && (serverSubs.length > 0 || globalExtras.length > 0)) {
      filteredServer = serverSubs;
      filteredExtras = globalExtras;
    }

    const merged = [];
    const seenLabels = new Set();
    for (const track of [...filteredServer, ...filteredExtras]) {
      if (!seenLabels.has(track.label)) {
        seenLabels.add(track.label);
        merged.push(track);
      }
    }

    setSubs(merged);
    // Auto-select first English track if available
    if (merged.length > 0) {
      setActiveSub(merged[0].id !== undefined ? merged[0].id : 0);
    } else {
      setActiveSub(-1);
    }
  }, [subTracksJson, extraTracksJson]);

  useEffect(() => { if (hlsRef.current) hlsRef.current.currentLevel  = activeQ;  }, [activeQ]);
  
  useEffect(() => { 
    // Sync Hls.js embedded tracks
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = activeSub; 
    }
  }, [activeSub]);

  // Close menus when controls fade out
  useEffect(() => {
    if (!ctrlVis) setActivePanel(null);
  }, [ctrlVis]);
  // Fetch and parse subtitles when activeSub changes
  useEffect(() => {
    const currentSubTrack = subs.find(s => s.id === activeSub) || subs[activeSub] || subs[0];
    if (activeSub === -1 || (!currentSubTrack?.file && !currentSubTrack?.content)) {
      setCues([]);
      return;
    }

    // ── Core subtitle text loader for a single track ──
    const loadSubtitleFromTrack = async (track) => {
      const url = track.file || '';
      log(`[Subtitle] Attempting track "${track.label || 'unknown'}" from: ${url.slice(0, 80) || 'preloaded-content'}`);

      // 1. Instant path: direct pre-loaded string content (e.g. offline downloaded subtitle)
      if (track?.content && typeof track.content === 'string' && track.content.trim().length > 0) {
        log('[AniPlayer] Using embedded/pre-loaded subtitle content directly');
        return track.content;
      }

      // 2. Local offline file URL path (e.g. http://localhost/_capacitor_file_/... or file://...)
      if (isLocal || url.includes('_capacitor_file_') || url.startsWith('file://') || url.startsWith('http://localhost') || url.startsWith('local://')) {
        // Try window.fetch first (works in most WebView scenarios)
        try {
          log(`[AniPlayer] Fetching local subtitle via WebView asset loader: ${url}`);
          const res = await window.fetch(url);
          if (res.ok) {
            const text = await res.text();
            if (text && text.length > 5 && (text.includes('-->') || text.includes('WEBVTT') || text.trimStart().startsWith('['))) {
              return text;
            }
            log('[AniPlayer] window.fetch returned non-subtitle content, trying CapacitorHttp fallback...');
          }
        } catch (err) {
          log(`[AniPlayer] window.fetch on local subtitle failed: ${err.message}`);
        }

        // Fallback: CapacitorHttp handles file:// and _capacitor_file_ paths better on Android
        if (isNative) {
          try {
            // Convert _capacitor_file_ URL back to file:// for CapacitorHttp
            let localPath = url;
            if (url.includes('_capacitor_file_')) {
              const match = url.match(/_capacitor_file_(.+)/);
              if (match) localPath = 'file://' + decodeURIComponent(match[1]);
            }
            log(`[AniPlayer] CapacitorHttp fallback for local subtitle: ${localPath.slice(0, 80)}`);
            const resp = await CapacitorHttp.request({ url: localPath, method: 'GET', responseType: 'text' });
            if (resp.status === 200 && resp.data) {
              const text = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
              if (text && text.length > 5) return text;
            }
          } catch (e) {
            log(`[AniPlayer] CapacitorHttp local subtitle fallback failed: ${e.message}`);
          }
        }
      }

      // 3. Remote subtitle URL path on native platform
      const subReferer = track?.referer || referer;
      let targetUrl = url;
      let targetReferer = subReferer;

      // Handle subtitle-native:// scheme: extract real URL + referer encoded by scrapers
      if (url.startsWith('subtitle-native://')) {
        try {
          const parsed = new URL(url.replace('subtitle-native://', 'https://subtitle-native.local/'));
          const innerUrl = parsed.searchParams.get('url');
          const innerRef = parsed.searchParams.get('referer');
          if (innerUrl) {
            targetUrl = decodeURIComponent(innerUrl);
            if (innerRef) targetReferer = decodeURIComponent(innerRef);
            log(`[AniPlayer] subtitle-native:// decoded → ${targetUrl.slice(0, 80)}, referer: ${targetReferer.slice(0, 60)}`);
          }
        } catch (e) {
          log(`[AniPlayer] subtitle-native:// parse failed: ${e.message}`);
        }
      }
      // Handle proxy URL params (web/fallback path)
      else if (isNative && !url.includes('_capacitor_file_') && !url.startsWith('file://')) {
        try {
          const parsed = new URL(url.startsWith('http') ? url : (window.location.origin + url));
          const innerUrl = parsed.searchParams.get('url');
          const innerRef = parsed.searchParams.get('referer');
          if (innerUrl) {
            targetUrl = decodeURIComponent(innerUrl);
            if (innerRef) targetReferer = decodeURIComponent(innerRef);
            log(`[AniPlayer] Subtitle proxy bypass → ${targetUrl.slice(0, 80)}`);
          }
        } catch {}
      }

      if (isNative && targetUrl.startsWith('http') && !targetUrl.includes('localhost')) {
        try {
          const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': '*/*',
          };
          if (targetReferer) {
            try {
              const refOrigin = new URL(targetReferer).origin;
              reqHeaders['Origin'] = refOrigin;
            } catch {}
            reqHeaders['Referer'] = targetReferer;
          } else {
            try {
              const urlObj = new URL(targetUrl);
              reqHeaders['Origin'] = urlObj.origin;
              reqHeaders['Referer'] = urlObj.origin + '/';
            } catch {}
          }

          const response = await CapacitorHttp.request({
            url: targetUrl,
            method: 'GET',
            headers: reqHeaders,
            responseType: 'text',
          });

          if (response.status === 200 && response.data) {
            return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
          } else {
            throw new Error(`HTTP status ${response.status}`);
          }
        } catch (e) {
          console.warn('[AniPlayer] CapacitorHttp subtitle request failed:', e.message);
          throw e; // propagate so retry chain can try next track
        }
      }

      // Web fallback: try the original proxy URL (works in browser with CORS proxy)
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    };

    // ── Parse subtitle text into cues ──
    const parseSubtitleText = (text) => {
      if (!text) {
        log('Subtitle response was empty or blocked');
        return [];
      }

      if (text && typeof text === 'object') {
        try { text = JSON.stringify(text); } catch { return []; }
      }

      log(`Subtitle response type: ${typeof text}, length: ${text ? text.length : 0}`);
      if (text && typeof text === 'string') {
        log(`Subtitle start snippet: ${text.slice(0, 100)}`);
      }

      // Try JSON first (some scrapers return [{startTime, endTime, text}])
      if (typeof text === 'string' && (text.trimStart().startsWith('[') || text.trimStart().startsWith('{'))) {
        try {
          const data = JSON.parse(text);
          log(`Loaded ${data.length} subtitle cues (JSON format)`);
          return Array.isArray(data) ? data : [];
        } catch {}
      }

      // Parse WebVTT / SRT format
      if (text.includes('WEBVTT') || text.includes('-->')) {
        const parsed = [];
        const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
        for (const block of blocks) {
          const lines = block.trim().split('\n');
          const tsIdx = lines.findIndex(l => l.includes('-->'));
          if (tsIdx === -1) continue;
          const tsParts = lines[tsIdx].split('-->');
          if (tsParts.length < 2) continue;

          const parseTime = (t) => {
            const parts = t.trim().replace(',', '.').split(':');
            let secs = 0;
            if (parts.length === 3) secs = +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
            else if (parts.length === 2) secs = +parts[0] * 60 + parseFloat(parts[1]);
            return secs;
          };

          const startTime = parseTime(tsParts[0]);
          const endTime = parseTime(tsParts[1].trim().split(/\s+/)[0]);
          const rawSubText = lines.slice(tsIdx + 1).join('\n').trim();
          const cleanSubText = rawSubText.replace(/<[^>]+>/g, '').trim();

          if (cleanSubText && isFinite(startTime) && isFinite(endTime)) {
            parsed.push({ startTime, endTime, text: cleanSubText });
          }
        }
        log(`Loaded ${parsed.length} subtitle cues (WebVTT/SRT format)`);
        return parsed;
      }

      log('Unknown subtitle format — could not parse');
      return [];
    };

    // ── Main: try current track, then retry with fallbacks ──
    (async () => {
      // Try the active track first
      try {
        const text = await loadSubtitleFromTrack(currentSubTrack);
        const cueList = parseSubtitleText(text);
        if (cueList.length > 0) {
          setCues(cueList);
          return;
        }
        log('[Subtitle] Primary track returned 0 cues, trying fallbacks...');
      } catch (err) {
        log(`[Subtitle] Primary track failed: ${err.message}, trying fallbacks...`);
      }

      // Retry chain: try every other available track before giving up
      for (const fallbackTrack of subs) {
        if (fallbackTrack.id === activeSub) continue; // skip the one that just failed
        if (!fallbackTrack.file && !fallbackTrack.content) continue;
        try {
          const text = await loadSubtitleFromTrack(fallbackTrack);
          const cueList = parseSubtitleText(text);
          if (cueList.length > 0) {
            log(`[Subtitle] Fallback track "${fallbackTrack.label}" succeeded with ${cueList.length} cues`);
            setCues(cueList);
            return;
          }
        } catch {
          // continue to next fallback
        }
      }

      // All tracks exhausted
      log('[Subtitle] All subtitle tracks exhausted — no cues loaded');
      setCues([]);
      if (!isLocal) {
        setSubToast('Subtitles unavailable');
        setTimeout(() => setSubToast(null), 3500);
      }
    })();
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
      const ct = v.currentTime;
      setCurTime(ct);

      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
      // Only log non-timeupdate events to avoid flooding re-renders
      if (e.type !== 'timeupdate') {
        log(`Video state sync (event: ${e.type}, curTime=${v.currentTime.toFixed(1)}, paused=${v.paused})`);
      }
    };
    const onMeta = () => {
      log(`Video loadedmetadata: duration=${v.duration.toFixed(1)}`);
      setDuration(v.duration);
      // Resume from stored seek position (Netflix-style "continue where you left off")
      // Only seek if > 5s into episode and not within last 30s (episode considered done)
      if (initialSeekTime > 5 && v.duration > 0 && initialSeekTime < v.duration - 30) {
        log(`[Resume] Seeking to stored position: ${initialSeekTime.toFixed(1)}s`);
        v.currentTime = initialSeekTime;
      }
    };
    const onWait = () => {
      log('Video event: waiting (buffering)');
      setWaiting(true);
    };
    const onEnded = () => {
      log('Video ended');
      if (autoplay && onEpisodeChange && currentEpisode < totalEpisodes) {
        setAutoplayCountdown(3); // 3 seconds — faster, more premium
      }
    };
    const onPlay = (e) => {
      log(`Video event: playing/canplay (event: ${e.type})`);
      setWaiting(false);
      if (e.type === 'playing') {
        setNeedsTap(false);
        setHasStarted(true);
        schedHide(); // ← auto-hide HUD when video actually starts playing
      }
    };
    // Also trigger auto-hide from timeupdate when playing starts (covers autoplay case)
    let _lastPlaying = false;
    const onTimeUpdate = () => {
      if (!v.paused && !_lastPlaying) {
        _lastPlaying = true;
        schedHide();
      } else if (v.paused) {
        _lastPlaying = false;
      }
    };

    v.addEventListener('play',            sync);
    v.addEventListener('pause',           sync);
    v.addEventListener('timeupdate',      sync);
    v.addEventListener('timeupdate',      onTimeUpdate);
    v.addEventListener('loadedmetadata',  onMeta);
    v.addEventListener('waiting',         onWait);
    v.addEventListener('playing',         onPlay);
    v.addEventListener('canplay',         onPlay);
    v.addEventListener('ended',           onEnded);
    return () => {
      v.removeEventListener('play',           sync);
      v.removeEventListener('pause',          sync);
      v.removeEventListener('timeupdate',     sync);
      v.removeEventListener('timeupdate',     onTimeUpdate);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('waiting',        onWait);
      v.removeEventListener('playing',        onPlay);
      v.removeEventListener('canplay',        onPlay);
      v.removeEventListener('ended',          onEnded);
    };
  }, [log, autoplay, onEpisodeChange, currentEpisode, totalEpisodes]);

  // ── Save seek position every 10s while playing (Netflix-style resume) ──
  // Fires onSeekProgress(currentTime, duration) at 10s intervals.
  // Throttled: only fires while video is actually playing, not paused/buffering.
  // Egress impact: ZERO — this is a local Preferences write, not a Supabase read.
  const onSeekProgressRef = useRef(onSeekProgress);
  useEffect(() => { onSeekProgressRef.current = onSeekProgress; }, [onSeekProgress]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !onSeekProgressRef.current) return;

    const interval = setInterval(() => {
      if (v.paused || v.ended || v.duration < 5) return;
      const ct = v.currentTime;
      const dur = v.duration;
      // Don't save in first 5s (avoids saving resume point at 0) or last 30s (episode done)
      if (ct < 5 || ct > dur - 30) return;
      onSeekProgressRef.current(ct, dur);
    }, 10000); // every 10 seconds

    return () => clearInterval(interval);
  }, [url]); // restart interval when URL changes (new episode)

  // ── Autoplay countdown when video ends ─────────────────────────
  useEffect(() => {
    if (autoplayCountdown === null) return;
    if (autoplayCountdown <= 0) {
      setAutoplayCountdown(null);
      if (onEpisodeChange && currentEpisode < totalEpisodes) {
        onEpisodeChange(currentEpisode + 1);
      }
      return;
    }
    const t = setTimeout(() => setAutoplayCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [autoplayCountdown, onEpisodeChange, currentEpisode, totalEpisodes]);

  // Monitor stuck state — show hint after 8s but NEVER throw a fatal error
  useEffect(() => {
    const isLoading = (waiting || !hasStarted) && !hlsErr;
    if (!isLoading) {
      setStuckCount(0);
      return;
    }
    const interval = setInterval(() => {
      setStuckCount(c => c + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [waiting, hasStarted, hlsErr]);

  /* ── Fullscreen events (Desktop Browser Only) ─────────────────── */
  useEffect(() => {
    if (isNative) return; // Native mobile uses CSS + ScreenOrientation + ImmersiveMode, not DOM Fullscreen API
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
      onFullscreenChange(fs || isLocal);
    }
    const syncNativeFullscreen = async () => {
      if (!isNative) return;
      try {
        if (fs || isLocal) {
          // Lock landscape + full immersive (hides both status bar AND nav bar)
          if (EmbedScraper?.setOrientation) {
            await EmbedScraper.setOrientation({ orientation: 'landscape' }).catch(() => {});
          }
          await ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
          if (EmbedScraper?.setImmersiveMode) {
            await EmbedScraper.setImmersiveMode({ enabled: true });
          } else {
            // Fallback: at least hide status bar
            await StatusBar.hide();
          }
        } else {
          // Force back to portrait first, then unlock orientation, and restore system bars
          if (EmbedScraper?.setOrientation) {
            await EmbedScraper.setOrientation({ orientation: 'portrait' }).catch(() => {});
          }
          try {
            await ScreenOrientation.lock({ orientation: 'portrait' });
            await ScreenOrientation.unlock();
          } catch {}
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
  }, [fs, isLocal]);

  // Always restore system bars + unlock orientation on unmount
  // SKIP this when unmounting due to an episode transition (keepFsOnEpChange.current === true)
  // so the next episode can immediately re-enter fullscreen without a portrait flash.
  useEffect(() => {
    return () => {
      // Always reset screen brightness when player closes
      resetDeviceBrightness();

      if (isNative && !(keepFsOnEpChange?.current)) {
        ScreenOrientation.lock({ orientation: 'portrait' })
          .then(() => ScreenOrientation.unlock())
          .catch(() => {});
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

  // Silent skip — shows ripple feedback but does NOT show the full HUD
  // Used for double-tap. For button taps, use skip() which also shows controls.
  const skipSilent = useCallback((s) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(v.currentTime + s, 0, v.duration || 0);
    const id = Date.now();
    setRipple({ side: s < 0 ? 'left' : 'right', label: `${Math.abs(s)}s`, id });
    setTimeout(() => setRipple(r => r?.id === id ? null : r), 750);
    // schedHide only if HUD is already visible — don't bring it up
    if (ctrlVis) schedHide();
  }, [ctrlVis, schedHide]);

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
    setFs(prev => !prev);
  }, []);

  // Note: startInFs is handled by initialising fs state directly above (useState(startInFs)),
  // so no separate useEffect is needed — avoids the portrait-flash caused by the two-render cycle.

  // ── Playback Speed ─────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
  }, [speed]);

  // Pause playback when loading/fetching next episode servers
  useEffect(() => {
    if (loading && videoRef.current) {
      videoRef.current.pause();
    }
  }, [loading]);

  const applySpeed = useCallback((s) => {
    setSpeed(s);
    setActivePanel(null);
    showCtrl();
  }, [showCtrl]);

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
      // Double-tap: skip silently — no HUD flash
      clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (xPct < 0.35) skipSilent(-10);
      else if (xPct > 0.65) skipSilent(10);
      else togglePlay(); // center double-tap = play/pause (HUD toggle is fine here)
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
  }, [skipSilent, togglePlay, schedHide]);

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
      if (dx > 8 || dy > 8) {
        // If predominantly horizontal, cancel swipe (handled by double-tap skip)
        if (dx > dy * 1.2) { gesture.current = null; return; }
        gesture.current.moved = true;
      } else return;
    }
    // Sensitivity: 180px swipe = full range
    const delta = (gesture.current.startY - cy) / 180;
    if (gesture.current.isLeft) {
      // LEFT side = screen brightness (native phone brightness)
      const nb = clamp(gesture.current.startBri + delta, 0.05, 1.0);
      setBright(nb);
      setDeviceBrightness(nb); // sets ACTUAL phone screen brightness
      setSwipeBri(true);
    } else {
      // RIGHT side = volume
      applyVol(clamp(gesture.current.startVol + delta, 0, 1));
      setSwipeVol(true);
    }
  }, [applyVol]);

  const onGestureEnd = useCallback((cx, cy) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved) handleTap(cx, cy);
    // Keep brightness set — do NOT reset (user wants it to stay)
    setTimeout(() => { setSwipeBri(false); setSwipeVol(false); }, 900);
  }, [handleTap]);

  // Programmatic touch event binding to support preventDefault() during swipes on Android
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const handleTouchStart = (e) => {
      // Ignore multi-touch (pinch-to-zoom etc)
      if (e.touches.length > 1) {
        gesture.current = null;
        return;
      }
      if (!isGestureTarget(e.target)) return;
      lastTouchTime.current = Date.now();
      const t = e.touches[0];
      if (t) onGestureStart(t.clientX, t.clientY);
    };

    const handleTouchMove = (e) => {
      // Cancel gesture on multi-touch
      if (e.touches.length > 1) {
        gesture.current = null;
        return;
      }
      if (!isGestureTarget(e.target)) return;
      // Prevent Android scroll/bounce if actively swiping volume/brightness or dragging seek
      if (seekDrag.current || (gesture.current && gesture.current.moved)) {
        if (e.cancelable) e.preventDefault();
      }
      const t = e.touches[0];
      if (t) onGestureMove(t.clientX, t.clientY);
    };

    const handleTouchEnd = (e) => {
      if (!isGestureTarget(e.target)) {
        seekDrag.current = false;
        return;
      }
      lastTouchTime.current = Date.now();
      // Fix: if we were dragging the seek bar, consume and return
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

    // NOTE: touchstart must be { passive: false } so we can preventDefault()
    // during brightness/volume swipes to prevent Android's scroll interference.
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove',  handleTouchMove,  { passive: false });
    el.addEventListener('touchend',   handleTouchEnd,   { passive: true  });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove',  handleTouchMove);
      el.removeEventListener('touchend',   handleTouchEnd);
    };
  }, [onGestureStart, onGestureMove, onGestureEnd]);

  /* ─── Derived ─────────────────────────────────────────────── */
  const pct    = duration ? (curTime  / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  const VolIco = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const activeCue = Array.isArray(cues) && cues.length > 0 ? cues.find(c => curTime >= (c.startTime + subDelay) && curTime <= (c.endTime + subDelay)) : null;
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
      onClick={(e) => {
        if (isTouch()) return;
        if (!isGestureTarget(e.target)) return;
        if (Date.now() - lastTouchTime.current < 500) return;
        handleTap(e.clientX, e.clientY);
      }}
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
      {activeCue && cueHtml && (() => {
        const subSz = subtitleSettings?.subtitleFontSize || 'medium';
        const fontSize = { small: 14, medium: 18, large: 22, xlarge: 28 }[subSz] || 18;
        const color = subtitleSettings?.subtitleColor || '#ffffff';
        const bgOpacity = subtitleSettings?.subtitleBgOpacity ?? 0.35;
        const isTop = subtitleSettings?.subtitlePosition === 'top';
        return (
          <div
            className="anip__subtitle-overlay"
            style={isTop ? { bottom: 'auto', top: '11%' } : {}}
          >
            <span
              className="anip__subtitle-text"
              style={{ fontSize, color, background: `rgba(0,0,0,${bgOpacity})` }}
              dangerouslySetInnerHTML={{ __html: cueHtml.replace(/\n/g, '<br/>') }}
            />
          </div>
        );
      })()}



      {/* ── Subtitle unavailable toast ────────────────────────── */}
      {subToast && (
        <div className="anip__sub-toast">
          <span>⚠️ {subToast}</span>
        </div>
      )}

      {/* ── Fatal HLS error overlay ─────────────────────────────── */}
      {hlsErr && (() => {
        // Context-aware error messages
        const errMessages = {
          network: { icon: '📡', title: 'Connection Issue', body: 'Could not reach the stream. Check your connection or try a different server.' },
          media:   { icon: '⚠️', title: 'Decode Error',      body: 'This stream format isn\'t supported. Try switching to another server.' },
          unknown: { icon: '🎬', title: 'Stream Unavailable', body: 'This stream couldn\'t load. Select another server to continue watching.' },
        };
        const msg = errMessages[hlsErr] || errMessages.unknown;
        const doRetry = () => {
          const v = videoRef.current;
          if (!v) return;
          setHlsErr(null);
          setNeedsTap(false);
          setWaiting(true);
          const oldHls = hlsRef.current;
          if (oldHls) { try { oldHls.destroy(); } catch {} hlsRef.current = null; }
          const newHls = new Hls({
            enableWorker: true,
            startLevel: -1,
            maxBufferLength: 15,
            maxMaxBufferLength: 30,
            maxBufferSize: 30 * 1000 * 1000,
            backBufferLength: 15,
            manifestLoadingTimeOut: 8000,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,
            levelLoadingTimeOut: 8000,
            levelLoadingMaxRetry: 3,
            levelLoadingRetryDelay: 1000,
            fragLoadingTimeOut: 12000,
            fragLoadingMaxRetry: 3,
            fragLoadingRetryDelay: 1000,
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.1,
            nudgeMaxRetries: 10,
            autoStartLoad: true,
            pLoader: isNative ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, referer, embedUrl) : Hls.DefaultConfig.loader,
            fLoader: isNative ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, referer, embedUrl) : Hls.DefaultConfig.loader,
          });
          hlsRef.current = newHls;
          newHls.attachMedia(v);
          newHls.on(Hls.Events.MEDIA_ATTACHED, () => { newHls.loadSource(url); });
          newHls.on(Hls.Events.MANIFEST_PARSED, () => { setWaiting(false); v.play().catch(() => {}); });
          newHls.on(Hls.Events.ERROR, (_, d) => {
            if (d.fatal) { setHlsErr('unknown'); setWaiting(false); }
          });
        };
        return (
          <div className="anip__error">
            <span className="anip__error__icon">{msg.icon}</span>
            <p className="anip__error__msg">
              <strong style={{ display: 'block', marginBottom: 4, fontSize: 15, fontWeight: 700, color: '#fff' }}>
                {msg.title}
              </strong>
              {msg.body}
            </p>
            <button className="anip__error__retry" onClick={doRetry}>
              ↺ Retry
            </button>
            <button className="anip__error__secondary" onClick={onBack}>
              ← Try Another Server
            </button>
          </div>
        );
      })()}

      {/* ── buffering spinner / loading spinner ─────────────── */}
      {(waiting || !hasStarted || needsTap || loading) && !hlsErr && (
        <div className="anip__spinner">
          <div className="anip__spinner-ring" />
        </div>
      )}

      {/* ── Auto-next episode — minimalist premium pill ───────── */}
      {autoplayCountdown !== null && (
        <div style={{
          position: 'absolute', bottom: 80, right: 12, zIndex: 28,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14, padding: '10px 12px 10px 10px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
          animation: 'anipNext_in 0.3s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          {/* SVG circular countdown ring */}
          <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
            <svg width="38" height="38" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
              <circle cx="19" cy="19" r="15" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
              <circle
                cx="19" cy="19" r="15" fill="none"
                stroke="var(--accent)" strokeWidth="2.5"
                strokeDasharray={`${2 * Math.PI * 15}`}
                strokeDashoffset={`${2 * Math.PI * 15 * (1 - autoplayCountdown / 3)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.95s linear' }}
              />
            </svg>
            <span style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, color: '#fff',
            }}>{autoplayCountdown}</span>
          </div>
          {/* Text */}
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 700 }}>Up Next</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Episode {currentEpisode + 1}</div>
          </div>
          {/* Cancel X */}
          <button
            onClick={() => setAutoplayCountdown(null)}
            aria-label="Cancel auto-next"
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', marginLeft: 2,
            }}
          >
            <X size={12} color="rgba(255,255,255,0.75)" />
          </button>
          <style>{`@keyframes anipNext_in { from{opacity:0;transform:translateX(14px) scale(0.9)} to{opacity:1;transform:none} }`}</style>
        </div>
      )}

      {/* ── skip ripples ────────────────────────────────────── */}
      {ripple && <SkipRipple key={ripple.id} side={ripple.side} label={ripple.label} />}

      {/* ── swipe indicators ────────────────────────────────── */}
      <SwipeBar type="brightness" value={clamp(bright, 0, 1)} visible={swipeBri} />
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
          {/* Back Button (rendered when onBack prop is passed, e.g. offline download player) */}
          {onBack ? (
            <button
              className="anip__btn anip__btn--back"
              onClick={e => { e.stopPropagation(); onBack(); }}
              title="Exit Video"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                cursor: 'pointer',
                flexShrink: 0,
                marginRight: 10,
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            >
              <ArrowLeft size={19} />
            </button>
          ) : (
            <div style={{ width: 34, flexShrink: 0 }} />
          )}
          <span 
            className="anip__title"
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              setTitleTaps(t => {
                const next = t + 1;
                log(`Title tapped ${next}/5 times`);
                if (next >= 5) {
                  setShowDebug(d => {
                    const nextD = !d;
                    if (nextD) setLogs([...logsRef.current]);
                    return nextD;
                  });
                  log(`Toggled developer console`);
                  return 0;
                }
                return next;
              });
            }}
          >
            {title}
          </span>

          {/* Subtitle sync delay adjuster on top-right */}
          <div className="anip__menu-anchor" style={{ zIndex: 10 }}>
            <button
              className={`anip__btn ${subDelay !== 0 ? 'anip__btn--active' : ''}`}
              onClick={e => { e.stopPropagation(); setActivePanel(p => p === 'sync' ? null : 'sync'); schedHide(); }}
              title="Subtitle Delay"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 12px',
                background: 'rgba(0, 0, 0, 0.6)',
                borderRadius: 20,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: subDelay !== 0 ? 'var(--accent)' : 'rgba(255, 255, 255, 0.95)',
                cursor: 'pointer'
              }}
            >
              <Clock size={15} />
              <span style={{ fontSize: 11, fontWeight: 700 }}>Sub Sync</span>
              {subDelay !== 0 && (
                <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', borderRadius: 4, padding: '1px 4px', marginLeft: 2 }}>
                  {subDelay > 0 ? `+${subDelay.toFixed(1)}s` : `${subDelay.toFixed(1)}s`}
                </span>
              )}
            </button>
            {showSync && (
              <div className="anip__sync-menu" onClick={e => e.stopPropagation()}>
                <p className="anip__sync-hd">Subtitle Sync</p>
                <div className="anip__sync-readout">
                  {subDelay > 0 ? `+${subDelay.toFixed(1)}s` : `${subDelay.toFixed(1)}s`}
                </div>
                <div className="anip__sync-grid">
                  <button className="anip__sync-btn" onClick={() => setSubDelay(d => d - 0.5)}>-0.5s</button>
                  <button className="anip__sync-btn" onClick={() => setSubDelay(d => d + 0.5)}>+0.5s</button>
                  <button className="anip__sync-btn" onClick={() => setSubDelay(d => d - 0.1)}>-0.1s</button>
                  <button className="anip__sync-btn" onClick={() => setSubDelay(d => d + 0.1)}>+0.1s</button>
                  <button className="anip__sync-btn anip__sync-btn--reset" onClick={() => setSubDelay(0)}>Reset (0.0s)</button>
                </div>
              </div>
            )}
          </div>
        </div>


        {/* ── Spacer (click to toggle controls) ──────────────── */}
        <div className="anip__spacer" />

        {/* ── Center Controls (Prev, Play/Pause, Next) ──────── */}
        {!(showQ || showSub || showSync || loading) && (
          <div className="anip__center-ctrls" onClick={e => e.stopPropagation()}>
          {onEpisodeChange && (
            <button
              className={`anip__center-btn ${currentEpisode <= 1 ? 'anip__center-btn--disabled' : ''}`}
              disabled={currentEpisode <= 1}
              onClick={(e) => { e.stopPropagation(); onEpisodeChange(currentEpisode - 1); }}
              title="Previous Episode"
            >
              <SkipBack size={22} fill="currentColor" />
            </button>
          )}
          
          <button
            className="anip__center-btn anip__center-btn--play"
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={32} fill="currentColor" strokeWidth={0} /> : <Play size={32} fill="currentColor" strokeWidth={0} style={{ marginLeft: 3 }} />}
          </button>

          {onEpisodeChange && (
            <button
              className={`anip__center-btn ${currentEpisode >= totalEpisodes ? 'anip__center-btn--disabled' : ''}`}
              disabled={currentEpisode >= totalEpisodes}
              onClick={(e) => { e.stopPropagation(); onEpisodeChange(currentEpisode + 1); }}
              title="Next Episode"
            >
              <SkipForward size={22} fill="currentColor" />
            </button>
          )}
        </div>
      )}

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





              {/* Time */}
              <span className="anip__time">{fmt(curTime)} / {fmt(duration)}</span>
            </div>

            {/* Right cluster */}
            <div className="anip__cluster anip__cluster--right">

              {/* Subtitles */}
              <div className="anip__menu-anchor">
                <button
                  className={`anip__btn ${activeSub !== -1 ? 'anip__btn--active' : ''}`}
                  onClick={e => { e.stopPropagation(); setActivePanel(p => p === 'subtitles' ? null : 'subtitles'); schedHide(); }}
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
                        onClick={e => { e.stopPropagation(); setActiveSub(s.id); setActivePanel(null); schedHide(); }}
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
                  onClick={e => { e.stopPropagation(); setActivePanel(p => p === 'quality' ? null : 'quality'); schedHide(); }}
                  title="Quality"
                >
                  <Settings size={17} />
                  <span className="anip__badge-visible">{activeQ===-1?'Auto':qualities[activeQ]?.label||'Auto'}</span>
                </button>
                {showQ && (
                  <div className="anip__menu">
                    <p className="anip__menu-hd">Quality</p>
                    {[{ id:-1, label:'Auto' }, ...[...qualities].reverse()].map(q => (
                      <button key={q.id}
                        className={`anip__menu-item ${activeQ===q.id ? 'anip__menu-item--on':''}`}
                        onClick={e => { e.stopPropagation(); setActiveQ(q.id); setActivePanel(null); schedHide(); }}
                      >
                        {activeQ===q.id && <span className="anip__chk">✓</span>}{q.label}
                      </button>
                    ))}
                    {qualities.length===0 && <p className="anip__menu-empty">No options</p>}
                  </div>
                )}
              </div>

              {/* Playback Speed */}
              <div className="anip__menu-anchor">
                <button
                  className="anip__btn"
                  onClick={e => { e.stopPropagation(); setActivePanel(p => p === 'speed' ? null : 'speed'); schedHide(); }}
                  title="Playback Speed"
                >
                  <span className="anip__badge-visible" style={{ fontSize: '10px', fontWeight: 800 }}>
                    {speed === 1 ? '1×' : `${speed}×`}
                  </span>
                </button>
                {showSpeed && (
                  <div className="anip__menu" onClick={e => e.stopPropagation()}>
                    <p className="anip__menu-hd">Speed</p>
                    {SPEEDS.map(s => (
                      <button key={s}
                        className={`anip__menu-item ${speed === s ? 'anip__menu-item--on' : ''}`}
                        onClick={e => { e.stopPropagation(); applySpeed(s); }}
                      >
                        {speed === s && <span className="anip__chk">✓</span>}{s}×
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Aspect Ratio Toggle */}
              <button className="anip__btn"
                onClick={e => { e.stopPropagation(); toggleFitMode(); }}
                title="Aspect Ratio"
                style={{ minWidth: '48px', justifyContent: 'center' }}
              >
                <span className="anip__badge-visible" style={{ fontSize: '10px', textTransform: 'uppercase', opacity: 0.95 }}>
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

      {/* Developer Diagnostics Overlay */}
      {showDebug && (
        <div className="anip__debug-panel" onClick={e => e.stopPropagation()}>
          <div className="anip__debug-header">
            <span>Developer Diagnostics</span>
            <button className="anip__debug-close" onClick={() => setShowDebug(false)}>✕</button>
          </div>
          <div className="anip__debug-info">
            <strong>Stream URL:</strong> <code style={{ fontSize: '10px', wordBreak: 'break-all' }}>{url}</code><br/>
            <strong>Playback state:</strong> {playing ? 'Playing' : 'Paused'}, <strong>Waiting:</strong> {waiting ? 'Yes' : 'No'}<br/>
            <strong>Buffer:</strong> {buffered.toFixed(1)}s / {duration.toFixed(1)}s ({pct.toFixed(0)}%)
          </div>
          <div className="anip__debug-logs">
            {logs.map((logStr, idx) => (
              <div key={idx} className="anip__debug-log-line">{logStr}</div>
            ))}
          </div>
        </div>
      )}



    </div>
  );

  return playerContent;
}
