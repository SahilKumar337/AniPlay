import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Star, Play, Tag, Loader, ChevronDown, Check, RotateCcw } from 'lucide-react';
import {
  searchAnime, getTitle, getCover, getDisplayGenresOrTags,
  getTrending, getAiring, getSeasonal,
  getMostPopular, getTopRated, getMovies, getCurrentSeason
} from '../api/anilist';
import { useApp }       from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import { searchAndRankAnime } from '../utils/searchEngine';
import { useDebounce }  from '../hooks/useDebounce';


const GENRES = [
  'Action', 'Adventure', 'Cars', 'Comedy', 'Dementia', 'Demons', 'Drama', 'Ecchi',
  'Fantasy', 'Game', 'Harem', 'Female Harem', 'Historical', 'Horror', 'Isekai', 'Josei', 'Kids',
  'Magic', 'Mahou Shoujo', 'Martial Arts', 'Mecha', 'Military', 'Music', 'Mystery',
  'Parody', 'Police', 'Psychological', 'Romance', 'Samurai', 'School', 'Sci-Fi',
  'Seinen', 'Shoujo', 'Shoujo Ai', 'Shounen', 'Shounen Ai', 'Slice of Life', 'Space',
  'Sports', 'Super Power', 'Supernatural', 'Thriller', 'Vampire'
];

const FORMATS = [
  { label: 'All',   value: null },
  { label: 'TV',    value: 'TV' },
  { label: 'Movie', value: 'MOVIE' },
  { label: 'OVA',   value: 'OVA' },
  { label: 'ONA',   value: 'ONA' },
];
const STATUSES = [
  { label: 'All',      value: null             },
  { label: 'Airing',   value: 'RELEASING'      },
  { label: 'Finished', value: 'FINISHED'       },
  { label: 'Upcoming', value: 'NOT_YET_RELEASED'},
];

const CATEGORY_TITLES = {
  'airing':        'Top Airing',
  'new-releases':  'New Episode Releases',
  'trending':      'Top Hits Anime',
  'seasonal':      'This Season',
  'popular':       'Most Favorite',
  'top-rated':     'Top TV Series',
  'movies':        'Top Movies',
};

const STATUS_COLOR = {
  RELEASING:        '#22c55e',
  FINISHED:         'var(--text-muted)',
  NOT_YET_RELEASED: '#f59e0b',
};
const STATUS_LABEL = {
  RELEASING:        'Airing',
  FINISHED:         'Finished',
  NOT_YET_RELEASED: 'Upcoming',
};

// ─── Genre Emoji Map ────────────────────────────────────────────────
const GENRE_EMOJI = {
  'Action': '⚔️', 'Adventure': '🗺️', 'Cars': '🏎️', 'Comedy': '😂',
  'Dementia': '🌀', 'Demons': '👹', 'Drama': '🎭', 'Ecchi': '🔞',
  'Fantasy': '🧙', 'Game': '🎮', 'Harem': '💘', 'Female Harem': '💝', 'Historical': '📜',
  'Horror': '👻', 'Isekai': '🌐', 'Josei': '💐', 'Kids': '🧸',
  'Magic': '✨', 'Mahou Shoujo': '🪄', 'Martial Arts': '🥋', 'Mecha': '🤖',
  'Military': '🎖️', 'Music': '🎵', 'Mystery': '🔍', 'Parody': '🎪',
  'Police': '👮', 'Psychological': '🧠', 'Romance': '❤️', 'Samurai': '⛩️',
  'School': '🎓', 'Sci-Fi': '🚀', 'Seinen': '📕', 'Shoujo': '🌸',
  'Shoujo Ai': '🌺', 'Shounen': '💥', 'Shounen Ai': '🌼', 'Slice of Life': '☕',
  'Space': '🌌', 'Sports': '⚽', 'Super Power': '💪', 'Supernatural': '👁️',
  'Thriller': '😰', 'Vampire': '🧛',
};

