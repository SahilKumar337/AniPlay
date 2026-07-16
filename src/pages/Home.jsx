import { useState, useEffect } from 'react';
import { Search, Bell, Play, X, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getTrending, getTopRated,
  getAiring, getMovies,
  getNewReleases, getPopularThisSeason,
  getSchedule, getCurrentSeason, getCover, getTitle,
} from '../api/anilist';
import { useApp }       from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import HeroBanner from '../components/HeroBanner';
import AnimeRow   from '../components/AnimeRow';


export default function Home() {
  const navigate = useNavigate();
  const { recentlyViewed, removeFromRecentlyViewed } = useApp();

  const [trending,       setTrending]       = useState([]);
  const [airing,         setAiring]         = useState([]);
  const [newReleases,    setNewReleases]     = useState([]);
  const [popularSeason,  setPopularSeason]   = useState([]);
  const [topRated,       setTopRated]       = useState([]);
  const [movies,         setMovies]         = useState([]);
  const [popular,        setPopular]        = useState([]);
  const [weekSchedule,   setWeekSchedule]   = useState([]);
  const [scrolled,       setScrolled]       = useState(false);
  const [ready,          setReady]          = useState(false);
  const [apiError,       setApiError]        = useState(null);
  const [retryCount,     setRetryCount]      = useState(0);
  const [loadingSections, setLoadingSections] = useState({
    trending: true,
    airing: true,
    newReleases: true,
    popularSeason: true,
    topRated: true,
    movies: true,
    schedule: true,
  });

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

    async function load(fn, set, key, ...args) {
      try {
        const d = await fn(...args);
        if (live && d?.length) set(d.filter(a => getCover(a)));
      } catch (e) {
        console.warn(`[Home] ${key} section failed:`, e.message);
      } finally {
        if (live && key) {
          setLoadingSections(prev => ({ ...prev, [key]: false }));
        }
      }
    }

    // Clear error state on every load attempt
    setApiError(null);

    (async () => {
      // Load trending first so hero appears ASAP
      try {
        const d = await getTrending(1, 15);
        if (live && d?.length) setTrending(d.filter(a => getCover(a)));
      } catch (e) {
        console.warn('[Home] trending failed:', e.message);
        // Detect AniList global outage (403 or their specific error message)
        if (live && (e.message?.includes('temporarily disabled') || e.message?.includes('stability'))) {
          setApiError('AniList API is temporarily down. Please try again later or check the AniList Discord for updates.');
        } else if (live) {
          setApiError(e.message || 'Failed to load anime data. Check your internet connection.');
        }
      } finally {
        if (live) {
          setLoadingSections(prev => ({ ...prev, trending: false }));
          setReady(true);
        }
      }

      // Load ALL sections simultaneously — sessionStorage cache handles AniList
      // rate limits so the 500ms pause is no longer needed. Each setter is
      // independent so any section that finishes first renders immediately.
      await Promise.allSettled([
        load(getAiring,            setAiring,        'airing',        1, 20),
        load(getNewReleases,       setNewReleases,   'newReleases',   1, 20),
        load(getPopularThisSeason, setPopularSeason, 'popularSeason', 1, 15),
        load(getTopRated,          setTopRated,      'topRated',      1, 15),
        load(getMovies,            setMovies,        'movies',        1, 12),
        load(async () => {
          const sched = await getSchedule(1, 30);
          return sched
            .filter(s => getCover(s.media))
            .map(s => ({ ...s.media, _schedEp: s.episode, _schedAt: s.airingAt }));
        }, setWeekSchedule, 'schedule'),
      ]);
    })();

    return () => { live = false; };
  }, [retryCount]);

  if (!ready) return <HomeSkeleton />;

  // AniList is globally down — show a clear error screen
  if (apiError && trending.length === 0) {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', padding: '0 24px', textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20, background: 'var(--bg-elevated)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18,
          border: '0.5px solid var(--border)',
        }}>
          <WifiOff size={28} color="var(--text-muted)" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text-primary)', marginBottom: 10 }}>Service Unavailable</h2>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 300, marginBottom: 28, letterSpacing: '-0.1px' }}>
          {apiError}
        </p>
        <button
          onClick={() => { setReady(false); setRetryCount(c => c + 1); }}
          style={{
            padding: '13px 32px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'var(--accent)',
            color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', letterSpacing: '-0.2px',
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Personalize rows using K-Nearest Neighbors based on watch history
  const personalizedAiring        = rankAnimeByKnn(airing,        recentlyViewed);
  const personalizedNewReleases   = rankAnimeByKnn(newReleases,   recentlyViewed);
  const personalizedPopularSeason = rankAnimeByKnn(popularSeason, recentlyViewed);
  const personalizedTrending      = rankAnimeByKnn(trending,      recentlyViewed);
  const personalizedTopRated      = rankAnimeByKnn(topRated.filter(a => a.format === 'TV'), recentlyViewed);
  const personalizedMovies        = rankAnimeByKnn(movies,        recentlyViewed);

  return (
    <div className="page" style={{ position: 'relative' }}>

      <div style={{
        position: 'fixed', top: 0, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        width: '100%', maxWidth: 480,
        padding: '12px 16px 12px',
        paddingTop: 'max(32px, env(safe-area-inset-top))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(15, 15, 15, 0.82)' : 'rgba(10, 10, 10, 0)',
        backdropFilter: scrolled ? 'blur(35px) saturate(200%)' : 'blur(0px) saturate(100%)',
        WebkitBackdropFilter: scrolled ? 'blur(35px) saturate(200%)' : 'blur(0px) saturate(100%)',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid rgba(255, 255, 255, 0)',
        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'all', cursor: 'pointer', opacity: scrolled ? 1 : 0.9, transition: 'opacity 0.2s' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{
            width: 28, height: 28, background: 'var(--accent)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          ><Bell size={18} /></button>
        </div>
      </div>

      {/* ── Content Wrapper with Entrance Animation ────────────────── */}
      <div className="fade-in-up">
        {/* ── Hero Banner ─────────────────────────────────────── */}
        {trending.length > 0 && <HeroBanner animes={trending} />}

        {/* ── 1. Continue Watching (Top Priority) ─────────────── */}
        {recentlyViewed && recentlyViewed.length > 0 && (
          <section className="home-section" style={{ position: 'relative', marginTop: 16 }}>
            <div className="section-header">
              <h2 className="section-title">Continue Watching</h2>
            </div>
            <div className="h-scroll">
              {recentlyViewed.map((item, idx) => {
                const title = getTitle(item.anime);
                const cover = getCover(item.anime);
                return (
                  <div
                    key={idx}
                    className="card-entrance"
                    style={{ flexShrink: 0, animationDelay: `${idx * 40}ms` }}
                  >
                    {/* Card with full anime-card hover effects */}
                    <div
                      className="anime-card"
                      style={{ width: 130, height: 170 }}
                      onClick={() => navigate(`/watch/${item.anime.id}/${item.episode}`)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Continue watching ${title}`}
                    >
                      <img src={cover} alt={title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                      {/* Episode badge — bottom left */}
                      <span style={{
                        position: 'absolute', bottom: 8, left: 8,
                        fontSize: 10, fontWeight: 700, color: '#fff',
                        background: 'var(--accent)', padding: '2px 6px',
                        borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3, zIndex: 3,
                      }}>
                        <Play size={8} fill="#fff"/> EP {item.episode}
                      </span>

                      {/* Remove button — top right */}
                      <button
                        onClick={e => { e.stopPropagation(); removeFromRecentlyViewed(item.anime.id); }}
                        style={{
                          position: 'absolute', top: 6, right: 6,
                          width: 22, height: 22, borderRadius: '50%',
                          background: 'rgba(0,0,0,0.6)', border: 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', zIndex: 10, transition: 'background 0.2s',
                        }}
                        aria-label="Remove from Continue Watching"
                      >
                        <X size={10} color="#fff" />
                      </button>

                      {/* Play overlay on hover (same as AnimeCard) */}
                      <div className="card-play-overlay">
                        <div className="card-play-overlay-inner">
                          <Play size={16} color="#fff" fill="#fff" />
                        </div>
                      </div>

                      {/* Title overlay on hover (same as AnimeCard) */}
                      <div className="card-title-overlay" style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)',
                        padding: '24px 6px 6px', opacity: 0, transition: 'opacity 0.2s',
                      }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', display: 'block', lineHeight: 1.3 }}>
                          {title}
                        </span>
                      </div>
                    </div>

                    {/* Title below card */}
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginTop: 6, width: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 2. New Episode Releases (aired last 2 weeks, real schedule data) */}
        {loadingSections.newReleases ? (
          <RowSkeleton title="New Episode Releases" subtitle="Last 2 weeks" cardWidth={120} cardHeight={160} />
        ) : personalizedNewReleases.length > 0 ? (
          <AnimeRow
            title="New Episode Releases"
            subtitle="Last 2 weeks"
            animes={personalizedNewReleases}
            cardWidth={120}
            cardHeight={160}
            showEpBadge
            onSeeAll={() => navigate('/browse?category=new-releases')}
          />
        ) : null}

        {/* ── 3. Top Airing (currently releasing, ranked by trending score) */}
        {loadingSections.airing ? (
          <RowSkeleton title="Top Airing" subtitle="Trending now" cardWidth={120} cardHeight={160} />
        ) : personalizedAiring.length > 0 ? (
          <AnimeRow
            title="Top Airing"
            subtitle="Trending now"
            animes={personalizedAiring}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=airing')}
          />
        ) : null}

        {/* ── 4. Airing This Week schedule teaser ── */}
        {loadingSections.schedule ? (
          <RowSkeleton title="Airing This Week" subtitle="Next 7 days" cardWidth={100} cardHeight={140} count={6} />
        ) : weekSchedule.length > 0 ? (
          <section className="home-section">
            <div className="section-header">
              <div>
                <h2 className="section-title">Airing This Week</h2>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 1 }}>Next 7 days</span>
              </div>
              <button
                className="see-all"
                onClick={() => navigate('/schedule')}
              >
                See all
              </button>
            </div>
            <div className="h-scroll">
              {weekSchedule.slice(0, 15).map((anime, idx) => {
                const airedDate = anime._schedAt
                  ? new Date(anime._schedAt * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  : '';
                return (
                  <div
                    key={idx}
                    className="card-entrance"
                    style={{ width: 100, flexShrink: 0, animationDelay: `${idx * 40}ms` }}
                  >
                    <div
                      className="anime-card"
                      style={{ width: 100, height: 140 }}
                      onClick={() => navigate(`/anime/${anime.id}`)}
                      role="button"
                      tabIndex={0}
                      aria-label={getTitle(anime)}
                    >
                      <img src={getCover(anime)} alt={getTitle(anime)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%)',
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '6px 6px 6px',
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

                      {/* Play overlay on hover (same as AnimeCard) */}
                      <div className="card-play-overlay">
                        <div className="card-play-overlay-inner" style={{ width: 28, height: 28 }}>
                          <Play size={12} color="#fff" fill="#fff" />
                        </div>
                      </div>

                      {/* Title overlay on hover (same as AnimeCard) */}
                      <div className="card-title-overlay" style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)',
                        padding: '24px 6px 6px', opacity: 0, transition: 'opacity 0.2s',
                        zIndex: 3,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: '#fff', display: 'block', lineHeight: 1.3 }}>
                          {getTitle(anime)}
                        </span>
                      </div>
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginTop: 5, width: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {getTitle(anime)}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* ── 5. Popular This Season (this season ranked by trending) */}
        {loadingSections.popularSeason ? (
          <RowSkeleton
            title="Popular This Season"
            subtitle={(() => { const { season, year } = getCurrentSeason(); return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`; })()}
            cardWidth={120}
            cardHeight={160}
          />
        ) : personalizedPopularSeason.length > 0 ? (
          <AnimeRow
            title="Popular This Season"
            subtitle={(() => { const { season, year } = getCurrentSeason(); return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`; })()}
            animes={personalizedPopularSeason}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=seasonal')}
          />
        ) : null}

        {/* ── 6. Top Trending (global trending across all time) ── */}
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

        {/* ── 7. Top TV Series (highest rated finished series) ── */}
        {loadingSections.topRated ? (
          <RowSkeleton title="Top TV Series" subtitle="Highest rated" cardWidth={120} cardHeight={160} />
        ) : personalizedTopRated.length > 0 ? (
          <AnimeRow
            title="Top TV Series"
            subtitle="Highest rated"
            animes={personalizedTopRated}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=top-rated')}
          />
        ) : null}

        {/* ── 8. Top Movies ───────────────────────────────────── */}
        {loadingSections.movies ? (
          <RowSkeleton title="Top Movies" subtitle="Films & specials" cardWidth={120} cardHeight={160} />
        ) : personalizedMovies.length > 0 ? (
          <AnimeRow
            title="Top Movies"
            subtitle="Films & specials"
            animes={personalizedMovies}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=movies')}
          />
        ) : null}

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

function RowSkeleton({ title, subtitle, count = 5, cardWidth = 120, cardHeight = 160 }) {
  return (
    <section className="home-section" style={{ position: 'relative' }}>
      <div className="section-header">
        <div>
          <h2 className="section-title" style={{ opacity: 0.8 }}>{title}</h2>
          {subtitle && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 1, opacity: 0.6 }}>{subtitle}</span>
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
      <div className="skeleton" style={{ height: 380, borderRadius: 0 }} />
      {[1, 2, 3].map(i => (
        <div key={i} style={{ padding: '20px 16px 0' }}>
          <div className="skeleton" style={{ height: 17, width: 150, borderRadius: 6, marginBottom: 4 }} />
          <div className="skeleton" style={{ height: 12, width: 80, borderRadius: 4, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 10 }}>
            {[1,2,3,4].map(j => (
              <div key={j} className="skeleton" style={{ width: 120, height: 160, borderRadius: 12, flexShrink: 0 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
