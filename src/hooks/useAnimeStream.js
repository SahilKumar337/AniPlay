import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getAniNekoServers, getCachedServers, resolvePlaceholderServer } from '../api/stream';
import { scrapeEmbedNative, scrapeEmbedDirectly } from '../api/embedScraper';
import { enrichDubSubtitles, buildAllSubtitleTracks } from '../utils/animeStreamUtils';

export function useAnimeStream({
  anime,
  epParam,
  playParam,
  settings,
  showToast,
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

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');

  const selectServer = useCallback(async (srv, srvList) => {
    if (!srv) return;
    setActiveServer(srv);
    setActiveName(srv.name || '');
    setActiveType(srv.type || 'sub');
    if (srv.type && srv.type !== audioTrack) {
      setAudioTrack(srv.type);
    }
    setStreamErr(null);
    setExtracting(false);

    const listToUse = srvList || servers || [];
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
  }, [anime, epParam, servers]);

  const fetchStream = useCallback(async () => {
    if (!anime || !epParam) return;
    const fetchKey = `${anime.id}_${epParam}`;
    if (lastFetchedRef.current === fetchKey && servers.length > 0) return;
    lastFetchedRef.current = fetchKey;

    setLoadStream(true);
    setStreamErr(null);

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

      const allTracks = buildAllSubtitleTracks(enriched);
      setAllSubtitleTracks(allTracks);

      const preferredTrack = audioTrack || 'sub';
      const trackServers = enriched.filter(s => s.type === preferredTrack);
      const chosen = trackServers.length > 0 ? trackServers[0] : enriched[0];
      if (chosen && chosen.type && chosen.type !== audioTrack) {
        setAudioTrack(chosen.type);
      }

      await selectServer(chosen, enriched);
    } catch (err) {
      console.error('[useAnimeStream] Error:', err);
      setStreamErr('Failed to load video stream. Tap retry.');
    } finally {
      setLoadStream(false);
    }
  }, [anime, epParam, audioTrack, servers.length, selectServer]);

  useEffect(() => {
    if (playParam && epParam && anime) {
      fetchStream();
    }
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
