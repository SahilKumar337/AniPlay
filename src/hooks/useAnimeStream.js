import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getAniNekoServers, getCachedServers, resolvePlaceholderServer, prefetchNextEpisode, getServerSortPriority, resolveSingleServer, isDirectStreamUrl, getEpisodeSubtitles, saveEpisodeSubtitles, checkIsAdultAnime } from '../api/stream';
import { scrapeEmbedNative, scrapeEmbedDirectly } from '../api/embedScraper';
import { enrichDubSubtitles, buildAllSubtitleTracks, sortServers, getAiredEpisodeCount } from '../utils/animeStreamUtils';

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
  const currentPriorityRef = useRef(999);
  // Ref mirror of servers state — lets selectServer/fetchStream access latest servers
  // without those functions being in a re-render loop (servers → callback → useEffect → servers)
  const serversRef = useRef([]);
  const audioTrackRef = useRef(audioTrack);
  const userSelectedServerRef = useRef(false);
  const userSelectedTrackRef = useRef(false);
  const inFlightServerRef = useRef(null);
  const inFlightSubSubsRef = useRef(null);
  const isScrapingRef = useRef(false);
  const fetchStartTimeRef = useRef(Date.now());

  // Keep refs in sync with state
  useEffect(() => { serversRef.current = servers; }, [servers]);
  useEffect(() => { audioTrackRef.current = audioTrack; }, [audioTrack]);

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');

  // Resolves SUB server in background when watching DUB to share rich dialogue subtitles
  const resolveSubSubtitlesForDub = useCallback(async (currentAnime, currentEp) => {
    if (!currentAnime || !currentEp) return;
    const animeId = currentAnime?.id || currentAnime?.idMal || currentAnime?.title?.romaji || 'anime';
    const fetchKey = `${animeId}_${currentEp}`;

    // 1. Check if we already have episode subtitles in persistent cache
    const cachedSubs = getEpisodeSubtitles(animeId, currentEp);
    if (cachedSubs && cachedSubs.length > 0) {
      const enriched = enrichDubSubtitles(serversRef.current, cachedSubs);
      setServers(enriched);
      serversRef.current = enriched;
      const tracks = buildAllSubtitleTracks(enriched);
      setAllSubtitleTracks(tracks);
      setActiveServer(prev => {
        if (!prev) return prev;
        const currentSubs = prev.subtitles || [];
        const seenUrls = new Set(currentSubs.map(s => s.file || s.url));
        const combined = [...currentSubs];
        for (const cs of cachedSubs) {
          const f = cs.file || cs.url;
          if (f && !seenUrls.has(f)) {
            seenUrls.add(f);
            combined.push(cs);
          }
        }
        return { ...prev, subtitles: combined };
      });
      return;
    }

    if (inFlightSubSubsRef.current === fetchKey) return;
    inFlightSubSubsRef.current = fetchKey;

    try {
      // Find candidate SUB servers to extract dialogue subtitles from
      const subList = (serversRef.current || []).filter(s => {
        const type = s.type || 'sub';
        const name = (s.name || '').toLowerCase();
        return type === 'sub' && !name.includes('hardsub') && !name.includes('hard') && !name.includes('waves');
      });

      if (!subList.length) return;

      // Prioritize Vidstream > HD-1 > HD-2 > MegaPlay > others
      const sortedSubs = [...subList].sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name));
      const targetSub = sortedSubs[0];

      console.log(`[useAnimeStream] Resolving sub server "${targetSub.name}" in background to share subtitles with DUB...`);
      const resolved = await resolveSingleServer(targetSub, currentAnime, currentEp);

      if (lastFetchedRef.current !== `${currentAnime.id}_${currentEp}`) return;

      if (resolved?.subtitles && resolved.subtitles.length > 0) {
        saveEpisodeSubtitles(animeId, currentEp, resolved.subtitles);
        const updatedList = serversRef.current.map(s => {
          if (s.name === targetSub.name && (s.type || 'sub') === 'sub') {
            return { ...s, ...resolved };
          }
          return s;
        });
        const enriched = enrichDubSubtitles(updatedList, resolved.subtitles);
        setServers(enriched);
        serversRef.current = enriched;
        const tracks = buildAllSubtitleTracks(enriched);
        setAllSubtitleTracks(tracks);

        // Inject into currently active playing server so AniPlayer immediately gets the subtitles!
        setActiveServer(prev => {
          if (!prev) return prev;
          const currentSubs = prev.subtitles || [];
          const seenUrls = new Set(currentSubs.map(s => s.file || s.url));
          const combined = [...currentSubs];
          for (const rs of resolved.subtitles) {
            const f = rs.file || rs.url;
            if (f && !seenUrls.has(f)) {
              seenUrls.add(f);
              combined.push(rs);
            }
          }
          return { ...prev, subtitles: combined };
        });
        console.log(`[useAnimeStream] Successfully shared ${resolved.subtitles.length} sub subtitles with DUB!`);
      }
    } catch (e) {
      console.warn('[useAnimeStream] Failed background sub subtitle resolution:', e.message);
    } finally {
      inFlightSubSubsRef.current = null;
    }
  }, []);

  // selectServer: reads serversRef.current as fallback — stable callback, no array dep
  const selectServer = useCallback(async (srv, srvList, isManual = false) => {
    if (!srv) return;
    if (isManual) {
      userSelectedServerRef.current = true;
      userSelectedTrackRef.current = true;
    }
    inFlightServerRef.current = `${srv.name}_${srv.type || 'sub'}`;
    currentPriorityRef.current = getServerSortPriority(srv.name);
    setActiveServer(srv);
    setActiveName(srv.name || '');
    setActiveType(srv.type || 'sub');
    if (srv.type && srv.type !== audioTrackRef.current) {
      setAudioTrack(srv.type);
      audioTrackRef.current = srv.type;
    }
    setStreamErr(null);
    setExtracting(false);

    const isDub = srv.type === 'dub' || (srv.name || '').toLowerCase().includes('dub');
    if (isDub) {
      resolveSubSubtitlesForDub(anime, epParam);
    }

    const listToUse = (srvList && srvList.length > 0) ? srvList : (serversRef.current || []);

    const handleScrapeError = () => {
      setExtracting(false);
      setLoadStream(false);
      inFlightServerRef.current = null;
      setStreamErr(`Unable to load stream for "${srv.name}". Please tap retry or select another server.`);
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

    // Unresolved / embed server — lazy resolution on demand
    const isUnresolved = !srv.isHLS || !isDirectStreamUrl(srv.videoUrl);
    if (isUnresolved) {
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setExtracting(true);
      // Keep existing activeUrl during extraction so AniPlayer stays mounted with loading overlay,
      // preventing orientation flicker and preserving playback position across server switches.

      try {
        // Directly resolve the selected server with in-flight deduplication
        const resolved = await resolveSingleServer(srv, anime, epParam);

        setExtracting(false);

        if (resolved?.videoUrl && isDirectStreamUrl(resolved.videoUrl)) {
          const finalSubs = (resolved.subtitles && resolved.subtitles.length > 0) ? resolved.subtitles : (srv.subtitles || []);
          const updatedSrv = { ...srv, ...resolved, isHLS: true, subtitles: finalSubs };

          setActiveServer(updatedSrv);
          setActiveName(srv.name);
          setActiveType(srv.type || 'sub');
          currentPriorityRef.current = getServerSortPriority(srv.name);
          setActiveUrl(resolved.videoUrl);
          activeUrlRef.current = resolved.videoUrl;
          setIsActiveHLS(true);
          setLoadStream(false);
          setExtracting(false);
          inFlightServerRef.current = null;

          // Always merge into the latest live serversRef so servers discovered in parallel are NEVER wiped out
          const baseList = serversRef.current.length > 0 ? serversRef.current : listToUse;
          const updatedList = baseList.map(s => {
            if (s.name === srv.name && s.type === srv.type) {
              return updatedSrv;
            }
            return s;
          });
          const cachedSubs = getEpisodeSubtitles(anime?.id, epParam);
          const enriched = enrichDubSubtitles(updatedList, cachedSubs);
          setServers(enriched);
          serversRef.current = enriched;
          setAllSubtitleTracks(buildAllSubtitleTracks(enriched));
          if (isDub) {
            resolveSubSubtitlesForDub(anime, epParam);
          }
          return;
        } else {
          console.warn(`[useAnimeStream] Lazy resolution failed for server ${srv.name}`);
          handleScrapeError();
          return;
        }
      } catch (err) {
        console.warn(`[useAnimeStream] Lazy resolution error for ${srv.name}:`, err.message);
        setExtracting(false);
        handleScrapeError();
        return;
      }
    }

    // Direct HLS / MP4 server
    if (srv.videoUrl && isDirectStreamUrl(srv.videoUrl)) {
      setActiveServer(srv);          // ← CRITICAL: provides referer+embedUrl to AniPlayer's HLS loader
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setActiveUrl(srv.videoUrl);
      activeUrlRef.current = srv.videoUrl;
      setIsActiveHLS(Boolean(srv.isHLS));
      setLoadStream(false);
      setExtracting(false);
      inFlightServerRef.current = null;
      if (isDub) {
        resolveSubSubtitlesForDub(anime, epParam);
      }
    } else {
      console.warn(`[useAnimeStream] Server ${srv.name} has non-direct URL (${srv.videoUrl})`);
      handleScrapeError();
    }
  }, [anime, epParam, resolveSubSubtitlesForDub]); // ← stable callback

  const fetchStream = useCallback(async () => {
    if (!anime || !epParam) return;
    const fetchKey = `${anime.id}_${epParam}`;
    const isAdult = checkIsAdultAnime(anime);
    if (isAdult) {
      setStreamErr('Adult (18+) content is currently disabled in the app.');
      setLoadStream(false);
      isScrapingRef.current = false;
      return;
    }

    // ⚡ Unreleased Guard: Prevent scraping anime that has not been released yet!
    const currentYear = new Date().getFullYear();
    const trulyNotReleased = (
      (anime.status === 'NOT_YET_RELEASED' && (!anime.startDate?.year || anime.startDate.year > currentYear)) ||
      (getAiredEpisodeCount(anime) === 0 && !anime.nextAiringEpisode && anime.status !== 'RELEASING' && (!anime.startDate?.year || anime.startDate.year > currentYear))
    );
    if (trulyNotReleased) {
      setStreamErr('This anime has not been released yet.');
      setLoadStream(false);
      isScrapingRef.current = false;
      return;
    }

    // ⚡ Airing Guard: Prevent scraping un-aired future episodes!
    const isAiring = !isAdult && anime.status === 'RELEASING';
    const nextEp = anime.nextAiringEpisode?.episode;
    if (isAiring && nextEp && Number(epParam) >= nextEp) {
      const s = anime.nextAiringEpisode.timeUntilAiring || 0;
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const timeStr = d > 0 ? `${d} day${d > 1 ? 's' : ''} ${h} hr${h > 1 ? 's' : ''}` : (h > 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${m} mins`);
      setStreamErr(`Episode ${epParam} has not aired yet. Airing in ${timeStr}!`);
      setLoadStream(false);
      isScrapingRef.current = false;
      return;
    }

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

    if (lastFetchedRef.current !== fetchKey) {
      userSelectedServerRef.current = false;
      // ⚡ Netflix/YouTube Architecture: Isolate episode playback sessions completely.
      // Purge old episode's servers, activeUrl, and priority so previous episode never leaks into the new one!
      serversRef.current = [];
      setServers([]);
      activeUrlRef.current = '';
      setActiveUrl('');
      setActiveServer(null);
      setActiveName('');
      currentPriorityRef.current = 999;
    }
    lastFetchedRef.current = fetchKey;
    setStreamErr(null);
    setLoadStream(true);
    fetchStartTimeRef.current = Date.now();
    isScrapingRef.current = true;

    try {
      const cached = getCachedServers(anime, epParam);
      let srvList = cached?.servers || [];

      if (srvList.length) {
        // ── Cache hit: instant path ──
        const sorted = sortServers(srvList);
        const cachedSubs = getEpisodeSubtitles(anime?.id, epParam);
        const enriched = enrichDubSubtitles(sorted, cachedSubs);
        setServers(enriched);
        serversRef.current = enriched;
        setAllSubtitleTracks(buildAllSubtitleTracks(enriched));

        const track = audioTrackRef.current || 'sub';
        if (track === 'dub') {
          resolveSubSubtitlesForDub(anime, epParam);
        }

        const trackServers = enriched.filter(s => s.type === track);
        let chosen = trackServers.length > 0 ? trackServers[0] : null;
        if (!chosen && enriched.length > 0) {
          chosen = enriched[0];
        }
        if (chosen) {
          if (chosen.type && chosen.type !== audioTrackRef.current) {
            setAudioTrack(chosen.type);
            audioTrackRef.current = chosen.type;
          }
          await selectServer(chosen, enriched, false);
        }
      } else {
        // ── Cold path: eager server selection ──
        // Pass onServersFound callback so the FIRST scraper to return
        // triggers immediate server selection + embed extraction,
        // while remaining scrapers continue in the background.
        let eagerSelectionDone = false;

        const onServersFound = (partialServers) => {
          if (!partialServers?.length) return;
          // ⚡ Sequence guard: Discard stale servers if user has already switched episodes
          if (lastFetchedRef.current !== fetchKey) return;
          // Merge incoming partial servers with any already discovered servers FOR THIS EPISODE
          const existing = serversRef.current || [];
          const merged = [...existing];
          partialServers.forEach(ps => {
            const idx = merged.findIndex(x => x.name === ps.name && x.type === ps.type);
            if (idx === -1) {
              merged.push(ps);
            } else if (ps.isHLS && isDirectStreamUrl(ps.videoUrl) && !merged[idx].isHLS) {
              merged[idx] = { ...merged[idx], ...ps };
            }
          });
          const sorted = sortServers(merged);
          const cachedSubs = getEpisodeSubtitles(anime?.id, epParam);
          const enriched = enrichDubSubtitles(sorted, cachedSubs);
          setServers(enriched);
          serversRef.current = enriched;
          setAllSubtitleTracks(buildAllSubtitleTracks(enriched));
          setLoadStream(false);

          if (audioTrackRef.current === 'dub') {
            resolveSubSubtitlesForDub(anime, epParam);
          }

          // If user has manually picked a server, NEVER override their choice!
          if (userSelectedServerRef.current) return;

          // Strictly respect the active audio track — NEVER auto-switch between sub and dub!
          const track = audioTrackRef.current || 'sub';
          let trackServers = enriched.filter(s => s.type === track);
          if (!trackServers.length && isAdult) {
            // Adult anime exclusively features Japanese audio with English subtitles.
            // If user previously had DUB selected, fallback to available SUB servers immediately.
            trackServers = enriched;
          }
          if (!trackServers.length) {
            // No servers for current track arrived yet from this scraper — wait for others
            return;
          }
          const topServer = trackServers[0];
          const topName = (topServer.name || '').toLowerCase();
          const isVidstream = topName.includes('vidstream');

          // Eager start: if nothing has been selected yet, start with ANY available server
          // (including Waves). We no longer block on Waves — get video playing ASAP!
          if (!eagerSelectionDone && !userSelectedServerRef.current) {
            eagerSelectionDone = true;
            selectServer(topServer, enriched, false).catch(() => {});
          } else if (!userSelectedServerRef.current && isVidstream) {
            // If a lower-priority server (e.g. Waves) was eagerly selected before Vidstream arrived,
            // automatically upgrade to Vidstream (user's preferred default server)!
            if (!activeUrlRef.current || currentPriorityRef.current > 1.2) {
              console.log('[useAnimeStream] Upgrading to preferred default server: Vidstream');
              selectServer(topServer, enriched, false).catch(() => {});
            }
          }
        };

        const res = await getAniNekoServers(anime, epParam, onServersFound, false);
        // ⚡ Sequence guard: Discard result if user navigated to a different episode while scraping
        if (lastFetchedRef.current !== fetchKey) return;
        srvList = res?.servers || [];

        if (!srvList.length && serversRef.current.length === 0) {
          const elapsed = Date.now() - fetchStartTimeRef.current;
          const remainingWait = Math.max(0, 10000 - elapsed);
          setTimeout(() => {
            if (!activeUrlRef.current && serversRef.current.length === 0) {
              setStreamErr('No streaming servers available for this episode.');
            }
          }, remainingWait);
          return;
        }

        // After ALL scrapers finish: combine srvList with any servers in serversRef.current
        const allKnown = [...srvList];
        serversRef.current.forEach(ex => {
          if (!allKnown.some(x => x.name === ex.name && x.type === ex.type)) {
            allKnown.push(ex);
          }
        });
        const sortedFinal = sortServers(allKnown);
        const mergedFinal = sortedFinal.map(s => {
          const existing = serversRef.current.find(x => x.name === s.name && x.type === s.type);
          if (existing?.isHLS) {
            return { ...s, ...existing };
          }
          return s;
        });
        const cachedSubs = getEpisodeSubtitles(anime?.id, epParam);
        const finalEnriched = enrichDubSubtitles(mergedFinal, cachedSubs);
        setServers(finalEnriched);
        serversRef.current = finalEnriched;
        setAllSubtitleTracks(buildAllSubtitleTracks(finalEnriched));

        if (audioTrackRef.current === 'dub') {
          resolveSubSubtitlesForDub(anime, epParam);
        }

        if (!userSelectedServerRef.current && (!activeUrlRef.current || currentPriorityRef.current > 1.2) && !inFlightServerRef.current) {
          const track = audioTrackRef.current || 'sub';
          let trackServers = finalEnriched.filter(s => s.type === track);
          if (!trackServers.length && isAdult) {
            trackServers = finalEnriched;
          }
          let chosen = trackServers.length > 0 ? trackServers[0] : null;
          if (!chosen && finalEnriched.length > 0) {
            chosen = finalEnriched[0];
          }
          if (chosen && chosen.name !== activeName) {
            if (chosen.type && chosen.type !== audioTrackRef.current) {
              setAudioTrack(chosen.type);
              audioTrackRef.current = chosen.type;
            }
            await selectServer(chosen, finalEnriched, false);
          }
        }
      }

      // Schedule silent next-episode prefetch 30s into playback
      // Delayed to avoid competing with active stream loading/buffering (was aggressively 2s)
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = setTimeout(() => {
        prefetchNextEpisode(anime, epParam, totalEps);
      }, 30000);
    } catch (err) {
      console.error('[useAnimeStream] Error:', err);
      if (err?.message && (err.message.includes('ADULT_MODE_DISABLED') || err.message.includes('ADULT_CONTENT_DISABLED'))) {
        setStreamErr('Adult (18+) content is currently disabled in the app.');
        setLoadStream(false);
        isScrapingRef.current = false;
        return;
      }
      const elapsed = Date.now() - fetchStartTimeRef.current;
      const remainingWait = Math.max(0, 10000 - elapsed);
      setTimeout(() => {
        if (!activeUrlRef.current) {
          setStreamErr('Failed to load video stream. Tap retry.');
        }
      }, remainingWait);
    } finally {
      if (lastFetchedRef.current === fetchKey) {
        isScrapingRef.current = false;
        setLoadStream(false);
      }
    }
  }, [anime, epParam, selectServer, resolveSubSubtitlesForDub]); // ← no 'servers' or 'audioTrack' dep — uses refs

  // Retrying clears the cache for this episode and re-runs a clean full scraper pass
  const retryStream = useCallback(() => {
    if (anime && epParam) {
      invalidateStreamCache(anime, epParam);
    }
    lastFetchedRef.current = null;
    fetchStream();
  }, [anime, epParam, fetchStream]);

  // When switching to DUB track, ensure sub dialogue subtitles are fetched & shared
  useEffect(() => {
    if (audioTrack === 'dub' && anime && epParam) {
      resolveSubSubtitlesForDub(anime, epParam);
    }
  }, [audioTrack, anime, epParam, resolveSubSubtitlesForDub]);

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
    retryStream,
  };
}
