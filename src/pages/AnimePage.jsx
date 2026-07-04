import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft, Share2, Bookmark, Star, Play, Download,
  Plus, Check, ChevronDown, ChevronUp, RefreshCw,
  AlertCircle, Search as SearchIcon, ChevronLeft, ChevronRight,
  Clock, CheckCircle, Tv, Wifi, WifiOff, Loader, Heart
} from 'lucide-react';
import { getAnimeDetail, getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';
import AnimeCard from '../components/AnimeCard';
import { getAniNekoServers, getCachedServers, checkProxy } from '../api/stream';
import AniPlayer   from '../components/AniPlayer';
import IframePlayer from '../components/IframePlayer';
import { scrapeEmbedNative } from '../api/embedScraper';



export default function AnimePage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const {
    watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, updateWatchlistStatus,
    toggleFavorite, isFavorite, getEpisodeProgress,
    setEpisodeProgress, addToRecentlyViewed, showToast
  } = useApp();
  const [anime,    setAnime]    = useState(null);
  const [state,    setState]    = useState('loading');
  const [errMsg,   setErrMsg]   = useState('');
  const [tab,      setTab]      = useState('episodes');
  const [synOpen,  setSynOpen]  = useState(false);
  const [epQuery,  setEpQuery]  = useState('');
  const [epPage,   setEpPage]   = useState(1); // pagination for episode list
  const [scrolled, setScrolled] = useState(false);
  const EP_PER_PAGE = 50;

  // Search parameters for inline watching
  const [searchParams, setSearchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';
  const epParam = parseInt(searchParams.get('ep')) || null;

  // Stream/Player State
  const [servers,       setServers]      = useState([]);
  const [activeUrl,     setActiveUrl]    = useState('');
  const [activeName,    setActiveName]   = useState('');
  const [activeType,    setActiveType]   = useState('sub');
  const [audioTrack,    setAudioTrack]   = useState(() => localStorage.getItem('anilab_preferred_track') || 'sub');
  const [loadStream,    setLoadStream]   = useState(false);
  const [streamErr,     setStreamErr]    = useState(null);
  const [isActiveHLS,   setIsActiveHLS]  = useState(false);
  const [extracting,    setExtracting]   = useState(false);
  const [activeServer,  setActiveServer] = useState(null);
  const [fsActive,      setFsActive]     = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled((window.scrollY || document.documentElement.scrollTop) > 60);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
    };
  }, []);

  // Lock body scroll and prevent viewport shifts during video playback
  useEffect(() => {
    if (playParam && epParam) {
      document.body.style.overflow = 'hidden';
      document.body.style.height = '100vh';
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.height = '100vh';
    } else {
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    };
  }, [playParam, epParam]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await getAnimeDetail(Number(id));
      setAnime(data);
      setState('done');
    } catch (e) {
      setErrMsg(e.message || 'Failed to load');
      setState('error');
    }
  }, [id]);

  useEffect(() => { window.scrollTo(0, 0); load(); }, [load]);

  // Robust server selection
  const selectServer = useCallback(async (srv, srvList) => {
    setActiveServer(srv);
    setStreamErr(null);
    setExtracting(false);

    const listToUse = srvList || [];
    const sameTypeServers = srv.type === 'dub' 
      ? listToUse.filter(s => s.type === 'dub') 
      : listToUse.filter(s => s.type === 'sub');
    
    const currentIndex = sameTypeServers.findIndex(s => s.videoUrl === srv.videoUrl);

    const handleScrapeError = () => {
      if (currentIndex !== -1 && currentIndex < sameTypeServers.length - 1) {
        const nextSrv = sameTypeServers[currentIndex + 1];
        console.log(`[AnimePage] Server ${srv.name} failed. Falling back to: ${nextSrv.name}`);
        selectServer(nextSrv, listToUse);
      } else {
        setStreamErr('Unable to load stream. Please tap retry or select another server.');
      }
    };

    const isEmbedServer = !srv.isHLS && srv.embedUrl;
    if (isEmbedServer) {
      const embedUrl = srv.embedUrl;
      const referer  = srv.referer || 'https://aniwaves.ru/';

      if (Capacitor.isNativePlatform()) {
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);
        setActiveUrl('');
        setExtracting(true);

        scrapeEmbedNative(embedUrl, referer, 40000)
          .then(m3u8Url => {
            setExtracting(false);
            setActiveUrl(m3u8Url);
            setIsActiveHLS(true);
          })
          .catch(err => {
            console.warn('[AnimePage] Native scraper failed:', err.message);
            setExtracting(false);
            handleScrapeError();
          });
        return;
      } else {
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);
        setActiveUrl(embedUrl);
        setExtracting(false);
        return;
      }
    }

    setActiveUrl(srv.videoUrl);
    setActiveName(srv.name);
    setActiveType(srv.type || 'sub');
    setIsActiveHLS(!!srv.isHLS);
    setExtracting(false);
  }, []);

  const fetchStream = useCallback(async () => {
    if (!anime || !epParam) return;

    const cachedResult = getCachedServers(anime, epParam);
    if (cachedResult?.servers?.length) {
      setStreamErr(null);
      setServers(cachedResult.servers);
      
      const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
      let matchingServers = cachedResult.servers.filter(s => s.type === preferredTrack);
      if (matchingServers.length === 0) {
        matchingServers = cachedResult.servers.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
      }
      const preferred = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
                     || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name))
                     || matchingServers[0]
                     || cachedResult.servers[0];
      
      setActiveType(preferred.type || 'sub');
      setAudioTrack(preferred.type || 'sub');
      selectServer(preferred, cachedResult.servers);

      const nextEp = epParam + 1;
      const maxEps = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : (anime.episodes || 999);
      if (nextEp <= maxEps) {
        getAniNekoServers(anime, nextEp).catch(() => {});
      }
      setLoadStream(false);
      return;
    }

    setLoadStream(true);
    setStreamErr(null);
    setServers([]);
    setActiveUrl('');
    setActiveName('');
    setActiveServer(null);

    const handleFound = (currentServers) => {
      setServers(currentServers);
      
      setActiveServer(prev => {
        if (prev) return prev;
        
        const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
        let matchingServers = currentServers.filter(s => s.type === preferredTrack);
        if (matchingServers.length === 0) {
          matchingServers = currentServers.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
        }
        const preferred = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
                       || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name))
                       || matchingServers[0]
                       || currentServers[0];
        
        if (preferred) {
          setActiveType(preferred.type || 'sub');
          setAudioTrack(preferred.type || 'sub');
          selectServer(preferred, currentServers);
          setLoadStream(false);
          setStreamErr(null);
        }
        return preferred;
      });
    };

    try {
      const result = await getAniNekoServers(anime, epParam, handleFound);
      if (!result?.servers?.length) {
        setStreamErr('No streaming servers available for this episode.');
      } else {
        const nextEp = epParam + 1;
        const maxEps = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : (anime.episodes || 999);
        if (nextEp <= maxEps) {
          getAniNekoServers(anime, nextEp).catch(() => {});
        }
      }
    } catch (e) {
      setServers(prev => {
        if (prev.length === 0) {
          setStreamErr('Unable to connect to streaming servers. Please try again.');
        }
        return prev;
      });
    } finally {
      setLoadStream(false);
    }
  }, [anime, epParam, selectServer]);

  // Load stream when epParam changes
  useEffect(() => {
    if (playParam && epParam) {
      fetchStream();
    }
  }, [epParam, playParam, fetchStream]);

  // Track episode watch history progress
  useEffect(() => {
    if (anime && epParam) {
      setEpisodeProgress(anime.id, epParam);
      addToRecentlyViewed(anime, epParam);

      // If all episodes watched, mark as completed
      if (totalEps > 0 && epParam === totalEps) {
        const currentItem = watchlist[anime.id];
        if (!currentItem) {
          addToWatchlist(anime, 'completed');
          showToast('Completed! 🎉');
        } else if (currentItem.status !== 'completed') {
          updateWatchlistStatus(anime.id, 'completed');
          showToast('Completed! 🎉');
        }
      }
    }
  }, [anime, epParam, totalEps, watchlist, addToWatchlist, updateWatchlistStatus, setEpisodeProgress, addToRecentlyViewed, showToast]);

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');

  /* ── Loading ───────────────────────────────────────────────── */
  if (state === 'loading') return <DetailSkeleton />;

  /* ── Error ─────────────────────────────────────────────────── */
  if (state === 'error') {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <AlertCircle size={52} color="#e50914" style={{ marginBottom: 12, opacity: 0.8 }} />
        <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Couldn't load anime</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 260, marginBottom: 20 }}>{errMsg}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={load}><RefreshCw size={15} /> Retry</button>
          <button className="btn btn-outline" onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  /* ── Data ──────────────────────────────────────────────────── */
  const title   = getTitle(anime);
  const cover   = getCover(anime);
  const score   = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const eps     = anime.episodes || 0;
  const studios = anime.studios?.nodes?.map(s => s.name).join(', ') || '';
  const desc    = (anime.description || 'No description available.')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
  const inList  = isInWatchlist(anime.id);
  const fav     = isFavorite(anime.id);
  const prog    = getEpisodeProgress(anime.id);
  // ── Fix: isNotReleased was hardcoded false — now checks real status ──
  const isNotReleased = anime.status === 'NOT_YET_RELEASED' || (eps === 0 && !anime.nextAiringEpisode);
  const totalEps = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1)
    ? anime.nextAiringEpisode.episode - 1 
    : (eps || 0);
  const resumeEp = prog?.episode ? Math.min(prog.episode, Math.max(totalEps, 1)) : 1;
  const allEps   = Array.from({ length: totalEps }, (_, i) => i + 1);
  const filtered = epQuery ? allEps.filter(n => String(n).includes(epQuery.trim())) : allEps;
  // Pagination
  const totalPages = Math.ceil(filtered.length / EP_PER_PAGE);
  const filteredPage = filtered.slice((epPage - 1) * EP_PER_PAGE, epPage * EP_PER_PAGE);
  const recs     = anime.recommendations?.nodes?.map(n => n.mediaRecommendation).filter(Boolean) || [];
  const chars    = (anime.characters?.edges || []).map(e => ({ ...e.node, voiceActors: e.voiceActors || [] }));

  return (
    <div className="page" style={{ position: 'relative' }}>

      <div style={{
        position: 'fixed', top: 0, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        width: '100%', maxWidth: 480,
        padding: 'calc(12px + env(safe-area-inset-top)) 16px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(15, 15, 15, 0.75)' : 'rgba(15, 15, 15, 0)',
        backdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
        WebkitBackdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid rgba(255, 255, 255, 0)',
        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'none',
      }}>
        <button
          onClick={() => navigate(-1)} id="detail-back"
          className="floating-btn"
          style={{ pointerEvents: 'all' }}
          aria-label="Go back"
        ><ArrowLeft size={18} /></button>

        {/* Title visible only when scrolled */}
        <div style={{
          flex: 1, textAlign: 'center', padding: '0 12px',
          opacity: scrolled ? 1 : 0,
          transform: scrolled ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          fontWeight: 800, fontSize: 15, color: '#fff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontFamily: 'var(--font-brand)'
        }}>
          {title}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'all' }}>
          <button
            onClick={() => inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime)} id={`fav-${anime.id}`}
            aria-label="Bookmark"
            className="floating-btn"
          >
            <Bookmark size={18} color={inList ? '#e50914' : '#fff'} fill={inList ? '#e50914' : 'none'} />
          </button>
          <button
            id="share-btn"
            aria-label="Share"
            className="floating-btn"
          >
            <Share2 size={18} />
          </button>
        </div>
      </div>

      {/* ── Content Wrapper with Entrance Animation ────────────────── */}
      <div className="fade-in-up">
        {/* ════════════════════════════════════════
            HERO COVER IMAGE
        ════════════════════════════════════════ */}
        <div style={{ position: 'relative', width: '100%', height: 210, overflow: 'hidden', background: '#111' }}>
          <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <img
              src={cover} alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(20px) brightness(0.35)', transform: 'scale(1.15)', display: 'block' }}
            />
            <img
              src={cover} alt={title}
              style={{ height: '85%', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.65)', zIndex: 2, objectFit: 'contain' }}
            />
          </div>
          {/* Gradient fade to black at bottom */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(15,15,15,0.6) 60%, rgba(15,15,15,1) 100%)',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
        </div>

        {/* ════════════════════════════════════════
            SERVER SELECTION ROW
        ════════════════════════════════════════ */}
        {playParam && epParam && servers.length > 0 && (
          <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Select Server
            </p>

            {/* Segmented Control for Sub / Dub */}
            <div style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 24,
              padding: 3,
              marginBottom: 10,
              border: '1px solid var(--border)'
            }}>
              <button
                disabled={subServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'sub');
                  setAudioTrack('sub');
                  if (subServers.length > 0) selectServer(subServers[0], servers);
                }}
                style={{
                  flex: 1, padding: '6px 0', border: 'none',
                  background: audioTrack === 'sub' ? 'var(--accent)' : 'transparent',
                  color: subServers.length === 0 
                    ? 'rgba(255,255,255,0.15)' 
                    : (audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)'),
                  opacity: subServers.length === 0 ? 0.35 : 1,
                  fontSize: 11, fontWeight: 700, borderRadius: 20,
                  cursor: subServers.length === 0 ? 'not-allowed' : 'pointer', 
                  transition: 'all 0.2s'
                }}
              >
                Subtitled (SUB)
              </button>
              <button
                disabled={dubServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'dub');
                  setAudioTrack('dub');
                  if (dubServers.length > 0) selectServer(dubServers[0], servers);
                }}
                style={{
                  flex: 1, padding: '6px 0', border: 'none',
                  background: audioTrack === 'dub' ? 'var(--accent)' : 'transparent',
                  color: dubServers.length === 0 
                    ? 'rgba(255,255,255,0.15)' 
                    : (audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)'),
                  opacity: dubServers.length === 0 ? 0.35 : 1,
                  fontSize: 11, fontWeight: 700, borderRadius: 20,
                  cursor: dubServers.length === 0 ? 'not-allowed' : 'pointer', 
                  transition: 'all 0.2s'
                }}
              >
                Dubbed (DUB)
              </button>
            </div>

            {/* Active Track Server List */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(audioTrack === 'sub' ? subServers : dubServers).map((s, idx) => {
                const active = activeServer?.videoUrl === s.videoUrl;
                return (
                  <button
                    key={idx}
                    onClick={() => selectServer(s, servers)}
                    style={{
                      padding: '6px 12px', borderRadius: 20,
                      background: active ? 'var(--accent)' : 'var(--bg-card)',
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      color: active ? '#fff' : 'var(--text-secondary)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                      transition: 'all 0.25s'
                    }}
                  >
                    {active && <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            TITLE ROW
        ════════════════════════════════════════ */}
        <div style={{ padding: '12px 16px 0' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-brand)', lineHeight: 1.2 }}>
            {title}
          </h1>
        </div>

      {/* ════════════════════════════════════════
          META BADGES ROW
      ════════════════════════════════════════ */}
      <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {score && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, fontWeight: 700, color: '#f5c518' }}>
            <Star size={13} fill="#f5c518" color="#f5c518" />{score}
          </div>
        )}
        {score && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>}
        {anime.startDate?.year && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{anime.startDate.year}</span>}
        <span className="card-badge badge-pg">PG-13</span>
        <span className="card-badge badge-hd">HD</span>
        {anime.format && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{anime.format.replace('_', ' ')}</span>
        )}
        {totalEps > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{totalEps} eps</span>}
      </div>

      {/* ════════════════════════════════════════
          PLAY + DOWNLOAD BUTTONS
      ════════════════════════════════════════ */}
      <div style={{ padding: '14px 16px 0', display: 'flex', gap: 10 }}>
        {isNotReleased ? (
          <div style={{
            flex: 1, textAlign: 'center', padding: '13px',
            fontSize: 14, fontWeight: 700, borderRadius: 10,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
          }}>
            <AlertCircle size={16} /> Not Yet Released
          </div>
        ) : (
          <>
            <button
              className="btn btn-primary"
              id={`play-${anime.id}`}
              style={{ flex: 1, justifyContent: 'center', padding: '13px', fontSize: 15, fontWeight: 700, borderRadius: 10 }}
              onClick={() => setSearchParams({ play: 'true', ep: String(resumeEp) })}
            >
              <Play size={17} fill="#fff" />
              {prog && resumeEp > 0 ? `Resume Ep ${resumeEp}` : 'Play'}
            </button>
            <button
              className="btn btn-primary"
              id={`dl-${anime.id}`}
              style={{
                flex: 1,
                justifyContent: 'center',
                padding: '13px',
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.05)',
                color: 'var(--text-muted)',
                opacity: 0.6,
                cursor: 'not-allowed'
              }}
              disabled
            >
              <Download size={17} />
              Downloads
            </button>
          </>
        )}
      </div>

      {/* ════════════════════════════════════════
          GENRE + SYNOPSIS WITH HEART BUTTON
      ════════════════════════════════════════ */}
      <div style={{ padding: '14px 16px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Genre */}
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Genre:</span>{' '}
            {anime.genres?.slice(0, 6).join(', ')}
            {studios ? ` · Studio: ${studios}` : ''}
          </p>

          {/* Description */}
          <p style={{
            fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75,
            display: '-webkit-box', WebkitBoxOrient: 'vertical',
            WebkitLineClamp: synOpen ? 'unset' : 4,
            overflow: 'hidden',
          }}>{desc}</p>
          <button onClick={() => setSynOpen(v => !v)} id="syn-toggle"
            style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 4, display: 'flex', alignItems: 'center', gap: 2, border: 'none', background: 'none' }}
          >
            {synOpen ? <>View Less <ChevronUp size={12} /></> : <>... View More <ChevronDown size={12} /></>}
          </button>
        </div>

        {/* Heart button */}
        <button
          onClick={() => toggleFavorite(anime.id, anime)}
          id={`fav-btn-syn-${anime.id}`}
          style={{
            background: fav ? 'rgba(229,9,20,0.1)' : 'rgba(255,255,255,0.05)',
            border: `1.5px solid ${fav ? '#e50914' : 'var(--border)'}`,
            borderRadius: 12, width: 44, height: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s'
          }}
          aria-label="Add to favorites"
        >
          <Heart size={20} color={fav ? '#e50914' : '#fff'} fill={fav ? '#e50914' : 'none'} />
        </button>
      </div>

      {/* ════════════════════════════════════════
          TABS
      ════════════════════════════════════════ */}
      <div style={{ marginTop: 20, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', padding: '0 16px' }}>
          {[
            { k: 'episodes',   l: 'Episodes' },
            { k: 'similar',    l: `More like this` },
            { k: 'characters', l: 'Characters' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} id={`tab-${t.k}`}
              style={{
                padding: '12px 12px',
                fontSize: 13, fontWeight: tab === t.k ? 700 : 500,
                color: tab === t.k ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: tab === t.k ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}
            >{t.l}</button>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════
          TAB CONTENT
      ════════════════════════════════════════ */}
      <div style={{ padding: '16px 16px 0' }}>

        {/* ── EPISODES ─────────────────────────────────────────── */}
        {tab === 'episodes' && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>
                Episodes
                {totalEps > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>{totalEps} total</span>}
              </span>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg-card)', borderRadius: 8, padding: '6px 10px',
                border: '1px solid var(--border)',
              }}>
                <SearchIcon size={12} color="var(--text-muted)" />
                <input
                  type="number" placeholder="Go to ep..." value={epQuery} min={1}
                  onChange={e => { setEpQuery(e.target.value); setEpPage(1); }}
                  id="ep-search"
                  style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 12, width: 80 }}
                />
              </div>
            </div>

            {/* Episode List — clean Netflix-style numbered rows */}
            {isNotReleased || totalEps === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
                <AlertCircle size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                <p>No episodes available yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredPage.map(n => {
                  const isWatched = prog?.episode > n;
                  const isCurrent = prog?.episode === n;
                  return (
                    <div
                      key={n}
                      onClick={() => {
                        setSearchParams({ play: 'true', ep: String(n) });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      id={`ep-card-${n}`}
                      role="button" tabIndex={0}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '12px 4px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer',
                        borderRadius: 8,
                        transition: 'background 0.15s',
                        background: isCurrent ? 'rgba(229,9,20,0.06)' : 'transparent',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = isCurrent ? 'rgba(229,9,20,0.06)' : 'transparent'}
                    >
                      {/* Episode number */}
                      <span style={{
                        width: 40, textAlign: 'center', fontSize: 16, fontWeight: 800,
                        color: isCurrent ? 'var(--accent)' : isWatched ? 'rgba(255,255,255,0.2)' : 'var(--text-muted)',
                        flexShrink: 0,
                      }}>{n}</span>

                      {/* Status bar on left */}
                      <div style={{
                        width: 3, height: 32, borderRadius: 3, flexShrink: 0,
                        background: isCurrent ? 'var(--accent)' : isWatched ? 'rgba(76,175,80,0.6)' : 'rgba(255,255,255,0.08)',
                      }} />

                      {/* Label */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: isWatched ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                          Episode {n}
                        </div>
                        {isCurrent && (
                          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, fontWeight: 600 }}>▶ Resume here</div>
                        )}
                        {isWatched && !isCurrent && (
                          <div style={{ fontSize: 11, color: 'rgba(76,175,80,0.8)', marginTop: 2 }}>✓ Watched</div>
                        )}
                      </div>

                      {/* Play icon */}
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: isCurrent ? 'var(--accent)' : 'rgba(255,255,255,0.07)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}>
                        <Play size={13} fill={isCurrent ? '#fff' : 'rgba(255,255,255,0.6)'} color={isCurrent ? '#fff' : 'rgba(255,255,255,0.6)'} />
                      </div>
                    </div>
                  );
                })}

                {/* Pagination controls */}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, paddingBottom: 8 }}>
                    <button
                      onClick={() => setEpPage(p => Math.max(1, p - 1))}
                      disabled={epPage <= 1}
                      style={{
                        padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                        background: epPage <= 1 ? 'rgba(255,255,255,0.03)' : 'var(--bg-card)',
                        border: '1px solid var(--border)', color: epPage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                        cursor: epPage <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <ChevronLeft size={14} /> Prev
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Page {epPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setEpPage(p => Math.min(totalPages, p + 1))}
                      disabled={epPage >= totalPages}
                      style={{
                        padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                        background: epPage >= totalPages ? 'rgba(255,255,255,0.03)' : 'var(--bg-card)',
                        border: '1px solid var(--border)', color: epPage >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                        cursor: epPage >= totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MORE LIKE THIS ───────────────────────────────────── */}
        {tab === 'similar' && (
          <div style={{ paddingBottom: 16 }}>
            {!recs.length ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <p className="empty-sub">No recommendations yet</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {recs.map(r => <AnimeCard key={r.id} anime={r} width="100%" height={148} />)}
              </div>
            )}
          </div>
        )}

        {/* ── CHARACTERS ───────────────────────────────────────── */}
        {tab === 'characters' && (
          <div style={{ paddingBottom: 16 }}>
            {!chars.length ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <p className="empty-sub">No character data</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {chars.map(c => {
                  const va = c.voiceActors?.[0];
                  return (
                    <div key={c.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--bg-card)', borderRadius: 12, padding: '10px 12px',
                    }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <img src={c.image?.large} alt={c.name?.full}
                          style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: '#222', flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name?.full}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Character</div>
                        </div>
                      </div>
                      {va && (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{va.name?.full}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Voice Actor</div>
                          </div>
                          <img src={va.image?.large} alt={va.name?.full}
                            style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: '#222', flexShrink: 0 }}
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ── PLAYER SCREEN / OVERLAY WINDOW (PORTAL) ──────────────── */}
    {playParam && epParam && createPortal(
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: '#000000', display: 'flex', flexDirection: 'column',
        paddingTop: fsActive ? 0 : 'env(safe-area-inset-top)',
        boxSizing: 'border-box',
      }} className="fade-in">
        
        {/* 1. Player Box */}
        <div style={{
          position: 'relative',
          width: '100%',
          height: fsActive ? '100%' : 'auto',
          aspectRatio: fsActive ? 'unset' : '16/9',
          flex: fsActive ? 1 : 'unset',
          background: '#000',
          overflow: fsActive ? 'visible' : 'hidden'
        }}>
          {loadStream && servers.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 12 }}>
              <Loader size={30} className="spin" color="var(--accent)" />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Searching servers...</p>
            </div>
          ) : extracting ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 12 }}>
              <Loader size={30} className="spin" color="var(--accent)" />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Resolving stream sources...</p>
            </div>
          ) : streamErr ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 12, padding: 20 }}>
              <AlertCircle size={32} color="#e50914" />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 260 }}>{streamErr}</p>
              <button className="btn btn-primary" onClick={fetchStream} style={{ padding: '6px 16px', borderRadius: 20, fontSize: 12 }}>
                ↺ Retry
              </button>
            </div>
          ) : activeUrl ? (
            isActiveHLS ? (
              <AniPlayer
                url={activeUrl}
                title={`${title} - Episode ${epParam}`}
                referer={activeServer?.referer}
                embedUrl={activeServer?.embedUrl}
                subtitles={activeServer?.subtitles || []}
                onBack={() => setSearchParams({})}
                onFullscreenChange={setFsActive}
              />
            ) : (
              <IframePlayer
                url={activeUrl}
                onBack={() => setSearchParams({})}
              />
            )
          ) : null}
        </div>

        {/* 2. Toolbar / Navigation for Player Overlay */}
        {!fsActive && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'rgba(255,255,255,0.01)'
          }}>
            <button
              onClick={() => setSearchParams({})}
              className="floating-btn"
              style={{ width: 32, height: 32 }}
            >
              <ArrowLeft size={16} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Now Playing
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Episode {epParam} · {title}
              </div>
            </div>
          </div>
        )}

        {/* 3. Server Row & Audio selector inside player screen */}
        {!fsActive && servers.length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            {/* Segmented Control for Sub / Dub */}
            <div style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 24,
              padding: 3,
              marginBottom: 8,
              border: '1px solid var(--border)'
            }}>
              <button
                disabled={subServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'sub');
                  setAudioTrack('sub');
                  if (subServers.length > 0) selectServer(subServers[0], servers);
                }}
                style={{
                  flex: 1, padding: '5px 0', border: 'none',
                  background: audioTrack === 'sub' ? 'var(--accent)' : 'transparent',
                  color: subServers.length === 0 ? 'rgba(255,255,255,0.15)' : (audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)'),
                  fontSize: 10, fontWeight: 700, borderRadius: 20,
                }}
              >
                Subtitled (SUB)
              </button>
              <button
                disabled={dubServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'dub');
                  setAudioTrack('dub');
                  if (dubServers.length > 0) selectServer(dubServers[0], servers);
                }}
                style={{
                  flex: 1, padding: '5px 0', border: 'none',
                  background: audioTrack === 'dub' ? 'var(--accent)' : 'transparent',
                  color: dubServers.length === 0 ? 'rgba(255,255,255,0.15)' : (audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)'),
                  fontSize: 10, fontWeight: 700, borderRadius: 20,
                }}
              >
                Dubbed (DUB)
              </button>
            </div>

            {/* Active Track Server List */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 60, overflowY: 'auto' }}>
              {(audioTrack === 'sub' ? subServers : dubServers).map((s, idx) => {
                const active = activeServer?.videoUrl === s.videoUrl;
                return (
                  <button
                    key={idx}
                    onClick={() => selectServer(s, servers)}
                    style={{
                      padding: '4px 10px', borderRadius: 20,
                      background: active ? 'var(--accent)' : 'var(--bg-card)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      color: active ? '#fff' : 'var(--text-secondary)',
                      fontSize: 10, fontWeight: 600,
                    }}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Episodes Scrollable List below */}
        {!fsActive && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            <h3 style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              Episodes ({totalEps})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allEps.map(n => {
                const isWatched = prog?.episode > n;
                const isCurrent = epParam === n;
                return (
                  <div
                    key={n}
                    onClick={() => {
                      setSearchParams({ play: 'true', ep: String(n) });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px', borderRadius: 8, cursor: 'pointer',
                      background: isCurrent ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.02)',
                      border: isCurrent ? '1px solid var(--accent)' : '1px solid transparent',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 800, color: isCurrent ? 'var(--accent)' : 'var(--text-muted)', width: 24, textAlign: 'center' }}>
                      {n}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Episode {n}</div>
                      {isWatched && <span style={{ fontSize: 10, color: '#4caf50' }}>✓ Watched</span>}
                    </div>
                    <Play size={12} fill={isCurrent ? 'var(--accent)' : 'rgba(255,255,255,0.4)'} color="transparent" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>,
      document.body
    )}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {Array.from({length: 6}).map((_,i) => (
            <div key={i}>
              <div className="skeleton" style={{ aspectRatio: '16/9', borderRadius: 10, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 10, borderRadius: 4, width: '60%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
