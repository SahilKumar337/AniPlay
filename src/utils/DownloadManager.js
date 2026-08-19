import { registerPlugin, Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();
const OfflineDownloader = isNative ? registerPlugin('OfflineDownloader') : null;

/**
 * Build the expected MP4 filename that Java saves the download as.
 * Must match the Java pattern: "<safe title> - Ep <episode> (<TRACK>).mp4"
 */
export function getEpisodeFilename(animeTitle, episode, track = 'sub') {
  const safe = (animeTitle || 'Anime').replace(/[\\\/:*?"<>|]/g, '_');
  return `${safe} - Ep ${episode} (${track.toUpperCase()}).mp4`;
}

// ── Ultra-lean localStorage persistence ───────────────────────────────────────────────────────
// Each saved entry is only ~200 bytes of JSON (5 short fields, no binary data).
// 500 downloads = ~100KB — well within localStorage's 5MB limit on all Android WebViews.
// Status/progress/error are NOT stored (those reset on each session anyway).
const DL_META_KEY = 'aniplay_dlmeta';
const DL_META_MAX = 500; // cap at 500 entries to prevent unbounded growth

function _metaLoad() {
  try {
    const raw = localStorage.getItem(DL_META_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function _metaSave(list) {
  try {
    // Keep only the most recent DL_META_MAX entries
    const trimmed = list.slice(-DL_META_MAX);
    localStorage.setItem(DL_META_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[DownloadManager] localStorage write failed:', e.message);
  }
}

function _metaAdd(animeId, animeTitle, cover, episode, track) {
  const id = `${animeId}_${episode}_${track}`;
  const list = _metaLoad().filter(x => x.id !== id); // remove old entry for same episode
  list.push({ id, t: animeTitle, c: cover, e: String(episode), k: track });
  _metaSave(list);
}

function _metaRemove(taskId) {
  const list = _metaLoad().filter(x => x.id !== taskId);
  _metaSave(list);
}

class DownloadManager {
  constructor() {
    this.listeners      = new Set();
    this.activeProgress = {};
    this.completedList  = [];
    this.pendingMeta    = {}; // taskId → { animeId, animeTitle, cover, episode, track }

    // ── Restore persisted metadata from previous sessions ──
    // Entries are loaded as status:"completed" since we only persist finished downloads.
    try {
      const saved = _metaLoad();
      for (const m of saved) {
        this.completedList.push({
          taskId:    m.id,
          status:    'completed',
          progress:  100,
          error:     null,
          remuxError: null,
          animeId:    m.id.split('_')[0],
          animeTitle: m.t || 'Anime',
          cover:      m.c || '',
          episode:    m.e || m.id.split('_')[1],
          track:      m.k || m.id.split('_')[2] || 'sub',
        });
      }
    } catch (e) {
      console.warn('[DownloadManager] Failed to restore persisted metadata:', e);
    }

    if (isNative && OfflineDownloader) {
      try {
        OfflineDownloader.addListener('downloadProgress', (data) => {
          const { taskId, progress, status, error, remuxError } = data;
          if (taskId) {
            const meta = this.pendingMeta[taskId] || {};
            if (status === 'completed' || status === 'error') {
              delete this.activeProgress[taskId];
              this.completedList = this.completedList.filter(x => x.taskId !== taskId);
              this.completedList.push({
                taskId,
                status,
                progress: status === 'completed' ? 100 : 0,
                error:       error      || null,
                remuxError:  remuxError || null,
                animeId:    meta.animeId    || taskId.split('_')[0],
                animeTitle: meta.animeTitle || 'Anime',
                cover:      meta.cover      || '',
                episode:    meta.episode    || taskId.split('_')[1],
                track:      meta.track      || taskId.split('_')[2] || 'sub',
              });
              // ─ Persist to localStorage (only on success, ~200 bytes per entry) ─
              if (status === 'completed' && meta.animeId) {
                _metaAdd(meta.animeId, meta.animeTitle, meta.cover, meta.episode, meta.track);
              }
              delete this.pendingMeta[taskId];
            } else {
              this.activeProgress[taskId] = progress;
            }
            this.notify(data);
          }
        });
      } catch (e) {
        console.warn('[DownloadManager] Plugin listeners not supported in current environment:', e);
      }
    }
  }

  // Request native download of an episode
  async downloadEpisode(anime, episode, srvUrl, referer = '', track = 'sub', subtitles = [], isHls = false, playlistContent = '') {
    if (!isNative || !OfflineDownloader) {
      // WEB MOCK DOWNLOAD
      const taskId = `${anime.id}_${episode}_${track}`;
      let progress = 0;
      this.activeProgress[taskId] = 0;
      this.notify({ taskId, progress: 0, status: 'downloading' });
      
      const interval = setInterval(() => {
        progress += 20;
        if (progress >= 100) {
          clearInterval(interval);
          delete this.activeProgress[taskId];
          this.completedList = this.completedList.filter(x => x.taskId !== taskId);
          this.completedList.push({
            taskId, status: 'completed', progress: 100,
            animeId: String(anime.id),
            animeTitle: anime.title?.english || anime.title?.romaji || 'Anime',
            cover: anime.coverImage?.large || anime.coverImage?.medium || '',
            episode: String(episode), track
          });
          this.notify({ taskId, progress: 100, status: 'completed' });
        } else {
          this.activeProgress[taskId] = progress;
          this.notify({ taskId, progress, status: 'downloading' });
        }
      }, 400);
      
      return { status: 'started' };
    }

    if (!anime || !episode || !srvUrl) {
      throw new Error('anime, episode, and srvUrl are required');
    }

    const animeId    = String(anime.id);
    const animeTitle = anime.title?.english || anime.title?.romaji || 'Anime';
    const cover      = anime.coverImage?.large || anime.coverImage?.medium || '';
    const taskId     = `${animeId}_${episode}_${track}`;

    // Store metadata NOW — completion event will include it in completedList
    this.pendingMeta[taskId] = { animeId, animeTitle, cover, episode: String(episode), track };
    this.activeProgress[taskId] = 0;

    return OfflineDownloader.downloadEpisode({
      animeId,
      animeTitle,
      episode: String(episode),
      url: srvUrl,
      referer,
      cover,
      track,
      subtitles,
      isHls,
      playlistContent: playlistContent || ''
    });
  }

  // Get list of completed session downloads & active downloading items
  async getDownloadsList() {
    const list = [];
    
    // Add completed/failed session items
    for (const item of this.completedList) {
      const parts = item.taskId.split('_');
      list.push({
        taskId:     item.taskId,
        animeId:    item.animeId    || parts[0],
        animeTitle: item.animeTitle || 'Anime',
        cover:      item.cover      || '',
        episode:    item.episode    || parts[1],
        track:      item.track      || parts[2] || 'sub',
        status:     item.status,
        progress:   item.progress,
        error:      item.error,
        remuxError: item.remuxError,
        timestamp:  Date.now()
      });
    }

    // Add active progress items
    for (const [taskId, progress] of Object.entries(this.activeProgress)) {
      const meta  = this.pendingMeta[taskId] || {};
      const parts = taskId.split('_');
      list.push({
        taskId,
        animeId:    meta.animeId    || parts[0],
        animeTitle: meta.animeTitle || 'Anime',
        cover:      meta.cover      || '',
        episode:    meta.episode    || parts[1],
        track:      meta.track      || parts[2] || 'sub',
        status:     'downloading',
        progress,
        timestamp:  Date.now()
      });
    }

    return list;
  }

  // Query MediaStore for the local file path, then convert to a WebView-accessible HTTP URL
  // using Capacitor's built-in local file server (supports byte-range requests for seeking).
  async getLocalFileUri(animeTitle, episode, track = 'sub') {
    if (!isNative || !OfflineDownloader) {
      console.log('[DownloadManager] getLocalFileUri: not available in browser');
      return { videoUri: null, subtitleUri: null };
    }
    const displayName = getEpisodeFilename(animeTitle, episode, track);
    try {
      const result = await OfflineDownloader.getLocalVideoUri({ displayName });

      // Convert filesystem paths to http://localhost/_capacitor_file_/... URLs
      // that the WebView can stream. This is the official Capacitor pattern for
      // serving local files to the WebView — supports byte-range (video seeking).
      let videoUri = null;
      let subtitleUri = null;

      if (result.filePath) {
        const { Capacitor } = await import('@capacitor/core');
        const toCapacitorUrl = (p) => {
          if (!p) return null;
          const clean = p.startsWith('file://') ? p : `file://${p}`;
          return Capacitor.convertFileSrc(clean);
        };
        videoUri = toCapacitorUrl(result.filePath);
        subtitleUri = toCapacitorUrl(result.subtitlePath);
      }

      return { videoUri, subtitleUri };
    } catch (e) {
      console.error('[DownloadManager] getLocalFileUri failed:', e);
      return { videoUri: null, subtitleUri: null };
    }
  }

  // Delete a downloaded episode (no-op as saved to gallery)
  async deleteDownload(animeId, episode, track = 'sub') {
    const taskId = `${animeId}_${episode}_${track}`;
    this.completedList   = this.completedList.filter(x => x.taskId !== taskId);
    delete this.activeProgress[taskId];
    delete this.pendingMeta[taskId];
    _metaRemove(taskId); // also remove from localStorage
    this.notify({ taskId, status: 'deleted' });
  }

  // Open stream in external downloader (1DM/ADM) or player (VLC/MX Player)
  async openExternalDownloader(url, referer, title, targetPackage = '') {
    if (!isNative || !OfflineDownloader) {
      console.log('[DownloadManager] Mock external download URL:', url);
      return;
    }
    return OfflineDownloader.openExternalDownloader({ url, referer, title, package: targetPackage });
  }

  // ── Path A: JS-driven HLS download ──────────────────────────────────────────
  // Uses CapacitorHttp (native HTTP, full auth, no CORS) to download each segment.
  // Binary data flows: JS fetch → base64 → native writeSegment → FFmpegKit local mux → Gallery
  async downloadHLSInBrowser(anime, episode, m3u8Url, playlistText, referer, track, subtitles) {
    if (!isNative || !OfflineDownloader) throw new Error('Native plugin not available');

    const animeTitle = anime.title?.english || anime.title?.romaji || 'Anime';
    const safe = animeTitle.replace(/[\\/:*?"<>|]/g, '_');
    const outputName = `${safe} - Ep ${episode} (${track.toUpperCase()}).mp4`;
    const taskId = `${anime.id}_${episode}_${track}`;

    this.activeProgress[taskId] = 0;
    this.notify({ taskId, progress: 0, status: 'downloading' });

    const { CapacitorHttp } = await import('@capacitor/core');

    // Helper: fetch URL as base64 via CapacitorHttp (native, no CORS)
    const fetchB64 = async (url, attempt = 0) => {
      try {
        const r = await CapacitorHttp.request({
          url, method: 'GET',
          responseType: 'blob',
          headers: referer ? { Referer: referer } : {}
        });
        if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
        // CapacitorHttp blob responseType returns base64 string on Android
        return typeof r.data === 'string' ? r.data : _buf2b64(new TextEncoder().encode(r.data).buffer);
      } catch (e) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 600 * (attempt + 1))); return fetchB64(url, attempt + 1); }
        throw e;
      }
    };

    // Helper: fetch raw ArrayBuffer (for AES key decryption)
    const fetchBuf = async (url) => {
      const b64 = await fetchB64(url);
      return _b642buf(b64);
    };

    // Parse the media playlist
    const { segments, isFmp4, initUrl } = _parseMediaPlaylist(m3u8Url, playlistText);
    if (segments.length === 0) throw new Error('No video segments found in playlist');
    console.log(`[JSDownload] ${segments.length} segments fmp4=${isFmp4}`);

    // Init native storage
    await OfflineDownloader.initDownload({ taskId, outputName, total: segments.length, isFmp4 });

    // Download fMP4 init segment
    if (isFmp4 && initUrl) {
      const b64 = await fetchB64(initUrl);
      await OfflineDownloader.writeSegment({ taskId, index: -1, data: b64, type: 'init' });
    }

    // Decrypt + download each segment
    const keyCache = {};
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      let b64 = await fetchB64(seg.url);

      // AES-128 decryption (Web Crypto API — always available in Android WebView)
      if (seg.keyUri) {
        if (!keyCache[seg.keyUri]) {
          const keyBuf = await fetchBuf(seg.keyUri);
          keyCache[seg.keyUri] = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
        }
        const encBuf = _b642buf(b64);
        const decBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: seg.iv }, keyCache[seg.keyUri], encBuf);
        b64 = _buf2b64(decBuf);
      }

      await OfflineDownloader.writeSegment({ taskId, index: i, data: b64, type: isFmp4 ? 'm4s' : 'ts' });
    }

    // Mux + save
    await OfflineDownloader.finalizeDownload({ taskId, isFmp4 });
    return { status: 'started' };
  }

  // Event Subscription
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(data) {
    this.listeners.forEach(cb => cb(data));
  }

  getActiveProgress(animeId, episode, track = 'sub') {
    return this.activeProgress[`${animeId}_${episode}_${track}`] || null;
  }
}

// ── Standalone helpers (outside class) ───────────────────────────────────────

function _parseMediaPlaylist(baseUrl, text) {
  const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  let rootProto = '';
  try { const u = new URL(baseUrl); rootProto = u.protocol + '//' + u.host; } catch {}

  const resolve = (url) => {
    if (!url) return url;
    url = url.trim();
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return rootProto + url;
    return base + url;
  };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const segments = []; let currentKey = null, seqNum = 0, isFmp4 = false, initUrl = null, pendingExtInf = false;

  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { seqNum = parseInt(t.split(':')[1]) || 0; }
    else if (t.startsWith('#EXT-X-MAP:')) {
      isFmp4 = true;
      const m = t.match(/URI="([^"]+)"/); if (m) initUrl = resolve(m[1]);
    } else if (t.startsWith('#EXT-X-KEY:')) {
      const method = (t.match(/METHOD=([^,\s]+)/) || [])[1] || '';
      if (method === 'AES-128') {
        const uriM = t.match(/URI="([^"]+)"/), ivM = t.match(/IV=0x([0-9a-fA-F]+)/);
        currentKey = { uri: uriM ? resolve(uriM[1]) : null, iv: ivM ? ivM[1] : null };
      } else { currentKey = null; }
    } else if (t.startsWith('#EXTINF:')) { pendingExtInf = true; }
    else if (t && !t.startsWith('#')) {
      if (pendingExtInf) {
        const url = resolve(t);
        const isAd = url.includes('ibyteimg.com') || url.includes('/ad/') || url.includes('adserver');
        if (!isAd) {
          const seg = { url, seqNum };
          if (currentKey?.uri) {
            seg.keyUri = currentKey.uri;
            if (currentKey.iv) {
              seg.iv = _hex2u8(currentKey.iv);
            } else {
              const iv = new Uint8Array(16); let s = seqNum;
              for (let b = 15; b >= 0; b--) { iv[b] = s & 0xFF; s >>>= 8; }
              seg.iv = iv;
            }
          }
          segments.push(seg);
        }
        seqNum++; pendingExtInf = false;
      }
    } else { pendingExtInf = false; }
  }
  return { segments, isFmp4, initUrl };
}

function _hex2u8(hex) {
  hex = hex.replace(/^0x/i, '');
  const u = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
  return u;
}

function _buf2b64(buf) {
  const bytes = new Uint8Array(buf); let b = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) b += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  return btoa(b);
}

function _b642buf(b64) {
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export const downloadManager = new DownloadManager();
