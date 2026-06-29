import { useState, useEffect } from 'react';
import { Search, Bell, Play, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  getTrending, getSeasonal, getTopRated,
  getAiring, getMovies, getMostPopular,
  getCurrentSeason, getCover, getTitle,
} from '../api/anilist';
import { useApp }       from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import HeroBanner from '../components/HeroBanner';
import AnimeRow   from '../components/AnimeRow';


export default function Home() {
  const navigate = useNavigate();
  const { recentlyViewed, removeFromRecentlyViewed } = useApp();

  const [trending, setTrending] = useState([]);
  const [airing,   setAiring]   = useState([]);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  const [seasonal, setSeasonal] = useState([]);
  const [topRated, setTopRated] = useState([]);
  const [movies,   setMovies]   = useState([]);
  const [popular,  setPopular]  = useState([]);
  const [ready,    setReady]    = useState(false);

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

      // Then everything else in parallel
      const { season, year } = getCurrentSeason();
      await Promise.allSettled([
        load(getAiring,      setAiring,   1, 15),
        load(getSeasonal,    setSeasonal, season, year, 1, 12),
        load(getTopRated,    setTopRated, 1, 12),
        load(getMovies,      setMovies,   1, 10),
        load(getMostPopular, setPopular,  1, 12),
      ]);
    })();

    return () => { live = false; };
  }, []);

  if (!ready) return <HomeSkeleton />;

  // Personalize each section row using K-Nearest Neighbors
  const personalizedAiring   = rankAnimeByKnn(airing,   recentlyViewed);
  const personalizedTrending = rankAnimeByKnn(trending, recentlyViewed);
  const personalizedSeasonal = rankAnimeByKnn(seasonal, recentlyViewed);
  const personalizedPopular  = rankAnimeByKnn(popular,  recentlyViewed);
  const personalizedTopRated = rankAnimeByKnn(topRated.filter(a => a.format === 'TV'), recentlyViewed);
  const personalizedMovies   = rankAnimeByKnn(movies,   recentlyViewed);

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

        {/* ── Continue Watching (Top Priority) ──────────────── */}
        {recentlyViewed && recentlyViewed.length > 0 && (
          <section className="home-section" style={{ position: 'relative', marginTop: 16 }}>
            <div className="section-header">
              <h2 className="section-title">Continue Watching</h2>
            </div>
            <div style={{ position: 'relative', width: '100%' }}>
              <div className="h-scroll">
                {recentlyViewed.map((item, idx) => {
                  const title = getTitle(item.anime);
                  const cover = getCover(item.anime);
                  return (
                    <div
                      key={idx}
                      onClick={() => navigate(`/watch/${item.anime.id}/${item.episode}`)}
                      style={{
                        width: 130, flexShrink: 0, cursor: 'pointer', position: 'relative'
                      }}
                    >
                      <div style={{ width: 130, height: 170, borderRadius: 12, overflow: 'hidden', position: 'relative', background: 'var(--bg-card)' }}>
                        <img src={cover} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{
                          position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 80%)',
                          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 8
                        }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--accent)', padding: '2px 6px', borderRadius: 4, width: 'fit-content', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Play size={8} fill="#fff"/> EP {item.episode}
                          </span>
                        </div>
                        {/* Cut option (Cross/Remove button) */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            removeFromRecentlyViewed(item.anime.id);
                          }}
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 22, height: 22, borderRadius: '50%',
                            background: 'rgba(0,0,0,0.6)', border: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', zIndex: 10,
                            transition: 'background 0.2s',
                          }}
                          aria-label="Remove from Continue Watching"
                        >
                          <X size={10} color="#fff" />
                        </button>
                      </div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {title}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Top Airing ─────────────────────────────────────── */}
        {personalizedAiring.length > 0 && (
          <AnimeRow
            title="Top Airing"
            animes={personalizedAiring}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=airing')}
          />
        )}

        {/* ── New Episode Releases ────────────────────────────── */}
        {personalizedAiring.length > 0 && (
          <AnimeRow
            title="New Episode Releases"
            animes={[...personalizedAiring].reverse()}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=new-releases')}
          />
        )}

        {/* ── Top Hits Anime ──────────────────────────────────── */}
        {personalizedTrending.length > 0 && (
          <AnimeRow
            title="Top Hits Anime"
            animes={personalizedTrending}
            cardWidth={130}
            cardHeight={180}
            showRank
            onSeeAll={() => navigate('/browse?category=trending')}
          />
        )}

        {/* ── This Season ─────────────────────────────────────── */}
        {personalizedSeasonal.length > 0 && (
          <AnimeRow
            title="This Season"
            animes={personalizedSeasonal}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=seasonal')}
          />
        )}

        {/* ── Most Favorite ───────────────────────────────────── */}
        {personalizedPopular.length > 0 && (
          <AnimeRow
            title="Most Favorite"
            animes={personalizedPopular}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=popular')}
          />
        )}

        {/* ── Top TV Series ───────────────────────────────────── */}
        {personalizedTopRated.length > 0 && (
          <AnimeRow
            title="Top TV Series"
            animes={personalizedTopRated}
            cardWidth={120}
            cardHeight={160}
            onSeeAll={() => navigate('/browse?category=top-rated')}
          />
        )}

        {/* ── Top Movie ───────────────────────────────────────── */}
        {personalizedMovies.length > 0 && (
          <AnimeRow
            title="Top Movie"
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
      {[1, 2].map(i => (
        <div key={i} style={{ padding: '20px 16px 0' }}>
          <div className="skeleton" style={{ height: 17, width: 130, borderRadius: 6, marginBottom: 14 }} />
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
