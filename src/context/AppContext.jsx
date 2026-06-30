import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // ── Watchlist: { [animeId]: { anime, status, progress } }
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem('anilab_watchlist') || '{}'); }
    catch { return {}; }
  });

  // ── Favorites: Set of IDs
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('anilab_favorites') || '[]')); }
    catch { return new Set(); }
  });

  // ── Recently viewed: [ { anime, episode, timestamp }, ... ]
  const [recentlyViewed, setRecentlyViewed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('anilab_recently_viewed') || '[]'); }
    catch { return []; }
  });

  // ── Watch progress: { [animeId]: { episode, timestamp } }
  const [progress, setProgress] = useState(() => {
    try { return JSON.parse(localStorage.getItem('anilab_progress') || '{}'); }
    catch { return {}; }
  });

  // ── Toast
  const [toast, setToast] = useState({ msg: '', show: false });

  const showToast = useCallback((msg) => {
    setToast({ msg, show: true });
    setTimeout(() => setToast({ msg: '', show: false }), 2500);
  }, []);

  // Persist watchlist
  useEffect(() => {
    localStorage.setItem('anilab_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  // Persist favorites
  useEffect(() => {
    localStorage.setItem('anilab_favorites', JSON.stringify([...favorites]));
  }, [favorites]);

  // Persist progress
  useEffect(() => {
    localStorage.setItem('anilab_progress', JSON.stringify(progress));
  }, [progress]);

  // Persist recently viewed
  useEffect(() => {
    localStorage.setItem('anilab_recently_viewed', JSON.stringify(recentlyViewed));
  }, [recentlyViewed]);

  const addToWatchlist = useCallback((anime, status = 'plan_to_watch') => {
    setWatchlist(prev => ({
      ...prev,
      [anime.id]: { anime, status, addedAt: Date.now() },
    }));
    showToast('Added to My List ✓');
  }, [showToast]);

  const removeFromWatchlist = useCallback((animeId) => {
    setWatchlist(prev => {
      const next = { ...prev };
      delete next[animeId];
      return next;
    });
    showToast('Removed from My List');
  }, [showToast]);

  const updateWatchlistStatus = useCallback((animeId, status) => {
    setWatchlist(prev => ({
      ...prev,
      [animeId]: { ...prev[animeId], status },
    }));
  }, []);

  const isInWatchlist = useCallback((animeId) => Boolean(watchlist[animeId]), [watchlist]);

  const toggleFavorite = useCallback((animeId, anime = null) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(animeId)) {
        next.delete(animeId);
        // Also remove from watchlist so My List stays in sync
        setWatchlist(w => {
          const wNext = { ...w };
          delete wNext[animeId];
          return wNext;
        });
        showToast('Removed from My List');
      } else {
        next.add(animeId);
        // Also add to watchlist so it appears in My List
        if (anime) {
          setWatchlist(w => ({
            ...w,
            [animeId]: { anime, status: 'plan_to_watch', addedAt: Date.now() },
          }));
        }
        showToast('Added to My List ✓');
      }
      return next;
    });
  }, [showToast]);

  const isFavorite = useCallback((animeId) => favorites.has(animeId), [favorites]);

  const setEpisodeProgress = useCallback((animeId, episode) => {
    setProgress(prev => ({ ...prev, [animeId]: { episode, timestamp: Date.now() } }));
  }, []);

  const getEpisodeProgress = useCallback((animeId) => progress[animeId] || null, [progress]);

  const addToRecentlyViewed = useCallback((anime, episode) => {
    setRecentlyViewed(prev => {
      const filtered = prev.filter(item => item.anime.id !== anime.id);
      const next = [{ anime, episode, timestamp: Date.now() }, ...filtered];
      return next.slice(0, 15);
    });
  }, []);

  const removeFromRecentlyViewed = useCallback((animeId) => {
    setRecentlyViewed(prev => prev.filter(item => item.anime.id !== animeId));
    showToast('Removed from Continue Watching');
  }, [showToast]);

  return (
    <AppContext.Provider value={{
      watchlist, addToWatchlist, removeFromWatchlist, updateWatchlistStatus, isInWatchlist,
      favorites, toggleFavorite, isFavorite,
      progress, setEpisodeProgress, getEpisodeProgress,
      recentlyViewed, addToRecentlyViewed, removeFromRecentlyViewed,
      showToast, toast,
    }}>
      {children}
      {/* Global Toast */}
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.msg}</div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
