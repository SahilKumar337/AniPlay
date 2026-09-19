import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { useApp } from '../context/AppContext';
import { useAnimeDetail } from '../hooks/useAnimeDetail';
import { useAnimeStream } from '../hooks/useAnimeStream';
import { useAnimeDownload } from '../hooks/useAnimeDownload';
import { getAniNekoServers, getCachedServers } from '../api/stream';
import { getAiredEpisodeCount } from '../utils/animeStreamUtils';
import { registerBackButtonHandler } from '../utils/backButton';
import AnimeHeroSection from '../components/anime/AnimeHeroSection';
import EpisodeGrid from '../components/anime/EpisodeGrid';
import CommentSection from '../components/anime/CommentSection';
import PlayerOverlayPortal from '../components/anime/PlayerOverlayPortal';
import DownloadListModal from '../components/anime/DownloadListModal';
import DownloadServerSheet from '../components/anime/DownloadServerSheet';
import DownloadQualityModal from '../components/anime/DownloadQualityModal';
import AnimeCard from '../components/AnimeCard';
import LoadingWheel from '../components/ui/LoadingWheel';
import NativeAdCard from '../components/ads/NativeAdCard';
import { AlertCircle } from 'lucide-react';
import VideoAdOverlay from '../components/ads/VideoAdOverlay';
import adEngine from '../services/adEngine';

