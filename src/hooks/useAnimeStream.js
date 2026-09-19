import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getAniNekoServers, getCachedServers, resolvePlaceholderServer, prefetchNextEpisode, getServerSortPriority, resolveSingleServer } from '../api/stream';
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
  const isScrapingRef = useRef(false);
  const fetchStartTimeRef = useRef(Date.now());

  // Keep refs in sync with state
  useEffect(() => { serversRef.current = servers; }, [servers]);
  useEffect(() => { audioTrackRef.current = audioTrack; }, [audioTrack]);

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');

  // selectServer: reads serversRef.current as fallback — stable callback, no array dep
  const selectServer = useCallback(async (srv, srvList, isManual = false) => {
    if (!srv) return;
    if (isManual) {
      userSelectedServerRef.current = true;
      userSelectedTrackRef.current = true;
    }
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

    const listToUse = srvList || serversRef.current || [];
    const sameTypeServers = srv.type === 'dub'
      ? listToUse.filter(s => s.type === 'dub')
      : listToUse.filter(s => s.type === 'sub');

    const currentIndex = sameTypeServers.findIndex(s => s.name === srv.name && s.type === srv.type);

    const handleScrapeError = () => {
      // Re-read latest servers from ref to get all servers discovered so far
      const currentFullList = serversRef.current.length > 0 ? serversRef.current : listToUse;
      const currentTrackServers = srv.type === 'dub'
        ? currentFullList.filter(s => s.type === 'dub')
        : currentFullList.filter(s => s.type === 'sub');

      const currentIdx = currentTrackServers.findIndex(s => s.name === srv.name && s.type === srv.type);

      // If another server candidate exists, automatically failover to it
      if (currentIdx !== -1 && currentIdx < currentTrackServers.length - 1) {
        const nextSrv = currentTrackServers[currentIdx + 1];
        console.log(`[useAnimeStream] Server "${srv.name}" failed, auto-failing over to "${nextSrv.name}"`);
        selectServer(nextSrv, currentFullList, false);
        return;
      }

      // If scrapers are still actively discovering servers in the background, keep waiting!
      if (isScrapingRef.current) {
        console.log('[useAnimeStream] Background scrapers still active, waiting for more servers...');
        return;
      }

      // Professional timeout guard: never show retry button prematurely before 10 seconds of searching
      const elapsed = Date.now() - fetchStartTimeRef.current;
      const remainingWait = Math.max(0, 10000 - elapsed);
      setTimeout(() => {
        if (!activeUrlRef.current) {
          setStreamErr('Unable to load stream. Please tap retry or select another server.');
        }
      }, remainingWait);
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
    const isUnresolved = !srv.isHLS;
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

        if (resolved?.videoUrl && (resolved.isHLS || resolved.videoUrl.startsWith('http'))) {
          const finalSubs = (resolved.subtitles && resolved.subtitles.length > 0) ? resolved.subtitles : (srv.subtitles || []);
          const updatedSrv = { ...srv, ...resolved, isHLS: true, subtitles: finalSubs };

          setActiveServer(updatedSrv);
          setActiveName(srv.name);
          setActiveType(srv.type || 'sub');
          currentPriorityRef.current = getServerSortPriority(srv.name);
          setActiveUrl(resolved.videoUrl);
          activeUrlRef.current = resolved.videoUrl;
          setIsActiveHLS(Boolean(resolved.isHLS));
          setLoadStream(false);
          setExtracting(false);

          // Always merge into the latest live serversRef so servers discovered in parallel are NEVER wiped out
          const baseList = serversRef.current.length > 0 ? serversRef.current : listToUse;
          const updatedList = baseList.map(s => {
            if (s.name === srv.name && s.type === srv.type) {
              return updatedSrv;
            }
            return s;
          });
          const enriched = enrichDubSubtitles(updatedList);
          setServers(enriched);
          serversRef.current = enriched;
          setAllSubtitleTracks(buildAllSubtitleTracks(enriched));
          return;
        } else {
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
    if (srv.videoUrl) {
      setActiveServer(srv);          // ← CRITICAL: provides referer+embedUrl to AniPlayer's HLS loader
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setActiveUrl(srv.videoUrl);
      activeUrlRef.current = srv.videoUrl;
      setIsActiveHLS(Boolean(srv.isHLS));
      setLoadStream(false);
      setExtracting(false);
    }
  }, [anime, epParam]); // ← no 'servers' dep — uses serversRef.current instead

  const fetchStream = useCallback(async () => {
    if (!anime || !epParam) return;
    const fetchKey = `${anime.id}_${epParam}`;

    // ⚡ Unreleased Guard: Prevent scraping anime that has not been released yet!
    if (anime.status === 'NOT_YET_RELEASED' || (getAiredEpisodeCount(anime) === 0 && !anime.nextAiringEpisode)) {
      setStreamErr('This anime has not been released yet.');
      setLoadStream(false);
      isScrapingRef.current = false;
      return;
    }

    // ⚡ Airing Guard: Prevent scraping un-aired future episodes!
    const isAiring = anime.status === 'RELEASING';
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
        const enriched = enrichDubSubtitles(sorted);
        setServers(enriched);
        serversRef.current = enriched;
        setAllSubtitleTracks(buildAllSubtitleTracks(enriched));

        const track = audioTrackRef.current || 'sub';
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
            } else if (ps.isHLS && !merged[idx].isHLS) {
              merged[idx] = { ...merged[idx], ...ps };
            }
          });
          const sorted = sortServers(merged);
          const enriched = enrichDubSubtitles(sorted);
          setServers(enriched);
          serversRef.current = enriched;
          setAllSubtitleTracks(buildAllSubtitleTracks(enriched));
          setLoadStream(false);

          // If user has manually picked a server, NEVER override their choice!
          if (userSelectedServerRef.current) return;

          // Strictly respect the active audio track — NEVER auto-switch between sub and dub!
          const track = audioTrackRef.current || 'sub';
          const trackServers = enriched.filter(s => s.type === track);
          if (!trackServers.length) {
            // No servers for current track arrived yet from this scraper — wait for others
            return;
          }
          const topServer = trackServers[0];

          // Eager start: if nothing has been selected yet, start with topServer immediately!
          if (!eagerSelectionDone) {
            eagerSelectionDone = true;
            // Fire-and-forget: start embed extraction immediately
            // while other scrapers are still running in parallel
            selectServer(topServer, enriched, false).catch(() => {});
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
        const finalEnriched = enrichDubSubtitles(mergedFinal);
        setServers(finalEnriched);
        serversRef.current = finalEnriched;
        setAllSubtitleTracks(buildAllSubtitleTracks(finalEnriched));

        // If no server has produced a playable stream yet, try highest priority from full list
        if (!activeUrlRef.current && !userSelectedServerRef.current) {
          const track = audioTrackRef.current || 'sub';
          const trackServers = finalEnriched.filter(s => s.type === track);
          let chosen = trackServers.length > 0 ? trackServers[0] : null;
          if (!chosen && finalEnriched.length > 0) {
            chosen = finalEnriched[0];
          }
          if (chosen) {
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
