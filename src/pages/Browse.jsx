import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Star, Play, Tag } from 'lucide-react';
import {
  searchAnime, getTitle, getCover,
  getTrending, getAiring, getSeasonal,
  getMostPopular, getTopRated, getMovies, getCurrentSeason
} from '../api/anilist';
import { useApp }       from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import { searchAndRankAnime } from '../utils/searchEngine';
import { useDebounce }  from '../hooks/useDebounce';


const GENRES = ['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mecha','Mystery','Romance','Sci-Fi','Slice of Life','Sports','Thriller','Supernatural'];
const FORMATS = [
  { label: 'All', value: null },
  { label: 'TV',  value: 'TV' },
  { label: 'Movie', value: 'MOVIE' },
  { label: 'OVA', value: 'OVA' },
  { label: 'ONA', value: 'ONA' },
];
const STATUSES = [
  { label: 'All',      value: null        },
  { label: 'Airing',   value: 'RELEASING' },
  { label: 'Finished', value: 'FINISHED'  },
  { label: 'Upcoming', value: 'NOT_YET_RELEASED' },
];

const CATEGORY_TITLES = {
  'airing': 'Top Airing',
  'new-releases': 'New Episode Releases',
  'trending': 'Top Hits Anime',
  'seasonal': 'This Season',
  'popular': 'Most Favorite',
  'top-rated': 'Top TV Series',
  'movies': 'Top Movie'
};