export default function AnimePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';
  const epParam = parseInt(searchParams.get('ep'), 10) || null;
  const isDirectPlay = searchParams.get('direct') === 'true' || !!location.state?.directPlay;

  const {
    showToast,
    settings,
    getEpisodeProgress,
    setEpisodeProgress,
    addToRecentlyViewed,
  } = useApp();

  const [tab, setTab] = useState('episodes');
  const [scrolled, setScrolled] = useState(false);
  const [fsActive, setFsActive] = useState(false);
  const [epTransitionFs, setEpTransitionFs] = useState(false);

  const fsActiveRef = useRef(false);
  const keepFsRef = useRef(false);

  // 1. Data hooks
  const { anime, loading, error } = useAnimeDetail(id);

  const isNotYetReleased = Boolean(
    anime && (
      anime.status === 'NOT_YET_RELEASED' ||
      (getAiredEpisodeCount(anime) === 0 && !anime.nextAiringEpisode) ||
      (anime.status === 'RELEASING' && anime.nextAiringEpisode?.episode === 1)
    )
  );

  // 2. Calculations (must be before useAnimeStream so totalEps is available for prefetch)
  const totalEps = useMemo(() => {
    if (!anime) return 0;
    if (isNotYetReleased) return 0;
    const aired = getAiredEpisodeCount(anime);
    if (aired > 0) return aired;
    return anime.episodes || 0;
  }, [anime, isNotYetReleased]);

  const allEps = useMemo(() => (totalEps > 0 ? Array.from({ length: totalEps }, (_, i) => i + 1) : []), [totalEps]);
  const prog = anime ? getEpisodeProgress(anime.id) : null;
  const resumeEp = prog?.episode ? Math.min(prog.episode, Math.max(totalEps, 1)) : 1;

  const recs = useMemo(() => anime?.recommendations?.nodes?.map(n => n.mediaRecommendation).filter(Boolean) || [], [anime]);
  const chars = useMemo(() => (anime?.characters?.edges || []).map(e => ({ ...e.node, voiceActors: e.voiceActors || [] })), [anime]);

  const {
    servers,
    subServers,
    dubServers,
    activeServer,
    activeName,
    activeUrl,
    setActiveUrl,
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
  } = useAnimeStream({
    anime,
    epParam,
    playParam,
    settings,
    showToast,
    totalEps,
  });

  const {
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
    cancelActiveDownload,
    handleDownloadClick,
    startDownload,
  } = useAnimeDownload(anime, showToast);

  // Reset scroll and tab when navigating to a new anime
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setTab('episodes');
  }, [id]);

  // Pause any currently playing media when download video ad is showing
  useEffect(() => {
    if (downloadVideoAd) {
      document.querySelectorAll('video').forEach((v) => {
        if (!v.closest('.download-video-ad-modal')) {
          v.pause();
        }
      });
    }
  }, [downloadVideoAd]);

  // Comprehensive DUB Availability State: Tracks if the anime has DUB on any provider
  const [animeDubAvailable, setAnimeDubAvailable] = useState(() => {
    const ep = resumeEp || 1;
    const cached = getCachedServers(anime, ep);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached.some(s => s.type === 'dub');
    }
    return null;
  });

  // Pre-warm stream cache in background & discover DUB availability
  useEffect(() => {
    if (!anime || !resumeEp || isNotYetReleased) return;
    const ep = resumeEp || 1;
    const cached = getCachedServers(anime, ep);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      setAnimeDubAvailable(cached.some(s => s.type === 'dub'));
      return;
    }
    let cancelled = false;
    getAniNekoServers(anime, ep, null, false).then(res => {
      if (!cancelled && res?.servers?.length > 0) {
        setAnimeDubAvailable(res.servers.some(s => s.type === 'dub'));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [anime?.id, resumeEp, isNotYetReleased]);

  // Synchronize DUB availability whenever active video stream servers are updated
  useEffect(() => {
    if (dubServers.length > 0) {
      setAnimeDubAvailable(true);
    } else if (servers.length > 0 && subServers.length > 0 && dubServers.length === 0) {
      setAnimeDubAvailable(false);
    }
  }, [dubServers.length, servers.length, subServers.length]);

  // Synchronize DUB availability when episode download servers are fetched
  useEffect(() => {
    if (serverPickerData?.servers?.length > 0) {
      const hasDub = serverPickerData.servers.some(s => s.type === 'dub');
      setAnimeDubAvailable(hasDub);
    }
  }, [serverPickerData]);

  const playbackTimeRef = useRef(0);
  const durationRef = useRef(0);
  const serverSwitchSeekRef = useRef(0);
  const [serverSwitchSeek, setServerSwitchSeek] = useState(0);

  // Synchronize session: reset server-switch tracking ref when switching episodes/anime
  const currentEpSession = `${anime?.id}_${epParam}`;
  const activeEpSessionRef = useRef(currentEpSession);
  if (activeEpSessionRef.current !== currentEpSession) {
    activeEpSessionRef.current = currentEpSession;
    serverSwitchSeekRef.current = 0;
    playbackTimeRef.current = 0;
  }

  useEffect(() => {
    serverSwitchSeekRef.current = 0;
    setServerSwitchSeek(0);
    playbackTimeRef.current = 0;
  }, [anime?.id, epParam]);

  // 3. Hardware Back Button & Scroll Listener
  useEffect(() => {
    const cleanup = registerBackButtonHandler(() => {
      if (downloadVideoAd) {
        setDownloadVideoAd(null);
        return true;
      }
      if (qualityPickerData) {
        cancelActiveDownload?.(qualityPickerData.episode ?? null);
        return true;
      }
      if (serverPickerData) {
        setServerPickerData(null);
        return true;
      }
      if (downloadModalOpen) {
        setDownloadModalOpen(false);
        return true;
      }
      if (playParam) {
        if (playbackTimeRef.current > 2 && anime && epParam) {
          setEpisodeProgress(anime.id, epParam, playbackTimeRef.current, durationRef.current);
        }
        serverSwitchSeekRef.current = 0;
        setServerSwitchSeek(0);
        if (isDirectPlay) {
          if (window.history.state && window.history.state.idx > 0) {
            navigate(-1);
          } else {
            navigate('/', { replace: true });
          }
        } else {
          setSearchParams({}, { replace: true });
        }
        return true;
      }
      return false;
    });
    return cleanup;
  }, [playParam, downloadModalOpen, serverPickerData, qualityPickerData, downloadVideoAd, setSearchParams, anime, epParam, setEpisodeProgress, isDirectPlay, navigate]);

  // Flush playback progress on page unmount / navigation away
  useEffect(() => {
    return () => {
      if (playbackTimeRef.current > 2 && anime && epParam) {
        setEpisodeProgress(anime.id, epParam, playbackTimeRef.current, durationRef.current);
      }
    };
  }, [anime, epParam, setEpisodeProgress]);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrolled((window.scrollY || document.documentElement.scrollTop || 0) > 60);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Sync episode progress when playing
  useEffect(() => {
    if (anime && epParam) {
      const existingProg = getEpisodeProgress(anime.id, epParam);
      setEpisodeProgress(anime.id, epParam,
        existingProg?.seekPosition ?? null,
        existingProg?.duration ?? null
      );
      addToRecentlyViewed(anime, epParam);
    }
  }, [anime, epParam, setEpisodeProgress, addToRecentlyViewed, getEpisodeProgress]);

  // Save within-episode position (called by AniPlayer on progress, pause, unmount)
  const handleSeekProgress = useCallback((currentTime, duration) => {
    if (!anime || !epParam) return;
    if (currentTime > 0) {
      playbackTimeRef.current = currentTime;
      if (duration > 0) durationRef.current = duration;
    }
    setEpisodeProgress(anime.id, epParam, currentTime, duration);
  }, [anime, epParam, setEpisodeProgress]);

  // Initial seek time: handles both server switching (exact second) and episode resume
  const initialSeekTime = useMemo(() => {
    if (serverSwitchSeek > 2) {
      return serverSwitchSeek;
    }
    if (serverSwitchSeekRef.current > 2) {
      return serverSwitchSeekRef.current;
    }
    const epProg = anime ? getEpisodeProgress(anime.id, epParam) : null;
    return epProg?.seekPosition ?? 0;
  }, [anime, epParam, getEpisodeProgress, serverSwitchSeek]);

  const handleSelectServer = useCallback((srv) => {
    const currentProgress = (anime && epParam) ? getEpisodeProgress(anime.id, epParam) : null;
    const currentPos = playbackTimeRef.current > 2
      ? playbackTimeRef.current
      : (currentProgress?.seekPosition > 2 ? currentProgress.seekPosition : 0);

    if (currentPos > 2) {
      serverSwitchSeekRef.current = currentPos;
      setServerSwitchSeek(currentPos);
      if (anime && epParam) {
        setEpisodeProgress(anime.id, epParam, currentPos, durationRef.current);
      }
    }
    selectServer(srv, servers, true);
  }, [anime, epParam, selectServer, servers, setEpisodeProgress, getEpisodeProgress]);

  const handleAudioTrackChange = useCallback((trk) => {
    localStorage.setItem('anilab_preferred_track', trk);
    const currentProgress = (anime && epParam) ? getEpisodeProgress(anime.id, epParam) : null;
    const currentPos = playbackTimeRef.current > 2
      ? playbackTimeRef.current
      : (currentProgress?.seekPosition > 2 ? currentProgress.seekPosition : 0);

    if (trk === 'dub' && dubServers.length === 0) {
      showToast('No English Dub available for this anime');
      return;
    }

    if (currentPos > 2) {
      serverSwitchSeekRef.current = currentPos;
      setServerSwitchSeek(currentPos);
      if (anime && epParam) {
        setEpisodeProgress(anime.id, epParam, currentPos, durationRef.current);
      }
    }
    setAudioTrack(trk);
    const targetList = trk === 'dub' ? dubServers : subServers;
    if (targetList.length > 0) selectServer(targetList[0], servers, true);
  }, [anime, epParam, dubServers, subServers, selectServer, servers, setAudioTrack, setEpisodeProgress, getEpisodeProgress, showToast]);

  const handleExitPlayer = useCallback(() => {
    if (playbackTimeRef.current > 2 && anime && epParam) {
      setEpisodeProgress(anime.id, epParam, playbackTimeRef.current, durationRef.current);
    }
    serverSwitchSeekRef.current = 0;
    setServerSwitchSeek(0);
    if (isDirectPlay) {
      if (window.history.state && window.history.state.idx > 0) {
        navigate(-1);
      } else {
        navigate('/', { replace: true });
      }
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [anime, epParam, setEpisodeProgress, setSearchParams, isDirectPlay, navigate]);

  const handleEpisodeSelect = useCallback((newEp) => {
    if (isNotYetReleased || totalEps === 0) {
      showToast('This anime has not been released yet.');
      return;
    }
    if (playbackTimeRef.current > 2 && anime && epParam) {
      setEpisodeProgress(anime.id, epParam, playbackTimeRef.current, durationRef.current);
    }
    playbackTimeRef.current = 0;
    serverSwitchSeekRef.current = 0;
    setServerSwitchSeek(0);
    adEngine.triggerEpisodeAd();
    const wasFs = fsActiveRef.current;
    if (wasFs) {
      keepFsRef.current = true;
      setEpTransitionFs(true);
      // Extended timeout: covers slow server fetches (HD-1 can take 3–4s)
      // keepFsRef prevents the unmount cleanup from resetting orientation
      setTimeout(() => { keepFsRef.current = false; }, 4000);
      // Belt-and-suspenders: re-lock landscape immediately so even if something
      // briefly resets orientation, we snap back before the user notices
      if (window.Capacitor?.isNativePlatform?.()) {
        ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
      }
    } else {
      setEpTransitionFs(false);
    }
    const nextParams = { play: 'true', ep: String(newEp) };
    if (isDirectPlay) nextParams.direct = 'true';
    setSearchParams(nextParams, { replace: true });
  }, [anime, epParam, setEpisodeProgress, setSearchParams, isDirectPlay]);

  // Direct Play Mode (e.g. from Continue Watching): render only player portal without mounting the anime info page
  if (isDirectPlay && playParam && epParam) {
    return (
      <div className="page" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, overflow: 'hidden' }}>
        <PlayerOverlayPortal
          anime={anime}
          epParam={epParam}
          totalEps={totalEps}
          servers={servers}
          subServers={subServers}
          dubServers={dubServers}
          activeServer={activeServer}
          activeName={activeName}
          activeUrl={activeUrl}
          isActiveHLS={isActiveHLS}
          loadStream={loadStream || extracting}
          extracting={extracting}
          streamErr={streamErr}
          audioTrack={audioTrack}
          onAudioTrackChange={handleAudioTrackChange}
          onSelectServer={handleSelectServer}
          onRetryFetch={fetchStream}
          onBack={handleExitPlayer}
          onEpisodeChange={handleEpisodeSelect}
          allSubtitleTracks={allSubtitleTracks}
          fsActive={fsActive}
          setFsActive={setFsActive}
          fsActiveRef={fsActiveRef}
          epTransitionFs={epTransitionFs}
          setEpTransitionFs={setEpTransitionFs}
          keepFsRef={keepFsRef}
          settings={settings}
          allEps={allEps}
          prog={prog}
          setActiveUrl={setActiveUrl}
          setIsActiveHLS={setIsActiveHLS}
          initialSeekTime={initialSeekTime}
          onSeekProgress={handleSeekProgress}
          sessionDownloadedEps={downloadedSet}
        />

        {/* Drawers for Offline Downloads */}
        <DownloadListModal
          open={downloadModalOpen && !serverPickerData && !qualityPickerData && !downloadVideoAd}
          onOpenChange={setDownloadModalOpen}
          anime={anime}
          allEps={allEps}
          hasDub={animeDubAvailable !== false}
          downloadAudioTrack={downloadAudioTrack}
          onAudioTrackChange={setDownloadAudioTrack}
          downloadedSet={downloadedSet}
          downloadProgress={downloadProgress}
          failedSet={failedSet}
          onDownloadEpisode={handleDownloadClick}
        />

        <DownloadServerSheet
          data={serverPickerData}
          audioTrack={downloadAudioTrack}
          onAudioTrackChange={setDownloadAudioTrack}
          onSelectServer={(srv) => startDownload(serverPickerData.episode, srv, serverPickerData.servers)}
          onClose={() => setServerPickerData(null)}
        />

        <DownloadQualityModal data={qualityPickerData} />

        {/* Video Ad Overlay for Offline Downloads */}
        {downloadVideoAd && (
          <div
            className="download-video-ad-modal"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999999,
              background: '#000',
              width: '100vw',
              height: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <VideoAdOverlay
              ad={downloadVideoAd.ad}
              onComplete={downloadVideoAd.onComplete}
            />
          </div>
        )}
      </div>
    );
  }

  if (loading && !anime && !playParam) {
    return <DetailSkeleton />;
  }

  if (error && !playParam) {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 24, gap: 12 }}>
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>{error}</p>
        <button
          className="btn btn-outline"
          onClick={() => {
            if (window.history.state && window.history.state.idx > 0) {
              navigate(-1);
            } else {
              navigate('/', { replace: true });
            }
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div
      className="page"
      style={{
        position: 'relative',
        paddingBottom: 'calc(max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 48px)',
      }}
    >
      {/* 1. Detail Hero Section */}
      <AnimeHeroSection
        anime={anime}
        resumeEp={resumeEp}
        onPlay={() => {
          if (isNotYetReleased || totalEps === 0) {
            showToast('This anime has not been released yet.');
            return;
          }
          adEngine.triggerEpisodeAd();
          setSearchParams({ play: 'true', ep: String(resumeEp) }, { replace: true });
        }}
        onOpenDownloads={() => setDownloadModalOpen(true)}
        scrolled={scrolled}
      />

      {/* 2. Detail Navigation Tabs */}
      <div style={{ marginTop: 20, borderBottom: '1px solid var(--border)' }}>
        <div
          className="no-scrollbar"
          style={{
            display: 'flex',
            padding: '0 16px',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {[
            { k: 'episodes', l: `Episodes (${totalEps})` },
            { k: 'similar', l: 'More like this' },
            { k: 'comments', l: 'Discussion' },
            { k: 'characters', l: 'Characters' },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              id={`tab-${t.k}`}
              style={{
                padding: '12px 14px',
                fontSize: 13,
                fontWeight: tab === t.k ? 700 : 500,
                color: tab === t.k ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderBottom: tab === t.k ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Tab Content */}
      <div style={{ padding: '16px 16px 0' }}>
        {tab === 'episodes' && (
          <>
            {totalEps === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '44px 20px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: 16,
                border: '1px solid var(--border)',
                margin: '12px 0 24px',
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 26,
                  background: 'rgba(124, 58, 237, 0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px',
                  color: 'var(--accent)',
                }}>
                  <AlertCircle size={26} />
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                  {isNotYetReleased ? 'Anime Not Yet Released' : 'No Episodes Available'}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
                  {anime?.startDate?.year 
                    ? `Scheduled for premiere in ${anime.startDate.year}${anime.season ? ` (${anime.season})` : ''}. Episodes will appear here as soon as they air worldwide.`
                    : 'Episodes for this anime have not aired yet. Check back closer to the broadcast date!'}
                </p>
              </div>
            ) : (
              <EpisodeGrid
                episodes={allEps.map(n => ({ number: n }))}
                currentEp={epParam || resumeEp}
                onSelectEp={handleEpisodeSelect}
                watchedEps={new Set(prog?.episode ? Array.from({ length: prog.episode - 1 }, (_, i) => i + 1) : [])}
                downloadedEps={(() => {
                  const s = new Set();
                  const trk = downloadAudioTrack || audioTrack || 'sub';
                  downloadedSet.forEach(k => {
                    if (k.endsWith(`_${trk}`)) {
                      const ep = k.split('_')[0];
                      if (ep) s.add(Number(ep));
                    }
                  });
                  return s;
                })()}
              />
            )}
            <NativeAdCard placement="anime_detail_episodes" />
          </>
        )}

        {tab === 'similar' && (
          <div>
            {!recs.length ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No recommendations found.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {recs.map(r => (
                  <AnimeCard key={r.id} anime={r} width="100%" height={148} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'comments' && anime && (
          <CommentSection animeId={anime.id} epNum={epParam || 1} />
        )}

        {tab === 'characters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!chars.length ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No character data available.
              </div>
            ) : (
              chars.map((c) => {
                const va = c.voiceActors?.[0];
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--bg-card)',
                      borderRadius: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <img
                        src={c.image?.large}
                        alt={c.name?.full}
                        style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: '#222', flexShrink: 0 }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name?.full}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Character</div>
                      </div>
                    </div>
                    {va && (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{va.name?.full}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Voice Actor</div>
                        </div>
                        <img
                          src={va.image?.large}
                          alt={va.name?.full}
                          style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: '#222', flexShrink: 0 }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 4. Fullscreen Player Portal Window */}
      {playParam && epParam && (
        <PlayerOverlayPortal
          anime={anime}
          epParam={epParam}
          totalEps={totalEps}
          servers={servers}
          subServers={subServers}
          dubServers={dubServers}
          activeServer={activeServer}
          activeName={activeName}
          activeUrl={activeUrl}
          isActiveHLS={isActiveHLS}
          loadStream={loadStream || extracting}
          extracting={extracting}
          streamErr={streamErr}
          audioTrack={audioTrack}
          onAudioTrackChange={handleAudioTrackChange}
          onSelectServer={handleSelectServer}
          onRetryFetch={fetchStream}
          onBack={handleExitPlayer}
          onEpisodeChange={handleEpisodeSelect}
          allSubtitleTracks={allSubtitleTracks}
          fsActive={fsActive}
          setFsActive={setFsActive}
          fsActiveRef={fsActiveRef}
          epTransitionFs={epTransitionFs}
          setEpTransitionFs={setEpTransitionFs}
          keepFsRef={keepFsRef}
          settings={settings}
          allEps={allEps}
          prog={prog}
          setActiveUrl={setActiveUrl}
          setIsActiveHLS={setIsActiveHLS}
          initialSeekTime={initialSeekTime}
          onSeekProgress={handleSeekProgress}
          sessionDownloadedEps={downloadedSet}
        />
      )}

      {/* 5. Drawers for Offline Downloads */}
      <DownloadListModal
        open={downloadModalOpen && !serverPickerData && !qualityPickerData && !downloadVideoAd}
        onOpenChange={setDownloadModalOpen}
        anime={anime}
        allEps={allEps}
        hasDub={animeDubAvailable !== false}
        downloadAudioTrack={downloadAudioTrack}
        onAudioTrackChange={setDownloadAudioTrack}
        downloadedSet={downloadedSet}
        downloadProgress={downloadProgress}
        failedSet={failedSet}
        onDownloadEpisode={handleDownloadClick}
      />

      <DownloadServerSheet
        data={serverPickerData}
        audioTrack={downloadAudioTrack}
        onAudioTrackChange={setDownloadAudioTrack}
        onSelectServer={(srv) => startDownload(serverPickerData.episode, srv, serverPickerData.servers)}
        onClose={() => setServerPickerData(null)}
      />

      <DownloadQualityModal data={qualityPickerData} />

      {/* 6. Video Ad Overlay for Offline Downloads */}
      {downloadVideoAd && (
        <div
          className="download-video-ad-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: '#000',
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <VideoAdOverlay
            ad={downloadVideoAd.ad}
            onComplete={downloadVideoAd.onComplete}
          />
        </div>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page" style={{ position: 'relative', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{
        height: 320,
        position: 'relative',
        background: 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.12) 0%, rgba(5, 5, 8, 0.95) 75%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      }}>
        <LoadingWheel size={46} text="Loading anime details..." />
      </div>
      <div style={{ padding: '16px' }}>
        <div className="skeleton" style={{ height: 28, width: '70%', borderRadius: 8, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 14, width: '45%', borderRadius: 6, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div className="skeleton" style={{ flex: 1, height: 46, borderRadius: 14 }} />
          <div className="skeleton" style={{ flex: 1, height: 46, borderRadius: 14 }} />
        </div>
        <div className="skeleton" style={{ height: 80, borderRadius: 12, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 42, borderRadius: 10 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
