import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Preferences } from '@capacitor/preferences';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [watchlist, setWatchlist] = useState({});
  const [favorites, setFavorites] = useState({});
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [progress, setProgress] = useState({});
  const [loaded, setLoaded] = useState(false);

  // ── Toast
  const [toast, setToast] = useState({ msg: '', show: false });

  const showToast = useCallback((msg) => {
    setToast({ msg, show: true });
    setTimeout(() => setToast({ msg: '', show: false }), 2500);
  }, []);

  // ── Load & Automatic Migration on Startup ──────────────────────
  useEffect(() => {
    async function loadData() {
      try {
        // Try loading from native preferences
        const wVal = await Preferences.get({ key: 'aniplay_watchlist' });
        const fVal = await Preferences.get({ key: 'aniplay_favorites' });
        const rVal = await Preferences.get({ key: 'aniplay_recently_viewed' });
        const pVal = await Preferences.get({ key: 'aniplay_progress' });

        let finalWatchlist = wVal.value ? JSON.parse(wVal.value) : null;
        let finalFavorites = fVal.value ? JSON.parse(fVal.value) : null;
        let finalRecently = rVal.value ? JSON.parse(rVal.value) : null;
        let finalProgress = pVal.value ? JSON.parse(pVal.value) : null;

        // Migration Check: If native preferences are empty, try migrating from localStorage
        if (!finalWatchlist && !finalFavorites && !finalRecently && !finalProgress) {
          console.log('[AppStorage] Migrating legacy localStorage to native Preferences...');
          const legacyW = localStorage.getItem('anilab_watchlist');
          const legacyF = localStorage.getItem('anilab_favorites');
          const legacyR = localStorage.getItem('anilab_recently_viewed');
          const legacyP = localStorage.getItem('anilab_progress');

          if (legacyW) {
            finalWatchlist = JSON.parse(legacyW);
            await Preferences.set({ key: 'aniplay_watchlist', value: legacyW });
            localStorage.removeItem('anilab_watchlist');
          }
          if (legacyF) {
            finalFavorites = JSON.parse(legacyF);
            await Preferences.set({ key: 'aniplay_favorites', value: legacyF });
            localStorage.removeItem('anilab_favorites');
          }
          if (legacyR) {
            finalRecently = JSON.parse(legacyR);
            await Preferences.set({ key: 'aniplay_recently_viewed', value: legacyR });
            localStorage.removeItem('anilab_recently_viewed');
          }
          if (legacyP) {
            finalProgress = JSON.parse(legacyP);
            await Preferences.set({ key: 'aniplay_progress', value: legacyP });
            localStorage.removeItem('anilab_progress');
          }
        }

        // Set React States
        if (finalWatchlist) setWatchlist(finalWatchlist);
        
        if (finalFavorites) {
          if (Array.isArray(finalFavorites)) {
            // Convert legacy list/Set array of IDs to object
            const migrated = {};
            finalFavorites.forEach(id => {
              migrated[id] = finalWatchlist?.[id]?.anime || { id };
            });
            setFavorites(migrated);
          } else {
            setFavorites(finalFavorites);
          }
        }
        
        if (finalRecently)   setRecentlyViewed(finalRecently);
        if (finalProgress)   setProgress(finalProgress);

      } catch (e) {
        console.error('[AppStorage] Error loading data from Capacitor Preferences:', e);
      } finally {
        setLoaded(true);
      }
    }
    loadData();
  }, []);

  // ── Auto-save Watchlist when changed ───────────────────────────
  useEffect(() => {
    if (!loaded) return;
    Preferences.set({ key: 'aniplay_watchlist', value: JSON.stringify(watchlist) }).catch(console.error);
  }, [watchlist, loaded]);

  // ── Auto-save Favorites when changed ───────────────────────────
  useEffect(() => {
    if (!loaded) return;
    Preferences.set({ key: 'aniplay_favorites', value: JSON.stringify(favorites) }).catch(console.error);
  }, [favorites, loaded]);

  // ── Auto-save Progress when changed ────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    Preferences.set({ key: 'aniplay_progress', value: JSON.stringify(progress) }).catch(console.error);
  }, [progress, loaded]);

  // ── Auto-save Recently Viewed when changed ─────────────────────
  useEffect(() => {
    if (!loaded) return;
    Preferences.set({ key: 'aniplay_recently_viewed', value: JSON.stringify(recentlyViewed) }).catch(console.error);
  }, [recentlyViewed, loaded]);

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
      const next = { ...prev };
      if (next[animeId]) {
        delete next[animeId];
        showToast('Removed from Favorites');
      } else {
        next[animeId] = anime || { id: animeId };
        showToast('Added to Favorites ❤️');
      }
      return next;
    });
  }, [showToast]);

  const isFavorite = useCallback((animeId) => Boolean(favorites[animeId]), [favorites]);


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
      showToast, toast, loaded
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
