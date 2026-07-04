import { registerPlugin } from '@capacitor/core';

const OfflineDownloader = registerPlugin('OfflineDownloader');

class DownloadManager {
  constructor() {
    this.listeners = new Set();
    this.activeProgress = {};

    // Setup listener for native download updates
    try {
      OfflineDownloader.addListener('downloadProgress', (data) => {
        const { taskId, progress, status, error } = data;
        if (taskId) {
          if (status === 'completed' || status === 'error') {
            delete this.activeProgress[taskId];
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

  // Request native download of an episode
  async downloadEpisode(anime, episode, srvUrl, referer = '') {
    if (!anime || !episode || !srvUrl) {
      throw new Error('anime, episode, and srvUrl are required');
    }

    const cover = anime.coverImage?.large || anime.coverImage?.medium || '';
    const animeTitle = anime.title?.english || anime.title?.romaji || 'Anime';

    return OfflineDownloader.downloadEpisode({
      animeId: String(anime.id),
      animeTitle,
      episode: String(episode),
      url: srvUrl,
      referer,
      cover
    });
  }

  // Get list of completed & downloading items
  async getDownloadsList() {
    try {
      const result = await OfflineDownloader.getDownloadsList();
      return result.downloads || [];
    } catch (e) {
      console.error('[DownloadManager] Failed to get downloads list:', e);
      return [];
    }
  }

  // Delete a downloaded episode
  async deleteDownload(animeId, episode) {
    return OfflineDownloader.deleteDownload({
      animeId: String(animeId),
      episode: String(episode)
    });
  }

  // Generate the playback stream URL served by the local HTTP server
  getPlaybackUrl(animeId, episode, isHLS = true) {
    const taskId = `${animeId}_${episode}`;
    const filename = isHLS ? 'index.m3u8' : 'video.mp4';
    return `http://localhost:8081/play/${taskId}/${filename}`;
  }

  // Event Subscription
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(data) {
    this.listeners.forEach(cb => cb(data));
  }

  getActiveProgress(animeId, episode) {
    return this.activeProgress[`${animeId}_${episode}`] || null;
  }
}

export const downloadManager = new DownloadManager();
