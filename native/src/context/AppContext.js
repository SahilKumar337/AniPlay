import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, Animated } from 'react-native';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [watchlist, setWatchlist] = useState({});
  const [favorites, setFavorites] = useState(new Set());
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);

  // Toast State
  const [toastMsg, setToastMsg] = useState('');
  const [toastOpacity] = useState(new Animated.Value(0));

  // Load from AsyncStorage on mount
  useEffect(() => {
    async function loadStoredData() {
      try {
        const storedWatchlist = await AsyncStorage.getItem('anilab_watchlist');
        const storedFavorites = await AsyncStorage.getItem('anilab_favorites');
        const storedRecently = await AsyncStorage.getItem('anilab_recently_viewed');
        const storedProgress = await AsyncStorage.getItem('anilab_progress');

        if (storedWatchlist) {
          try {
            const parsed = JSON.parse(storedWatchlist);
            if (parsed && typeof parsed === 'object') setWatchlist(parsed);
          } catch {}
        }
        if (storedFavorites) {
          try {
            const parsed = JSON.parse(storedFavorites);
            if (Array.isArray(parsed)) setFavorites(new Set(parsed));
          } catch {}
        }
        if (storedRecently) {
          try {
            const parsed = JSON.parse(storedRecently);
            if (Array.isArray(parsed)) setRecentlyViewed(parsed);
          } catch {}
        }
        if (storedProgress) {
          try {
            const parsed = JSON.parse(storedProgress);
            if (parsed && typeof parsed === 'object') setProgress(parsed);
          } catch {}
        }
      } catch (e) {
        console.warn('[Storage] Failed to load data:', e);
      } finally {
        setLoading(false);
      }
    }
    loadStoredData();
  }, []);

  // Save watchlist
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem('anilab_watchlist', JSON.stringify(watchlist)).catch(() => {});
    }
  }, [watchlist, loading]);

  // Save favorites
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem('anilab_favorites', JSON.stringify([...favorites])).catch(() => {});
    }
  }, [favorites, loading]);

  // Save recently viewed
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem('anilab_recently_viewed', JSON.stringify(recentlyViewed)).catch(() => {});
    }
  }, [recentlyViewed, loading]);

  // Save progress
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem('anilab_progress', JSON.stringify(progress)).catch(() => {});
    }
  }, [progress, loading]);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    // Animate opacity in
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start(() => {
      setToastMsg('');
    });
  }, [toastOpacity]);

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
        setWatchlist(w => {
          const wNext = { ...w };
          delete wNext[animeId];
          return wNext;
        });
        showToast('Removed from My List');
      } else {
        next.add(animeId);
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
      showToast, loading
    }}>
      {children}
      {toastMsg ? (
        <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      ) : null}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(20, 20, 20, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e50914',
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  }
});
