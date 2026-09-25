import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { Capacitor, CapacitorHttp, CapacitorCookies, registerPlugin } from '@capacitor/core';
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  Maximize, Minimize, Settings, Subtitles,
  RotateCcw, RotateCw, ArrowLeft, Clock, SkipForward, SkipBack, X,
  RectangleHorizontal, ZoomIn, MoveHorizontal
} from 'lucide-react';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { StatusBar } from '@capacitor/status-bar';
import { registerBackButtonHandler } from '../utils/backButton';
import VideoAdOverlay from './ads/VideoAdOverlay';
import adEngine from '../services/adEngine';
import { getNetworkProfile, findLowestQualityLevel, recordNetworkSample, subscribeNetworkChanges } from '../utils/networkSpeed';
import { getCachedPlaylistText } from '../api/stream';
import './AniPlayer.css';

export function isNativePlatform() {
  try {
    if (typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() === 'android')) {
      return true;
    }
    return Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
}

const EmbedScraper = registerPlugin('EmbedScraper');

/* ─── Native Brightness plugin ─────────────────────────────────
   Uses LAZY initialization so the plugin is only resolved after
   Capacitor is fully loaded (avoids "plugin not found" at import time).
──────────────────────────────────────────────────────────────── */
let _BrightnessPlugin = undefined; // lazy-loaded on first use

