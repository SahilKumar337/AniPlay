import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getAniNekoServers, getCachedServers, saveCachedServers, updateCachedEpisodeServer, resolvePlaceholderServer, prefetchNextEpisode, getServerSortPriority, resolveSingleServer, isDirectStreamUrl, getEpisodeSubtitles, saveEpisodeSubtitles, checkIsAdultAnime, invalidateStreamCache } from '../api/stream';
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
  const [serverSwitchToken, setServerSwitchToken] = useState(0);

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
  const serverSwitchTokenRef = useRef(0);
  // Stores the backup server expander returned by getAniNekoServers.
  // Called automatically when ALL primary server candidates fail to resolve,
  // so backup servers appear in the UI without requiring a full page reload.
  const expandBackupsRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => { serversRef.current = servers; }, [servers]);
  // ⚡ CRITICAL: audioTrackRef is used in synchronous callbacks (selectServer) so it MUST be
  // kept in sync both via useEffect AND via the setAudioTrack wrapper to prevent DUB/SUB mismatch.
  useEffect(() => { audioTrackRef.current = audioTrack; }, [audioTrack]);

  // Synchronized audioTrack setter — updates ref immediately (synchronous) then schedules state update
  const setAudioTrackSync = useCallback((trk) => {
    audioTrackRef.current = trk;
    setAudioTrack(trk);
    userSelectedServerRef.current = false;
  }, []);


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
      if (lastFetchedRef.current !== fetchKey) return;
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

      // ⚡ 3-second startup delay: let the main HLS stream initialize and buffer before
      // firing a second resolveSingleServer call that competes for network & CPU.
      // After the delay, abort if the user navigated to a different episode.
      await new Promise(r => setTimeout(r, 3000));
      if (inFlightSubSubsRef.current !== fetchKey || lastFetchedRef.current !== fetchKey) return; // superseded by a newer episode

      console.log(`[useAnimeStream] Resolving sub server "${targetSub.name}" in background to share subtitles with DUB...`);
      const resolved = await resolveSingleServer(targetSub, currentAnime, currentEp);

      if (lastFetchedRef.current !== fetchKey) return;

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
    const fetchKeyAtStart = `${anime?.id}_${epParam}`;
    const srvKey = `${srv.name}_${srv.type || 'sub'}`;

    // Prevent duplicate in-flight resolution if user taps the same server while it is resolving
    if (isManual && inFlightServerRef.current === srvKey) {
      console.log(`[useAnimeStream] Server "${srvKey}" already resolving — ignoring duplicate tap`);
      return;
    }

    const token = ++serverSwitchTokenRef.current;
    if (isManual) {
      userSelectedServerRef.current = true;
      userSelectedTrackRef.current = true;
      setServerSwitchToken(token);
    }
    inFlightServerRef.current = srvKey;
    currentPriorityRef.current = getServerSortPriority(srv.name);
    setActiveServer(srv);
    setActiveName(srv.name || '');
    setActiveType(srv.type || 'sub');
    if (isManual && srv.type && srv.type !== audioTrackRef.current) {
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

    const tryNextServerOrFail = () => {
      if (token !== serverSwitchTokenRef.current) return;
      srv._failed = true;
      const targetType = srv.type || 'sub';
      const remainingServers = listToUse.filter(s =>
        (s.type || 'sub') === targetType &&
        s.name !== srv.name &&
        !s._failed
      );
      if (remainingServers.length > 0) {
        console.log(`[useAnimeStream] Server "${srv.name}" failed, auto-failing over to "${remainingServers[0].name}"...`);
        return selectServer(remainingServers[0], listToUse, isManual);
      }
      handleScrapeError();
    };

    // Placeholder server
    const isPlaceholder = Boolean(srv.isPlaceholder) || (Boolean(srv.videoUrl) && srv.videoUrl.includes('proxy/placeholder'));
    if (isPlaceholder) {
      const prevType = audioTrackRef.current || 'sub';
      const isTrackSwitch = srv.type && srv.type !== prevType;
      if (isTrackSwitch || lastFetchedRef.current !== fetchKeyAtStart) {
        // When switching audio tracks or episodes, clear old stream URL so old video doesn't linger
        setActiveUrl('');
        activeUrlRef.current = '';
      }
      setExtracting(true);
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      try {
        const resolved = await resolvePlaceholderServer(anime, epParam, srv.name, srv.type || 'sub');
        setExtracting(false);
        const updatedList = listToUse.map(s => {
          if (s.name === srv.name && s.type === srv.type) {
            return { ...s, ...resolved, isPlaceholder: false };
          }
          return s;
        });
        setServers(updatedList);
        serversRef.current = updatedList;
        selectServer({ ...srv, ...resolved, isPlaceholder: false }, updatedList);
        return;
      } catch (err) {
        setExtracting(false);
        tryNextServerOrFail();
        return;
      }
    }

    // Unresolved / embed server — lazy resolution on demand
    const isUnresolved = !srv.isHLS || !isDirectStreamUrl(srv.videoUrl);
    if (isUnresolved) {
      const prevType = audioTrackRef.current || 'sub';
      const isTrackSwitch = srv.type && srv.type !== prevType;
      if (isTrackSwitch || lastFetchedRef.current !== fetchKeyAtStart) {
        // When switching audio tracks or episodes, clear old stream URL so old video/audio doesn't linger
        setActiveUrl('');
        activeUrlRef.current = '';
      }
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setExtracting(true);
      // Keep existing activeUrl during extraction if same track so AniPlayer stays mounted with loading overlay,
      // preventing orientation flicker and preserving playback position across server switches.

      try {
        // ⚡ Hard timeout: prevent any single server from hanging the UI forever
        const RESOLVE_TIMEOUT_MS = 6000;
        const withServerTimeout = (p) => Promise.race([
          p,
          new Promise((_, rej) => setTimeout(() => rej(new Error(`Server resolution timed out after ${RESOLVE_TIMEOUT_MS}ms`)), RESOLVE_TIMEOUT_MS))
        ]);

        // Directly resolve the selected server with in-flight deduplication
        const resolved = await withServerTimeout(resolveSingleServer(srv, anime, epParam));

        if (token !== serverSwitchTokenRef.current || lastFetchedRef.current !== fetchKeyAtStart) {
          console.log(`[useAnimeStream] Server selection "${srv.name}" superseded by newer selection or episode switch — ignoring`);
          return;
        }

        setExtracting(false);

        if (resolved?.videoUrl && isDirectStreamUrl(resolved.videoUrl)) {
          const finalSubs = (resolved.subtitles && resolved.subtitles.length > 0) ? resolved.subtitles : (srv.subtitles || []);
          const updatedSrv = { ...srv, ...resolved, isHLS: Boolean(resolved.isHLS), subtitles: finalSubs };

          setActiveServer(updatedSrv);
          setActiveName(srv.name);
          setActiveType(srv.type || 'sub');
          currentPriorityRef.current = getServerSortPriority(srv.name);
          setActiveUrl(resolved.videoUrl);
          activeUrlRef.current = resolved.videoUrl;
          setIsActiveHLS(Boolean(resolved.isHLS));
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
          updateCachedEpisodeServer(anime, epParam, updatedSrv);
          saveCachedServers(anime, epParam, enriched, false);
          if (isDub) {
            resolveSubSubtitlesForDub(anime, epParam);
          }
          return;
        } else {
          console.warn(`[useAnimeStream] Lazy resolution failed for server ${srv.name}. Trying next server...`);
          tryNextServerOrFail();
          return;
        }
      } catch (err) {
        console.warn(`[useAnimeStream] Lazy resolution error for ${srv.name}:`, err.message);
        setExtracting(false);
        tryNextServerOrFail();
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
      updateCachedEpisodeServer(anime, epParam, srv);
      if (isDub) {
        resolveSubSubtitlesForDub(anime, epParam);
      }
    } else {
      console.warn(`[useAnimeStream] Server ${srv.name} has non-direct URL (${srv.videoUrl}). Trying next server...`);
      tryNextServerOrFail();
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
      serverSwitchTokenRef.current++;
      userSelectedServerRef.current = false;
      const pref = localStorage.getItem('anilab_preferred_track') || 'sub';
      audioTrackRef.current = pref;
      setAudioTrack(pref);
      // ⚡ Netflix/YouTube Architecture: Isolate episode playback sessions completely.
      // Purge old episode's servers, activeUrl, subtitles, and priority so previous episode never leaks into the new one!
      serversRef.current = [];
      setServers([]);
      setAllSubtitleTracks([]);
      inFlightSubSubsRef.current = null;
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
        if (!chosen && enriched.length > 0 && track !== 'dub') {
          chosen = enriched[0];
        }
        if (!chosen && enriched.length > 0 && track === 'dub') {
          // If this episode has no DUB servers, auto-fallback to SUB and notify UI
          chosen = enriched[0];
          setAudioTrackSync('sub');
        }
        if (chosen) {
          await selectServer(chosen, enriched, false);
        }

        // ⚡ If cached servers are partial or have fewer than 3 servers, fetch remaining servers in background
        const currentTrackCount = enriched.filter(s => s.type === (audioTrackRef.current || 'sub')).length;
        if (cached?.isPartial || currentTrackCount < 3) {
          getAniNekoServers(anime, epParam, (partialServers) => {
            if (!partialServers?.length || lastFetchedRef.current !== fetchKey) return;
            const existing = serversRef.current || [];
            const merged = [...existing];
            partialServers.forEach(ps => {
              const psName = (ps.name || '').trim().toLowerCase();
              const psType = (ps.type || 'sub').trim().toLowerCase();
              const idx = merged.findIndex(x => 
                (x.name || '').trim().toLowerCase() === psName && 
                (x.type || 'sub').trim().toLowerCase() === psType
              );
              if (idx === -1) {
                merged.push({ ...ps, name: ps.name, type: ps.type || 'sub' });
              } else if (ps.isHLS && isDirectStreamUrl(ps.videoUrl) && !merged[idx].isHLS) {
                merged[idx] = { ...merged[idx], ...ps };
              }
            });
            const sorted = sortServers(merged);
            const cachedSubs = getEpisodeSubtitles(anime?.id, epParam);
            const reEnriched = enrichDubSubtitles(sorted, cachedSubs);
            setServers(reEnriched);
            serversRef.current = reEnriched;
            setAllSubtitleTracks(buildAllSubtitleTracks(reEnriched));
            saveCachedServers(anime, epParam, reEnriched, false);
          }, false).catch(() => {});
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
            const psName = (ps.name || '').trim().toLowerCase();
            const psType = (ps.type || 'sub').trim().toLowerCase();
            const idx = merged.findIndex(x => 
              (x.name || '').trim().toLowerCase() === psName && 
              (x.type || 'sub').trim().toLowerCase() === psType
            );
            if (idx === -1) {
              merged.push({ ...ps, name: ps.name, type: ps.type || 'sub' });
            } else if (!ps.isPlaceholder) {
              // Replace placeholder with real discovered server
              merged[idx] = { ...merged[idx], ...ps, isPlaceholder: false };
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
          saveCachedServers(anime, epParam, enriched, true);
          setLoadStream(false);

          if (audioTrackRef.current === 'dub' && !inFlightSubSubsRef.current) {
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

          // ⚡ Immediate Direct Stream Selection:
          // If any discovered server is ALREADY direct HLS (from cache or background resolution),
          // immediately select and play it without starting an unnecessary candidate race!
          const directReady = trackServers.find(s => s.isHLS && isDirectStreamUrl(s.videoUrl));
          if (directReady && !activeUrlRef.current && !userSelectedServerRef.current) {
            selectServer(directReady, enriched, false).catch(() => {});
            return;
          }

          // ⚡ PARALLEL RESOLUTION — Race top-3 servers simultaneously.
          // First winner plays instantly; much faster than sequential fallback.
          if (!eagerSelectionDone && !userSelectedServerRef.current && !activeUrlRef.current) {
            eagerSelectionDone = true;

            const RACE_TIMEOUT_MS = 6000;
            const withRaceTimeout = (p) => Promise.race([
              p,
              new Promise((_, rej) => setTimeout(() => rej(new Error('race timeout')), RACE_TIMEOUT_MS))
            ]);

            const runCandidateRace = (candidatesList) => {
              setExtracting(true);
              inFlightServerRef.current = 'parallel-race';

              Promise.any(
                candidatesList.map(async (candidate) => {
                  const resolved = await withRaceTimeout(resolveSingleServer(candidate, anime, epParam));
                  if (!resolved?.videoUrl || !isDirectStreamUrl(resolved.videoUrl)) {
                    throw new Error(`${candidate.name}: no valid URL resolved`);
                  }
                  return { candidate, resolved };
                })
              ).then(({ candidate, resolved }) => {
                // Sequence guard: episode changed while resolving
                if (lastFetchedRef.current !== fetchKey) return;
                if (userSelectedServerRef.current) { setExtracting(false); return; }

                const finalSubs = (resolved.subtitles?.length) ? resolved.subtitles : (candidate.subtitles || []);
                const updatedSrv = { ...candidate, ...resolved, isHLS: Boolean(resolved.isHLS), subtitles: finalSubs };

                setActiveServer(updatedSrv);
                setActiveName(candidate.name);
                setActiveType(candidate.type || 'sub');
                currentPriorityRef.current = getServerSortPriority(candidate.name);
                setActiveUrl(resolved.videoUrl);
                activeUrlRef.current = resolved.videoUrl;
                setIsActiveHLS(Boolean(resolved.isHLS));
                setExtracting(false);
                setLoadStream(false);
                inFlightServerRef.current = null;

                // Merge resolved server into the live list
                const baseList = serversRef.current.length > 0 ? serversRef.current : enriched;
                const updatedList = baseList.map(s =>
                  (s.name === candidate.name && s.type === candidate.type) ? updatedSrv : s
                );
                const cachedSubsNow = getEpisodeSubtitles(anime?.id, epParam);
                const freshEnriched = enrichDubSubtitles(updatedList, cachedSubsNow);
                setServers(freshEnriched);
                serversRef.current = freshEnriched;
                setAllSubtitleTracks(buildAllSubtitleTracks(freshEnriched));
              }).catch((err) => {
                if (lastFetchedRef.current !== fetchKey) return;
                console.warn('[useAnimeStream] Initial parallel candidates failed:', err);
                inFlightServerRef.current = null;
                const remaining = trackServers.slice(candidatesList.length);
                if (remaining.length > 0 && !activeUrlRef.current && !userSelectedServerRef.current) {
                  runCandidateRace(remaining.slice(0, 3));
                } else if (!activeUrlRef.current && !userSelectedServerRef.current) {
                  // No more candidates — trigger backup server expansion
                  if (expandBackupsRef.current) {
                    console.log('[useAnimeStream] All primary servers failed — expanding backup servers');
                    expandBackupsRef.current();
                    expandBackupsRef.current = null;
                  } else {
                    setExtracting(false);
                    setLoadStream(false);
                  }
                } else {
                  setExtracting(false);
                  setLoadStream(false);
                }
              });
            };

            runCandidateRace(trackServers.slice(0, 3));
          } else if (!userSelectedServerRef.current && !activeUrlRef.current && isVidstream) {
            selectServer(topServer, enriched, false).catch(() => {});
          }
        };

        const res = await getAniNekoServers(anime, epParam, onServersFound, false);
        // Store the backup expander so we can trigger it if primary servers fail
        if (res?.expandBackups) {
          expandBackupsRef.current = res.expandBackups;
        }
        // ⚡ Sequence guard: Discard result if user navigated to a different episode while scraping
        if (lastFetchedRef.current !== fetchKey) return;
        srvList = res?.servers || [];

        if (!srvList.length && serversRef.current.length === 0) {
          const elapsed = Date.now() - fetchStartTimeRef.current;
          const remainingWait = Math.max(0, 8000 - elapsed);
          setTimeout(() => {
            if (!activeUrlRef.current && serversRef.current.length === 0) {
              setStreamErr('No streaming servers available for this episode.');
              setExtracting(false);
              setLoadStream(false);
            }
          }, remainingWait);
          return;
        }

        // ⚡ Safety net: if parallel race also failed to produce a URL after all scrapers done,
        // show an error after a brief grace period instead of spinning forever.
        setTimeout(() => {
          if (lastFetchedRef.current !== fetchKey) return;
          if (!activeUrlRef.current && !userSelectedServerRef.current) {
            setExtracting(false);
            setLoadStream(false);
            if (serversRef.current.length > 0 && !inFlightServerRef.current) {
              setStreamErr('Unable to connect to streaming servers. Please tap retry or pick a different server.');
            }
          }
        }, 3000);

        // After ALL scrapers finish: combine srvList with any servers in serversRef.current
        const allKnown = [...srvList].filter(s => !s.isPlaceholder || (s.embedUrl || s.videoUrl));
        serversRef.current.forEach(ex => {
          if (ex.isPlaceholder && !ex.embedUrl && !ex.videoUrl) return; // DISCARD UNRESOLVED PLACEHOLDERS!
          const exName = (ex.name || '').trim().toLowerCase();
          const exType = (ex.type || 'sub').trim().toLowerCase();
          if (!allKnown.some(x => 
            (x.name || '').trim().toLowerCase() === exName && 
            (x.type || 'sub').trim().toLowerCase() === exType
          )) {
            allKnown.push(ex);
          }
        });
        const sortedFinal = sortServers(allKnown);
        const mergedFinal = sortedFinal.map(s => {
          const sName = (s.name || '').trim().toLowerCase();
          const sType = (s.type || 'sub').trim().toLowerCase();
          const existing = serversRef.current.find(x => 
            (x.name || '').trim().toLowerCase() === sName && 
            (x.type || 'sub').trim().toLowerCase() === sType
          );
          if (existing?.isHLS) {
            return { ...s, ...existing };
          }
          return s;
        }).filter(s => !s.isPlaceholder || (s.embedUrl || s.videoUrl));
        const cachedSubs = getEpisodeSubtitles(anime?.id, epParam);
        const finalEnriched = enrichDubSubtitles(mergedFinal, cachedSubs);
        setServers(finalEnriched);
        serversRef.current = finalEnriched;
        setAllSubtitleTracks(buildAllSubtitleTracks(finalEnriched));
        saveCachedServers(anime, epParam, finalEnriched, false);

        if (audioTrackRef.current === 'dub') {
          resolveSubSubtitlesForDub(anime, epParam);
        }

        if (!userSelectedServerRef.current && !activeUrlRef.current && !inFlightServerRef.current) {
          const track = audioTrackRef.current || 'sub';
          let trackServers = finalEnriched.filter(s => s.type === track);
          if (!trackServers.length && isAdult) {
            trackServers = finalEnriched;
          }
          let chosen = trackServers.length > 0 ? trackServers[0] : null;
          if (!chosen && finalEnriched.length > 0) {
            // User requested DUB, but this episode has no DUB servers!
            // Auto-switch UI and player to SUB
            chosen = finalEnriched[0];
            setAudioTrackSync('sub');
          }
          if (chosen && chosen.name !== activeName) {
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
    setAudioTrack: setAudioTrackSync, // synchronized version — updates ref + state atomically
    loadStream,
    extracting,
    streamErr,
    isActiveHLS,
    setIsActiveHLS,
    serverSwitchToken,
    allSubtitleTracks,
    selectServer,
    fetchStream,
    retryStream,
  };
}
