import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAnimeDetail } from '../hooks/useAnimeDetail';
import { useAnimeStream } from '../hooks/useAnimeStream';
import { useAnimeDownload } from '../hooks/useAnimeDownload';
import { registerBackButtonHandler } from '../utils/backButton';
import AnimeHeroSection from '../components/anime/AnimeHeroSection';
import EpisodeGrid from '../components/anime/EpisodeGrid';
import CommentSection from '../components/anime/CommentSection';
import PlayerOverlayPortal from '../components/anime/PlayerOverlayPortal';
import DownloadListModal from '../components/anime/DownloadListModal';
import DownloadServerSheet from '../components/anime/DownloadServerSheet';
import DownloadQualityModal from '../components/anime/DownloadQualityModal';
import AnimeCard from '../components/AnimeCard';

export default function AnimePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';
  const epParam = parseInt(searchParams.get('ep'), 10) || null;

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
  });

  const {
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
  } = useAnimeDownload(anime, showToast);

  // 2. Calculations
  const totalEps = useMemo(() => {
    if (!anime) return 1;
    const eps = anime.episodes || 0;
    const isAiring = anime.status === 'RELEASING';
    const airedCount = anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1
      ? anime.nextAiringEpisode.episode - 1
      : 0;
    return isAiring ? Math.max(1, airedCount, eps) : Math.max(eps, 1);
  }, [anime]);

  const allEps = useMemo(() => Array.from({ length: totalEps }, (_, i) => i + 1), [totalEps]);
  const prog = anime ? getEpisodeProgress(anime.id) : null;
  const resumeEp = prog?.episode ? Math.min(prog.episode, totalEps) : 1;

  const recs = useMemo(() => anime?.recommendations?.nodes?.map(n => n.mediaRecommendation).filter(Boolean) || [], [anime]);
  const chars = useMemo(() => (anime?.characters?.edges || []).map(e => ({ ...e.node, voiceActors: e.voiceActors || [] })), [anime]);

  // Reset scroll and tab when navigating to a new anime
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setTab('episodes');
  }, [id]);

  // 3. Hardware Back Button & Scroll Listener
  useEffect(() => {
    const cleanup = registerBackButtonHandler(() => {
      if (qualityPickerData) {
        setQualityPickerData(null);
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
        setSearchParams({}, { replace: true });
        return true;
      }
      return false;
    });
    return cleanup;
  }, [playParam, downloadModalOpen, serverPickerData, qualityPickerData, setSearchParams]);

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
      setEpisodeProgress(anime.id, epParam);
      addToRecentlyViewed(anime, epParam);
    }
  }, [anime, epParam, setEpisodeProgress, addToRecentlyViewed]);

  const handleEpisodeSelect = useCallback((newEp) => {
    const wasFs = fsActiveRef.current;
    if (wasFs) {
      keepFsRef.current = true;
      setEpTransitionFs(true);
      setTimeout(() => { keepFsRef.current = false; }, 800);
    } else {
      setEpTransitionFs(false);
    }
    setSearchParams({ play: 'true', ep: String(newEp) }, { replace: true });
  }, [setSearchParams]);

  if (loading && !playParam) {
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
        onPlay={() => setSearchParams({ play: 'true', ep: String(resumeEp) }, { replace: true })}
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
          <EpisodeGrid
            episodes={allEps.map(n => ({ number: n }))}
            currentEp={epParam || resumeEp}
            onSelectEp={handleEpisodeSelect}
            watchedEps={new Set(prog?.episode ? Array.from({ length: prog.episode - 1 }, (_, i) => i + 1) : [])}
          />
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
          loadStream={loadStream}
          extracting={extracting}
          streamErr={streamErr}
          audioTrack={audioTrack}
          onAudioTrackChange={(trk) => {
            localStorage.setItem('anilab_preferred_track', trk);
            setAudioTrack(trk);
            const targetList = trk === 'dub' ? dubServers : subServers;
            if (targetList.length > 0) selectServer(targetList[0], servers);
          }}
          onSelectServer={selectServer}
          onRetryFetch={fetchStream}
          onBack={() => setSearchParams({}, { replace: true })}
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
        />
      )}

      {/* 5. Drawers for Offline Downloads */}
      <DownloadListModal
        open={downloadModalOpen && !serverPickerData && !qualityPickerData}
        onOpenChange={setDownloadModalOpen}
        anime={anime}
        allEps={allEps}
        downloadAudioTrack={downloadAudioTrack}
        onAudioTrackChange={setDownloadAudioTrack}
        downloadedSet={downloadedSet}
        downloadProgress={downloadProgress}
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
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page">
      <div className="skeleton" style={{ height: 280, borderRadius: 0 }} />
      <div style={{ padding: '12px 16px' }}>
        <div className="skeleton" style={{ height: 28, width: '75%', borderRadius: 6, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 13, width: '50%', borderRadius: 4, marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div className="skeleton" style={{ flex: 1, height: 46, borderRadius: 10 }} />
          <div className="skeleton" style={{ flex: 1, height: 46, borderRadius: 10 }} />
        </div>
        <div className="skeleton" style={{ height: 72, borderRadius: 8, marginBottom: 20 }} />
      </div>
    </div>
  );
}