function getBrightnessPlugin() {
  if (_BrightnessPlugin !== undefined) return _BrightnessPlugin;
  // Only attempt on native platforms
  if (!isNativePlatform()) {
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



/* ─── Subtitle HTML Sanitizer ──────────────────────────────────
   Converts VTT inline tags to safe HTML with a strict whitelist.
   Immune to nested-tag bypass attacks (e.g. <scr<script>ipt>).
   Only allows: <em>, <strong>, <br>, <span> (no attrs), <ruby>, <rt>.
   All other tags and all attributes containing "on*" or "javascript:" are stripped.
──────────────────────────────────────────────────────────────── */
const SAFE_SUBTITLE_TAGS = new Set(['em', 'strong', 'br', 'span', 'ruby', 'rt']);

function sanitizeSubtitleHtml(raw) {
  if (!raw) return '';

  // Step 1: Map VTT-specific tags to safe HTML equivalents
  let text = raw
    .replace(/<i>/gi, '<em>')
    .replace(/<\/i>/gi, '</em>')
    .replace(/<b>/gi, '<strong>')
    .replace(/<\/b>/gi, '</strong>');

  // Step 2: Whitelist-only tag stripping with full attribute removal
  text = text.replace(/<\/?([a-z0-9]+)[^>]*>/gi, (match, tag) => {
    const lower = tag.toLowerCase();
    if (!SAFE_SUBTITLE_TAGS.has(lower)) return '';
    // Only allow the bare self-closing <br/> or <tag>...</tag> — no attributes
    const isClosing = match.startsWith('</');
    if (lower === 'br') return '<br/>';
    return isClosing ? `</${lower}>` : `<${lower}>`;
  });

  // Step 3: Paranoid final pass — strip any residual javascript: or event handlers
  // that may have slipped through malformed tag structures
  text = text
    .replace(/javascript:/gi, '')
    .replace(/\bon\w+\s*=/gi, '');

  return text;
}


/* ─── Way 4: CapacitorHttp hls.js loader ──────────────────────

   On Android, each HLS manifest and fragment is fetched through
   CapacitorHttp which bypasses CORS at the OS network layer.
   This eliminates the need for any backend HLS proxy server.
──────────────────────────────────────────────────────────────── */
const isNative = isNativePlatform();

export function getEffectivePlayableUrl(rawUrl, referer) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  if (isNativePlatform() || rawUrl.includes('localhost:8081') || rawUrl.includes('_capacitor_file_') || rawUrl.startsWith('file:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
    return rawUrl;
  }
  // If already proxied via backend, keep it
  if (rawUrl.includes('/api/stream/hls') || rawUrl.includes('/api/stream/segment')) {
    return rawUrl;
  }
  const streamProxy = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STREAM_PROXY_URL) || 'http://localhost:4000/api/stream/hls';
  const effectiveRef = referer || 'https://megaplay.buzz/';
  const sep = streamProxy.includes('?') ? '&' : '?';
  return `${streamProxy}${sep}url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(effectiveRef)}`;
}

/* ─── MPEG-TS / fMP4 Header De-obfuscator ───────────────────────
   MegaCloud / MegaPlay disguise video segments on TikTok CDN (and other CDNs)
   by prepending a 252-byte dummy PNG image header (\x89PNG\r\n\x1a\n...IEND...).
   This utility strips the dummy image header and returns clean MPEG-TS / fMP4 bytes
   so Hls.js demuxes and decodes with zero stalling or buffer append errors.
──────────────────────────────────────────────────────────────── */
function stripObfuscatedHeader(data) {
  if (!data) return data;
  let u8;
  if (data instanceof ArrayBuffer) {
    u8 = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return data;
  }

  if (u8.length < 188) return data;

  // Already standard MPEG-TS (first byte is sync byte 0x47)
  if (u8[0] === 0x47 && (u8.length < 376 || u8[188] === 0x47)) return data;

  // Standard fMP4 box ('ftyp' or 'moof')
  if (u8.length > 8 && (
    (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) || // ftyp
    (u8[4] === 0x6d && u8[5] === 0x6f && u8[6] === 0x6f && u8[7] === 0x66)    // moof
  )) {
    return data;
  }

  // MegaCloud / MegaPlay .image or .png wrapper (known 252-byte PNG header check for O(1) instant return)
  if (u8.length > 252 + 376 && u8[252] === 0x47 && u8[252 + 188] === 0x47 && u8[252 + 376] === 0x47) {
    return u8.buffer.slice(u8.byteOffset + 252, u8.byteOffset + u8.length);
  }

  // General sync word scan for any other dummy image headers (scans first 2048 bytes)
  const maxScan = Math.min(u8.length - 376, 2048);
  for (let o = 1; o < maxScan; o++) {
    if (u8[o] === 0x47 && u8[o + 188] === 0x47 && u8[o + 376] === 0x47) {
      return u8.buffer.slice(u8.byteOffset + o, u8.byteOffset + u8.length);
    }
  }

  return data;
}

function base64ToArrayBuffer(base64) {
  if (!base64) return new ArrayBuffer(0);
  if (base64 instanceof ArrayBuffer) return base64;
  if (ArrayBuffer.isView(base64)) return base64.buffer.slice(base64.byteOffset, base64.byteOffset + base64.byteLength);
  let clean = typeof base64 === 'string' ? base64 : String(base64);
  const commaIdx = clean.indexOf(',');
  if (commaIdx !== -1 && commaIdx < 100) {
    clean = clean.slice(commaIdx + 1);
  }
  // Strip whitespace / newlines from Capacitor Base64.DEFAULT
  if (clean.includes('\n') || clean.includes('\r') || clean.includes(' ') || clean.includes('\t')) {
    clean = clean.replace(/[\r\n\s\t]/g, '');
  }
  if (!clean) return new ArrayBuffer(0);

  const rem = clean.length % 4;
  if (rem === 2) clean += '==';
  else if (rem === 3) clean += '=';

  try {
    const binary_string = window.atob(clean);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (e) {
    console.error('[base64ToArrayBuffer] atob failed:', e.message, 'clean len:', clean.length);
    return new ArrayBuffer(0);
  }
}

// Proper referer resolver matching native OfflineDownloader
function getProperReferer(urlStr, fallbackRef) {
  if (!urlStr) return fallbackRef || '';
  const lower = urlStr.toLowerCase();
  if (lower.includes('otakuhg') || lower.includes('premilkyway') || lower.includes('cdn-centaurus') || lower.includes('streamhg') || lower.includes('financialintelligence')) {
    return 'https://otakuhg.site/';
  }
  if (lower.includes('otakuvid') || lower.includes('dramiyos') || lower.includes('acek-cdn') || lower.includes('earnvids') || lower.includes('mediadexmora')) {
    return 'https://otakuvid.online/';
  }
  if (lower.includes('megap') || lower.includes('megacloud') || lower.includes('rabbitstream')
      || lower.includes('mfast') || lower.includes('rapid-cloud') || lower.includes('kryntal')
      || lower.includes('norami') || lower.includes('imgnex') || lower.includes('dokicloud')
      || lower.includes('akirax') || lower.includes('shiora') || lower.includes('mikora')
      || lower.includes('quavex') || lower.includes('nexabloom') || lower.includes('streamzone')
      || lower.includes('silverorbit') || lower.includes('anihd')) {
    return 'https://megaplay.buzz/';
  }
  if (lower.includes('vibevibe.workers.dev') || lower.includes('bibiemb')) {
    return 'https://bibiemb.xyz/';
  }
  if (lower.includes('vivibebe')) {
    return 'https://vivibebe.site/';
  }
  if (lower.includes('vidtube') || lower.includes('vidstream')) {
    if (fallbackRef && (fallbackRef.includes('megap') || fallbackRef.includes('norami') || fallbackRef.includes('imgnex') || fallbackRef.includes('dokicloud'))) {
      return 'https://megaplay.buzz/';
    }
    return 'https://vidtube.site/';
  }
  if (lower.includes('vidplay') || lower.includes('mycloud') || lower.includes('mcloud')) {
    return 'https://vidplay.online/';
  }
  if (lower.includes('echovideo') || lower.includes('roburnt') || lower.includes('dpopdrop') || lower.includes('burntburst') || lower.includes('savedly')) {
    return 'https://play.echovideo.ru/';
  }
  if (lower.includes('anineko')) {
    return 'https://anineko.es/';
  }
  if (lower.includes('anivid')) {
    return 'https://anivid.net/';
  }
  if (lower.includes('tiktokcdn') || lower.includes('tiktok') || lower.includes('snssdk')) {
    return 'https://megaplay.buzz/';
  }
  if (lower.includes('hstream') || lower.includes('ane-h.xyz') || lower.includes('imoto-str')) {
    return 'https://hstream.moe/';
  }
  if (lower.includes('hentaicity')) {
    return 'https://www.hentaicity.com/';
  }
  if (fallbackRef && fallbackRef.startsWith('http') && !fallbackRef.includes('localhost')) {
    try {
      const u = new URL(fallbackRef);
      return u.origin + '/';
    } catch (_) {
      return fallbackRef;
    }
  }
  return 'https://megaplay.buzz/';
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
      const isLocalhost = url.includes('localhost:8081') || url.includes('127.0.0.1:8081') || url.includes('_capacitor_file_') || url.startsWith('file://');

      // Sanitize callback to strip obfuscated dummy PNG headers
      const sanitizeCallbacks = (cb) => ({
        ...cb,
        onSuccess: (response, stats, ctx, networkDetails) => {
          if (this._aborted) return;
          if (response && response.data) {
            response.data = stripObfuscatedHeader(response.data);
          }
          cb.onSuccess(response, stats, ctx, networkDetails);
        },
        onError: (error, ctx, networkDetails) => {
          if (this._aborted) return;
          cb.onError(error, ctx, networkDetails);
        }
      });

      // On desktop browser or local offline file playback, use standard browser XHR loader
      if (!isNativePlatform() || isLocalhost) {
        return super.load(context, config, sanitizeCallbacks(callbacks));
      }

      this._aborted = false;
      const t0 = performance.now();
      if (this.stats) {
        this.stats.loading.start = t0;
      }

      const isPlaylist = Boolean(
        !context.frag &&
        (
          context.type === 'manifest' ||
          context.type === 'level' ||
          context.type === 'audioTrack' ||
          context.type === 'subtitleTrack' ||
          context.responseType !== 'arraybuffer' ||
          url.includes('.m3u8')
        )
      );

      // Check In-Memory Master Playlist Cache for 0ms instant startup
      if (isPlaylist) {
        const cachedText = getCachedPlaylistText(url);
        if (cachedText) {
          const now = performance.now();
          const byteLen = cachedText.length;
          if (this.stats) {
            this.stats.loaded = byteLen;
            this.stats.total = byteLen;
            this.stats.bwEstimate = 50000000;
            this.stats.loading.start = t0;
            this.stats.loading.first = now;
            this.stats.loading.end = now;
            this.stats.aborted = false;
          }
          const stats = this.stats || {
            aborted: false,
            loaded: byteLen,
            retry: 0,
            total: byteLen,
            chunkCount: 0,
            bwEstimate: 50000000,
            loading: { start: t0, first: now, end: now },
            parsing: { start: now, end: now },
            buffering: { start: now, first: now, end: now },
          };
          queueMicrotask(() => {
            if (!this._aborted) {
              callbacks.onSuccess({ data: cachedText, url, code: 200 }, stats, context, null);
            }
          });
          return;
        }
      }

      // ON NATIVE ANDROID: ALWAYS route via CapacitorHttp!
      // Native WebView XHR sends 'Origin: https://localhost', triggering CDN 403 Forbidden.
      // CapacitorHttp uses Android OS network stack with zero browser origin restrictions.
      (async () => {
        try {
          const activeReferer = typeof refererUrl === 'function' ? refererUrl() : refererUrl;
          const activeEmbed = typeof embedUrl === 'function' ? embedUrl() : embedUrl;
          const fallbackRef = activeReferer || activeEmbed || '';
          const effectiveReferer = getProperReferer(url, fallbackRef);

          const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
            'Accept': isPlaylist ? 'application/vnd.apple.mpegurl, */*' : '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
          };

          if (effectiveReferer) {
            reqHeaders['Referer'] = effectiveReferer;
            try {
              reqHeaders['Origin'] = new URL(effectiveReferer).origin;
            } catch (_) {
              reqHeaders['Origin'] = effectiveReferer.replace(/\/$/, '');
            }
          }

          if (context.headers) {
            Object.assign(reqHeaders, context.headers);
          }
          if (context.rangeEnd) {
            reqHeaders['Range'] = `bytes=${context.rangeStart || 0}-${context.rangeEnd - 1}`;
          }

          if (isPlaylist && embedUrl && isNativePlatform()) {
            try {
              const targetHost = new URL(url).origin;
              const cookies = await CapacitorCookies.getCookies({ url: targetHost });
              if (cookies && Object.keys(cookies).length > 0) {
                reqHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
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

          if (!response.status || response.status < 200 || response.status >= 400) {
            const code = response.status || 0;
            callbacks.onError(
              { code, text: `HTTP ${code}` },
              context, response, this.stats
            );
            return;
          }

          const tFirst = performance.now();
          let data = response.data;

          if (!isPlaylist) {
            if (typeof data === 'string') {
              data = base64ToArrayBuffer(data);
            } else if (data instanceof Blob) {
              data = await data.arrayBuffer();
            }
            // Strip obfuscated image headers before passing to Hls.js
            data = stripObfuscatedHeader(data);
          } else if (typeof data !== 'string') {
            data = String(data || '');
          }

          const tEnd = performance.now();
          const byteLen = (data && (data.byteLength || data.length)) || 0;
          if (!isPlaylist && byteLen === 0) {
            console.warn('[CapacitorHlsLoader] 0-byte media segment decoded for:', url);
            callbacks.onError({ code: 0, text: 'Empty media segment' }, context, response, this.stats);
            return;
          }

          const elapsedSec = Math.max(0.001, (tEnd - t0) / 1000);
          const calculatedBw = Math.round((byteLen * 8) / elapsedSec);

          if (this.stats) {
            this.stats.loaded = byteLen;
            this.stats.total = byteLen;
            this.stats.bwEstimate = calculatedBw;
            this.stats.loading.start = t0;
            this.stats.loading.first = Math.max(t0 + 1, Math.min(tFirst, tEnd));
            this.stats.loading.end = tEnd;
            this.stats.aborted = false;
          }

          const stats = this.stats || {
            aborted: false,
            loaded: byteLen,
            retry: 0,
            total: byteLen,
            chunkCount: 0,
            bwEstimate: calculatedBw,
            loading: { start: t0, first: Math.max(t0 + 1, Math.min(tFirst, tEnd)), end: tEnd },
            parsing: { start: tEnd, end: tEnd },
            buffering: { start: tEnd, first: tEnd, end: tEnd },
          };

          callbacks.onSuccess({ data, url: response.url || url, code: response.status || 200 }, stats, context, response);
        } catch (err) {
          if (this._aborted) return;
          console.error('[CapacitorHlsLoader] Exception during load:', err);
          callbacks.onError({ code: 0, text: err.message || String(err) }, context, null, this.stats);
        }
      })();
    }
  };
}

const fmt = (s) => {
  if (isNaN(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
};
const formatTime = fmt;
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
  serverName = '',
  isHardSub = false,
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

  // Resume & Watch Progress Synchronization Refs
  const lastKnownTimeRef = useRef(0);
  const lastKnownDurRef = useRef(0);
  const resumeSeekAppliedRef = useRef(false);
  const targetResumeTimeRef = useRef(0);
  const onSeekProgressRef = useRef(onSeekProgress);
  useEffect(() => { onSeekProgressRef.current = onSeekProgress; }, [onSeekProgress]);
  const refererRef = useRef(referer);
  useEffect(() => { refererRef.current = referer; }, [referer]);
  const embedUrlRef = useRef(embedUrl);
  useEffect(() => { embedUrlRef.current = embedUrl; }, [embedUrl]);

  // Synchronous, multi-event progress flusher
  const flushProgress = useCallback((explicitTime = null) => {
    const v = videoRef.current;
    const ct = (explicitTime !== null && explicitTime !== undefined)
      ? explicitTime
      : (v && v.currentTime > 0 ? v.currentTime : lastKnownTimeRef.current);
    const dur = (v && v.duration > 0) ? v.duration : lastKnownDurRef.current;
    if (ct > 2 && onSeekProgressRef.current) {
      onSeekProgressRef.current(ct, dur);
    }
  }, []);

  /* state */
  const [playing,   setPlaying]   = useState(false);
  const [curTime,   setCurTime]   = useState(0);
  const [duration,  setDuration]  = useState(0);
  const [buffered,  setBuffered]  = useState(0);
  const [volume,    setVolume]    = useState(1);
  const [muted,     setMuted]     = useState(false);
  const [bright,    setBright]    = useState(1);
  const [fs,        setFs]        = useState(isLocal || startInFs);
  const [waiting,   setWaiting]   = useState(false);
  const [ctrlVis,   setCtrlVis]   = useState(true);
  const [qualities, setQualities] = useState([]);
  const [activeQ,   setActiveQ]   = useState(-1);
  const [playingResolution, setPlayingResolution] = useState('');
  // Persistent quality lock: survives server switches + episode changes
  // -1 = Auto (ABR), otherwise the height string e.g. '1080p'
  const lockedQualityRef = useRef(localStorage.getItem('aniplay_preferred_quality') || 'Auto');
  const [qualityLockLabel, setQualityLockLabel] = useState(lockedQualityRef.current);
  const [subs,      setSubs]      = useState(subtitles || []);
  const [activeSub, setActiveSub] = useState(-1);
  const [cues,      setCues]      = useState([]);
  const [embeddedCueText, setEmbeddedCueText] = useState('');
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
  const [fitToast,  setFitToast]  = useState(null);
  const fitToastTimerRef = useRef(null);
  const [needsTap,  setNeedsTap]  = useState(false);  // autoplay blocked
  const [hlsErr,    setHlsErr]    = useState(null);   // fatal stream error
  const [hasStarted, setHasStarted] = useState(false); // first play event occurred
  const [subToast,  setSubToast]  = useState(null);   // subtitle unavailable toast message
  const [autoplayCountdown, setAutoplayCountdown] = useState(null); // null or number (5..0)

  const [showSkipIntro,    setShowSkipIntro]    = useState(false);
  const [showSkipOutro,    setShowSkipOutro]    = useState(false);

  const isHardSubServer = !!isHardSub || 
                          (serverName || '').toLowerCase().includes('hardsub') || 
                          (serverName || '').toLowerCase().includes('hard');
  const selectedTrack = (Array.isArray(subs) && subs.find(s => s.id === activeSub)) || null;
  const isEnglishActive = selectedTrack ? (selectedTrack.label || '').toLowerCase().includes('eng') : true;
  const shouldSuppressOverlay = activeSub === -1 || (isHardSubServer && isEnglishActive);
  const [skipNotification, setSkipNotification] = useState('');

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

  const introSkippedRef = useRef(false);
  const outroSkippedRef = useRef(false);
  const currentSessionKey = `${title || 'anime'}_ep_${currentEpisode}`;
  const prevSessionRef = useRef(currentSessionKey);
  const initialSeekTimeRef = useRef(initialSeekTime);
  useEffect(() => { initialSeekTimeRef.current = initialSeekTime; }, [initialSeekTime]);
  useEffect(() => {
    return () => {
      if (fitToastTimerRef.current) clearTimeout(fitToastTimerRef.current);
    };
  }, []);

  const videoAdShownRef = useRef(false);
  const activeVideoAdRef = useRef(null);
  const [activeVideoAd, setActiveVideoAd] = useState(null);

  // Clean episode session boundary: flush previous episode and isolate in-memory tracking
  useEffect(() => {
    if (prevSessionRef.current !== currentSessionKey) {
      prevSessionRef.current = currentSessionKey;
      lastKnownTimeRef.current = 0;
      lastKnownDurRef.current = 0;
      targetResumeTimeRef.current = initialSeekTimeRef.current > 2 ? initialSeekTimeRef.current : 0;
      resumeSeekAppliedRef.current = false;
      const v = videoRef.current;
      if (v) {
        try { v.currentTime = 0; } catch (_) {}
      }
      setCurTime(0);
      videoAdShownRef.current = false;
      activeVideoAdRef.current = null;
      setActiveVideoAd(null);
    }
    return () => {
      // Flushes progress of current episode when switching away to another episode or unmounting
      flushProgress();
    };
  }, [currentSessionKey, flushProgress]);

  // When initialSeekTime updates (e.g. from server switch seek position), synchronize target
  useEffect(() => {
    if (initialSeekTime > 2) {
      targetResumeTimeRef.current = Math.max(targetResumeTimeRef.current || 0, initialSeekTime);
      lastKnownTimeRef.current = targetResumeTimeRef.current;
      resumeSeekAppliedRef.current = false;
      const v = videoRef.current;
      if (v && v.readyState >= 1 && v.duration > 0 && Math.abs(v.currentTime - targetResumeTimeRef.current) > 2) {
        try {
          v.currentTime = targetResumeTimeRef.current;
          resumeSeekAppliedRef.current = true;
          log(`[Resume] Applied seek from initialSeekTime effect: ${targetResumeTimeRef.current.toFixed(1)}s`);
        } catch (_) {}
      }
    }
  }, [initialSeekTime, log]);

  // When switching servers, loading is true. Clear any stale hlsErr from a previous server so error doesn't persist.
  // Note: We do NOT pause v here because background server discovery in useAnimeStream passes loading=true,
  // which would repeatedly pause an already mounted and playable stream!
  // When loading finishes, automatically resume playback if needed.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (loading) {
      // Always wipe stale error overlay when a new server/URL is loading
      setHlsErr(null);
    } else if (!loading && !activeVideoAdRef.current) {
      if (v.paused && !needsTap) {
        v.play().then(() => setNeedsTap(false)).catch(err => {
          if (err.name === 'NotAllowedError') {
            v.muted = true;
            v.play().catch(() => {});
          }
        });
      }
    }
  }, [loading, needsTap]);

  const handleVideoAdComplete = useCallback(() => {
    log('Video ad finished or skipped, resuming anime playback...');
    activeVideoAdRef.current = null;
    setActiveVideoAd(null);
    const v = videoRef.current;
    if (v) {
      v.play().then(() => setNeedsTap(false)).catch(e => console.log('Resume after ad failed:', e));
    }
  }, [log]);

  // Playback speed
  const [speed, setSpeed] = useState(1);
  // showSpeed is derived from activePanel above (showSpeed_inner)
  const showSpeed = showSpeed_inner;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];


  /* ── HLS ──────────────────────────────────────────────────── */
  const lastLoadedEpisodeRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return;

    log(`Initializing stream: ${url.slice(0, 100)}...`);

    // Check if this stream is loading for the SAME episode or a NEW episode:
    const isSameEpisode = (lastLoadedEpisodeRef.current === currentEpisode);
    lastLoadedEpisodeRef.current = currentEpisode;

    // Only inherit mid-stream playback position if switching servers/tracks WITHIN the same episode!
    // When changing to a different episode, delete old episode's memory and strictly start from initialSeekTime (or 0)
    let resumeTarget = 0;
    if (isSameEpisode) {
      const currentVideoTime = (v.currentTime > 2)
        ? v.currentTime
        : (lastKnownTimeRef.current > 2 ? lastKnownTimeRef.current : 0);
      resumeTarget = currentVideoTime > 2 ? currentVideoTime : (initialSeekTimeRef.current > 2 ? initialSeekTimeRef.current : 0);
    } else {
      // NEW episode: purge in-memory track, reset video element, load only new episode's initialSeekTime
      lastKnownTimeRef.current = 0;
      lastKnownDurRef.current = 0;
      resumeTarget = (initialSeekTimeRef.current > 2) ? initialSeekTimeRef.current : 0;
      try { v.currentTime = 0; } catch (_) {}
    }

    targetResumeTimeRef.current = resumeTarget;
    lastKnownTimeRef.current = resumeTarget > 2 ? resumeTarget : 0;
    resumeSeekAppliedRef.current = false;

    // Reset stream state on URL change (Do NOT reset videoAdShownRef or activeVideoAd here!
    // Server resolution and quality switches fire URL changes during playback)
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
    setPlayingResolution('');
    setSubs(subtitles || []);
    // If subtitles are already provided (e.g. offline download), auto-select the first one immediately
    // so cues load without waiting for the subTracksJson effect (which only fires on subtitle prop change).
    // For streaming, -1 is correct — the subtitle sync effect will auto-select after tracks are loaded.
    setActiveSub((subtitles && subtitles.length > 0) ? (subtitles[0].id ?? 0) : -1);
    setActivePanel(null); // close all menus when URL/server changes
    setStuckCount(0);

    v.removeAttribute('src');
    v.load();

    const tryPlay = () => {
      // Check if an in-stream video ad should play before starting episode
      if (!videoAdShownRef.current && !isLocal && adEngine.isAdsEnabled() && adEngine.shouldShowVideoAd()) {
        videoAdShownRef.current = true;
        const videoAd = adEngine.getRandomVideoAd();
        if (videoAd) {
          log('Triggering in-stream video ad before playback...');
          adEngine.markVideoAdShown();
          activeVideoAdRef.current = videoAd;
          setActiveVideoAd(videoAd);
          v.pause();
          return;
        }
      }

      // If an in-stream video ad is currently active, keep main video paused!
      if (activeVideoAdRef.current) {
        log('Video ad is currently active, keeping main video paused...');
        v.pause();
        return;
      }

      log('Calling video.play()...');
      v.play().then(() => {
        log('video.play() SUCCEEDED');
        setNeedsTap(false);
        // Only seek here if video element is ready (readyState >= 1 and duration > 0)
        // If readyState is 0, do NOT mark resumeSeekAppliedRef as true! Let loadedmetadata/canplay/timeupdate seek!
        if (targetResumeTimeRef.current > 2 && !resumeSeekAppliedRef.current && v.readyState >= 1 && v.duration > 0) {
          log(`Resuming from target position in play(): ${targetResumeTimeRef.current.toFixed(1)}s`);
          try {
            v.currentTime = targetResumeTimeRef.current;
            resumeSeekAppliedRef.current = true;
          } catch (_) {}
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
    let onPlayable = null;
    let onVideoErr = null;

    // ── DIRECT VIDEO FILE MODE: bypass HLS.js, use native video element directly ──
    // Direct MP4 / WebM / local files work natively with hardware acceleration.
    // HLS.js only loads .m3u8 manifests and fails if given an MP4 stream.
    const isDirectVideoFile = (
      url.includes('.mp4') ||
      url.includes('.webm') ||
      url.includes('_capacitor_file_') ||
      url.startsWith('file://') ||
      url.startsWith('blob:') ||
      (!url.includes('.m3u8') && !url.includes('/api/iframe-proxy') && !url.includes('proxy/iframe'))
    );
    if (isDirectVideoFile) {
      log('Direct video file mode: setting src directly on native video element');
      v.src = url;
      setQualities([{ id: 0, label: '720p' }]);
      setPlayingResolution('720p');
      setActiveQ(0);
      setWaiting(false);
      v.load();
      if (targetResumeTimeRef.current > 2) {
        try {
          v.currentTime = targetResumeTimeRef.current;
          resumeSeekAppliedRef.current = true;
        } catch (_) {}
      }
      tryPlay();
      const onDirectPlayable = () => {
        setWaiting(false);
        tryPlay();
      };
      v.addEventListener('loadeddata', onDirectPlayable);
      v.addEventListener('canplay', onDirectPlayable);
      return () => {
        v.removeEventListener('loadeddata', onDirectPlayable);
        v.removeEventListener('canplay', onDirectPlayable);
        flushProgress();
        v.removeAttribute('src');
        v.load();
      };
    }

    if (Hls.isSupported()) {
      const netProfile = getNetworkProfile();
      log(`Hls.js is supported. NetworkProfile: type=${netProfile.effectiveType}, downlink=${netProfile.downlink?.toFixed?.(2)}Mbps, rtt=${netProfile.rtt}ms, isSlow=${netProfile.isSlow}`);
      hls = new Hls({
        enableWorker: true,
        startFragPrefetch: false, // ⚡ Netflix Fast-Start: allocate 100% bandwidth to Fragment 0 for instant frame render
        testBandwidth: false,
        capLevelToPlayerSize: true,
        lowLatencyMode: false, // Must be false for VOD to prevent video decoder starvation while audio plays
        progressive: false,    // Must be false on mobile WebViews to avoid partial TS chunk corruptions
        startPosition: (targetResumeTimeRef.current > 2 || initialSeekTimeRef.current > 2) ? Math.max(targetResumeTimeRef.current || 0, initialSeekTimeRef.current || 0) : -1,
        startLevel: -1,
        abrEwmaDefaultEstimate: 1200000,
        abrBandWidthFactor: netProfile.isSlow ? 0.7 : 0.85,
        abrBandWidthUpFactor: netProfile.isSlow ? 0.5 : 0.7,
        maxBufferLength: netProfile.isSlow ? 20 : 35, // Solid golden buffer prevents A/V desync
        maxMaxBufferLength: netProfile.isSlow ? 40 : 70,
        maxBufferSize: netProfile.isSlow ? 40 * 1000 * 1000 : 80 * 1000 * 1000,
        backBufferLength: 25,
        maxBufferHole: 0.5,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1200,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1200,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1200,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetries: 10,
        maxStarvationDelay: 4,
        maxLoadingDelay: 4,
        autoStartLoad: true,
        loader: isNativePlatform() ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, () => refererRef.current, () => embedUrlRef.current) : Hls.DefaultConfig.loader,
        pLoader: isNativePlatform() ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, () => refererRef.current, () => embedUrlRef.current) : Hls.DefaultConfig.loader,
        fLoader: isNativePlatform() ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, () => refererRef.current, () => embedUrlRef.current) : Hls.DefaultConfig.loader,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.BUFFER_STALLED, () => {
        log('[HLS] Buffer stalled event received — nudging playback to resume video...');
        try {
          if (v && !v.paused) {
            v.currentTime = v.currentTime + 0.05;
          }
        } catch (_) {}
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        log(`HLS Error: type=${data.type}, details=${data.details}, fatal=${data.fatal}`);
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkErrRetries < 5) {
          // Retry network errors up to 5 times with backoff before giving up
          networkErrRetries++;
          log(`Fatal network error (retry ${networkErrRetries}/5), calling startLoad in ${networkErrRetries * 800}ms...`);
          setTimeout(() => {
            if (hlsRef.current) hls.startLoad();
          }, networkErrRetries * 800);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrRetries < 3) {
          mediaErrRetries++;
          log(`Fatal media error, retrying recoverMediaError (${mediaErrRetries}/3)...`);
          hls.recoverMediaError();
        } else {
          log(`Fatal HLS error unrecoverable (${data.details}). Displaying error overlay.`);
          // Pause the video so audio does NOT continue playing under the error overlay
          const v = videoRef.current;
          if (v && !v.paused) {
            try { v.pause(); } catch (_) {}
          }
          // Pass error type key so JSX can show the right contextual message
          const errKey = data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network'
            : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media'
            : 'unknown';
          setHlsErr({
            type: errKey,
            details: data.details || '',
            error: data.error?.message || data.reason || '',
          });
          setWaiting(false);
        }
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        const sourceUrl = getEffectivePlayableUrl(url, refererRef.current);
        log('Media attached to Hls.js, loading source: ' + sourceUrl.slice(0, 80));
        hls.loadSource(sourceUrl);
      });

      let cleanPlayStarted = false;
      const startCleanPlayback = () => {
        if (cleanPlayStarted) return;
        cleanPlayStarted = true;
        setWaiting(false);
        if (activeVideoAdRef.current) {
          log('Stream ready in background, but ad is active. Keeping anime video paused.');
          v.pause();
          return;
        }
        tryPlay();
      };

      hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
        try {
          log(`Manifest parsed: found ${d.levels.length} quality levels`);
          if (d.levels?.length) {
            const parsedQualities = d.levels.map((l, i) => ({
              id: i,
              label: l.height ? `${l.height}p` : `Level ${i + 1}`
            }));
            setQualities(parsedQualities);

            const activeNet = getNetworkProfile();
            const savedQuality = lockedQualityRef.current;
            const isQualityLocked = savedQuality && savedQuality !== 'Auto';

            if (d.levels.length > 1) {
              const ramCachedIdx = d.levels.findIndex(l => l.url && getCachedPlaylistText(l.url));

              if (isQualityLocked) {
                // User has a locked quality preference — apply it immediately
                const preferredHeight = parseInt(savedQuality, 10);
                let lockedIdx = d.levels.findIndex(l => l.height === preferredHeight);
                if (lockedIdx === -1) {
                  const lower = d.levels.filter(l => l.height && l.height <= preferredHeight).sort((a, b) => b.height - a.height);
                  lockedIdx = lower.length > 0 ? d.levels.indexOf(lower[0]) : 0;
                }
                if (lockedIdx !== -1) {
                  hls.startLevel = lockedIdx;
                  hls.currentLevel = lockedIdx;
                  const lvl = d.levels[lockedIdx];
                  const lockedLabel = lvl?.height ? `${lvl.height}p` : `Level ${lockedIdx + 1}`;
                  setPlayingResolution(lockedLabel);
                  setActiveQ(lockedIdx);
                  log(`[QualityLock] Locked to user preference ${savedQuality} → level ${lockedIdx} (${lockedLabel})`);
                }
              } else if (ramCachedIdx !== -1) {
                hls.startLevel = ramCachedIdx;
                const lvl = d.levels[ramCachedIdx];
                const ramLabel = lvl?.height ? `${lvl.height}p` : `Level ${ramCachedIdx + 1}`;
                setPlayingResolution(ramLabel);
                log(`[PinpointRAM] Instant 0ms start: locked to pre-warmed RAM level ${ramLabel} (level ${ramCachedIdx})`);
              } else if (activeNet.isSlow) {
                const lowest = findLowestQualityLevel(d.levels);
                const lowestLabel = lowest.level?.height ? `${lowest.level.height}p` : `Level ${lowest.index + 1}`;
                log(`[NetworkSpeed] Slow network detected (${activeNet.effectiveType}). Selecting lowest resolution ${lowestLabel} for instant zero-buffer start.`);
                hls.startLevel = lowest.index;
                setPlayingResolution(lowestLabel);
              } else {
                const fastIdx = d.levels.findIndex(l => l.height && l.height <= 480 && l.height >= 360) !== -1
                  ? d.levels.findIndex(l => l.height && l.height <= 480 && l.height >= 360)
                  : d.levels.findIndex(l => l.height && l.height <= 720);
                const targetIdx = fastIdx !== -1 ? fastIdx : 0;
                hls.startLevel = targetIdx;
                const lvl = d.levels[targetIdx];
                const fastLabel = lvl?.height ? `${lvl.height}p` : `Level ${targetIdx + 1}`;
                setPlayingResolution(fastLabel);
                log(`[FastStart] Selected lightweight ${fastLabel} for sub-300ms initial frame render.`);
              }
            }
          }
          startCleanPlayback();
        } catch (e) {
          log(`Error in MANIFEST_PARSED handler: ${e.message}`);
        }
      });

      // Continuous EWMA network speed calibration from loaded video fragments
      hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
        try {
          if (data?.stats?.total && data?.stats?.loading?.end && data?.stats?.loading?.start) {
            const durMs = data.stats.loading.end - data.stats.loading.start;
            recordNetworkSample(data.stats.total, durMs);
          }
        } catch (_) {}
      });

      // Synchronize active playing resolution badge when HLS ABR switches levels
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        try {
          if (hls.levels && hls.levels[data.level]) {
            const lvl = hls.levels[data.level];
            const resLabel = lvl.height ? `${lvl.height}p` : `Level ${data.level + 1}`;
            log(`[HLS] Level switched to ${resLabel} (${Math.round((lvl.bitrate || 0) / 1000)} kbps)`);
            setPlayingResolution(resLabel);
          }
        } catch (_) {}
      });

      // Smooth fast start: trigger play as soon as initial frames are decoded
      hls.on(Hls.Events.BUFFER_APPENDED, () => {
        try {
          // Re-enable fragment prefetching once playback buffer is active
          if (hls && hls.config) {
            hls.config.startFragPrefetch = true;
          }
          if (!cleanPlayStarted) {
            startCleanPlayback();
          }
          if (!resumeSeekAppliedRef.current && v.duration > 0) {
            const target = Math.max(targetResumeTimeRef.current > 2 ? targetResumeTimeRef.current : 0, initialSeekTime > 2 ? initialSeekTime : 0);
            if (target > 2 && target < v.duration - 5 && Math.abs(v.currentTime - target) > 2) {
              log(`[Resume] BUFFER_APPENDED seek: jumping to ${target.toFixed(1)}s`);
              try {
                v.currentTime = target;
                resumeSeekAppliedRef.current = true;
              } catch (_) {}
            } else if (target > 2 && Math.abs(v.currentTime - target) <= 2) {
              resumeSeekAppliedRef.current = true;
            }
          }
        } catch (e) {
          log(`Error in BUFFER_APPENDED handler: ${e.message}`);
        }
      });
      hls.on(Hls.Events.FRAG_PARSED, () => {
        if (!cleanPlayStarted) {
          startCleanPlayback();
        }
      });

      onPlayable = () => startCleanPlayback();
      onVideoErr = () => {
        log('HTML5 video element error event fired:', v.error?.code, v.error?.message);
      };
      v.addEventListener('loadeddata', onPlayable, { once: true });
      v.addEventListener('canplay', onPlayable, { once: true });
      v.addEventListener('playing', onPlayable);
      v.addEventListener('error', onVideoErr);

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

      const unsubNet = subscribeNetworkChanges((newNet) => {
        if (!hlsRef.current) return;
        if (newNet.isSlow) {
          log(`[NetworkSpeed] Dynamic network change: degraded to ${newNet.effectiveType}. Lowering buffer target.`);
          hlsRef.current.config.maxBufferLength = 15;
          hlsRef.current.config.abrBandWidthUpFactor = 0.5;
          if (newNet.isCriticalSlow && hlsRef.current.autoLevelEnabled && hlsRef.current.levels?.length > 1) {
            const lowest = findLowestQualityLevel(hlsRef.current.levels);
            if (lowest.index >= 0) {
              hlsRef.current.nextLevel = lowest.index;
            }
          }
        } else {
          hlsRef.current.config.maxBufferLength = 30;
          hlsRef.current.config.abrBandWidthUpFactor = 0.7;
        }
      });

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
      if (typeof unsubNet === 'function') {
        try { unsubNet(); } catch (_) {}
      }
      flushProgress();
      if (onPlayable) {
        v.removeEventListener('loadeddata', onPlayable);
        v.removeEventListener('canplay', onPlayable);
        v.removeEventListener('playing', onPlayable);
      }
      if (onVideoErr) {
        v.removeEventListener('error', onVideoErr);
      }
      if (hls) {
        try {
          hls.destroy();
        } catch (_) {}
      }
      hlsRef.current = null;
    };
  }, [url, serverName]);


  // Sync subtitle tracks when props change — merge server-specific + global source tracks
  const subTracksJson = JSON.stringify(subtitles);
  const extraTracksJson = JSON.stringify(extraSubtitles);
  useEffect(() => {
    const guessLangFromFile = (file) => {
      if (!file) return '';
      const f = file.toLowerCase();
      if (f.includes('/ar.') || f.includes('_ara') || f.includes('arabic')) return 'Arabic';
      if (f.includes('/es.') || f.includes('_spa') || f.includes('spanish')) return 'Spanish';
      if (f.includes('/fr.') || f.includes('_fre') || f.includes('french')) return 'French';
      if (f.includes('/de.') || f.includes('_ger') || f.includes('german')) return 'German';
      if (f.includes('/it.') || f.includes('_ita') || f.includes('italian')) return 'Italian';
      if (f.includes('/pt.') || f.includes('_por') || f.includes('portuguese')) return 'Portuguese';
      if (f.includes('/ru.') || f.includes('_rus') || f.includes('russian')) return 'Russian';
      if (f.includes('/ja.') || f.includes('_jpn') || f.includes('japanese')) return 'Japanese';
      if (f.includes('/en.') || f.includes('_eng') || f.includes('english')) return 'English';
      return '';
    };

    const isForcedTrack = (label, file) => {
      const raw = (label || '').toLowerCase();
      const f = (file || '').toLowerCase();
      return /forced/i.test(raw) || /forced[\._\-]/i.test(f);
    };

    const isSignsTrack = (label, file) => {
      const raw = (label || '').toLowerCase();
      const f = (file || '').toLowerCase();
      return /sign|song|s&s|dubtitle/i.test(raw) || /signs?[\._\-]/i.test(f);
    };

    const cleanLabel = (lbl, file) => {
      if (!lbl) return guessLangFromFile(file) || 'Unknown';
      if (isSignsTrack(lbl, file)) return 'English (Signs & Songs)';
      if (isForcedTrack(lbl, file)) return 'English (Forced)';
      let clean = lbl.replace(/\s*[-–—]?\s*\([^)]*\)/g, '').trim();
      return clean || lbl;
    };

    // Normalize language label for dedup: "eng", "English", "English)" → "English"
    const normalizeLanguage = (label, file) => {
      const raw = (label || '').toLowerCase();
      const f = (file || '').toLowerCase();
      if (isSignsTrack(raw, f)) return 'English (Signs & Songs)';
      if (isForcedTrack(raw, f)) return 'English (Forced)';
      const l = raw.replace(/[^a-z]/g, '');
      if (l.startsWith('eng')) return 'English';
      if (l.startsWith('jpn') || l.startsWith('jap')) return 'Japanese';
      if (l.startsWith('spa') || l.startsWith('esp')) return 'Spanish';
      if (l.startsWith('fre') || l.startsWith('fra')) return 'French';
      if (l.startsWith('ger') || l.startsWith('deu')) return 'German';
      if (l.startsWith('por')) return 'Portuguese';
      if (l.startsWith('ita')) return 'Italian';
      if (l.startsWith('ara')) return 'Arabic';
      if (l.startsWith('hin')) return 'Hindi';
      if (l.startsWith('kor')) return 'Korean';
      if (l.startsWith('chi') || l.startsWith('zho')) return 'Chinese';
      if (l.startsWith('rus')) return 'Russian';
      const guessed = guessLangFromFile(file);
      if (guessed) return guessed;
      return label || 'Unknown';
    };

    const serverSubs = (Array.isArray(subtitles) ? subtitles : []).map((s, idx) => ({
      id: s.id !== undefined ? s.id : idx,
      label: cleanLabel(s.label || s.lang, s.file || s.url) || `Track ${idx + 1}`,
      file: s.file || s.url || '',
      content: s.content || null,
      kind: s.kind || 'captions',
      default: s.default || false,
      referer: s.referer || referer || '',
      alternatives: Array.isArray(s.alternatives) ? [...s.alternatives] : [],
    }));
    const globalExtras = (Array.isArray(extraSubtitles) ? extraSubtitles : []).map((s, idx) => ({
      id: s.id !== undefined ? s.id : idx + 100,
      label: cleanLabel(s.label || s.lang, s.file || s.url) || `Track ${idx + 1}`,
      file: s.file || s.url || '',
      content: s.content || null,
      kind: s.kind || 'captions',
      default: s.default || false,
      referer: s.referer || referer || '',
      alternatives: Array.isArray(s.alternatives) ? [...s.alternatives] : [],
    }));

    // ── Deduplicate by normalized language — keep primary + group same-language alternatives ──
    const byLanguage = new Map();
    const isDubAudio = serverName && (serverName.toLowerCase().includes('dub') || serverName.toLowerCase().includes('(dub)'));
    // If playing DUB audio, prioritize globalExtras (subbed dialogue tracks) so they become the canonical primary English track
    const allTracks = isDubAudio ? [...globalExtras, ...serverSubs] : [...serverSubs, ...globalExtras];

    for (const track of allTracks) {
      if (!track.file && !track.content) continue;
      const langKey = normalizeLanguage(track.label, track.file);
      if (langKey === 'Unknown' && !track.label) continue;

      if (!byLanguage.has(langKey)) {
        track.label = langKey;
        const initialAlts = Array.isArray(track.alternatives) ? [...track.alternatives] : [];
        track.alternatives = initialAlts;
        byLanguage.set(langKey, track);
      } else {
        const primary = byLanguage.get(langKey);
        // If current primary has a forced/signs filename or label and this candidate is clean full English, SWAP THEM!
        const primaryIsForced = isForcedTrack(primary.label, primary.file) || isSignsTrack(primary.label, primary.file);
        const candidateIsClean = !isForcedTrack(track.label, track.file) && !isSignsTrack(track.label, track.file);
        if (primaryIsForced && candidateIsClean) {
          const oldAlts = primary.alternatives || [];
          primary.alternatives = [];
          track.alternatives = [primary, ...oldAlts];
          track.label = langKey;
          byLanguage.set(langKey, track);
        } else {
          // Add as backup candidate for the same language
          if (track.file && track.file !== primary.file && !primary.alternatives.some(a => a.file === track.file)) {
            primary.alternatives.push({
              file: track.file,
              content: track.content,
              referer: track.referer,
              label: langKey,
            });
          }
          if (Array.isArray(track.alternatives)) {
            for (const alt of track.alternatives) {
              if (alt.file && alt.file !== primary.file && !primary.alternatives.some(a => a.file === alt.file)) {
                primary.alternatives.push(alt);
              }
            }
          }
        }
      }
    }

    // On HardSub servers: ensure an "English" entry exists in the menu!
    // The video stream has burned-in English subtitles, so selecting English is valid and default.
    if (isHardSubServer && !byLanguage.has('English')) {
      byLanguage.set('English', {
        id: 9999,
        label: 'English',
        file: '',
        content: null,
        kind: 'captions',
        default: true,
        referer: '',
        alternatives: []
      });
    }

    const merged = Array.from(byLanguage.values());

    // Sort: English (Dialogue) first, then English (Signs & Songs), then English (Forced), then other languages alphabetically
    merged.sort((a, b) => {
      const aRaw = a.label.toLowerCase();
      const bRaw = b.label.toLowerCase();
      const aIsFullEng = aRaw === 'english';
      const bIsFullEng = bRaw === 'english';
      if (aIsFullEng && !bIsFullEng) return -1;
      if (!aIsFullEng && bIsFullEng) return 1;
      const aIsSigns = aRaw.includes('sign') || aRaw.includes('song');
      const bIsSigns = bRaw.includes('sign') || bRaw.includes('song');
      if (aIsSigns && !bIsSigns) return -1;
      if (!aIsSigns && bIsSigns) return 1;
      const aIsForced = aRaw.includes('forced');
      const bIsForced = bRaw.includes('forced');
      if (aIsForced && !bIsForced) return -1;
      if (!aIsForced && bIsForced) return 1;
      return a.label.localeCompare(b.label);
    });

    setSubs(merged);

    // Auto-select English or default track if available (guarantee 100% full dialogue English!)
    if (merged.length > 0) {
      const fullEngTrack = merged.find(t => t.label === 'English');
      const anyNonForcedEng = merged.find(t => t.label.toLowerCase().includes('eng') && !t.label.toLowerCase().includes('forced') && !t.label.toLowerCase().includes('sign'));
      const defaultTrack = fullEngTrack ||
                           anyNonForcedEng ||
                           merged.find(t => t.default && !t.label.toLowerCase().includes('forced') && !t.label.toLowerCase().includes('sign')) ||
                           merged.find(t => t.label.toLowerCase().includes('eng')) ||
                           merged.find(t => t.default) ||
                           merged[0];
      setActiveSub(defaultTrack.id !== undefined ? defaultTrack.id : 0);
    } else {
      setActiveSub(-1);
    }
  }, [subTracksJson, extraTracksJson, isHardSubServer, serverName, referer]);

  const userManualQualityChangedRef = useRef(false);
  useEffect(() => {
    if (!userManualQualityChangedRef.current) return;
    const h = hlsRef.current;
    if (!h) return;

    if (activeQ >= 0 && qualities[activeQ]?.label) {
      h.currentLevel = activeQ;
      const label = qualities[activeQ].label;
      setPlayingResolution(label);
      lockedQualityRef.current = label;
      setQualityLockLabel(label);
      try { localStorage.setItem('aniplay_preferred_quality', label); } catch (_) {}
      log(`[QualityLock] User locked quality to ${label} → level ${activeQ}`);
    } else if (activeQ === -1) {
      if (h.currentLevel !== -1) {
        h.currentLevel = -1;
      }
      lockedQualityRef.current = 'Auto';
      setQualityLockLabel('Auto');
      try { localStorage.setItem('aniplay_preferred_quality', 'Auto'); } catch (_) {}
      log('[QualityLock] Reverted to Auto quality');
    }
  }, [activeQ]);
  
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
    // Locate track by id first (most reliable), then by index as a fallback
    const currentSubTrack = subs.find(s => s.id === activeSub) ??
                            (activeSub >= 0 && activeSub < subs.length ? subs[activeSub] : null);

    if (activeSub === -1 || !currentSubTrack) {
      setCues([]);
      return;
    }

    const targetLang = currentSubTrack.label || 'English';
    const isTargetEnglish = targetLang.toLowerCase().includes('eng');

    // On HardSub servers: English subtitles are physically burned into the video stream.
    // Suppress external subtitle loading and clear overlay cues so no conflicting/wrong cues render.
    if (isHardSubServer && isTargetEnglish) {
      log('[Subtitle] HardSub server: English subtitles are burned into the video stream. Suppressing overlay cues.');
      setCues([]);
      return;
    }

    if (!currentSubTrack.file && !currentSubTrack.content) {
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
        if (isNativePlatform()) {
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
      else if (isNativePlatform() && !url.includes('_capacitor_file_') && !url.startsWith('file://')) {
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

      if (isNativePlatform() && targetUrl.startsWith('http') && !targetUrl.includes('localhost')) {
        // Build referer candidate list with root origins + trailing slash (Cloudflare CDN requirement)
        const refererCandidates = [];
        if (targetReferer) {
          try {
            const origin = new URL(targetReferer).origin;
            refererCandidates.push(`${origin}/`);
          } catch {}
        }
        if (embedUrl) {
          try {
            const origin = new URL(embedUrl).origin;
            refererCandidates.push(`${origin}/`);
          } catch {}
        }
        if (targetUrl.includes('kryntal.top') || targetUrl.includes('megaplay') || targetUrl.includes('megacloud') || targetUrl.includes('hiddenvertex') || targetUrl.includes('vertex') || targetUrl.includes('norami') || targetUrl.includes('tiktokcdn')) {
          refererCandidates.push('https://megaplay.buzz/');
        }
        if (targetUrl.includes('vidtube') || targetUrl.includes('vidplay')) {
          refererCandidates.push('https://vidtube.site/');
        }
        if (targetUrl.includes('echovideo') || targetUrl.includes('roburnt') || targetUrl.includes('dpopdrop') || targetUrl.includes('savedly')) {
          refererCandidates.push('https://play.echovideo.ru/');
        }
        if (targetUrl.includes('otakuhg') || targetUrl.includes('premilkyway') || targetUrl.includes('cdn-centaurus') || targetUrl.includes('streamhg')) {
          refererCandidates.push('https://otakuhg.site/');
        }
        if (targetUrl.includes('otakuvid') || targetUrl.includes('dramiyos') || targetUrl.includes('acek-cdn') || targetUrl.includes('earnvids')) {
          refererCandidates.push('https://otakuvid.online/');
        }
        if (targetUrl.includes('bibiemb') || targetUrl.includes('vibevibe')) {
          refererCandidates.push('https://bibiemb.xyz/');
        }
        if (targetUrl.includes('vivibebe')) {
          refererCandidates.push('https://vivibebe.site/');
        }
        if (targetUrl.includes('anineko')) {
          refererCandidates.push('https://anineko.es/');
        }
        if (targetUrl.includes('silverorbit') || targetUrl.includes('nexabloom') || targetUrl.includes('streamzone')) {
          refererCandidates.push('https://megaplay.buzz/');
        }
        if (targetUrl.includes('hstream') || targetUrl.includes('ane-h.xyz') || targetUrl.includes('imoto-str')) {
          refererCandidates.push('https://hstream.moe/');
        }
        if (targetUrl.includes('hentaicity')) {
          refererCandidates.push('https://www.hentaicity.com/');
        }
        try {
          const urlOrigin = new URL(targetUrl).origin;
          refererCandidates.push(`${urlOrigin}/`);
        } catch {}

        const uniqueReferers = [...new Set(refererCandidates.filter(Boolean))];
        let lastErr = null;

        for (const ref of uniqueReferers) {
          try {
            const refOrigin = new URL(ref).origin;
            const reqHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Origin': refOrigin,
              'Referer': ref, // Must have trailing slash!
            };

            const response = await CapacitorHttp.request({
              url: targetUrl,
              method: 'GET',
              headers: reqHeaders,
              responseType: 'text',
            });

            if (response.status === 200 && response.data) {
              const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
              if (text && (text.includes('WEBVTT') || text.includes('-->') || text.length > 20)) {
                log(`[AniPlayer] Subtitle loaded via CapacitorHttp (${text.length} chars, referer: ${ref})`);
                return text;
              }
            }
          } catch (e) {
            lastErr = e;
            console.warn(`[AniPlayer] CapacitorHttp subtitle attempt with referer ${ref} failed:`, e.message);
          }
        }
        if (lastErr) throw lastErr;
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

      // Parse WebVTT / SRT format (robust against single/double line breaks, cue IDs, and cue settings)
      if (text.includes('WEBVTT') || text.includes('-->')) {
        const parsed = [];
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        let i = 0;
        const parseTime = (t) => {
          if (!t) return NaN;
          const cleanT = t.trim().split(/\s+/)[0].replace(',', '.');
          const parts = cleanT.split(':');
          let secs = 0;
          if (parts.length === 3) secs = +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
          else if (parts.length === 2) secs = +parts[0] * 60 + parseFloat(parts[1]);
          return secs;
        };

        while (i < lines.length) {
          const line = lines[i];
          if (line.includes('-->')) {
            const tsParts = line.split('-->');
            if (tsParts.length >= 2) {
              const startTime = parseTime(tsParts[0]);
              const endTime = parseTime(tsParts[1]);
              const subLines = [];
              i++;
              while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
                // If next line is a single cue number right before a timestamp, break
                if (i + 1 < lines.length && lines[i + 1].includes('-->') && /^\d+$/.test(lines[i].trim())) {
                  break;
                }
                subLines.push(lines[i]);
                i++;
              }
              const rawSubText = subLines.join('\n').trim();
              const cleanSubText = rawSubText.replace(/<[^>]+>/g, '').trim();
              if (cleanSubText && isFinite(startTime) && isFinite(endTime)) {
                parsed.push({ startTime, endTime, text: cleanSubText });
              }
              continue;
            }
          }
          i++;
        }
        log(`Loaded ${parsed.length} subtitle cues (WebVTT/SRT format)`);
        return parsed;
      }

      log('Unknown subtitle format — could not parse');
      return [];
    };

    // ── Main: try primary track, then retry ONLY with fallbacks for the SAME LANGUAGE ──
    (async () => {
      // 1. Try primary track
      let primaryCues = [];
      try {
        const text = await loadSubtitleFromTrack(currentSubTrack);
        primaryCues = parseSubtitleText(text);
      } catch (err) {
        log(`[Subtitle] Primary track for "${targetLang}" failed: ${err.message}, trying same-language fallbacks...`);
      }

      // If the selected track is English dialogue, but returned very few cues (< 30)
      // (indicating it might be a partial/sign track) and alternatives exist,
      // probe same-language alternatives to find the full dialogue track!
      let bestCues = primaryCues;
      const isEnglish = targetLang.toLowerCase() === 'english';
      const sameLangAlternatives = currentSubTrack.alternatives || [];

      if ((bestCues.length === 0 || (isEnglish && bestCues.length < 30)) && sameLangAlternatives.length > 0) {
        log(`[Subtitle] Track for "${targetLang}" had ${bestCues.length} cues — checking ${sameLangAlternatives.length} alternative(s)...`);
        for (const altTrack of sameLangAlternatives) {
          if (!altTrack.file && !altTrack.content) continue;
          try {
            const altText = await loadSubtitleFromTrack(altTrack);
            const altCues = parseSubtitleText(altText);
            if (altCues.length > bestCues.length) {
              bestCues = altCues;
              log(`[Subtitle] Alternative track had ${altCues.length} cues (better match)!`);
              if (altCues.length >= 50) break; // Found full dialogue
            }
          } catch (_) {}
        }
      }

      if (bestCues.length > 0) {
        log(`[Subtitle] Subtitle loaded for "${targetLang}" with ${bestCues.length} cues`);
        setCues(bestCues);
        return;
      }

      // 3. All tracks for this language exhausted — gracefully clear cues.
      // NEVER switch to another language (e.g. Arabic when English was chosen)!
      log(`[Subtitle] All subtitle tracks for "${targetLang}" exhausted — no cues loaded`);
      setCues([]);
    })();
  }, [activeSub, subs, referer, log, isHardSubServer]);

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
      if (ct > 0) {
        lastKnownTimeRef.current = ct;
      }
      if (v.duration > 0) {
        lastKnownDurRef.current = v.duration;
      }
      if (e.type === 'pause') {
        flushProgress(ct);
      }

      // Safety net: if video started playing from 0:00 but a resume target exists, seek immediately
      if (!resumeSeekAppliedRef.current && v.duration > 0) {
        const target = Math.max(targetResumeTimeRef.current > 2 ? targetResumeTimeRef.current : 0, initialSeekTime > 2 ? initialSeekTime : 0);
        if (target > 2 && target < v.duration - 5 && Math.abs(ct - target) > 2) {
          log(`[Resume] Enforcing seek on timeupdate safety net: jumping to ${target.toFixed(1)}s (was at ${ct.toFixed(1)}s)`);
          try {
            v.currentTime = target;
            resumeSeekAppliedRef.current = true;
          } catch (_) {}
        } else if (target > 2 && Math.abs(ct - target) <= 2) {
          resumeSeekAppliedRef.current = true;
        }
      }

      if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
      // Only log non-timeupdate events to avoid flooding re-renders
      if (e.type !== 'timeupdate') {
        log(`Video state sync (event: ${e.type}, curTime=${v.currentTime.toFixed(1)}, paused=${v.paused})`);
      }
    };
    const onMeta = () => {
      log(`Video loadedmetadata: duration=${v.duration.toFixed(1)}`);
      setDuration(v.duration);
      if (v.duration > 0) {
        lastKnownDurRef.current = v.duration;
      }
      // Resume from stored seek position (Netflix-style "continue where you left off")
      const target = Math.max(targetResumeTimeRef.current > 2 ? targetResumeTimeRef.current : 0, initialSeekTime > 2 ? initialSeekTime : 0);
      if (target > 2 && v.duration > 0 && target < v.duration - 5 && !resumeSeekAppliedRef.current) {
        log(`[Resume] Seeking to stored target position on loadedmetadata: ${target.toFixed(1)}s`);
        try {
          v.currentTime = target;
          resumeSeekAppliedRef.current = true;
        } catch (_) {}
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
      const target = Math.max(targetResumeTimeRef.current > 2 ? targetResumeTimeRef.current : 0, initialSeekTime > 2 ? initialSeekTime : 0);
      if (target > 2 && !resumeSeekAppliedRef.current && v.duration > 0 && target < v.duration - 5) {
        log(`[Resume] Enforcing seek on ${e.type}: ${target.toFixed(1)}s`);
        try {
          v.currentTime = target;
          resumeSeekAppliedRef.current = true;
        } catch (_) {}
      }
    };
    // Also trigger auto-hide from timeupdate when playing starts (covers autoplay case)
    let _lastPlaying = false;
    const onTimeUpdate = () => {
      if (!v.paused) {
        if (!_lastPlaying) {
          _lastPlaying = true;
          schedHide();
        }
        if (v.currentTime > 0) {
          setWaiting(false);
          setNeedsTap(false);
          setHasStarted(true);
        }
      } else if (v.paused) {
        _lastPlaying = false;
      }
    };

    // ⚡ Silent Video Freeze Watchdog:
    // Detects when audio is playing (currentTime advances) but the video frame presentation is frozen (0 new frames rendered).
    let lastCheckTime = 0;
    let lastRenderedFrames = -1;
    let freezeStreak = 0;
    let lastNudgeTime = 0;

    const freezeWatchdogId = setInterval(() => {
      if (!v || v.paused || v.ended || v.seeking || v.readyState < 3) {
        freezeStreak = 0;
        return;
      }
      const ct = v.currentTime;
      const timeAdvanced = Math.abs(ct - lastCheckTime) >= 0.8;
      
      const quality = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
      const currentFrames = quality ? quality.totalVideoFrames : -1;

      if (timeAdvanced) {
        lastCheckTime = ct;
        if (quality && currentFrames >= 0 && currentFrames === lastRenderedFrames) {
          // Sound is playing (currentTime advanced by 0.8s+), BUT 0 new video frames were rendered!
          freezeStreak++;
          const now = Date.now();
          if (freezeStreak >= 2 && now - lastNudgeTime > 4000) {
            lastNudgeTime = now;
            freezeStreak = 0;
            log('[Watchdog] Silent video freeze detected (audio playing with 0 video frames). Nudging decoder pipeline...');
            try {
              // Micro-nudge forces the Android hardware decoder to flush its stalled buffer and re-sync
              v.currentTime = ct + 0.05;
              if (hlsRef.current) {
                hlsRef.current.recoverMediaError();
              }
            } catch (_) {}
          }
        } else {
          lastRenderedFrames = currentFrames;
          freezeStreak = 0;
        }
      }
    }, 1000);

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
      clearInterval(freezeWatchdogId);
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
  }, [log, autoplay, onEpisodeChange, currentEpisode, totalEpisodes, initialSeekTime, flushProgress]);

  // ── Engine B: Embedded Subtitle Track Fallback (MP4 Soft-Subs) ─────────
  // If external VTT cues are not present, inspect HTML5 video.textTracks
  // so any embedded tracks in the MP4 (as seen in MX Player) are rendered seamlessly.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handleCueChange = () => {
      if (cues.length > 0 || shouldSuppressOverlay) {
        setEmbeddedCueText('');
        return;
      }
      let foundText = '';
      if (v.textTracks && v.textTracks.length > 0) {
        for (let i = 0; i < v.textTracks.length; i++) {
          const track = v.textTracks[i];
          if (track.mode === 'disabled') track.mode = 'hidden';
          if (track.activeCues && track.activeCues.length > 0) {
            foundText = Array.from(track.activeCues).map(c => c.text).join('\n');
            if (foundText) break;
          }
        }
      }
      setEmbeddedCueText(foundText);
    };

    const setupEmbeddedTracks = () => {
      if (v.textTracks) {
        for (let i = 0; i < v.textTracks.length; i++) {
          const t = v.textTracks[i];
          t.mode = 'hidden';
          t.oncuechange = handleCueChange;
        }
        v.textTracks.onaddtrack = (e) => {
          if (e.track) {
            e.track.mode = 'hidden';
            e.track.oncuechange = handleCueChange;
          }
        };
      }
    };

    v.addEventListener('loadedmetadata', setupEmbeddedTracks);
    setupEmbeddedTracks();

    return () => {
      v.removeEventListener('loadedmetadata', setupEmbeddedTracks);
      if (v.textTracks) {
        for (let i = 0; i < v.textTracks.length; i++) {
          v.textTracks[i].oncuechange = null;
        }
      }
    };
  }, [cues.length, shouldSuppressOverlay]);

  // ── Save seek position every 10s while playing (Netflix-style resume) ──
  // Fires onSeekProgress(currentTime, duration) at 10s intervals.
  // Throttled: only fires while video is actually playing, not paused/buffering.
  // Fast & Bulletproof Watch Progress Tracking (4s interval + background/tab/close listeners)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !onSeekProgressRef.current) return;

    const interval = setInterval(() => {
      if (v.paused || v.ended || v.duration < 5) return;
      const ct = v.currentTime;
      const dur = v.duration;
      // Don't save in first 2s (avoids resetting to 0) or last 15s (episode considered completed)
      if (ct < 2 || ct > dur - 15) return;
      flushProgress(ct);
    }, 4000); // every 4 seconds for tight synchronization

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };

    const onPageHide = () => {
      flushProgress();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      flushProgress();
    };
  }, [url, flushProgress]);

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
    if (isNativePlatform() || (typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent))) return;
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
      if (!isNativePlatform()) return;
      try {
        if (fs || isLocal) {
          // Lock landscape: MainActivity maps SCREEN_ORIENTATION_LANDSCAPE to SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          // which allows free 180° rotation between landscape-left and landscape-right (like YouTube)
          // and permanently prevents automatic switching to portrait.
          if (EmbedScraper?.setOrientation) {
            await EmbedScraper.setOrientation({ orientation: 'landscape' }).catch(() => {});
          }
          await ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
          if (EmbedScraper?.setImmersiveMode) {
            await EmbedScraper.setImmersiveMode({ enabled: true }).catch(() => {});
          } else {
            await StatusBar.hide().catch(() => {});
          }
        } else {
          // On exit / portrait player: lock portrait and restore system UI
          if (EmbedScraper?.setOrientation) {
            await EmbedScraper.setOrientation({ orientation: 'portrait' }).catch(() => {});
          }
          await ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
          if (EmbedScraper?.setImmersiveMode) {
            await EmbedScraper.setImmersiveMode({ enabled: false }).catch(() => {});
          } else {
            await StatusBar.show().catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[AniPlayer] Fullscreen native sync error:', e.message);
      }
    };
    syncNativeFullscreen();
  }, [fs, isLocal]);

  // Back button handling: if in fullscreen landscape, hardware back exits fullscreen back to portrait
  useEffect(() => {
    if (!fs || isLocal) return;
    return registerBackButtonHandler(() => {
      setFs(false);
      return true; // handled: exited fullscreen
    });
  }, [fs, isLocal]);

  // Always restore system bars + lock portrait orientation on unmount
  // SKIP this when unmounting due to an episode transition (keepFsOnEpChange.current === true)
  // so the next episode can immediately re-enter fullscreen without a portrait flash.
  useEffect(() => {
    return () => {
      flushProgress();
      // Always reset screen brightness when player closes
      resetDeviceBrightness();

      if (isNativePlatform() && !(keepFsOnEpChange?.current)) {
        if (EmbedScraper?.setOrientation) {
          EmbedScraper.setOrientation({ orientation: 'portrait' }).catch(() => {});
        }
        ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
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
      const next = curr === 'contain' ? 'cover' : curr === 'cover' ? 'fill' : 'contain';
      const label = next === 'contain' ? 'Fit' : next === 'cover' ? 'Zoom' : 'Stretch';
      setFitToast(label);
      if (fitToastTimerRef.current) clearTimeout(fitToastTimerRef.current);
      fitToastTimerRef.current = setTimeout(() => setFitToast(null), 1200);
      return next;
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
    if (activeVideoAdRef.current) return;
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
    if (activeVideoAd) return;
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
  }, [skipSilent, togglePlay, schedHide, activeVideoAd]);

  /* ── Swipe gesture ────────────────────────────────────────── */
  const onGestureStart = useCallback((cx, cy) => {
    if (activeVideoAd) return;
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
      if (activeVideoAd) return;
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
      if (activeVideoAd) return;
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
  const activeCue = !shouldSuppressOverlay && Array.isArray(cues) && cues.length > 0 ? cues.find(c => curTime >= (c.startTime + subDelay) && curTime <= (c.endTime + subDelay)) : null;
  const cueHtml = !shouldSuppressOverlay
    ? (activeCue ? sanitizeSubtitleHtml(activeCue.text) : (embeddedCueText ? sanitizeSubtitleHtml(embeddedCueText) : ''))
    : '';


  /* ─── Render ──────────────────────────────────────────────── */
  const playerContent = (
    <div
      ref={wrapRef}
      className={['anip', fs ? 'anip--fs' : '', ctrlVis ? 'anip--ctrl' : '', isTouch() ? 'anip--touch' : ''].filter(Boolean).join(' ')}
      onMouseMove={() => { if (!isTouch()) showCtrl(); }}
      onMouseLeave={() => { if (!isTouch() && playing) setCtrlVis(false); }}
      onClick={(e) => {
        if (isTouch() || activeVideoAd) return;
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

      {/* ── YouTube-Style In-Stream Video Ad Overlay ────────── */}
      {activeVideoAd && (
        <VideoAdOverlay
          ad={activeVideoAd}
          onComplete={handleVideoAdComplete}
        />
      )}

      {/* ── BLACK LOADING BG: Covers grey browser poster/play icon ── */}
      {(!hasStarted || needsTap) && !hlsErr && !activeVideoAd && (
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
      {(activeCue || embeddedCueText) && cueHtml && (() => {
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

      {/* ── Aspect Ratio Mode Toast ────────────────────────── */}
      {fitToast && (
        <div className="anip__fit-toast">
          {fitToast === 'Fit' && <RectangleHorizontal size={14} />}
          {fitToast === 'Zoom' && <ZoomIn size={14} />}
          {fitToast === 'Stretch' && <MoveHorizontal size={14} />}
          <span>{fitToast}</span>
        </div>
      )}

      {/* ── Fatal HLS error overlay ─────────────────────────────── */}
      {/* NOTE: suppress if loading=true — URL is about to change, error will resolve */}
      {hlsErr && !loading && (() => {
        const errKey = (typeof hlsErr === 'object' && hlsErr.type) ? hlsErr.type : hlsErr;
        const errDetails = typeof hlsErr === 'object' ? (hlsErr.details || hlsErr.error || '') : '';
        // Context-aware error messages
        const errMessages = {
          network: { icon: '📡', title: 'Connection Issue', body: 'Could not reach the stream. Check your connection or try a different server.' },
          media:   { icon: '⚠️', title: 'Decode Error',      body: 'This stream format isn\'t supported. Try switching to another server.' },
          unknown: { icon: '🎬', title: 'Stream Unavailable', body: 'This stream couldn\'t load. Select another server to continue watching.' },
        };
        const msg = errMessages[errKey] || errMessages.unknown;
        const doRetry = () => {
          const v = videoRef.current;
          if (!v) return;
          setHlsErr(null);
          setNeedsTap(false);
          setWaiting(true);
          setHasStarted(false);
          const oldHls = hlsRef.current;
          if (oldHls) { try { oldHls.destroy(); } catch {} hlsRef.current = null; }
          const newHls = new Hls({
            enableWorker: true,
            startFragPrefetch: false,
            lowLatencyMode: false,
            progressive: false,
            startPosition: targetResumeTimeRef.current > 0 ? targetResumeTimeRef.current : -1,
            startLevel: -1,
            abrEwmaDefaultEstimate: 1200000,
            abrBandWidthFactor: 0.85,
            abrBandWidthUpFactor: 0.7,
            maxBufferLength: 25,
            maxMaxBufferLength: 50,
            maxBufferSize: 50 * 1000 * 1000,
            backBufferLength: 20,
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 6,
            manifestLoadingRetryDelay: 1200,
            levelLoadingTimeOut: 15000,
            levelLoadingMaxRetry: 6,
            levelLoadingRetryDelay: 1200,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1200,
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.1,
            nudgeMaxRetries: 10,
            autoStartLoad: true,
            loader: isNativePlatform() ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, () => refererRef.current, () => embedUrlRef.current) : Hls.DefaultConfig.loader,
            pLoader: isNativePlatform() ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, () => refererRef.current, () => embedUrlRef.current) : Hls.DefaultConfig.loader,
            fLoader: isNativePlatform() ? buildCapacitorHlsLoader(Hls.DefaultConfig.loader, () => refererRef.current, () => embedUrlRef.current) : Hls.DefaultConfig.loader,
          });
          hlsRef.current = newHls;
          newHls.attachMedia(v);
          newHls.on(Hls.Events.MEDIA_ATTACHED, () => {
            const sourceUrl = getEffectivePlayableUrl(url, refererRef.current);
            newHls.loadSource(sourceUrl);
          });
          newHls.on(Hls.Events.MANIFEST_PARSED, () => { setWaiting(false); v.play().catch(() => {}); });
          newHls.on(Hls.Events.ERROR, (_, d) => {
            if (d.fatal) {
              // Pause video so audio doesn't play under the error overlay
              try { if (v && !v.paused) v.pause(); } catch (_) {}
              setHlsErr({
                type: d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : d.type === Hls.ErrorTypes.MEDIA_ERROR ? 'media' : 'unknown',
                details: d.details || '',
                error: d.error?.message || d.reason || '',
              });
              setWaiting(false);
            }
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
              {errDetails && (
                <span style={{ display: 'block', marginTop: 6, fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>
                  ({errDetails})
                </span>
              )}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 240, margin: '14px auto 0' }}>
              <button className="anip__error__retry" onClick={doRetry}>
                ↺ Retry Stream
              </button>
              {onStreamExpired && (
                <button
                  className="anip__error__retry"
                  style={{
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    boxShadow: '0 4px 15px rgba(99, 102, 241, 0.35)',
                    border: 'none',
                  }}
                  onClick={() => {
                    setHlsErr(null);
                    setWaiting(true);
                    if (hlsRef.current) {
                      try { hlsRef.current.destroy(); } catch {}
                      hlsRef.current = null;
                    }
                    onStreamExpired();
                  }}
                >
                  ⚡ Switch Server
                </button>
              )}
              <button className="anip__error__secondary" onClick={() => { flushProgress(); onBack(); }}>
                ← Exit Player
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── buffering spinner / loading spinner ─────────────── */}
      {(!playing || waiting) && (waiting || !hasStarted || needsTap || loading) && !hlsErr && !activeVideoAd && (
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
      <div
        className="anip__overlay"
        style={activeVideoAd ? { display: 'none', pointerEvents: 'none' } : undefined}
      >

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
              onClick={e => {
                e.stopPropagation();
                if (fs && !isLocal) {
                  setFs(false);
                } else {
                  flushProgress();
                  onBack();
                }
              }}
              title={fs && !isLocal ? "Exit Fullscreen" : "Exit Video"}
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
        {!(showQ || showSub || showSpeed || showSync || loading || hlsErr) && (
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
                  aria-label="Subtitles"
                >
                  <Subtitles size={17} />
                </button>
                {showSub && (
                  <div className="anip__menu anip__menu--subs" onClick={e => e.stopPropagation()}>
                    <p className="anip__menu-hd">Subtitles</p>
                    <button
                      className={`anip__menu-item ${activeSub === -1 ? 'anip__menu-item--on' : ''}`}
                      onClick={e => { e.stopPropagation(); setActiveSub(-1); setActivePanel(null); schedHide(); }}
                    >
                      {activeSub === -1 && <span className="anip__chk">✓</span>}
                      Off
                    </button>
                    {subs.map(s => (
                      <button
                        key={s.id}
                        className={`anip__menu-item ${activeSub === s.id ? 'anip__menu-item--on' : ''}`}
                        onClick={e => { e.stopPropagation(); setActiveSub(s.id); setActivePanel(null); schedHide(); }}
                      >
                        {activeSub === s.id && <span className="anip__chk">✓</span>}
                        {s.label}
                      </button>
                    ))}
                    {subs.length === 0 && (
                      <p className="anip__menu-empty">No subtitles</p>
                    )}
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
                  <span className="anip__badge-visible">
                    {activeQ === -1
                      ? (playingResolution ? `Auto (${playingResolution})` : 'Auto')
                      : `🔒 ${qualities[activeQ]?.label || qualityLockLabel || 'HD'}`}
                  </span>
                </button>
                {showQ && (
                  <div className="anip__menu">
                    <p className="anip__menu-hd">Quality {activeQ !== -1 && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>🔒 Locked</span>}</p>
                    {[{ id: -1, label: playingResolution ? `Auto (${playingResolution})` : 'Auto' }, ...[...qualities].reverse()].map(q => (
                      <button key={q.id}
                        className={`anip__menu-item ${activeQ===q.id ? 'anip__menu-item--on':''}`}
                        onClick={e => { e.stopPropagation(); userManualQualityChangedRef.current = true; setActiveQ(q.id); setActivePanel(null); schedHide(); }}
                      >
                        {activeQ===q.id && <span className="anip__chk">✓</span>}{q.id === -1 ? q.label : (q.id >= 0 && activeQ !== -1 && qualities[activeQ]?.id === q.id ? `🔒 ${q.label}` : q.label)}
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

              {/* Aspect Ratio Toggle (symbols instead of words) */}
              <button className="anip__btn"
                onClick={e => { e.stopPropagation(); toggleFitMode(); }}
                title={`Aspect Ratio: ${fitMode === 'contain' ? 'Fit' : fitMode === 'cover' ? 'Zoom' : 'Stretch'}`}
                aria-label={`Aspect Ratio: ${fitMode === 'contain' ? 'Fit' : fitMode === 'cover' ? 'Zoom' : 'Stretch'}`}
                style={{ justifyContent: 'center' }}
              >
                {fitMode === 'contain' && <RectangleHorizontal size={17} />}
                {fitMode === 'cover' && <ZoomIn size={17} />}
                {fitMode === 'fill' && <MoveHorizontal size={17} />}
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
