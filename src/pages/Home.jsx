import { useState, useEffect, useMemo } from 'react';
import { Search, Bell, Play, X, WifiOff, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getTrending, getTopRated,
  getAiring, getMovies,
  getNewReleases, getPopularThisSeason,
  getSchedule, getCurrentSeason, getCover, getTitle,
} from '../api/anilist';
import { useApp } from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import HeroBanner from '../components/HeroBanner';
import AnimeRow from '../components/AnimeRow';
import { imageCache } from '../components/AnimeCard';
import { checkAndTriggerEpisodeAlerts } from '../api/notifications';
import { withSWR, getCachedData } from '../utils/cache';

/* ══════════════════════════════════════════════════════════════════
   Continue Watching — individual card with remove action
══════════════════════════════════════════════════════════════════ */
function ContinueWatchingItem({ item, idx, onRemove, navigate }) {
  const [removing, setRemoving] = useState(false);
  const title = getTitle(item.anime);
  const cover = getCover(item.anime);
  const totalEps = item.anime.episodes || 24;
  const currentEp = item.ep || item.episode || 1;
  const progressPct = Math.min((currentEp / totalEps) * 100, 100);

  const isCached = cover ? imageCache.has(cover) : false;
  const [imgLoaded, setImgLoaded] = useState(isCached);

  const handleRemove = (e) => {
    e.stopPropagation();
    setRemoving(true);
    setTimeout(() => onRemove(item.anime.id), 400);
  };

  return (
    <div
      className="card-entrance"
      style={{
        flexShrink: 0,
        animationDelay: `${Math.min(idx * 15, 90)}ms`,
        minWidth: removing ? 0 : 130,
        width: 130,
        maxWidth: removing ? 0 : 130,
        opacity: removing ? 0 : 1,
        transform: removing ? 'scale(0.8) translateY(16px) rotate(-3deg)' : 'none',
        overflow: removing ? 'hidden' : 'visible',
        transition: 'all 0.42s cubic-bezier(0.34, 1.25, 0.64, 1)',
      }}
    >
      <div
        className="continue-watching-card"
        onClick={() => navigate(`/watch/${item.anime.id}/${currentEp}`)}
        style={{
          width: 130, height: 175, position: 'relative',
          borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
          background: '#1a1a24',
          boxShadow: '0 8px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset',
        }}
      >
        <img
          src={cover} alt={title}
          decoding="async"
          onLoad={() => {
            if (cover) imageCache.add(cover);
            setImgLoaded(true);
          }}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 0.22s cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        />
        {/* Gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0) 70%)',
        }} />

        {/* Episode info overlay */}
        <div style={{
          position: 'absolute', bottom: 8, left: 8, right: 8,
          zIndex: 3,
        }}>
          <span style={{
            fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600,
            display: 'block', marginBottom: 5,
          }}>
            EP {currentEp}{totalEps && totalEps !== 24 ? ` / ${totalEps}` : ''}
          </span>

          {/* Premium progress bar */}
          <div style={{
            height: 3, borderRadius: 2,
            background: 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, var(--accent), var(--accent2))',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        {/* Play overlay */}
        <div className="card-play-overlay">
          <div className="card-play-overlay-inner" style={{ width: 34, height: 34 }}>
            <Play size={15} color="#fff" fill="#fff" />
          </div>
        </div>

        {/* Remove button — always visible on mobile */}
        <button
          onClick={handleRemove}
          style={{
            position: 'absolute', top: 6, right: 6, zIndex: 5,
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(0,0,0,0.7)', border: '0.5px solid rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          }}
        ><X size={11} color="#fff" /></button>
      </div>
      <p style={{
        fontSize: 11, color: 'var(--text-secondary)',
        marginTop: 7, lineHeight: 1.3, fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        width: 130,
      }}>
        {title}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   HOME PAGE — Netflix-premium with full-viewport hero
══════════════════════════════════════════════════════════════════ */
export default function Home() {
  const navigate = useNavigate();
  const { watchlist, progress, recentlyViewed, favorites, unreadCount, removeFromRecentlyViewed } = useApp();

  const continueWatchingList = useMemo(() => {
    const seenMap = new Map();

    (recentlyViewed || []).forEach(item => {
      if (!item || !item.anime) return;
      const id = String(item.anime.id);
      const epNum = progress?.[id]?.episode || progress?.[id]?.ep || item.episode || item.ep || 1;
      if (!seenMap.has(id)) {
        seenMap.set(id, {
          anime: item.anime,
          ep: epNum,
          progress: item.progress || 0,
          timestamp: Math.max(progress?.[id]?.timestamp || 0, item.timestamp || 0),
        });
      }
    });

    Object.keys(progress || {}).forEach(id => {
      if (!seenMap.has(String(id))) {
        const item = progress[id];
        const animeMeta = watchlist?.[id]?.anime || favorites?.[id];
        if (item && animeMeta) {
          seenMap.set(String(id), {
            anime: animeMeta,
            ep: item.episode || item.ep || 1,
            progress: 0,
            timestamp: item.timestamp || 0,
          });
        }
      }
    });

    return Array.from(seenMap.values())
      .filter(item => {
        if (!item || !item.anime) return false;
        const id = String(item.anime.id);
        const wItem = watchlist?.[id];
        const isMovie = item.anime.format === 'MOVIE' || item.anime.episodes === 1;
        if (isMovie) return true;
        return !wItem || wItem.status !== 'completed' || item.timestamp > (wItem.updatedAt || 0);
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 15);
  }, [recentlyViewed, progress, watchlist, favorites]);

  // Synchronous cache reads for INSTANT, zero-skeleton page navigation
  const cachedTrending = getCachedData('trending') || [];
  const cachedAiring = getCachedData('airing') || [];
  const cachedNewReleases = getCachedData('newReleases') || [];
  const cachedPopularSeason = getCachedData('popularSeason') || [];
  const cachedTopRated = getCachedData('topRated') || [];
  const cachedMovies = getCachedData('movies') || [];

  const [trending, setTrending] = useState(cachedTrending);
  const [airing, setAiring] = useState(cachedAiring);
  const [newReleases, setNewReleases] = useState(cachedNewReleases);
  const [popularSeason, setPopularSeason] = useState(cachedPopularSeason);
  const [topRated, setTopRated] = useState(cachedTopRated);
  const [movies, setMovies] = useState(cachedMovies);
  const [popular, setPopular] = useState([]);
  const [weekSchedule, setWeekSchedule] = useState([]);
  const [scrolled, setScrolled] = useState(false);
  const [ready, setReady] = useState(cachedTrending.length > 0);
  const [apiError, setApiError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [loadingSections, setLoadingSections] = useState({
    trending: !cachedTrending.length,
    airing: !cachedAiring.length,
    newReleases: !cachedNewReleases.length,
    popularSeason: !cachedPopularSeason.length,
    topRated: !cachedTopRated.length,
    movies: !cachedMovies.length,
    schedule: true,
  });

  // Trigger native phone notifications for newly released episode alerts
  useEffect(() => {
    if (airing?.length > 0) {
      checkAndTriggerEpisodeAlerts(airing, watchlist);
    }
  }, [airing, watchlist]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled((window.scrollY || document.documentElement.scrollTop) > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (!live) return;

      // Parallel fetch — each section updates independently
      withSWR('trending', getTrending, 10).then(d => { if (live && d?.length) { setTrending(d); setReady(true); setLoadingSections(s => ({ ...s, trending: false })); } }).catch(e => { console.error('Trending fetch failed:', e); setApiError(e.message); setLoadingSections(s => ({ ...s, trending: false })); setReady(true); });
      withSWR('airing', getAiring, 10).then(d => { if (live && d?.length) { setAiring(d); setLoadingSections(s => ({ ...s, airing: false })); } }).catch(() => setLoadingSections(s => ({ ...s, airing: false })));
      withSWR('newReleases', getNewReleases, 10).then(d => { if (live && d?.length) { setNewReleases(d); setLoadingSections(s => ({ ...s, newReleases: false })); } }).catch(() => setLoadingSections(s => ({ ...s, newReleases: false })));
      withSWR('popularSeason', getPopularThisSeason, 10).then(d => { if (live && d?.length) { setPopularSeason(d); setLoadingSections(s => ({ ...s, popularSeason: false })); } }).catch(() => setLoadingSections(s => ({ ...s, popularSeason: false })));
      withSWR('topRated', getTopRated, 30).then(d => { if (live && d?.length) { setTopRated(d); setLoadingSections(s => ({ ...s, topRated: false })); } }).catch(() => setLoadingSections(s => ({ ...s, topRated: false })));
      withSWR('movies', getMovies, 30).then(d => { if (live && d?.length) { setMovies(d); setLoadingSections(s => ({ ...s, movies: false })); } }).catch(() => setLoadingSections(s => ({ ...s, movies: false })));

      // Schedule
      getSchedule().then(d => {
        if (!live) return;
        const now = Date.now() / 1000;
        const weekAnime = d.filter(a => {
          const diff = (a.nextAiringEpisode?.airingAt || a._schedAt || 0) - now;
          return diff > 0 && diff < 7 * 86400;
        }).sort((a, b) => (a.nextAiringEpisode?.airingAt || a._schedAt || 0) - (b.nextAiringEpisode?.airingAt || b._schedAt || 0));
        setWeekSchedule(weekAnime);
        setLoadingSections(s => ({ ...s, schedule: false }));
      }).catch(() => setLoadingSections(s => ({ ...s, schedule: false })));
    }, 30);

    return () => { live = false; clearTimeout(timer); };
  }, [retryCount]);

  if (!ready) return <HomeSkeleton />;

  // AniList is globally down — show a clear error screen
  if (apiError && trending.length === 0) {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: '0 24px', textAlign: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, background: 'var(--bg-elevated)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
          border: '0.5px solid var(--border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <WifiOff size={30} color="var(--text-muted)" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text-primary)', marginBottom: 10 }}>Service Unavailable</h2>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 300, marginBottom: 28, letterSpacing: '-0.1px' }}>
          {apiError}
        </p>
        <button
          onClick={() => { setApiError(null); setReady(false); setRetryCount(c => c + 1); }}
          style={{
            padding: '14px 36px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
            color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.2px',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 8px 32px -6px var(--accent-glow)',
          }}
        >
          <RefreshCw size={16} />
          Try Again
        </button>
      </div>
    );
  }

  // Personalize rows using K-Nearest Neighbors based on watch history
  const personalizedAiring = rankAnimeByKnn(airing, recentlyViewed);
  const personalizedNewReleases = rankAnimeByKnn(newReleases, recentlyViewed);
  const personalizedPopularSeason = rankAnimeByKnn(popularSeason, recentlyViewed);
  const personalizedTrending = rankAnimeByKnn(trending, recentlyViewed);
  const personalizedTopRated = rankAnimeByKnn(topRated.filter(a => a.format === 'TV'), recentlyViewed);
  const personalizedMovies = rankAnimeByKnn(movies, recentlyViewed);

  return (
    <div className="page" style={{ position: 'relative' }}>

      {/* ══════════════════════════════════════════════════════════
          FLOATING HEADER — liquid glass, overlaps hero image
      ══════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'fixed', top: 0, left: '50%',
        transform: 'translateX(-50%) translateZ(0)',
        WebkitTransform: 'translateX(-50%) translateZ(0)',
        zIndex: 90,
        width: '100%', maxWidth: 480,
        padding: '12px 16px 12px',
        paddingTop: 'var(--sat)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(4, 4, 10, 0.78)' : 'transparent',
        backdropFilter: scrolled ? 'blur(32px) saturate(200%) brightness(0.65)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(32px) saturate(200%) brightness(0.65)' : 'none',
        borderBottom: scrolled ? '0.5px solid rgba(255, 255, 255, 0.06)' : '0.5px solid transparent',
        boxShadow: scrolled ? '0 1px 0 0 rgba(255,255,255,0.03), 0 4px 30px rgba(0,0,0,0.5)' : 'none',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform',
        isolation: 'isolate',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'all', cursor: 'pointer', opacity: scrolled ? 1 : 0.95, transition: 'opacity 0.2s' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{
            width: 28, height: 28, background: 'linear-gradient(135deg, var(--accent), var(--accent2))', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px var(--accent-glow)',
          }}><Play size={13} color="#fff" fill="#fff" /></div>
          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-brand)', color: '#fff', letterSpacing: -0.5 }}>AniPlay</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'all' }}>
          <button
            onClick={() => navigate('/browse')}
            id="home-search"
            aria-label="Search"
            className="floating-btn"
          ><Search size={18} /></button>
          <button
            id="home-bell"
            aria-label="Notifications"
            className="floating-btn"
            style={{ position: 'relative' }}
            onClick={() => navigate('/notifications')}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 3, right: 3, width: 8, height: 8,
                borderRadius: '50%', background: '#e50914', boxShadow: '0 0 8px #e50914',
                border: '1.5px solid var(--bg-primary)'
              }} />
            )}
          </button>
        </div>
      </div>

      {/* ── Hero Banner — OUTSIDE fade-in-up, never shifted by entrance animation ── */}
      <div style={{ position: 'relative' }}>
        {trending.length > 0
          ? <HeroBanner animes={trending} />
          : (
            <div style={{
              width: '100%', height: '55vh', maxHeight: 480, minHeight: 340,
              background: 'linear-gradient(180deg, #0a0a14 0%, var(--bg-primary, #04040a) 100%)',
            }} />
          )
        }
      </div>

      {/* ── Content Wrapper with Entrance Animation (sections only) ─────── */}
      <div className="fade-in-up">

        {/* 1. Continue Watching */}
        {continueWatchingList && continueWatchingList.length > 0 && (
          <section className="home-section" style={{ position: 'relative', marginTop: 16 }}>
            <div className="section-header">
              <h2 className="section-title">Continue Watching</h2>
            </div>
            <div className="h-scroll">
              {continueWatchingList.map((item, idx) => (
                <ContinueWatchingItem
                  key={item.anime.id || idx}
                  item={item}
                  idx={idx}
                  onRemove={removeFromRecentlyViewed}
                  navigate={navigate}
                />
              ))}
            </div>
          </section>
        )}

        {/* 2. New Episode Releases */}
        {loadingSections.newReleases ? (
          <RowSkeleton title="New Episode Releases" subtitle="Last 2 weeks" />
        ) : personalizedNewReleases.length > 0 ? (
          <AnimeRow
            title="New Episode Releases"
            subtitle="Last 2 weeks"
            animes={personalizedNewReleases}
            showEpBadge
            onSeeAll={() => navigate('/browse?category=new-releases')}
          />
        ) : null}

        {/* 3. Top Airing */}
        {loadingSections.airing ? (
          <RowSkeleton title="Top Airing" subtitle="Trending now" />
        ) : personalizedAiring.length > 0 ? (
          <AnimeRow
            title="Top Airing"
            subtitle="Trending now"
            animes={personalizedAiring}
            onSeeAll={() => navigate('/browse?category=airing')}
          />
        ) : null}

        {/* 4. Airing This Week */}
        {loadingSections.schedule ? (
          <RowSkeleton title="Airing This Week" subtitle="Next 7 days" count={6} cardWidth={100} cardHeight={140} />
        ) : weekSchedule.length > 0 ? (
          <section className="home-section">
            <div className="section-header">
              <div>
                <h2 className="section-title">Airing This Week</h2>
                <span className="section-subtitle">Next 7 days</span>
              </div>
              <button
                className="see-all"
                onClick={() => navigate('/schedule')}
              >
                See all
              </button>
            </div>
            <div className="scroll-row-wrapper">
              <div className="h-scroll">
                {weekSchedule.slice(0, 15).map((anime, idx) => {
                  const airedDate = anime._schedAt
                    ? new Date(anime._schedAt * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                    : '';
                  return (
                    <div
                      key={anime.id || idx}
                      className="anime-card-wrap card-entrance"
                      style={{ width: 100, animationDelay: `${Math.min(idx * 15, 90)}ms` }}
                    >
                      <div
                        className="anime-card"
                        style={{ width: 100, height: 140 }}
                        onClick={() => navigate(`/anime/${anime.id}`)}
                        role="button"
                        tabIndex={0}
                        aria-label={getTitle(anime)}
                      >
                        <img src={getCover(anime)} alt={getTitle(anime)} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 55%)',
                          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '6px',
                          zIndex: 2,
                        }}>
                          {anime._schedEp && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--accent)', padding: '2px 5px', borderRadius: 3, width: 'fit-content', marginBottom: 3 }}>
                              EP {anime._schedEp}
                            </span>
                          )}
                          {airedDate && (
                            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{airedDate}</span>
                          )}
                        </div>
                        <div className="card-play-overlay">
                          <div className="card-play-overlay-inner" style={{ width: 28, height: 28 }}>
                            <Play size={12} color="#fff" fill="#fff" />
                          </div>
                        </div>
                      </div>
                      <p className="card-label" style={{ width: 100 }}>{getTitle(anime)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        {/* 5. Popular This Season */}
        {loadingSections.popularSeason ? (
          <RowSkeleton
            title="Popular This Season"
            subtitle={(() => { const { season, year } = getCurrentSeason(); return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`; })()}
          />
        ) : personalizedPopularSeason.length > 0 ? (
          <AnimeRow
            title="Popular This Season"
            subtitle={(() => { const { season, year } = getCurrentSeason(); return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`; })()}
            animes={personalizedPopularSeason}
            onSeeAll={() => navigate('/browse?category=seasonal')}
          />
        ) : null}

        {/* 6. Top Trending — Netflix-style with rank numbers */}
        {loadingSections.trending ? (
          <RowSkeleton title="Top Trending" subtitle="All time" cardWidth={130} cardHeight={180} />
        ) : personalizedTrending.length > 0 ? (
          <AnimeRow
            title="Top Trending"
            subtitle="All time"
            animes={personalizedTrending}
            cardWidth={130}
            cardHeight={180}
            showRank
            onSeeAll={() => navigate('/browse?category=trending')}
          />
        ) : null}

        {/* 7. Top TV Series */}
        {loadingSections.topRated ? (
          <RowSkeleton title="Top TV Series" subtitle="Highest rated" />
        ) : personalizedTopRated.length > 0 ? (
          <AnimeRow
            title="Top TV Series"
            subtitle="Highest rated"
            animes={personalizedTopRated}
            onSeeAll={() => navigate('/browse?category=top-rated')}
          />
        ) : null}

        {/* 8. Top Movies */}
        {loadingSections.movies ? (
          <RowSkeleton title="Top Movies" subtitle="Films & specials" />
        ) : personalizedMovies.length > 0 ? (
          <AnimeRow
            title="Top Movies"
            subtitle="Films & specials"
            animes={personalizedMovies}
            onSeeAll={() => navigate('/browse?category=movies')}
          />
        ) : null}

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SKELETON LOADERS — shimmer while data loads
══════════════════════════════════════════════════════════════════ */
function RowSkeleton({ title, subtitle, count = 5, cardWidth = 120, cardHeight = 160 }) {
  return (
    <section className="home-section" style={{ position: 'relative' }}>
      <div className="section-header">
        <div>
          <h2 className="section-title" style={{ opacity: 0.8 }}>{title}</h2>
          {subtitle && (
            <span className="section-subtitle" style={{ opacity: 0.6 }}>{subtitle}</span>
          )}
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%' }}>
        <div className="h-scroll" style={{ overflowX: 'hidden' }}>
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{
                width: cardWidth,
                height: cardHeight,
                borderRadius: 12,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="page">
      {/* Hero skeleton — no hard bottom edge, fades into the page */}
      <div style={{ position: 'relative', height: '52vh', maxHeight: 440, minHeight: 320, overflow: 'hidden' }}>
        <div className="skeleton" style={{ position: 'absolute', inset: 0, borderRadius: 0 }} />
        {/* Gradient at bottom kills the shimmer line artifact */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
          background: 'linear-gradient(to bottom, transparent 0%, var(--bg-primary, #04040a) 100%)',
          pointerEvents: 'none', zIndex: 2,
        }} />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ padding: '20px 16px 0' }}>
          <div className="skeleton" style={{ height: 17, width: 150, borderRadius: 6, marginBottom: 4 }} />
          <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="skeleton" style={{ width: 120, height: 160, borderRadius: 12, flexShrink: 0 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
