import { useState, useRef, useCallback, useEffect } from 'react';
import { getAniNekoServers, resolvePlaceholderServer, fetchM3U8Playlist } from '../api/stream';
import { scrapeEmbedNative, scrapeEmbedDirectly } from '../api/embedScraper';
import { downloadManager } from '../utils/DownloadManager';
import { isDownloadable, enrichDubSubtitles, parseMasterPlaylistQualities, validateM3U8 } from '../utils/animeStreamUtils';
import { ensureStoragePermission } from '../api/permissions';

export function useAnimeDownload(anime, showToast) {
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadAudioTrack, setDownloadAudioTrack] = useState(() => localStorage.getItem('anilab_preferred_track') || 'sub');
  const [serverPickerData, setServerPickerData] = useState(null);
  const [qualityPickerData, setQualityPickerData] = useState(null);

  const [downloadedSet, setDownloadedSet] = useState(() => {
    const raw = downloadManager.getDownloadsList?.();
    const list = Array.isArray(raw) ? raw : [];
    const set = new Set();
    list.forEach(item => {
      if (item && item.status === 'completed' && String(item.animeId) === String(anime?.id)) {
        set.add(`${item.episode}_${item.track || 'sub'}`);
        set.add(String(item.episode));
        set.add(`${item.animeId}_${item.episode}_${item.track || 'sub'}`);
      }
    });
    return set;
  });

  useEffect(() => {
    const syncDownloads = () => {
      const raw = downloadManager.getDownloadsList?.();
      const list = Array.isArray(raw) ? raw : [];
      const next = new Set();
      list.forEach(item => {
        if (item && item.status === 'completed' && String(item.animeId) === String(anime?.id)) {
          next.add(`${item.episode}_${item.track || 'sub'}`);
          next.add(String(item.episode));
          next.add(`${item.animeId}_${item.episode}_${item.track || 'sub'}`);
        }
      });
      setDownloadedSet(next);
    };

    syncDownloads();
    const unsub = downloadManager.subscribe(() => {
      syncDownloads();
    });
    return unsub;
  }, [anime?.id]);

  const downloadCancelledRef = useRef(false);
  const qualityPickerShownRef = useRef(false);

  const cancelActiveDownload = useCallback((epNum = null) => {
    downloadCancelledRef.current = true;
    qualityPickerShownRef.current = false;
    setQualityPickerData(null);
    if (anime?.id && epNum) {
      downloadManager.cancelDownload(anime.id, epNum, downloadAudioTrack);
    }
  }, [anime?.id, downloadAudioTrack]);

  const handleDownloadClick = useCallback(async (epNum) => {
    const hasPerm = await ensureStoragePermission();
    if (!hasPerm) {
      showToast?.('Storage permission required to download episodes.');
      return;
    }
    setServerPickerData({ episode: epNum, servers: [], loading: true });
    try {
      const result = await getAniNekoServers(anime, epNum, null, false);
      if (result && result.servers && result.servers.length > 0) {
        const enriched = enrichDubSubtitles(result.servers);
        const downloadable = enriched.filter(isDownloadable);

        if (downloadable.length === 0) {
          showToast?.('No downloadable servers found for this episode.');
          setServerPickerData(null);
          return;
        }

        setServerPickerData({
          episode: epNum,
          servers: downloadable,
          loading: false,
        });
      } else {
        showToast?.('No servers available for download.');
        setServerPickerData(null);
      }
    } catch (e) {
      console.error('[Downloads]', e);
      showToast?.('Failed to find servers. Please try again.');
      setServerPickerData(null);
    }
  }, [anime, showToast]);

  const startDownload = useCallback(async (epNum, selectedServer, allServers = null) => {
    setServerPickerData(null);
    downloadCancelledRef.current = false;
    qualityPickerShownRef.current = false;
    const isCancelled = () => downloadCancelledRef.current;

    setQualityPickerData({
      episode: epNum,
      loading: true,
      variants: [],
      onSelect: () => {},
      onCancel: () => cancelActiveDownload(),
    });
    qualityPickerShownRef.current = true;

    const taskId = `${anime.id}_${epNum}_${downloadAudioTrack}`;
    const epKey = `${epNum}_${downloadAudioTrack}`;
    const serverQueue = [
      selectedServer,
      ...(allServers || []).filter(s => s.name !== selectedServer.name && s.type === (selectedServer.type || 'sub'))
    ];

    let lastError = null;

    for (let attempt = 0; attempt < serverQueue.length; attempt++) {
      if (isCancelled()) {
        setQualityPickerData(null);
        return;
      }
      const srv = serverQueue[attempt];

      try {
        if (attempt > 0 && !qualityPickerShownRef.current) {
          setQualityPickerData({ episode: epNum, loading: true, variants: [], onSelect: () => {}, onCancel: () => cancelActiveDownload() });
          qualityPickerShownRef.current = true;
        }
        setDownloadProgress(prev => ({ ...prev, [taskId]: 0, [epKey]: 0 }));

        let finalUrl = srv.videoUrl;
        let referer = srv.referer || '';

        if (srv.isPlaceholder) {
          const resolved = await resolvePlaceholderServer(srv);
          if (resolved) {
            finalUrl = resolved.videoUrl;
            referer = resolved.referer || referer;
          }
        }

        if (!finalUrl && srv.embedUrl) {
          try {
            const scraped = await scrapeEmbedNative(srv.embedUrl, srv.name);
            if (scraped?.streamUrl) {
              finalUrl = scraped.streamUrl;
              referer = scraped.referer || referer;
            }
          } catch (_) {
            const direct = await scrapeEmbedDirectly(srv.embedUrl, srv.name);
            if (direct?.streamUrl) {
              finalUrl = direct.streamUrl;
              referer = direct.referer || referer;
            }
          }
        }

        if (!finalUrl) {
          lastError = new Error(`Server ${srv.name} returned no stream URL`);
          continue;
        }

        // Validate segments
        const segCount = await validateM3U8(finalUrl, referer);
        if (segCount === 0) {
          lastError = new Error(`Server ${srv.name} stream has 0 valid video segments`);
          continue;
        }

        const qualities = await parseMasterPlaylistQualities(finalUrl);
        const variants = qualities.length > 0
          ? qualities.map(q => ({ label: q.name, url: q.url }))
          : [{ label: 'Default HD', url: finalUrl }];

        if (isCancelled()) return;

        setQualityPickerData({
          episode: epNum,
          loading: false,
          variants,
          onSelect: async (chosenVariant) => {
            setQualityPickerData(null);
            showToast?.(`Starting download for Ep ${epNum}...`);
            try {
              let mediaPlaylistContent = '';
              try {
                mediaPlaylistContent = await fetchM3U8Playlist(chosenVariant.url, referer);
              } catch (_) {}

              await downloadManager.startDownload({
                anime,
                episode: epNum,
                streamUrl: chosenVariant.url,
                referer,
                subtitles: srv.subtitles || [],
                audioTrack: downloadAudioTrack,
                quality: chosenVariant.label,
                isHls: true,
                playlistContent: mediaPlaylistContent || '',
                onProgress: (p) => {
                  setDownloadProgress(prev => ({ ...prev, [taskId]: p, [epKey]: p }));
                },
              });
              showToast?.(`Episode ${epNum} download queued!`);
            } catch (err) {
              console.error('[DownloadManager] Error:', err);
              showToast?.(`Download failed: ${err.message}`);
            }
          },
          onCancel: () => cancelActiveDownload(),
        });
        return;
      } catch (err) {
        lastError = err;
      }
    }

    if (!isCancelled()) {
      setQualityPickerData(null);
      showToast?.(`Failed to start download: ${lastError?.message || 'Unknown error'}`);
    }
  }, [anime, downloadAudioTrack, showToast, cancelActiveDownload]);

  return {
    downloadModalOpen,
    setDownloadModalOpen,
    downloadProgress,
    downloadAudioTrack,
    setDownloadAudioTrack,
    downloadedSet,
    serverPickerData,
    setServerPickerData,
    qualityPickerData,
    handleDownloadClick,
    startDownload,
    cancelActiveDownload,
  };
}