export default function Browse() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { recentlyViewed } = useApp();

  const initQuery = searchParams.get('q') || '';
  const initGenre = searchParams.get('genre') || null;
  const category  = searchParams.get('category') || null;

  const [query,          setQuery]         = useState(initQuery);
  const [selectedGenres, setSelectedGenres]= useState(initGenre ? [initGenre] : []);
  const [format,         setFormat]        = useState(null);
  const [status,         setStatus]        = useState(null);
  const [results,        setResults]       = useState([]);
  const [loading,        setLoading]       = useState(false);
  const [showFilter,     setShowFilter]    = useState(false);
  const [page,           setPage]          = useState(1);
  const [hasMore,        setHasMore]       = useState(true);

  const filterSheetRef = useRef(null);
  const debounced = useDebounce(query, 400);

  // Infinite scroll sentinel & YouTube-style header scroll-to-show state
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollY = useRef(0);
  // Use a ref for loading state so IntersectionObserver closure always sees current value
  // without needing to recreate the observer every time loading changes (prevents jitter)
  const loadingRef = useRef(false);

  // ─── Close filter sheet on outside tap ──────────────────────────
  useEffect(() => {
    if (!showFilter) return;
    const handler = (e) => {
      if (filterSheetRef.current && !filterSheetRef.current.contains(e.target)) {
        setShowFilter(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showFilter]);

  const toggleGenre = useCallback((g) => {
    setSelectedGenres(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  }, []);

  const clearAll = useCallback(() => {
    setSelectedGenres([]);
    setFormat(null);
    setStatus(null);
  }, []);

  const activeFilterCount = selectedGenres.length + (format ? 1 : 0) + (status ? 1 : 0);

  // ─── Search / Fetch ─────────────────────────────────────────────
  const doSearch = useCallback(async () => {
    loadingRef.current = true;
    setLoading(true);
    setPage(1);
    setHasMore(true);
    try {
      if (debounced || selectedGenres.length || format || status) {
        // Resolve sort and filters based on active category
        let sortVal = 'POPULARITY_DESC';
        let formatVal = format;
        let statusVal = status;
        
        if (category === 'trending') {
          sortVal = 'TRENDING_DESC';
        } else if (category === 'top-rated') {
          sortVal = 'SCORE_DESC';
          if (!statusVal) statusVal = 'FINISHED';
        } else if (category === 'movies') {
          if (!formatVal) formatVal = 'MOVIE';
        } else if (category === 'airing' || category === 'new-releases') {
          sortVal = 'TRENDING_DESC';
          if (!statusVal) statusVal = 'RELEASING';
        }

        const searchLimit = debounced ? 48 : 24;
        let searchResults = await searchAnime(
          debounced || null, 1, searchLimit,
          selectedGenres, formatVal, statusVal, sortVal
        );
        let finalCandidates = searchResults;

        if (debounced) {
          const [trending, popular] = await Promise.all([
            getTrending(1, 40).catch(() => []),
            getMostPopular(1, 40).catch(() => []),
          ]);
          const combined = [...searchResults, ...trending, ...popular];
          const seen = new Set();
          finalCandidates = combined.filter(item => {
            if (!item || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
          finalCandidates = searchAndRankAnime(debounced, finalCandidates);
        }

        setResults(finalCandidates);
        if (finalCandidates.length < searchLimit) setHasMore(false);
      } else if (category) {
        let r = [];
        if      (category === 'airing')       r = await getAiring(1, 24);
        else if (category === 'new-releases')  r = [...(await getAiring(1, 24))].reverse();
        else if (category === 'trending')      r = await getTrending(1, 24);
        else if (category === 'seasonal')      { const { season, year } = getCurrentSeason(); r = await getSeasonal(season, year, 1, 24); }
        else if (category === 'popular')       r = await getMostPopular(1, 24);
        else if (category === 'top-rated')     r = (await getTopRated(1, 24)).filter(a => a.format === 'TV');
        else if (category === 'movies')        r = await getMovies(1, 24);
        setResults(r);
        if (r.length < 24) setHasMore(false);
      } else {
        const r = await searchAnime(null, 1, 24);
        setResults(r);
        if (r.length < 24) setHasMore(false);
      }
    } catch (e) {
      console.warn('[Browse] fetch error:', e?.message || String(e));
      setResults([]);
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [debounced, selectedGenres, format, status, category]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    const nextPage = page + 1;
    setLoading(true);
    try {
      let newResults = [];
      if (debounced || selectedGenres.length || format || status) {
        // Resolve sort and filters based on active category
        let sortVal = 'POPULARITY_DESC';
        let formatVal = format;
        let statusVal = status;
        
        if (category === 'trending') {
          sortVal = 'TRENDING_DESC';
        } else if (category === 'top-rated') {
          sortVal = 'SCORE_DESC';
          if (!statusVal) statusVal = 'FINISHED';
        } else if (category === 'movies') {
          if (!formatVal) formatVal = 'MOVIE';
        } else if (category === 'airing' || category === 'new-releases') {
          sortVal = 'TRENDING_DESC';
          if (!statusVal) statusVal = 'RELEASING';
        }

        const searchLimit = debounced ? 48 : 24;
        newResults = await searchAnime(
          debounced || null, nextPage, searchLimit,
          selectedGenres, formatVal, statusVal, sortVal
        );
      } else if (category) {
        if      (category === 'airing')      newResults = await getAiring(nextPage, 24);
        else if (category === 'new-releases') newResults = [...(await getAiring(nextPage, 24))].reverse();
        else if (category === 'trending')    newResults = await getTrending(nextPage, 24);
        else if (category === 'seasonal')    { const { season, year } = getCurrentSeason(); newResults = await getSeasonal(season, year, nextPage, 24); }
        else if (category === 'popular')     newResults = await getMostPopular(nextPage, 24);
        else if (category === 'top-rated')   newResults = (await getTopRated(nextPage, 24)).filter(a => a.format === 'TV');
        else if (category === 'movies')      newResults = await getMovies(nextPage, 24);
      } else {
        newResults = await searchAnime(null, nextPage, 24);
      }

      if (!newResults || newResults.length === 0) {
        setHasMore(false);
      } else {
        const searchLimit = debounced ? 48 : 24;
        setResults(prev => {
          const combined = [...prev, ...newResults];
          const seen = new Set();
          return combined.filter(item => {
            if (!item || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
        });
        setPage(nextPage);
        if (newResults.length < searchLimit) setHasMore(false);
      }
    } catch (e) {
      console.warn('[Browse] loadMore error:', e?.message || String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [page, hasMore, debounced, selectedGenres, format, status, category]);

  useEffect(() => { doSearch(); }, [doSearch]);

  // Show search bar instantly when user scrolls up, hide after scrolling down 60px
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Always show at the very top
      if (currentScrollY < 10) {
        setShowHeader(true);
      } else if (currentScrollY < lastScrollY.current) {
        // Any upward movement → show header immediately
        setShowHeader(true);
      } else if (currentScrollY > lastScrollY.current + 5) {
        // Only hide after scrolling down at least 5px (prevents flicker on tiny scrolls)
        setShowHeader(false);
      }
      
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Window Scroll Listener with requestAnimationFrame for butter-smooth infinite scrolling
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const threshold = 350; // pixels from bottom to trigger next load
          const position = window.innerHeight + window.scrollY;
          const height = document.documentElement.scrollHeight;
          
          if (position >= height - threshold) {
            if (!loadingRef.current && hasMore) {
              loadMore();
            }
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadMore, hasMore]);

  const categoryTitle = category ? CATEGORY_TITLES[category] : null;
  const personalizedResults = debounced ? results : rankAnimeByKnn(results, recentlyViewed);

  return (
    <div className="page" style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>

      {/* ── Sticky Header ── */}
      <div 
        className="sticky-header" 
        style={{ 
          background: 'var(--bg-primary)',
          position: 'sticky',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          transform: showHeader ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ padding: '10px 14px 8px', display: 'flex', gap: 10, alignItems: 'center' }}>

          {/* Search Box */}
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--bg-secondary)', border: '1.5px solid var(--border)',
            borderRadius: 14, padding: '0 14px', height: 46,
            transition: 'border-color 0.2s',
          }}
            className="browse-search-box"
          >
            <Search size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <input
              id="search-input"
              type="text"
              placeholder={categoryTitle ? `Search in ${categoryTitle}…` : 'Search anime…'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: 14, fontFamily: 'var(--font-main)',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
              >
                <X size={14} color="var(--text-muted)" />
              </button>
            )}
          </div>

          {/* Filter Button */}
          <button
            onClick={() => setShowFilter(v => !v)}
            id="btn-filter"
            aria-label="Toggle filters"
            style={{
              width: 46, height: 46, borderRadius: 14, flexShrink: 0,
              background: activeFilterCount > 0 ? 'var(--accent)' : 'var(--bg-secondary)',
              border: `1.5px solid ${activeFilterCount > 0 ? 'var(--accent)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative', cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            <SlidersHorizontal size={18} color="#fff" />
            {activeFilterCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', color: 'var(--accent)',
                fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 6px rgba(0,0,0,0.3)',
              }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* ── Active genre chips strip ── */}
        {selectedGenres.length > 0 && (
          <div style={{
            display: 'flex', gap: 6, padding: '2px 14px 10px',
            overflowX: 'auto', alignItems: 'center',
          }}
            className="hide-scrollbar"
          >
            {selectedGenres.map(g => (
              <button
                key={g}
                onClick={() => toggleGenre(g)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'var(--accent)', borderRadius: 20, border: 'none',
                  padding: '4px 10px 4px 12px', fontSize: 11, fontWeight: 600,
                  color: '#fff', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >
                {GENRE_EMOJI[g] || ''} {g}
                <X size={10} style={{ opacity: 0.8 }} />
              </button>
            ))}
            <button
              onClick={() => setSelectedGenres([])}
              style={{
                fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'none',
                border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px',
                cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Category banner ── */}
        {categoryTitle && (
          <div style={{
            margin: '0 14px 8px', padding: '10px 14px',
            borderRadius: 12, background: 'rgba(229,9,20,0.08)',
            border: '1px solid rgba(229,9,20,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <Tag size={9} /> Category
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-brand)' }}>{categoryTitle}</div>
            </div>
            <button
              onClick={() => { navigate('/browse'); clearAll(); }}
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'rgba(229,9,20,0.12)', border: 'none', borderRadius: 20, padding: '5px 12px', cursor: 'pointer' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ─── Results List ─── */}
      <div style={{ paddingBottom: 80 }}>
        {loading && results.length === 0 ? (
          <div style={{ padding: '8px 0' }}>
            {[1, 2, 3, 4, 5, 6].map(i => <SkeletonResultItem key={i} />)}
          </div>
        ) : personalizedResults.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '60px 24px', gap: 12,
          }}>
            <Search size={52} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>No results found</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>Try a different search term or adjust your filters</p>
          </div>
        ) : (
          <>
            {personalizedResults.map(anime => (
              <SearchResultItem
                key={anime.id}
                anime={anime}
                onClick={() => navigate(`/anime/${anime.id}`)}
              />
            ))}
            {loading && page > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <Loader size={22} className="spin" color="var(--accent)" />
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Bottom Sheet Filter Panel ─── */}
      {showFilter && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
              zIndex: 1000, backdropFilter: 'blur(3px)',
            }}
            onClick={() => setShowFilter(false)}
          />

          {/* Sheet */}
          <div
            ref={filterSheetRef}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0,
              zIndex: 1001, borderRadius: '22px 22px 0 0',
              background: 'var(--bg-secondary)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '88vh',
              animation: 'slideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            {/* Sheet Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
              <div style={{ width: 38, height: 4, borderRadius: 4, background: 'var(--border)' }} />
            </div>

            {/* Sheet Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 18px 12px',
            }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Filters</h3>
                {activeFilterCount > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--accent)', margin: '2px 0 0', fontWeight: 600 }}>
                    {activeFilterCount} active filter{activeFilterCount > 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAll}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
                      background: 'var(--bg-hover)', border: '1px solid var(--border)',
                      borderRadius: 20, padding: '6px 12px', cursor: 'pointer',
                    }}
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                )}
                <button
                  onClick={() => setShowFilter(false)}
                  style={{
                    width: 34, height: 34, borderRadius: '50%',
                    background: 'var(--bg-hover)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <X size={16} color="var(--text-primary)" />
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{ overflowY: 'auto', padding: '0 18px 24px' }} className="hide-scrollbar">

              {/* ── Format ── */}
              <SectionLabel>Format</SectionLabel>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                {FORMATS.map(f => (
                  <FilterChip
                    key={f.value || 'all-fmt'}
                    label={f.label}
                    active={format === f.value}
                    onClick={() => setFormat(f.value)}
                  />
                ))}
              </div>

              {/* ── Status ── */}
              <SectionLabel>Status</SectionLabel>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                {STATUSES.map(s => (
                  <FilterChip
                    key={s.value || 'all-st'}
                    label={s.label}
                    active={status === s.value}
                    onClick={() => setStatus(s.value)}
                  />
                ))}
              </div>

              {/* ── Genre ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <SectionLabel noMargin>Genre</SectionLabel>
                {selectedGenres.length > 0 && (
                  <button
                    onClick={() => setSelectedGenres([])}
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                  >
                    Clear ({selectedGenres.length})
                  </button>
                )}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
              }}>
                {GENRES.map(g => {
                  const active = selectedGenres.includes(g);
                  return (
                    <button
                      key={g}
                      id={`genre-filter-${g.toLowerCase().replace(/\s/g, '-')}`}
                      onClick={() => toggleGenre(g)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '9px 12px', borderRadius: 12, cursor: 'pointer',
                        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        background: active ? 'rgba(229,9,20,0.12)' : 'var(--bg-card)',
                        color: active ? '#fff' : 'var(--text-secondary)',
                        fontSize: 12, fontWeight: active ? 700 : 500,
                        textAlign: 'left', transition: 'all 0.18s',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{GENRE_EMOJI[g] || '🎬'}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g}</span>
                      {active && (
                        <span style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: 'var(--accent)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <Check size={10} color="#fff" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Apply Button ── */}
            <div style={{ padding: '12px 18px', paddingBottom: 'calc(var(--nav-height) + 12px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => setShowFilter(false)}
                style={{
                  width: '100%', padding: '14px', borderRadius: 14,
                  background: 'var(--accent)', border: 'none', cursor: 'pointer',
                  color: '#fff', fontSize: 15, fontWeight: 800, letterSpacing: 0.3,
                  fontFamily: 'var(--font-main)',
                }}
              >
                {activeFilterCount > 0
                  ? `Show Results · ${activeFilterCount} Filter${activeFilterCount > 1 ? 's' : ''}`
                  : 'Show All Results'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Section Label ────────────────────────────────────────────────
function SectionLabel({ children, noMargin }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: 1,
      margin: noMargin ? 0 : '0 0 10px',
    }}>
      {children}
    </p>
  );
}

// ─── Filter Chip ─────────────────────────────────────────────────
function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 16px', borderRadius: 20, cursor: 'pointer',
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'var(--bg-card)',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: active ? 700 : 500,
        transition: 'all 0.18s', WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}

// ─── Search Result Item ──────────────────────────────────────────
function SearchResultItem({ anime, onClick }) {
  const title  = getTitle(anime);
  const cover  = getCover(anime);
  const score  = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const status = anime.status;
  const allGenres = getDisplayGenresOrTags(anime);

  return (
    <div
      className="search-result-item"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      id={`search-result-${anime.id}`}
      style={{
        display: 'flex', gap: 12, padding: '10px 14px',
        cursor: 'pointer', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background 0.2s',
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img
          src={cover}
          alt={title}
          style={{
            width: 62, height: 84, borderRadius: 10, objectFit: 'cover',
            background: 'var(--bg-card)',
          }}
          loading="lazy"
        />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.42)', opacity: 0,
          transition: 'opacity 0.2s',
        }}
          className="result-play-overlay"
        >
          <Play size={18} color="#fff" fill="#fff" />
        </div>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        {/* Title */}
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.3, marginBottom: 5,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {title}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
          {score && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#f5c518', fontSize: 12, fontWeight: 700 }}>
              <Star size={11} fill="#f5c518" color="#f5c518" /> {score}
            </span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
            background: 'var(--bg-hover)', borderRadius: 6, padding: '2px 6px',
          }}>
            {anime.format || 'TV'}
          </span>
          {anime.startDate?.year && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{anime.startDate.year}</span>
          )}
          {anime.episodes && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{anime.episodes} eps</span>
          )}
          {status && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: STATUS_COLOR[status] || 'var(--text-muted)',
            }}>
              {STATUS_LABEL[status] || status}
            </span>
          )}
        </div>

        {/* All Genre tags */}
        {allGenres.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {allGenres.map(g => (
              <span key={g} style={{
                padding: '3px 8px', borderRadius: 20,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 10, fontWeight: 500,
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}>
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Skeleton Loader ─────────────────────────────────────────────
function SkeletonResultItem() {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 14px', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="skeleton" style={{ width: 62, height: 84, borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, paddingTop: 4 }}>
        <div className="skeleton" style={{ height: 14, borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 11, width: '55%', borderRadius: 6, marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 5 }}>
          <div className="skeleton" style={{ height: 20, width: 50, borderRadius: 20 }} />
          <div className="skeleton" style={{ height: 20, width: 60, borderRadius: 20 }} />
          <div className="skeleton" style={{ height: 20, width: 45, borderRadius: 20 }} />
        </div>
      </div>
    </div>
  );
}
