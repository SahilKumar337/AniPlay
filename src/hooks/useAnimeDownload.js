import { useState, useRef, useCallback, useEffect } from 'react';
import { getAniNekoServers, resolvePlaceholderServer, resolveSingleServer } from '../api/stream';
import { scrapeEmbedNative, scrapeEmbedDirectly } from '../api/embedScraper';
import { downloadManager } from '../utils/DownloadManager';
import { isDownloadable, enrichDubSubtitles, parseMasterPlaylistQualities, validateM3U8 } from '../utils/animeStreamUtils';
import { ensureStoragePermission } from '../api/permissions';
import adEngine from '../services/adEngine';

const isDirectStreamUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('/api/proxy') || lower.includes('/api/proxy?') || lower.includes('/api/stream/proxy?')) return false;
  if (lower.includes('/e/') || lower.includes('/embed/') || lower.includes('/player/') || lower.includes('vidplay.online/e/')) return false;
  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.php')) return false;
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('.mkv') || lower.includes('.webm') || lower.includes('/stream/') || lower.includes('/hls/') || lower.includes('master') || lower.includes('manifest');
};

export function useAnimeDownload(anime, showToast) {
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [downloadAudioTrack, setDownloadAudioTrackState] = useState(() => localStorage.getItem('anilab_preferred_track') || 'sub');

  const setDownloadAudioTrack = useCallback((track) => {
    try {
      localStorage.setItem('anilab_preferred_track', track);
    } catch (_) {}
    setDownloadAudioTrackState(track);
  }, []);

  const [serverPickerData, setServerPickerData] = useState(null);
  const [qualityPickerData, setQualityPickerData] = useState(null);
  const [downloadVideoAd, setDownloadVideoAd] = useState(null);

  const [downloadedSet, setDownloadedSet] = useState(() => {
    const raw = downloadManager.getDownloadsList?.();
    const list = Array.isArray(raw) ? raw : [];
    const set = new Set();
    list.forEach(item => {
      if (item && item.status === 'completed' && String(item.animeId) === String(anime?.id)) {
        const trk = item.track || 'sub';
        set.add(`${item.episode}_${trk}`);
        set.add(`${item.animeId}_${item.episode}_${trk}`);
      }
    });
    return set;
  });

  const [failedSet, setFailedSet] = useState(() => {
    const raw = downloadManager.getDownloadsList?.();
    const list = Array.isArray(raw) ? raw : [];
    const set = new Set();
    list.forEach(item => {
      if (item && item.status === 'error' && String(item.animeId) === String(anime?.id)) {
        set.add(`${item.episode}_${item.track || 'sub'}`);
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
      const nextFailed = new Set();
      const finishedKeys = new Set();
      list.forEach(item => {
        if (item && String(item.animeId) === String(anime?.id)) {
          const trk = item.track || 'sub';
          const key = `${item.episode}_${trk}`;
          const taskKey = `${item.animeId}_${item.episode}_${trk}`;
          if (item.status === 'completed') {
            next.add(key);
            next.add(taskKey);
            finishedKeys.add(key);
            finishedKeys.add(taskKey);
          } else if (item.status === 'error' || item.status === 'failed') {
            nextFailed.add(key);
            nextFailed.add(taskKey);
            finishedKeys.add(key);
            finishedKeys.add(taskKey);
          }
        }
      });
      setDownloadedSet(next);
      setFailedSet(nextFailed);

      if (finishedKeys.size > 0) {
        setDownloadProgress(prev => {
          let changed = false;
          const updated = { ...prev };
          for (const k of finishedKeys) {
            if (k in updated) {
              delete updated[k];
              changed = true;
            }
          }
          return changed ? updated : prev;
        });
      }
    };

    syncDownloads();
    const unsub = downloadManager.subscribe(() => {
      syncDownloads();
    });
    return unsub;
  }, [anime?.id]);

  const downloadCancelledRef = useRef(false);
  const qualityPickerShownRef = useRef(false);
  const abortControllerRef = useRef(null);

  const cancelActiveDownload = useCallback((epNum = null) => {
    downloadCancelledRef.current = true;
    qualityPickerShownRef.current = false;
    if (abortControllerRef.current) {
      try { abortControllerRef.current.abort(); } catch (_) {}
      abortControllerRef.current = null;
    }
    setQualityPickerData(null);
    setDownloadVideoAd(null);
    // Clear any 0% ghost progress entry so the ep doesn't appear as "downloading"
    if (anime?.id) {
      const clearKeys = epNum
        ? [
            `${anime.id}_${epNum}_sub`, `${epNum}_sub`,
            `${anime.id}_${epNum}_dub`, `${epNum}_dub`
          ]
        : [];
      if (clearKeys.length) {
        setDownloadProgress(prev => {
          const next = { ...prev };
          let changed = false;
          for (const k of clearKeys) {
            if (k in next) { delete next[k]; changed = true; }
          }
          return changed ? next : prev;
        });
      }
    }
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
    abortControllerRef.current = new AbortController();
    const isCancelled = () => downloadCancelledRef.current || abortControllerRef.current?.signal?.aborted;

    setQualityPickerData({
      episode: epNum,
      loading: true,
      variants: [],
      onSelect: () => {},
      onCancel: (ep) => cancelActiveDownload(ep ?? epNum),
    });
    qualityPickerShownRef.current = true;

    const chosenTrack = selectedServer?.type || downloadAudioTrack || 'sub';
    const taskId = `${anime.id}_${epNum}_${chosenTrack}`;
    const epKey = `${epNum}_${chosenTrack}`;

    // Clear failed state immediately when starting fresh attempt
    setFailedSet(prev => {
      if (!prev.has(epKey) && !prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(epKey);
      next.delete(taskId);
      return next;
    });

    const serverQueue = [
      selectedServer,
      ...(allServers || []).filter(s => isDownloadable(s) && s.name !== selectedServer.name && s.type === (selectedServer.type || 'sub'))
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
          setQualityPickerData({ episode: epNum, loading: true, variants: [], onSelect: () => {}, onCancel: (ep) => cancelActiveDownload(ep ?? epNum) });
          qualityPickerShownRef.current = true;
        }
        if (isCancelled()) {
          setQualityPickerData(null);
          return;
        }

        let finalUrl = srv.videoUrl;
        let referer = srv.referer || '';
        let subtitles = srv.subtitles || [];

        // 1. If server is not yet resolved to direct .m3u8/.mp4 stream, resolve on-demand
        if (!finalUrl || (!finalUrl.includes('.m3u8') && !finalUrl.includes('.mp4')) || !srv.isHLS) {
          try {
            const resolved = await resolveSingleServer(srv, anime, epNum);
            if (resolved?.videoUrl && (resolved.videoUrl.includes('.m3u8') || resolved.videoUrl.includes('.mp4'))) {
              finalUrl = resolved.videoUrl;
              referer = resolved.referer || referer;
              if (resolved.subtitles?.length) subtitles = resolved.subtitles;
            }
          } catch (e) {
            console.warn(`[Download] resolveSingleServer error for ${srv.name}:`, e.message);
          }
        }

        if (srv.isPlaceholder && (!finalUrl || !finalUrl.includes('.m3u8'))) {
          const resolved = await resolvePlaceholderServer(anime, epNum, srv.name, srv.type);
          if (resolved) {
            finalUrl = resolved.videoUrl;
            referer = resolved.referer || referer;
            if (resolved.subtitles?.length) subtitles = resolved.subtitles;
          }
        }

        // If videoUrl is not a direct .m3u8, scrape the embed to extract direct stream & subs
        if ((!finalUrl || !finalUrl.includes('.m3u8')) && srv.embedUrl) {
          let embedOrigin = referer;
          try {
            if (srv.embedUrl) embedOrigin = new URL(srv.embedUrl).origin + '/';
          } catch (_) {}

          try {
            const direct = await scrapeEmbedDirectly(srv.embedUrl, embedOrigin);
            if (direct) {
              const dUrl = typeof direct === 'object' ? (direct.streamUrl || direct.videoUrl || direct.url) : direct;
              if (dUrl) finalUrl = dUrl;
              if (direct.referer) referer = direct.referer;
              if (Array.isArray(direct.subtitles) && direct.subtitles.length > 0) subtitles = direct.subtitles;
            }
          } catch (_) {}

          if (!finalUrl || !finalUrl.includes('.m3u8')) {
            try {
              const scraped = await scrapeEmbedNative(srv.embedUrl, embedOrigin);
              if (scraped) {
                const sUrl = typeof scraped === 'object' ? (scraped.streamUrl || scraped.videoUrl || scraped.url) : scraped;
                if (sUrl) finalUrl = sUrl;
                if (scraped.referer) referer = scraped.referer;
                if (Array.isArray(scraped.subtitles) && scraped.subtitles.length > 0) subtitles = scraped.subtitles;
              }
            } catch (_) {}
          }
        }

        if (!finalUrl || !isDirectStreamUrl(finalUrl)) {
          console.warn(`[Download] Server ${srv.name} did not yield a direct stream URL (got: ${finalUrl ? finalUrl.slice(0, 60) : 'none'}). Failing over to next server...`);
          lastError = new Error(`Server ${srv.name} returned non-stream URL`);
          continue;
        }

        // Ensure referer has trailing slash and matches CDN expectations
        if (srv.embedUrl && (srv.embedUrl.includes('otakuhg') || srv.name?.toLowerCase().includes('streamhg'))) {
          referer = 'https://otakuhg.site/';
        } else if (srv.embedUrl && (srv.embedUrl.includes('otakuvid') || srv.name?.toLowerCase().includes('earnvids'))) {
          referer = 'https://otakuvid.online/';
        } else if (srv.embedUrl && (srv.embedUrl.includes('megaplay') || srv.embedUrl.includes('megacloud') || srv.name?.toLowerCase().includes('anihd') || srv.name?.toLowerCase().includes('neko'))) {
          referer = 'https://megaplay.buzz/';
        } else if (srv.embedUrl && srv.embedUrl.includes('bibiemb')) {
          referer = 'https://bibiemb.xyz/';
        } else if (srv.embedUrl && srv.embedUrl.includes('anineko')) {
          referer = 'https://megaplay.buzz/';
        } else if (!referer && srv.embedUrl) {
          try { referer = new URL(srv.embedUrl).origin + '/'; } catch (_) {}
        } else if (referer) {
          try { referer = new URL(referer).origin + '/'; } catch (_) {}
        }

        // Parse master playlist qualities (1080p, 720p, 480p, 360p)
        // This tells us if the URL is a PROPER master playlist (with sub-stream entries)
        // or just a single-quality HLS URL.
        let qualities = [];
        let masterParseAttempted = false;
        try {
          masterParseAttempted = true;
          qualities = await parseMasterPlaylistQualities(finalUrl, null, referer);
        } catch (_) {}

        // ── Neko-HD-2 / bibiemb workaround ────────────────────────────────
        // parseMasterPlaylistQualities may return [] if the bibiemb CDN rejects
        // the fetch from our proxy. Try again with the correct referer directly.
        if (qualities.length === 0 && masterParseAttempted && finalUrl.includes('.m3u8')) {
          // Try fetching with the known referer for this CDN
          const knownReferer = srv.embedUrl?.includes('bibiemb')
            ? 'https://bibiemb.xyz/'
            : (referer || '');
          try {
            qualities = await parseMasterPlaylistQualities(finalUrl, null, knownReferer);
          } catch (_) {}
        }

        if (isCancelled()) return;

        let variants;
        if (qualities.length > 0) {
          // Successfully parsed: show actual quality choices
          variants = qualities.map(q => ({ label: q.name, url: q.url }));
        } else if (finalUrl.includes('.m3u8')) {
          // m3u8 but we couldn't parse sub-qualities — it could be:
          //   a) A master playlist our fetcher can't reach (auth/CORS) — Java CAN handle it
          //      because Java uses OkHttp with the correct headers
          //   b) A media playlist (already single quality) — Java downloads it directly
          // Either way: pass it to Java with isHls=true. Java resolves master→media internally.
          // Label it "HD (Auto)" to distinguish from broken 'Default HD'.
          variants = [{ label: 'HD (Auto)', url: finalUrl }];
        } else {
          // Non-HLS direct video (mp4, mkv, etc.)
          variants = [{ label: 'Default HD', url: finalUrl }];
        }

        setQualityPickerData({
          episode: epNum,
          loading: false,
          variants,
          onSelect: async (chosenVariant) => {
            if (isCancelled()) return;
            setQualityPickerData(null);

            const beginDownload = async () => {
              setDownloadProgress(prev => ({ ...prev, [taskId]: 0, [epKey]: 0 }));
              showToast?.(`Starting download for Ep ${epNum}...`);
              try {
                // IMPORTANT: Do NOT pre-fetch the media playlist here.
                // Segment URLs inside HLS playlists contain short-lived CDN tokens (~5-15min expiry).
                // If we pre-fetch and pass it to Java, the tokens expire before segments are downloaded,
                // causing every segment request to get 403 → all retries fail → progress resets to 0%.
                // Java always fetches the playlist fresh right before downloading segments.
                const isHls = !chosenVariant.url.toLowerCase().includes('.mp4') && !chosenVariant.url.toLowerCase().includes('.mkv');
                await downloadManager.startDownload({
                  anime,
                  episode: epNum,
                  streamUrl: chosenVariant.url,
                  referer,
                  subtitles: subtitles.length > 0 ? subtitles : (srv.subtitles || []),
                  audioTrack: chosenTrack,
                  quality: chosenVariant.label,
                  isHls,
                  playlistContent: '', // Always empty — Java fetches the playlist fresh
                  onProgress: (p, status) => {
                    if (status === 'completed' || status === 'error' || status === 'failed') {
                      setDownloadProgress(prev => {
                        if (!(taskId in prev) && !(epKey in prev)) return prev;
                        const next = { ...prev };
                        delete next[taskId];
                        delete next[epKey];
                        return next;
                      });
                    } else {
                      setDownloadProgress(prev => ({ ...prev, [taskId]: p, [epKey]: p }));
                    }
                  },
                });
                showToast?.(`Episode ${epNum} download queued!`);
              } catch (err) {
                console.error('[DownloadManager] Error:', err);
                showToast?.(`Download failed: ${err.message}`);
              }
            };

            // Play in-stream video ad before queuing download (same as playing anime)
            if (adEngine.isAdsEnabled() && adEngine.shouldShowVideoAd()) {
              const videoAd = adEngine.getRandomVideoAd();
              if (videoAd) {
                adEngine.markVideoAdShown();
                setDownloadVideoAd({
                  ad: videoAd,
                  onComplete: () => {
                    setDownloadVideoAd(null);
                    beginDownload();
                  },
                });
                return;
              }
            }

            beginDownload();
          },
          onCancel: (ep) => cancelActiveDownload(ep ?? epNum),
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
    failedSet,
    serverPickerData,
    setServerPickerData,
    qualityPickerData,
    setQualityPickerData,
    downloadVideoAd,
    setDownloadVideoAd,
    handleDownloadClick,
    startDownload,
    cancelActiveDownload,
  };
}
