import { useState, useEffect } from 'react';
import { Search, Bell, Play, X } from 'lucide-react';
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

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let live = true;

    async function load(fn, set, ...args) {
      try {
        const d = await fn(...args);
        if (live && d?.length) set(d.filter(a => getCover(a)));
      } catch (e) {
        console.warn('[Home] section failed:', e.message);
      }
    }

    (async () => {
      // Load trending first so hero appears ASAP
      await load(getTrending, setTrending, 1, 15);
      if (live) setReady(true);

      // Wave 1: most important rows (stagger to avoid AniList 429s)
      await Promise.allSettled([
        load(getAiring,            setAiring,        1, 20),
        load(getNewReleases,       setNewReleases,   1, 20),
        load(getPopularThisSeason, setPopularSeason, 1, 15),
      ]);

      // Small pause between waves so AniList rate-limit window resets
      await new Promise(r => setTimeout(r, 500));

      // Wave 2: supplementary rows
      await Promise.allSettled([
        load(getTopRated, setTopRated, 1, 15),
        load(getMovies,   setMovies,   1, 12),
        load(async () => {
          const sched = await getSchedule(1, 30);
          return sched
            .filter(s => getCover(s.media))
            .map(s => ({ ...s.media, _schedEp: s.episode, _schedAt: s.airingAt }));
        }, setWeekSchedule),
      ]);
    })();

    return () => { live = false; };
  }, []);

  if (!ready) return <HomeSkeleton />;

  // Personalize rows using K-Nearest Neighbors based on watch history
  const personalizedAiring        = rankAnimeByKnn(airing,        recentlyViewed);
  const personalizedNewReleases   = rankAnimeByKnn(newReleases,   recentlyViewed);
  const personalizedPopularSeason = rankAnimeByKnn(popularSeason, recentlyViewed);
  const personalizedTrending      = rankAnimeByKnn(trending,      recentlyViewed);
  const personalizedTopRated      = rankAnimeByKnn(topRated.filter(a => a.format === 'TV'), recentlyViewed);
  const personalizedMovies        = rankAnimeByKnn(movies,        recentlyViewed);

  return (
    <div className="page" style={{ position: 'relative' }}>

      {/* ── Fixed Premium Header ─────────────────────────────────── */}
      <div style={{
        position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', right: 0, zIndex: 90,
        width: '100%', maxWidth: 430,
        padding: 'calc(12px + env(safe-area-inset-top)) 16px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(15, 15, 15, 0.75)' : 'rgba(15, 15, 15, 0)',
        backdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
        WebkitBackdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid rgba(255, 255, 255, 0)',
        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'all', cursor: 'pointer', opacity: scrolled ? 1 : 0.9, transition: 'opacity 0.2s' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{
            width: 28, height: 28, background: 'var(--accent)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 900, fontFamily: 'var(--font-brand)', color: '#fff'
          }}>A</div>
          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-brand)', color: '#fff', letterSpacing: -0.5 }}>AniLab</span>
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
                  <div key={idx} style={{ flexShrink: 0 }}>
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
        {personalizedNewReleases.length > 0 && (
          <AnimeRow
            title="New Episode Releases"
            subtitle="Last 2 weeks"
            animes={personalizedNewReleases}
            cardWidth={120}
            cardHeight={160}
            showEpBadge
            onSeeAll={() => navigate('/browse?category=new-releases')}
          />
        )}

        {/* ── 3. Top Airing (currently releasing, ranked by trending score) */}
        {personalizedAiring.length > 0 && (
          <AnimeRow
            title="Top Airing"
            subtitle="Trending now"
            animes={personalizedAiring}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=airing')}
          />
        )}

        {/* ── 4. This Week's Schedule teaser ──────────────────── */}
        {weekSchedule.length > 0 && (
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
                    onClick={() => navigate(`/anime/${anime.id}`)}
                    style={{ width: 100, flexShrink: 0, cursor: 'pointer' }}
                  >
                    <div style={{ width: 100, height: 140, borderRadius: 10, overflow: 'hidden', position: 'relative', background: 'var(--bg-card)' }}>
                      <img src={getCover(anime)} alt={getTitle(anime)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%)',
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '6px 6px 6px',
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
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {getTitle(anime)}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 5. Popular This Season (this season ranked by trending) */}
        {personalizedPopularSeason.length > 0 && (
          <AnimeRow
            title="Popular This Season"
            subtitle={(() => { const { season, year } = getCurrentSeason(); return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`; })()}
            animes={personalizedPopularSeason}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=seasonal')}
          />
        )}

        {/* ── 6. Top Trending (global trending across all time) ── */}
        {personalizedTrending.length > 0 && (
          <AnimeRow
            title="Top Trending"
            subtitle="All time"
            animes={personalizedTrending}
            cardWidth={130}
            cardHeight={180}
            showRank
            onSeeAll={() => navigate('/browse?category=trending')}
          />
        )}

        {/* ── 7. Top TV Series (highest rated finished series) ── */}
        {personalizedTopRated.length > 0 && (
          <AnimeRow
            title="Top TV Series"
            subtitle="Highest rated"
            animes={personalizedTopRated}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=top-rated')}
          />
        )}

        {/* ── 8. Top Movies ───────────────────────────────────── */}
        {personalizedMovies.length > 0 && (
          <AnimeRow
            title="Top Movies"
            subtitle="Films & specials"
            animes={personalizedMovies}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=movies')}
          />
        )}

        <div style={{ height: 16 }} />
      </div>
    </div>
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
