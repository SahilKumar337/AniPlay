import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Preferences } from '@capacitor/preferences';
import { supabase, fetchCloudWatchlist, syncCloudProgress } from '../api/supabase';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [watchlist, setWatchlist] = useState({});
  const [favorites, setFavorites] = useState({});
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [progress, setProgress] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState(null);

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

  // ── Sync Local to Cloud ──────────────────────────────────────────
  const syncWithCloud = useCallback(async (activeUser = null) => {
    try {
      const u = activeUser || user;
      if (!u) return;

      console.log('[Supabase Sync] Starting cloud sync...');
      const cloudItems = await fetchCloudWatchlist();
      
      setWatchlist(prev => {
        setFavorites(prevFavs => {
          setProgress(prevProg => {
            const nextWatchlist = { ...prev };
            const nextFavorites = { ...prevFavs };
            const nextProgress = { ...prevProg };
            let updated = false;

            // Merge cloud items into local state
            for (const item of cloudItems) {
              const id = item.anime_id;
              const cloudProgress = item.progress || {};
              const animeMeta = cloudProgress.anime || null;
              
              if (!animeMeta) continue; // skip if no metadata is available to recover

              // 1. Merge watchlist status
              const localItem = nextWatchlist[id];
              const cloudTime = new Date(item.updated_at).getTime();
              const localTime = localItem?.addedAt || 0;

              if (!localItem || cloudTime > localTime) {
                nextWatchlist[id] = {
                  anime: animeMeta,
                  status: item.status,
                  addedAt: cloudTime
                };
                updated = true;
              }

              // 2. Merge favorites
              const localFav = nextFavorites[id];
              if (item.favorite && !localFav) {
                nextFavorites[id] = animeMeta;
                updated = true;
              } else if (!item.favorite && localFav && cloudTime > localTime) {
                delete nextFavorites[id];
                updated = true;
              }

              // 3. Merge progress
              const localEpProg = nextProgress[id];
              const cloudEp = cloudProgress.episode;
              const cloudTs = cloudProgress.timestamp || 0;
              const localTs = localEpProg?.timestamp || 0;

              if (cloudEp && (!localEpProg || cloudTs > localTs)) {
                nextProgress[id] = {
                  episode: cloudEp,
                  timestamp: cloudTs
                };
                updated = true;
              }
            }

            // Sync any local-only items up to the cloud
            const syncUpstream = async () => {
              for (const id of Object.keys(nextWatchlist)) {
                const localItem = nextWatchlist[id];
                const cloudItem = cloudItems.find(x => String(x.anime_id) === String(id));
                const cloudTime = cloudItem ? new Date(cloudItem.updated_at).getTime() : 0;
                const localTime = localItem.addedAt || 0;

                if (!cloudItem || localTime > cloudTime) {
                  const localProg = nextProgress[id] || {};
                  const isFav = !!nextFavorites[id];
                  
                  await syncCloudProgress(
                    id,
                    localItem.status,
                    isFav,
                    {
                      episode: localProg.episode || null,
                      timestamp: localProg.timestamp || null,
                      anime: localItem.anime
                    }
                  );
                }
              }
            };
            
            syncUpstream().then(() => {
              console.log('[Supabase Sync] Local data synced upstream successfully!');
            }).catch(e => {
              console.warn('[Supabase Sync] Failed to sync upstream:', e.message);
            });

            return nextProgress;
          });
          return nextFavorites;
        });
        return nextWatchlist;
      });

    } catch (e) {
      console.error('[Supabase Sync Error]', e.message);
    }
  }, [user]);

  // Auth observer
  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        syncWithCloud(session.user);
      }
    });
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        await syncWithCloud(session.user);
      } else {
        setUser(null);
      }
    });
    
    return () => subscription.unsubscribe();
  }, [syncWithCloud]);

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

  const addToWatchlist = useCallback(async (anime, status = 'plan_to_watch') => {
    setWatchlist(prev => ({
      ...prev,
      [anime.id]: { anime, status, addedAt: Date.now() },
    }));
    showToast('Added to My List ✓');

    if (user) {
      try {
        const localProg = progress[anime.id] || {};
        await syncCloudProgress(anime.id, status, !!favorites[anime.id], {
          episode: localProg.episode || null,
          timestamp: localProg.timestamp || null,
          anime: anime
        });
      } catch (e) {
        console.warn('[Sync error]', e.message);
      }
    }
  }, [user, progress, favorites, showToast]);

  const removeFromWatchlist = useCallback(async (animeId) => {
    setWatchlist(prev => {
      const next = { ...prev };
      delete next[animeId];
      return next;
    });
    showToast('Removed from My List');

    if (user) {
      try {
        await supabase
          .from('watchlist')
          .delete()
          .eq('user_id', user.id)
          .eq('anime_id', String(animeId));
      } catch (e) {
        console.warn('[Sync error]', e.message);
      }
    }
  }, [user, showToast]);

  const updateWatchlistStatus = useCallback(async (animeId, status) => {
    setWatchlist(prev => ({
      ...prev,
      [animeId]: { ...prev[animeId], status },
    }));

    if (user && watchlist[animeId]) {
      try {
        const item = watchlist[animeId];
        const localProg = progress[animeId] || {};
        await syncCloudProgress(animeId, status, !!favorites[animeId], {
          episode: localProg.episode || null,
          timestamp: localProg.timestamp || null,
          anime: item.anime
        });
      } catch (e) {
        console.warn('[Sync error]', e.message);
      }
    }
  }, [user, watchlist, progress, favorites]);

  const isInWatchlist = useCallback((animeId) => Boolean(watchlist[animeId]), [watchlist]);

  const toggleFavorite = useCallback(async (animeId, anime = null) => {
    let nextIsFav = false;
    setFavorites(prev => {
      const next = { ...prev };
      if (next[animeId]) {
        delete next[animeId];
        showToast('Removed from Favorites');
        nextIsFav = false;
      } else {
        next[animeId] = anime || { id: animeId };
        showToast('Added to Favorites ❤️');
        nextIsFav = true;
      }
      return next;
    });

    if (user) {
      try {
        const item = watchlist[animeId] || (anime ? { anime, status: 'watching' } : null);
        if (item) {
          const localProg = progress[animeId] || {};
          await syncCloudProgress(animeId, item.status, nextIsFav, {
            episode: localProg.episode || null,
            timestamp: localProg.timestamp || null,
            anime: item.anime
          });
        }
      } catch (e) {
        console.warn('[Sync error]', e.message);
      }
    }
  }, [user, watchlist, progress, showToast]);

  const isFavorite = useCallback((animeId) => Boolean(favorites[animeId]), [favorites]);

  const setEpisodeProgress = useCallback(async (animeId, episode) => {
    const timestamp = Date.now();
    setProgress(prev => ({ ...prev, [animeId]: { episode, timestamp } }));

    if (user) {
      try {
        const item = watchlist[animeId];
        if (item) {
          const isFav = !!favorites[animeId];
          await syncCloudProgress(animeId, item.status, isFav, {
            episode,
            timestamp,
            anime: item.anime
          });
        }
      } catch (e) {
        console.warn('[Sync error]', e.message);
      }
    }
  }, [user, watchlist, favorites]);

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
      showToast, toast, loaded, user, syncWithCloud
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
