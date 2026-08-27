import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getAniNekoServers, getCachedServers, resolvePlaceholderServer, prefetchNextEpisode } from '../api/stream';
import { scrapeEmbedNative, scrapeEmbedDirectly } from '../api/embedScraper';
import { enrichDubSubtitles, buildAllSubtitleTracks } from '../utils/animeStreamUtils';

export function useAnimeStream({
  anime,
  epParam,
  playParam,
  settings,
  showToast,
  totalEps,
}) {
  const [servers, setServers] = useState([]);
  const [allSubtitleTracks, setAllSubtitleTracks] = useState([]);
  const [activeUrl, setActiveUrl] = useState('');
  const [activeName, setActiveName] = useState('');
  const [activeType, setActiveType] = useState('sub');
  const [audioTrack, setAudioTrack] = useState(() => localStorage.getItem('anilab_preferred_track') || 'sub');
  const [loadStream, setLoadStream] = useState(false);
  const [streamErr, setStreamErr] = useState(null);
  const [isActiveHLS, setIsActiveHLS] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [activeServer, setActiveServer] = useState(null);

  const resolvedEmbedCacheRef = useRef(new Map());
  const activeUrlRef = useRef('');
  const lastFetchedRef = useRef(null);
  const prefetchTimerRef = useRef(null);
  // Ref mirror of servers state — lets selectServer/fetchStream access latest servers
  // without those functions being in a re-render loop (servers → callback → useEffect → servers)
  const serversRef = useRef([]);
  const audioTrackRef = useRef(audioTrack);

  // Keep refs in sync with state
  useEffect(() => { serversRef.current = servers; }, [servers]);
  useEffect(() => { audioTrackRef.current = audioTrack; }, [audioTrack]);

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');

  // selectServer: reads serversRef.current as fallback — stable callback, no array dep
  const selectServer = useCallback(async (srv, srvList) => {
    if (!srv) return;
    setActiveServer(srv);
    setActiveName(srv.name || '');
    setActiveType(srv.type || 'sub');
    if (srv.type && srv.type !== audioTrackRef.current) {
      setAudioTrack(srv.type);
      audioTrackRef.current = srv.type;
    }
    setStreamErr(null);
    setExtracting(false);

    const listToUse = srvList || serversRef.current || [];
    const sameTypeServers = srv.type === 'dub'
      ? listToUse.filter(s => s.type === 'dub')
      : listToUse.filter(s => s.type === 'sub');

    const currentIndex = sameTypeServers.findIndex(s => s.name === srv.name && s.type === srv.type);

    const handleScrapeError = () => {
      if (currentIndex !== -1 && currentIndex < sameTypeServers.length - 1) {
        const nextSrv = sameTypeServers[currentIndex + 1];
        selectServer(nextSrv, listToUse);
      } else {
        const otherType = listToUse.find(s => s.name !== srv.name);
        if (otherType) {
          selectServer(otherType, listToUse);
        } else {
          setStreamErr('Unable to load stream. Please tap retry or select another server.');
        }
      }
    };

    // Placeholder server
    const isPlaceholder = srv.videoUrl && srv.videoUrl.includes('proxy/placeholder');
    if (isPlaceholder) {
      setExtracting(true);
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      try {
        const resolved = await resolvePlaceholderServer(anime, epParam, srv.name, srv.type || 'sub');
        setExtracting(false);
        const updatedList = listToUse.map(s => {
          if (s.name === srv.name && s.type === srv.type) {
            return { ...s, ...resolved };
          }
          return s;
        });
        setServers(updatedList);
        serversRef.current = updatedList;
        selectServer({ ...srv, ...resolved }, updatedList);
        return;
      } catch (err) {
        setExtracting(false);
        handleScrapeError();
        return;
      }
    }

    // Embed server
    const isEmbedServer = !srv.isHLS && srv.embedUrl;
    if (isEmbedServer) {
      const embedUrl = srv.embedUrl;
      const referer = srv.referer || 'https://aniwaves.ru/';
      const isIframeServer = Boolean(srv.isIframe);

      if (Capacitor.isNativePlatform()) {
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);

        const embedCacheKey = (embedUrl || '').split('?')[0];
        const cached = resolvedEmbedCacheRef.current.get(embedCacheKey);
        if (cached && Date.now() - cached.timestamp < 90 * 60 * 1000) {
          setActiveUrl(cached.videoUrl);
          activeUrlRef.current = cached.videoUrl;
          setIsActiveHLS(cached.isHLS);
          setExtracting(false);
          return;
        }

        setActiveUrl('');
        activeUrlRef.current = '';
        setExtracting(true);

        try {
          const directM3u8 = await scrapeEmbedDirectly(embedUrl, referer);
          if (directM3u8) {
            resolvedEmbedCacheRef.current.set(embedCacheKey, { videoUrl: directM3u8, isHLS: true, timestamp: Date.now() });
            setActiveServer({ ...srv, videoUrl: directM3u8, isHLS: true });
            setExtracting(false);
            setActiveUrl(directM3u8);
            activeUrlRef.current = directM3u8;
            setIsActiveHLS(true);
            return;
          }

          const m3u8Url = await scrapeEmbedNative(embedUrl, referer, isIframeServer ? 22000 : 15000);
          resolvedEmbedCacheRef.current.set(embedCacheKey, { videoUrl: m3u8Url, isHLS: true, timestamp: Date.now() });
          setActiveServer({ ...srv, videoUrl: m3u8Url, isHLS: true });
          setExtracting(false);
          setActiveUrl(m3u8Url);
          activeUrlRef.current = m3u8Url;
          setIsActiveHLS(true);
        } catch (err) {
          setExtracting(false);
          activeUrlRef.current = '';
          if (isIframeServer) {
            setActiveServer(srv);
            setActiveUrl(embedUrl);
            activeUrlRef.current = embedUrl;
            setIsActiveHLS(false);
          } else {
            handleScrapeError();
          }
        }
      } else {
        setActiveServer(srv);
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setActiveUrl(srv.embedUrl);
        activeUrlRef.current = srv.embedUrl;
        setIsActiveHLS(false);
      }
      return;
    }

    // Direct HLS / MP4 server
    if (srv.videoUrl) {
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setActiveUrl(srv.videoUrl);
      activeUrlRef.current = srv.videoUrl;
      setIsActiveHLS(Boolean(srv.isHLS));
    }
  }, [anime, epParam]); // ← no 'servers' dep — uses serversRef.current instead

  const fetchStream = useCallback(async () => {
    if (!anime || !epParam) return;
    const fetchKey = `${anime.id}_${epParam}`;

    // Dedup guard: only skip if we already fetched THIS episode AND have a URL.
    // If URL is empty (e.g. autoplay cleared it), fall through to re-select.
    if (lastFetchedRef.current === fetchKey && serversRef.current.length > 0 && activeUrlRef.current) return;

    // Fast-path: servers already in memory (e.g. prefetched) but URL is empty.
    // Skip the network call and jump straight to server selection.
    if (lastFetchedRef.current === fetchKey && serversRef.current.length > 0 && !activeUrlRef.current) {
      const track = audioTrackRef.current || 'sub';
      const trackServers = serversRef.current.filter(s => s.type === track);
      const chosen = trackServers.length > 0 ? trackServers[0] : serversRef.current[0];
      if (chosen) {
        setLoadStream(true);
        await selectServer(chosen, serversRef.current);
        setLoadStream(false);
      }
      return;
    }

    lastFetchedRef.current = fetchKey;
    setStreamErr(null);
    setLoadStream(true);
    // NOTE: we intentionally do NOT clear activeUrl/servers here.
    // Keeping the old URL alive means AniPlayer stays mounted during the episode
    // transition → no orientation reset, no blocked touch events.
    // AniPlayer will automatically reinit its HLS when it receives the new url prop.

    try {
      const cached = getCachedServers(anime, epParam);
      let srvList = cached?.servers || [];

      if (!srvList.length) {
        const res = await getAniNekoServers(anime, epParam, null, false);
        srvList = res?.servers || [];
      }

      if (!srvList.length) {
        setStreamErr('No streaming servers available for this episode.');
        setLoadStream(false);
        return;
      }

      const enriched = enrichDubSubtitles(srvList);
      setServers(enriched);
      serversRef.current = enriched;

      const allTracks = buildAllSubtitleTracks(enriched);
      setAllSubtitleTracks(allTracks);

      const track = audioTrackRef.current || 'sub';
      const trackServers = enriched.filter(s => s.type === track);
      const chosen = trackServers.length > 0 ? trackServers[0] : enriched[0];
      if (chosen && chosen.type && chosen.type !== audioTrackRef.current) {
        setAudioTrack(chosen.type);
        audioTrackRef.current = chosen.type;
      }

      await selectServer(chosen, enriched);

      // Schedule silent next-episode prefetch 30s into playback
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = setTimeout(() => {
        prefetchNextEpisode(anime, epParam, totalEps);
      }, 30000);
    } catch (err) {
      console.error('[useAnimeStream] Error:', err);
      setStreamErr('Failed to load video stream. Tap retry.');
    } finally {
      setLoadStream(false);
    }
  }, [anime, epParam, selectServer]); // ← no 'servers' or 'audioTrack' dep — uses refs

  useEffect(() => {
    if (playParam && epParam && anime) {
      fetchStream();
    }
    // Cancel any in-flight prefetch timer when episode changes
    return () => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, [playParam, epParam, anime, fetchStream]);

  return {
    servers,
    subServers,
    dubServers,
    activeServer,
    activeUrl,
    setActiveUrl,
    activeName,
    activeType,
    audioTrack,
    setAudioTrack,
    loadStream,
    extracting,
    streamErr,
    isActiveHLS,
    setIsActiveHLS,
    allSubtitleTracks,
    selectServer,
    fetchStream,
  };
}
