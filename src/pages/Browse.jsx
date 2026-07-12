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

  const filterSheetRef  = useRef(null);
  const sentinelRef     = useRef(null);    // IntersectionObserver sentinel
  const generationRef   = useRef(0);       // Fresh search ID — stale results self-discard
  const loadingRef      = useRef(false);   // Sync flag: prevents double-fire
  const pageRef         = useRef(1);       // Sync page — safe inside observer closure
  const hasMoreRef      = useRef(true);    // Sync hasMore — safe inside observer closure
  const loadMoreRef     = useRef(null);    // Always-current loadMore fn for observer
  const lastScrollY     = useRef(0);

  const [showHeader, setShowHeader] = useState(true);

  // Keep refs in sync with state
  useEffect(() => { pageRef.current   = page;    }, [page]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  // 450ms debounce — feels instant, avoids API call on every keystroke
  const debounced = useDebounce(query, 450);

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

  // ─── Resolve sort / filter overrides for category context ────────
  const resolveQueryParams = useCallback((overrideFormat = format, overrideStatus = status) => {
    let sortVal   = 'POPULARITY_DESC';
    let formatVal = overrideFormat;
    let statusVal = overrideStatus;
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
    return { sortVal, formatVal, statusVal };
  }, [category, format, status]);

  // ─── Fetch a single page of results ────────────────────────────────
  // Returns { rows, rawCount } so callers can distinguish:
  //   rawCount = how many AniList returned (gate hasMore)
  //   rows     = potentially re-ranked/filtered subset (what we display)
  const fetchPage = useCallback(async (pg) => {
    const PER_PAGE = 24;
    let rows = [];
    let rawCount = 0;

    if (debounced || selectedGenres.length || format || status) {
      const { sortVal, formatVal, statusVal } = resolveQueryParams();
      rows = await searchAnime(
        debounced || null, pg, PER_PAGE,
        selectedGenres, formatVal, statusVal, sortVal
      );
      rawCount = rows.length; // store BEFORE local re-ranking
      // Re-rank only on page 1 with text search — pages 2+ stay in AniList order
      if (debounced && pg === 1 && rows.length > 0) {
        rows = searchAndRankAnime(debounced, rows);
      }
    } else if (category) {
      const { season, year } = getCurrentSeason();
      if      (category === 'airing')       rows = await getAiring(pg, PER_PAGE);
      else if (category === 'new-releases') rows = [...(await getAiring(pg, PER_PAGE))].reverse();
      else if (category === 'trending')     rows = await getTrending(pg, PER_PAGE);
      else if (category === 'seasonal')     rows = await getSeasonal(season, year, pg, PER_PAGE);
      else if (category === 'popular')      rows = await getMostPopular(pg, PER_PAGE);
      else if (category === 'top-rated')    rows = (await getTopRated(pg, PER_PAGE)).filter(a => a.format === 'TV');
      else if (category === 'movies')       rows = await getMovies(pg, PER_PAGE);
      rawCount = rows.length;
    } else {
      rows = await searchAnime(null, pg, PER_PAGE);
      rawCount = rows.length;
    }

    return { rows, rawCount };
  }, [debounced, selectedGenres, format, status, category, resolveQueryParams]);

  // ─── Initial / fresh search ──────────────────────────────────────
  const doSearch = useCallback(async () => {
    const gen = ++generationRef.current; // Stale-discard via generation counter

    loadingRef.current = true;
    setLoading(true);
    setPage(1);
    pageRef.current  = 1;
    setHasMore(true);
    hasMoreRef.current = true;
    setResults([]);

    try {
      const result = await fetchPage(1);
      if (gen !== generationRef.current) return; // Stale — a newer search started
      const { rows, rawCount } = result;
      setResults(rows);
      // Use rawCount (pre-ranking) to gate hasMore so local re-ranking
      // never prematurely kills pagination.
      const done = rawCount < 24;
      setHasMore(!done);
      hasMoreRef.current = !done;
    } catch (e) {
      if (gen !== generationRef.current) return;
      console.warn('[Browse] fetch error:', e?.message || String(e));
      setResults([]);
      setHasMore(false);
      hasMoreRef.current = false;
    } finally {
      if (gen === generationRef.current) {
        loadingRef.current = false;
        setLoading(false);
        // ══ Post-search viewport check ══════════════════════════════════
        // IntersectionObserver only fires on STATUS CHANGE (not≥0→1). If results
        // are fewer than one screenful, the sentinel is ALREADY in view when
        // the observer attached, so it fires immediately — but loadingRef was
        // still true and blocked it. After we clear loadingRef above we must
        // manually check and kick off loadMore if needed.
        requestAnimationFrame(() => {
          if (hasMoreRef.current && !loadingRef.current && sentinelRef.current) {
            const { top } = sentinelRef.current.getBoundingClientRect();
            if (top <= window.innerHeight + 400) {
              loadMoreRef.current?.();
            }
          }
        });
      }
    }
  }, [fetchPage]);

  // ─── Load next page (infinite scroll) ───────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    const nextPage = pageRef.current + 1;
    setLoading(true);
    try {
      const result = await fetchPage(nextPage);
      const { rows, rawCount } = result;
      if (!rows || rawCount === 0) {
        setHasMore(false);
        hasMoreRef.current = false;
      } else {
        setResults(prev => {
          const seen = new Set(prev.map(a => a.id));
          return [...prev, ...rows.filter(a => a && !seen.has(a.id))];
        });
        setPage(nextPage);
        pageRef.current = nextPage;
        if (rawCount < 24) {
          setHasMore(false);
          hasMoreRef.current = false;
        }
      }
    } catch (e) {
      console.warn('[Browse] loadMore error:', e?.message || String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [fetchPage]);

  // Keep loadMoreRef current so the IntersectionObserver closure always
  // calls the latest version without needing to reconnect the observer.
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  // Trigger fresh search when filters / query change
  useEffect(() => { doSearch(); }, [doSearch]);

  // ─── Scroll direction: show/hide sticky header ───────────────────
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      if (y < 10) setShowHeader(true);
      else if (y < lastScrollY.current) setShowHeader(true);
      else if (y > lastScrollY.current + 5) setShowHeader(false);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // ─── IntersectionObserver: jitter-free infinite scroll ──────────
  // Attached ONCE on mount. Uses loadMoreRef so it always calls the
  // latest loadMore without needing to disconnect/reconnect the observer
  // every time fetchPage identity changes (which was causing the gap
  // where the sentinel was in view but the observer wasn't yet attached).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && hasMoreRef.current) {
          loadMoreRef.current?.();
        }
      },
      { rootMargin: '400px 0px' } // trigger 400px before sentinel is visible
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []); // ← empty deps: attach once, use refs to stay current

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
        ) : personalizedResults.length === 0 && !loading ? (
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
                activeGenres={selectedGenres}
                onClick={() => navigate(`/anime/${anime.id}`)}
              />
            ))}
            {loading && results.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <Loader size={22} className="spin" color="var(--accent)" />
              </div>
            )}
          </>
        )}
        {/*
          Sentinel is ALWAYS in the DOM (outside conditionals) so the
          IntersectionObserver can attach to it immediately on mount.
          Placing it inside a conditional means sentinelRef.current is null
          when the effect runs, breaking infinite scroll entirely.
        */}
        <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
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
function SearchResultItem({ anime, onClick, activeGenres = [] }) {
  const title  = getTitle(anime);
  const cover  = getCover(anime);
  const score  = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const status = anime.status;
  // Pass activeGenres so filtered tags are always shown & highlighted
  const allGenres = getDisplayGenresOrTags(anime, activeGenres);
  // Normalize active filter names for highlight matching (Harem variants)
  const activeSet = new Set(activeGenres.map(g =>
    (g === 'Female Harem' || g === 'Male Harem') ? 'Harem' : g
  ));

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

        {/* Genre/Tag badges */}
        {allGenres.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {allGenres.map(g => {
              const isActive = activeSet.has(g);
              return (
                <span key={g} style={{
                  padding: '3px 8px', borderRadius: 20,
                  background: isActive ? 'rgba(229,9,20,0.18)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${isActive ? 'rgba(229,9,20,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  fontSize: 10, fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {g}
                </span>
              );
            })}
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