export default function Browse() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { recentlyViewed } = useApp();

  const initQuery = searchParams.get('q') || '';
  const initGenre = searchParams.get('genre') || null;
  const category  = searchParams.get('category') || null;

  const [query,    setQuery]   = useState(initQuery);
  const [genre,    setGenre]   = useState(initGenre);
  const [format,   setFormat]  = useState(null);
  const [status,   setStatus]  = useState(null);
  const [results,  setResults] = useState([]);
  const [loading,  setLoading] = useState(false);
  const [showFilter, setShowFilter] = useState(false);

  const debounced = useDebounce(query, 400);

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      if (debounced || genre || format || status) {
        // Fetch direct AniList search results
        const searchResults = await searchAnime(
          debounced || null, 1, 30,
          genre, format, status
        );

        let finalCandidates = searchResults;

        // If searching text, also pull from a popular/trending pool to ensure synonyms/genres match
        if (debounced) {
          const [trending, popular] = await Promise.all([
            getTrending(1, 40).catch(() => []),
            getMostPopular(1, 40).catch(() => [])
          ]);

          // Combine and deduplicate
          const combined = [...searchResults, ...trending, ...popular];
          const seen = new Set();
          finalCandidates = combined.filter(item => {
            if (!item || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });

          // Run our 4-layer fused matching ranking engine
          finalCandidates = searchAndRankAnime(debounced, finalCandidates);
        }

        setResults(finalCandidates);
      } else if (category) {
        // Fetch specific category
        let r = [];
        if (category === 'airing') {
          r = await getAiring(1, 24);
        } else if (category === 'new-releases') {
          const list = await getAiring(1, 24);
          r = [...list].reverse();
        } else if (category === 'trending') {
          r = await getTrending(1, 24);
        } else if (category === 'seasonal') {
          const { season, year } = getCurrentSeason();
          r = await getSeasonal(season, year, 1, 24);
        } else if (category === 'popular') {
          r = await getMostPopular(1, 24);
        } else if (category === 'top-rated') {
          const list = await getTopRated(1, 24);
          r = list.filter(a => a.format === 'TV');
        } else if (category === 'movies') {
          r = await getMovies(1, 24);
        }
        setResults(r);
      } else {
        // Default browse search
        const r = await searchAnime(null, 1, 24);
        setResults(r);
      }
    } catch (e) {
      console.warn('[Browse] fetch error:', e.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, genre, format, status, category]);

  useEffect(() => { doSearch(); }, [doSearch]);

  const categoryTitle = category ? CATEGORY_TITLES[category] : null;

  // Personalize sorting using K-Nearest Neighbors based on recent watch history
  // Only personalize if not actively typing a query (to keep typed results exact)
  const personalizedResults = debounced ? results : rankAnimeByKnn(results, recentlyViewed);

  return (
    <div className="page">
      {/* Sticky Header Container */}
      <div className="sticky-header">
        {/* Header */}
        <div className="browse-header" style={{ paddingBottom: 8 }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={16} color="var(--text-muted)" />
            <input
              id="search-input"
              type="text"
              placeholder={categoryTitle ? `Search in ${categoryTitle}...` : "Search anime..."}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} color="var(--text-muted)" />
              </button>
            )}
          </div>
          <button
            className="filter-btn"
            onClick={() => setShowFilter(v => !v)}
            id="btn-filter"
            aria-label="Toggle filters"
            style={{ borderRadius: '50%', width: 36, height: 36 }}
          >
            <SlidersHorizontal size={16} color="#fff" />
          </button>
        </div>

        {/* Filter Panel */}
        {showFilter && (
          <div style={{ padding: '0 16px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
            {/* Format */}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Format</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {FORMATS.map(f => (
                <button
                  key={f.value || 'all'}
                  className={`genre-pill ${format === f.value ? 'active' : ''}`}
                  onClick={() => setFormat(f.value)}
                >{f.label}</button>
              ))}
            </div>
            {/* Status */}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Status</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {STATUSES.map(s => (
                <button
                  key={s.value || 'all'}
                  className={`genre-pill ${status === s.value ? 'active' : ''}`}
                  onClick={() => setStatus(s.value)}
                >{s.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Genre Pills */}
        <div className="genre-pills" style={{ paddingBottom: 10, marginTop: 4 }}>
          <button
            className={`genre-pill ${!genre ? 'active' : ''}`}
            onClick={() => setGenre(null)}
          >All</button>
          {GENRES.map(g => (
            <button
              key={g}
              className={`genre-pill ${genre === g ? 'active' : ''}`}
              onClick={() => setGenre(g === genre ? null : g)}
              id={`genre-filter-${g.toLowerCase().replace(/\s/g, '-')}`}
            >{g}</button>
          ))}
        </div>
      </div>

      {/* Content Wrapper with Entrance Animation */}
      <div className="fade-in-up">
        {/* Category Indicator Card */}
        {categoryTitle && (
          <div style={{
            margin: '12px 16px 12px', padding: '12px 16px', borderRadius: 12,
            background: 'rgba(229,9,20,0.1)', border: '1px solid rgba(229,9,20,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            animation: 'fadeIn var(--transition)'
          }}>
            <div>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tag size={9}/> Category Filter
              </span>
              <h2 style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-brand)', color: '#fff', marginTop: 2 }}>{categoryTitle}</h2>
            </div>
            <button
              onClick={() => {
                navigate('/browse');
                setFormat(null);
                setStatus(null);
                setGenre(null);
              }}
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', background: 'rgba(229,9,20,0.15)', padding: '5px 12px', borderRadius: 20 }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div style={{ padding: '16px' }}>
            {[1,2,3,4,5,6].map(i => <SkeletonResultItem key={i} />)}
          </div>
        ) : personalizedResults.length === 0 ? (
          <div className="empty-state">
            <Search size={48} className="empty-icon" />
            <p className="empty-title">No anime found</p>
            <p className="empty-sub">Try a different search or filters</p>
          </div>
        ) : (
          <div style={{ paddingBottom: 8 }}>
            {personalizedResults.map(anime => (
              <SearchResultItem
                key={anime.id}
                anime={anime}
                onClick={() => navigate(`/anime/${anime.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultItem({ anime, onClick }) {
  const title = getTitle(anime);
  const cover = getCover(anime);
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;

  return (
    <div
      className="search-result-item"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      id={`search-result-${anime.id}`}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img
          src={cover}
          alt={title}
          className="search-result-thumb"
          loading="lazy"
        />
        <div className="search-result-play-overlay">
          <Play size={16} color="#fff" fill="#fff" />
        </div>
      </div>
      <div className="search-result-info">
        <div className="search-result-title">{title}</div>
        <div className="search-result-meta">
          {score && <span style={{ color: '#f5c518', display: 'flex', alignItems: 'center', gap: 2 }}><Star size={11} fill="#f5c518" />{score}</span>}
          <span>{anime.format || 'TV'}</span>
          {anime.startDate?.year && <span>{anime.startDate.year}</span>}
          {anime.episodes && <span>{anime.episodes} eps</span>}
          {anime.status && (
            <span style={{ color: anime.status === 'RELEASING' ? '#4caf50' : 'var(--text-muted)' }}>
              {anime.status === 'RELEASING' ? 'Airing' : anime.status === 'FINISHED' ? 'Finished' : anime.status === 'NOT_YET_RELEASED' ? 'Upcoming' : anime.status}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {anime.genres?.slice(0, 3).map(g => (
            <span key={g} style={{
              padding: '2px 8px', borderRadius: 20,
              background: 'var(--bg-hover)',
              fontSize: 10, color: 'var(--text-secondary)',
            }}>{g}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonResultItem() {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 16px', alignItems: 'center' }}>
      <div className="skeleton" style={{ width: 54, height: 72, borderRadius: 8, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 14, borderRadius: 4, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 11, width: '60%', borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 11, width: '40%', borderRadius: 4 }} />
      </div>
    </div>
  );
}
