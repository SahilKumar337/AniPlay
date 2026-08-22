import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Star, Play, Tag, Loader, Check, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import AppDrawer from '../components/ui/AppDrawer';
import {
  searchAnime, getTitle, getCover, getDisplayGenresOrTags,
  getTrending, getAiring, getSeasonal,
  getMostPopular, getTopRated, getMovies, getCurrentSeason
} from '../api/anilist';
import { useApp } from '../context/AppContext';
import { rankAnimeByKnn } from '../utils/knn';
import { searchAndRankAnime } from '../utils/searchEngine';
import { useDebounce } from '../hooks/useDebounce';


const GENRES = [
  'Action', 'Adventure', 'Cars', 'Comedy', 'Dementia', 'Demons', 'Drama', 'Ecchi',
  'Fantasy', 'Game', 'Harem', 'Historical', 'Horror', 'Isekai', 'Josei', 'Kids',
  'Magic', 'Mahou Shoujo', 'Martial Arts', 'Mecha', 'Military', 'Music', 'Mystery',
  'Parody', 'Police', 'Psychological', 'Romance', 'Samurai', 'School', 'Sci-Fi',
  'Seinen', 'Shoujo', 'Shoujo Ai', 'Shounen', 'Shounen Ai', 'Slice of Life', 'Space',
  'Sports', 'Super Power', 'Supernatural', 'Thriller', 'Vampire'
];

const FORMATS = [
  { label: 'All', value: null },
  { label: 'TV', value: 'TV' },
  { label: 'Movie', value: 'MOVIE' },
  { label: 'OVA', value: 'OVA' },
  { label: 'ONA', value: 'ONA' },
];
const STATUSES = [
  { label: 'All', value: null },
  { label: 'Airing', value: 'RELEASING' },
  { label: 'Finished', value: 'FINISHED' },
  { label: 'Upcoming', value: 'NOT_YET_RELEASED' },
];

const CATEGORY_TITLES = {
  'airing': 'Top Airing',
  'new-releases': 'New Episode Releases',
  'trending': 'Top Hits Anime',
  'seasonal': 'This Season',
  'popular': 'Most Favorite',
  'top-rated': 'Top TV Series',
  'movies': 'Top Movies',
};

const STATUS_COLOR = {
  RELEASING: '#22c55e',
  FINISHED: 'var(--text-muted)',
  NOT_YET_RELEASED: '#f59e0b',
};
const STATUS_LABEL = {
  RELEASING: 'Airing',
  FINISHED: 'Finished',
  NOT_YET_RELEASED: 'Upcoming',
};



