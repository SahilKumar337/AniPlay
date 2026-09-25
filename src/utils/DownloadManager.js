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

function _metaAdd(animeId, animeTitle, cover, episode, track, streamUrl = '', referer = '', subtitles = []) {
  const id = `${animeId}_${episode}_${track}`;
  const list = _metaLoad().filter(x => x.id !== id); // remove old entry for same episode
  list.push({
    id,
    t: animeTitle,
    c: cover,
    e: String(episode),
    k: track,
    u: streamUrl || '',
    r: referer || '',
    s: Array.isArray(subtitles) ? subtitles : []
  });
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
    this.cancelledTasks = new Set();

    // ── Restore persisted metadata from previous sessions ──
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
          streamUrl:  m.u || '',
          referer:    m.r || '',
          subtitles:  m.s || []
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
            // If the user cancelled or deleted this task, ignore any late progress events from Java
            if (this.cancelledTasks.has(taskId) || status === 'cancelled' || status === 'deleted') {
              delete this.activeProgress[taskId];
              delete this.pendingMeta[taskId];
              this.completedList = this.completedList.filter(x => x.taskId !== taskId);
              this.notify({ taskId, status: 'deleted', progress: 0 });
              return;
            }

            const meta = this.pendingMeta[taskId] || {};
            if (status === 'completed' || status === 'error' || status === 'failed') {
              delete this.activeProgress[taskId];
              this.completedList = this.completedList.filter(x => x.taskId !== taskId);
              this.completedList.unshift({
                taskId,
                status: status === 'failed' ? 'error' : status,
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
              if (status === 'completed' && (meta.animeId || taskId.split('_')[0])) {
                _metaAdd(
                  meta.animeId || taskId.split('_')[0],
                  meta.animeTitle || 'Anime',
                  meta.cover || '',
                  meta.episode || taskId.split('_')[1],
                  meta.track || taskId.split('_')[2] || 'sub'
                );
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

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.removeListener(callback);
  }

  removeListener(callback) {
    this.listeners.delete(callback);
  }

  subscribe(callback) {
    return this.addListener(callback);
  }

  notify(data) {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (e) {
        console.error('[DownloadManager] Listener error:', e);
      }
    }
  }

  // Request native download of an episode
  async downloadEpisode(anime, episode, srvUrl, referer = '', track = 'sub', subtitles = [], isHls = false, playlistContent = '') {
    const animeId    = String(anime.id || '0');
    const animeTitle = anime.title?.english || anime.title?.romaji || anime.title?.userPreferred || anime.title?.native || (typeof anime.title === 'string' ? anime.title : 'Anime');
    const cover      = anime.coverImage?.large || anime.coverImage?.medium || anime.image || '';
    const taskId     = `${animeId}_${episode}_${track}`;

    if (!isNative || !OfflineDownloader) {
      // WEB DOWNLOAD: Persist stream metadata for instant playback in Download Center
      let progress = 0;
      this.activeProgress[taskId] = 0;
      this.pendingMeta[taskId] = { animeId, animeTitle, cover, episode: String(episode), track, streamUrl: srvUrl, referer, subtitles };
      this.notify({ taskId, progress: 0, status: 'downloading' });
      
      // If direct MP4 file, trigger real browser download
      if (typeof window !== 'undefined' && srvUrl && srvUrl.includes('.mp4')) {
        try {
          const a = document.createElement('a');
          a.href = srvUrl;
          a.download = getEpisodeFilename(animeTitle, episode, track);
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch (_) {}
      }

      const interval = setInterval(() => {
        progress += 25;
        if (progress >= 100) {
          clearInterval(interval);
          delete this.activeProgress[taskId];
          this.completedList = this.completedList.filter(x => x.taskId !== taskId);
          this.completedList.unshift({
            taskId, status: 'completed', progress: 100,
            animeId, animeTitle, cover, episode: String(episode), track,
            streamUrl: srvUrl, referer, subtitles
          });
          _metaAdd(animeId, animeTitle, cover, episode, track, srvUrl, referer, subtitles);
          this.notify({ taskId, progress: 100, status: 'completed' });
        } else {
          this.activeProgress[taskId] = progress;
          this.notify({ taskId, progress, status: 'downloading' });
        }
      }, 250);
      
      return { status: 'started' };
    }

    if (!anime || !episode || !srvUrl) {
      throw new Error('anime, episode, and srvUrl are required');
    }

    // Store metadata NOW so DownloadPage immediately has access
    this.cancelledTasks.delete(taskId);
    this.pendingMeta[taskId] = { animeId, animeTitle, cover, episode: String(episode), track };
    this.activeProgress[taskId] = 0;
    this.notify({ taskId, progress: 0, status: 'downloading' });

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

  // Alias for starting downloads using an options object
  async startDownload({ anime, episode, streamUrl, referer = '', track = 'sub', audioTrack, subtitles = [], isHls = true, playlistContent = '', onProgress }) {
    const finalTrack = audioTrack || track || 'sub';
    const taskId = `${anime?.id}_${episode}_${finalTrack}`;
    if (onProgress) {
      const unsub = this.addListener((data) => {
        if (data.taskId === taskId) {
          onProgress(data.progress || 0, data.status);
          if (data.status === 'completed' || data.status === 'error' || data.status === 'failed') {
            unsub();
          }
        }
      });
    }
    return this.downloadEpisode(anime, episode, streamUrl, referer, finalTrack, subtitles, isHls, playlistContent);
  }

  // Get list of completed session downloads & active downloading items
  getDownloadsList() {
    const list = [];
    const seenTasks = new Set();
    
    // 1. Add active downloading items first
    for (const [taskId, progress] of Object.entries(this.activeProgress)) {
      const meta  = this.pendingMeta[taskId] || {};
      const parts = taskId.split('_');
      seenTasks.add(taskId);
      list.push({
        taskId,
        animeId:    meta.animeId    || parts[0],
        animeTitle: meta.animeTitle || 'Anime',
        cover:      meta.cover      || '',
        episode:    meta.episode    || parts[1],
        track:      meta.track      || parts[2] || 'sub',
        status:     'downloading',
        progress,
        streamUrl:  meta.streamUrl  || '',
        referer:    meta.referer    || '',
        subtitles:  meta.subtitles  || [],
        timestamp:  Date.now()
      });
    }

    // 2. Add completed/failed session items
    for (const item of this.completedList) {
      if (seenTasks.has(item.taskId)) continue;
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
        streamUrl:  item.streamUrl  || '',
        referer:    item.referer    || '',
        subtitles:  item.subtitles  || [],
        timestamp:  Date.now()
      });
    }

    return list;
  }

  // Save stream metadata for playback
  saveStreamMetadata(animeId, animeTitle, cover, episode, track, streamUrl, referer = '', subtitles = []) {
    _metaAdd(animeId, animeTitle, cover, episode, track, streamUrl, referer, subtitles);
    const taskId = `${animeId}_${episode}_${track}`;
    const found = this.completedList.find(x => x.taskId === taskId);
    if (found) {
      found.streamUrl = streamUrl;
      found.referer = referer;
      found.subtitles = subtitles;
    }
  }

  // Query MediaStore for the local file path, then convert to a WebView-accessible HTTP URL
  // using Capacitor's built-in local file server (supports byte-range requests for seeking).
  // In web browser mode, returns the saved stream URL for seamless playback in Download Center.
  async getLocalFileUri(animeTitle, episode, track = 'sub') {
    if (!isNative || !OfflineDownloader) {
      const epStr = String(episode);
      const match = this.completedList.find(x =>
        (x.animeTitle === animeTitle || x.animeId === animeTitle) &&
        String(x.episode) === epStr &&
        (x.track || 'sub') === track
      ) || _metaLoad().find(x =>
        (x.t === animeTitle || x.id.startsWith(animeTitle + '_')) &&
        String(x.e) === epStr &&
        (x.k || 'sub') === track
      );

      if (match) {
        const streamUrl = match.streamUrl || match.u || null;
        const subtitles = match.subtitles || match.s || [];
        const subtitleUri = subtitles[0]?.url || subtitles[0]?.file || null;
        const referer = match.referer || match.r || '';
        return {
          videoUri: streamUrl,
          subtitleUri,
          subtitleContent: null,
          subtitles,
          referer,
          isStream: true
        };
      }
      return { videoUri: null, subtitleUri: null, subtitleContent: null };
    }
    const displayName = getEpisodeFilename(animeTitle, episode, track);
    try {
      const result = await OfflineDownloader.getLocalVideoUri({ displayName });

      let videoUri = null;
      let subtitleUri = null;
      let subtitleContent = result.subtitleContent || null;

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

      return { videoUri, subtitleUri, subtitleContent };
    } catch (e) {
      console.error('[DownloadManager] getLocalFileUri failed:', e);
      return { videoUri: null, subtitleUri: null, subtitleContent: null };
    }
  }

  // Cancel and immediately kill an active or queued download, and delete files from disk
  async cancelDownload(animeId, episode, track = 'sub', animeTitle = '') {
    const taskId = `${animeId}_${episode}_${track}`;
    this.cancelledTasks.add(taskId);
    delete this.activeProgress[taskId];
    delete this.pendingMeta[taskId];
    this.completedList = this.completedList.filter(x => x.taskId !== taskId);
    _metaRemove(taskId);

    if (isNative && OfflineDownloader) {
      try {
        if (OfflineDownloader.cancelDownload) {
          await OfflineDownloader.cancelDownload({ taskId, animeId: String(animeId), episode: String(episode), track });
        }
        if (OfflineDownloader.deleteEpisode) {
          await OfflineDownloader.deleteEpisode({ animeTitle: animeTitle || '', episode: String(episode), track, animeId: String(animeId) });
        }
      } catch (e) {
        console.warn('[DownloadManager] Native cancel/delete error:', e);
      }
    }

    this.notify({ taskId, status: 'deleted', progress: 0 });
  }

  // Delete a downloaded episode completely from storage
  async deleteDownload(animeId, episode, track = 'sub', animeTitle = '') {
    return this.cancelDownload(animeId, episode, track, animeTitle);
  }

  // Open stream in external downloader (1DM/ADM) or player (VLC/MX Player)
  async openExternalDownloader(url, referer, title, targetPackage = '') {
    if (!isNative || !OfflineDownloader) {
      console.log('[DownloadManager] Mock external download URL:', url);
      return;
    }
    return OfflineDownloader.openExternalDownloader({ url, referer, title, package: targetPackage });
  }
}

export const downloadManager = new DownloadManager();