export default function Browse() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { recentlyViewed } = useApp();

  const initQuery = searchParams.get('q') || '';
  const initGenre = searchParams.get('genre') || null;
  const category = searchParams.get('category') || null;

  const [query, setQuery] = useState(initQuery);
  const [selectedGenres, setSelectedGenres] = useState(initGenre ? [initGenre] : []);
  const [format, setFormat] = useState(null);
  const [status, setStatus] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const filterSheetRef = useRef(null);
  const sentinelRef = useRef(null);    // IntersectionObserver sentinel
  const generationRef = useRef(0);       // Fresh search ID — stale results self-discard
  const loadingRef = useRef(false);   // Sync flag: prevents double-fire
  const pageRef = useRef(1);       // Sync page — always read from here, not state
  const hasMoreRef = useRef(true);    // Sync hasMore — safe inside stable closures
  const loadMoreRef = useRef(null);    // Points to stable loadMore (set once at mount)
  const lastScrollY = useRef(0);
  const fetchPageRef = useRef(null);    // Always-current fetchPage — read by stable closures
  const abortRef = useRef(null);    // AbortController: cancels stale in-flight searches
  const headerRef = useRef(null);    // Fixed header — DOM-mutated directly, zero re-renders
  const [headerHeight, setHeaderHeight] = useState(80); // tracked via ResizeObserver



  // 450ms debounce — feels instant, avoids API call on every keystroke
  const debounced = useDebounce(query, 450);

  // ─── ResizeObserver: track header height for content paddingTop ────
  useEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setHeaderHeight(Math.ceil(entry.contentRect.height));
      }
    });
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

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
    let sortVal = 'POPULARITY_DESC';
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

  // ─── PRODUCTION FIX: fetchPageRef pattern ────────────────────────
  // fetchPage is a useCallback that recreates every time debounced/genre/format
  // changes. Storing it in a ref breaks the dependency chain:
  //   fetchPage → doSearch → loadMore → loadMoreRef
  // doSearch and loadMore now have [] deps (STABLE, never recreate).
  // They read fetchPageRef.current at call-time — always fresh, never stale.
  const fetchPage = useCallback(async (pg) => {
    const PER_PAGE = 24;
    let rows = [];
    let rawCount = 0;
    let hasNextPage = false;

    if (debounced || selectedGenres.length || format || status) {
      const { sortVal, formatVal, statusVal } = resolveQueryParams();
      const result = await searchAnime(
        debounced || null, pg, PER_PAGE,
        selectedGenres, formatVal, statusVal, sortVal
      );
      // searchAnime now returns { rows, hasNextPage }
      rows = result.rows ?? result; // fallback for safety
      hasNextPage = result.hasNextPage ?? (rows.length >= PER_PAGE);
      rawCount = rows.length;
      if (debounced && pg === 1 && rows.length > 0) {
        rows = searchAndRankAnime(debounced, rows);
      }
    } else if (category) {
      const { season, year } = getCurrentSeason();
      if (category === 'airing') rows = await getAiring(pg, PER_PAGE);
      else if (category === 'new-releases') rows = [...(await getAiring(pg, PER_PAGE))].reverse();
      else if (category === 'trending') rows = await getTrending(pg, PER_PAGE);
      else if (category === 'seasonal') rows = await getSeasonal(season, year, pg, PER_PAGE);
      else if (category === 'popular') rows = await getMostPopular(pg, PER_PAGE);
      else if (category === 'top-rated') rows = (await getTopRated(pg, PER_PAGE)).filter(a => a.format === 'TV');
      else if (category === 'movies') rows = await getMovies(pg, PER_PAGE);
      rawCount = rows.length;
      hasNextPage = rows.length >= PER_PAGE;
    } else {
      const result = await searchAnime(null, pg, PER_PAGE);
      rows = result.rows ?? result;
      hasNextPage = result.hasNextPage ?? (rows.length >= PER_PAGE);
      rawCount = rows.length;
    }

    // Apply KNN ranking on this page's results if not text searching
    if (!debounced && rows.length > 0 && recentlyViewed && recentlyViewed.length > 0) {
      try {
        rows = rankAnimeByKnn(rows, recentlyViewed);
      } catch (err) {
        console.error('[Browse] KNN page ranking failed:', err);
      }
    }

    return { rows, rawCount, hasNextPage };
  }, [debounced, selectedGenres, format, status, category, resolveQueryParams, recentlyViewed]);

  // Keep fetchPageRef current — MUST be declared before doSearch and loadMore
  // so React runs this effect before the search trigger effect.
  useEffect(() => { fetchPageRef.current = fetchPage; }, [fetchPage]);

  // ─── Initial / fresh search (STABLE — [] deps) ───────────────────
  // Reads fetchPageRef.current at call-time: always has latest filters.
  // AbortController cancels any previous in-flight AniList request.
  const doSearch = useCallback(async () => {
    // Cancel previous in-flight request (Method #4 — AbortController)
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    // Reset ALL sync state before any async work
    const gen = ++generationRef.current;
    loadingRef.current = true;
    pageRef.current = 1;
    hasMoreRef.current = true;
    // NOTE: No scroll-to-top — search bar slides in from top (YouTube style) on scroll-up
    setLoading(true);

    setHasMore(true);
    setResults([]);

    try {
      const { rows, hasNextPage } = await fetchPageRef.current(1);
      if (gen !== generationRef.current) return; // newer search started, discard
      setResults(rows);
      hasMoreRef.current = !!hasNextPage;
      setHasMore(!!hasNextPage);
    } catch (e) {
      if (gen !== generationRef.current) return;
      if (e?.name === 'AbortError') return; // intentionally cancelled, not an error
      setResults([]);
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      if (gen === generationRef.current) {
        loadingRef.current = false; // reset sync flag BEFORE React state update
        setLoading(false);
      }
    }
  }, []); // STABLE — reads fetchPageRef.current at call-time

  // ─── Load next page (STABLE — [] deps) ───────────────────────────
  // Reads fetchPageRef.current at call-time: always has latest filters.
  // The loadingRef.current guard (Guard 1) is the ONLY double-fire prevention
  // needed — the previous 400ms rate-limit was removed because it blocked calls
  // when AniList responded quickly (< 150ms) and TRIGGER 2 fired within 400ms.
  const loadMore = useCallback(async () => {
    // Guard: no double-fire, no fire when exhausted
    if (loadingRef.current || !hasMoreRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    const nextPage = pageRef.current + 1;

    try {
      const { rows, rawCount, hasNextPage } = await fetchPageRef.current(nextPage);
      if (!rows || rawCount === 0) {
        hasMoreRef.current = false;
        setHasMore(false);
      } else {
        setResults(prev => {
          const seen = new Set(prev.map(a => a.id));
          return [...prev, ...rows.filter(a => a && !seen.has(a.id))];
        });
        pageRef.current = nextPage; // sync — BEFORE clearing loading flag
        hasMoreRef.current = !!hasNextPage;
        setHasMore(!!hasNextPage);
      }
    } catch (e) {
      console.warn('[Browse] loadMore error:', e?.message || String(e));
    } finally {
      loadingRef.current = false; // reset sync flag BEFORE React state update
      setLoading(false);
    }
  }, []); // STABLE — reads fetchPageRef.current at call-time


  // Set loadMoreRef once at mount — loadMore is stable so this never re-runs
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  // ─── Search trigger: explicit deps, no cascading recreations ─────
  // doSearch is stable ([] deps) so this effect only re-runs when the actual
  // search parameters change — not when any internal function recreates.
  // fetchPageRef is updated BEFORE this fires (declared first above).
  useEffect(() => {
    doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, selectedGenres, format, status, category]);

  // ─── TRIGGER 1: IntersectionObserver (primary, async, zero layout cost) ──
  // Observes a zero-height sentinel div at the bottom of the list.
  // Fires 700px before the sentinel enters the viewport for pre-loading.
  // Edge-triggered: only fires when sentinel CROSSES the threshold boundary.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && hasMoreRef.current) {
          loadMoreRef.current?.();
        }
      },
      { rootMargin: '600px 0px' } // trigger 600px before sentinel is visible for smooth load
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []); // Attach once — all state read from refs so always current

  // ─── TRIGGER 2: Post-load check (debounced) ───────────────────────
  // Fires after every page load completes with a 250ms DOM-settle delay.
  // Threshold is 700px (same as IO + scroll listener) so it catches the case
  // where new results append and push the sentinel down past the IO zone —
  // the user is still "near the bottom" of what they can see but the sentinel
  // is now further away. The 250ms delay + loadingRef guard prevent jitter.
  useEffect(() => {
    if (loading || !hasMore) return;
    const timer = setTimeout(() => {
      const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const sh = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      if (y + window.innerHeight >= sh - 700) loadMoreRef.current?.();
    }, 250);
    return () => clearTimeout(timer);
  }, [loading, hasMore]);

  // ─── TRIGGER 3: Scroll listener (rAF-throttled, fast-scroller backup) ──
  // Throttled with requestAnimationFrame: runs at most once per display frame.
  // YouTube-style: hide header on scroll-down, show immediately on scroll-up.
  useEffect(() => {
    let rafId = null;
    const getScrollY = () => window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const getScrollH = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const y = getScrollY();
        // YouTube-style header: always show when near top, hide on down, show on up
        if (headerRef.current) {
          if (y < 10) {
            // Near top — always fully visible
            headerRef.current.style.transform = 'translateX(-50%) translateY(0)';
          } else if (y < lastScrollY.current - 2) {
            // Scrolling UP (even tiny) → slide in immediately
            headerRef.current.style.transform = 'translateX(-50%) translateY(0)';
          } else if (y > lastScrollY.current + 5) {
            // Scrolling DOWN past threshold → slide out above viewport
            headerRef.current.style.transform = 'translateX(-50%) translateY(-110%)';
          }
        }
        lastScrollY.current = y;
        // Infinite scroll backup — Android-compatible
        if (!loadingRef.current && hasMoreRef.current) {
          if (y + window.innerHeight >= getScrollH() - 700) loadMoreRef.current?.();
        }
      });
    };
    // Listen on both window AND document for maximum Android WebView compatibility
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []); // Attach once — state read from refs so always current

  const categoryTitle = category ? CATEGORY_TITLES[category] : null;

  const personalizedResults = results;

  return (
    <div className="page" style={{ background: 'var(--bg-primary)', minHeight: '100vh', paddingTop: headerHeight }}>

      {/* ── YouTube-style Fixed Header: hides on scroll-down, shows on scroll-up ── */}
      <div
        ref={headerRef}
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%) translateY(0)',
          width: '100%',
          maxWidth: 480,
          zIndex: 100,
          background: 'rgba(12, 12, 14, 0.96)',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          borderBottom: '0.5px solid var(--border)',
          // Smooth spring animation matching Home/Schedule headers
          transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
      >
        <div style={{ padding: '10px 14px 8px', paddingTop: 'var(--sat)', display: 'flex', gap: 10, alignItems: 'center' }}>

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
                /* Android WebView: allow long-press Paste context menu */
                WebkitUserSelect: 'text',
                userSelect: 'text',
                WebkitTouchCallout: 'default',
                touchAction: 'auto',
              }}
            />
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
              position: 'relative', cursor: 'pointer',
              touchAction: 'manipulation',
              transition: 'background-color 0.2s ease, border-color 0.2s ease, transform 0.15s ease',
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
                {g}
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

      {/* ─── Modern 120 FPS AppDrawer Filter Panel ─── */}
      <AppDrawer
        open={showFilter}
        onOpenChange={setShowFilter}
        title="Filters"
        description={activeFilterCount > 0 ? `${activeFilterCount} active filters` : 'Filter anime by format, status, genre'}
        headerRight={
          activeFilterCount > 0 && (
            <button
              onClick={clearAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-muted)',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              <RotateCcw size={12} /> Reset
            </button>
          )
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Format ── */}
          <div>
            <SectionLabel>Format</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {FORMATS.map(f => (
                <FilterChip
                  key={f.value || 'all-fmt'}
                  label={f.label}
                  active={format === f.value}
                  onClick={() => setFormat(f.value)}
                />
              ))}
            </div>
          </div>

          {/* ── Status ── */}
          <div>
            <SectionLabel>Status</SectionLabel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUSES.map(s => (
                <FilterChip
                  key={s.value || 'all-st'}
                  label={s.label}
                  active={status === s.value}
                  onClick={() => setStatus(s.value)}
                />
              ))}
            </div>
          </div>

          {/* ── Genre ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
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
                  <motion.button
                    key={g}
                    id={`genre-filter-${g.toLowerCase().replace(/\s/g, '-')}`}
                    onClick={() => toggleGenre(g)}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 12px', borderRadius: 12, cursor: 'pointer',
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: 13, fontWeight: active ? 600 : 400,
                      textAlign: 'left',
                      letterSpacing: '-0.1px',
                    }}
                  >
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
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* ── Apply Button ── */}
          <div style={{ paddingTop: 8 }}>
            <motion.button
              onClick={() => setShowFilter(false)}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
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
            </motion.button>
          </div>
        </div>
      </AppDrawer>
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
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      style={{
        padding: '7px 16px', borderRadius: 20, cursor: 'pointer',
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'var(--bg-card)',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: active ? 700 : 500,
        touchAction: 'manipulation',
      }}
    >
      {label}
    </motion.button>
  );
}

// ─── Search Result Item ──────────────────────────────────────────
// Wrapped in memo to prevent redundant re-renders during scroll header changes
const SearchResultItem = memo(({ anime, activeGenres = [] }) => {
  const navigate = useNavigate();
  const title = getTitle(anime);
  const cover = getCover(anime);
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const status = anime.status;
  // Pass activeGenres so filtered tags are always shown & highlighted
  const allGenres = getDisplayGenresOrTags(anime, activeGenres);
  // Normalize active filter names for highlight matching (Harem variants)
  const activeSet = new Set(activeGenres.map(g =>
    (g === 'Female Harem' || g === 'Male Harem' || g === 'Harem') ? 'Harem' : g
  ));

  return (
    <motion.div
      className="search-result-item"
      onClick={() => navigate(`/anime/${anime.id}`, { viewTransition: true })}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && navigate(`/anime/${anime.id}`, { viewTransition: true })}
      id={`search-result-${anime.id}`}
      style={{
        display: 'flex', gap: 12, padding: '10px 14px',
        cursor: 'pointer', alignItems: 'flex-start',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        WebkitTapHighlightColor: 'transparent',
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
    </motion.div>
  );
});

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
