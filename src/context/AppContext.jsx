import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { supabase, fetchCloudWatchlist, syncCloudProgress, fetchUserProfile, updateCloudRecentlyViewed, updateCloudSettings } from '../api/supabase';

const AppContext = createContext(null);

// ── Default Settings ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  // Player
  autoplay: true,
  preferredServer: 'auto',       // 'auto' | 'neko' | 'anihd' | 'waveshd'
  // Theme/UI
  darkMode: true,
  accentColor: '#7c3aed',        // hex color
  compactCards: false,
  // Subtitles
  subtitleFontSize: 'medium',    // 'small' | 'medium' | 'large' | 'xlarge'
  subtitleColor: '#ffffff',
  subtitleBgOpacity: 0.5,        // 0 – 1
  subtitlePosition: 'bottom',    // 'bottom' | 'top'
  // Data
  autoBackup: true,
  updatedAt: 0,
};

export function AppProvider({ children }) {
  const [watchlist, setWatchlist] = useState({});
  const [favorites, setFavorites] = useState({});
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [progress, setProgress] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // Refs to always hold the LATEST state values without stale closures
  const watchlistRef = useRef({});
  const favoritesRef = useRef({});
  const progressRef  = useRef({});
  const settingsRef  = useRef(DEFAULT_SETTINGS);
  const recentlyViewedRef = useRef([]);

  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);
  useEffect(() => { progressRef.current  = progress;  }, [progress]);
  useEffect(() => { settingsRef.current  = settings;  }, [settings]);
  useEffect(() => { recentlyViewedRef.current = recentlyViewed; }, [recentlyViewed]);

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
        const sVal = await Preferences.get({ key: 'aniplay_settings' });

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
        // Load settings (merged with defaults so new keys always appear)
        if (sVal.value) {
          try {
            const savedSettings = JSON.parse(sVal.value);
            setSettings(prev => ({ ...prev, ...savedSettings }));
          } catch (_) {}
        }

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

  // ── Sync Local to Cloud ─────────────────────────────────────────
  const syncWithCloudRef = useRef(null);
  const isSyncingRef = useRef(false);
  const hasPendingSyncRef = useRef(false);

  const syncWithCloud = useCallback(async (activeUser = null) => {
    if (isSyncingRef.current) {
      hasPendingSyncRef.current = true;
      console.log('[Supabase Sync] Sync already in progress. Queued pending sync.');
      return;
    }
    isSyncingRef.current = true;
    try {
      if (!loaded) {
        console.log('[Supabase Sync] Deferred: local data not loaded yet.');
        return;
      }
      const u = activeUser || user;
      if (!u) return;
      if (!activeUser && !settingsRef.current.autoBackup) {
        console.log('[Supabase Sync] Skipped: autoBackup disabled.');
        return;
      }

      console.log('[Supabase Sync] Fetching cloud data (watchlist and profile)...');
      const [cloudItems, profileData] = await Promise.all([
        fetchCloudWatchlist().catch(e => { console.warn('[Supabase Sync] Failed to fetch cloud watchlist:', e.message); return []; }),
        fetchUserProfile(u.id).catch(e => { console.warn('[Supabase Sync] Failed to fetch cloud profile:', e.message); return null; })
      ]);

      // Read current values from refs (always fresh, no stale closure)
      const curWatchlist = { ...watchlistRef.current };
      const curFavorites = { ...favoritesRef.current };
      const curProgress  = { ...progressRef.current };

      // Compute merged state
      const nextWatchlist = { ...curWatchlist };
      const nextFavorites = { ...curFavorites };
      const nextProgress  = { ...curProgress };

      if (cloudItems?.length) {
        for (const item of cloudItems) {
          const id          = item.anime_id;
          const cloudProg   = item.progress || {};
          const animeMeta   = cloudProg.anime || { id: id };

          const cloudTime = new Date(item.updated_at).getTime();
          const localTime = Math.max(
            curWatchlist[id]?.addedAt || 0,
            curProgress[id]?.timestamp || 0,
            curFavorites[id]?.favoritedAt || 0
          );

          const isNewer = cloudTime > localTime;

          // Merge watchlist (exclude transient progress-only rows)
          if (item.status !== 'temp_watching') {
            if (!curWatchlist[id] || isNewer) {
              nextWatchlist[id] = { anime: animeMeta, status: item.status, addedAt: cloudTime };
            }
          } else {
            // If it is temp_watching in cloud but local watchlist doesn't have it, ensure it's not local
            if (!curWatchlist[id]) {
              delete nextWatchlist[id];
            }
          }

          // Merge favorites
          if (item.favorite) {
            if (!curFavorites[id] || isNewer) {
              nextFavorites[id] = { ...animeMeta, favoritedAt: curFavorites[id]?.favoritedAt || cloudTime };
            }
          } else {
            if (curFavorites[id] && isNewer) {
              delete nextFavorites[id];
            }
          }

          // Merge episode progress
          const cloudEp = cloudProg.episode;
          const cloudTs = cloudProg.timestamp || 0;
          const localTs = curProgress[id]?.timestamp || 0;
          if (cloudEp && (!curProgress[id] || cloudTs > localTs)) {
            nextProgress[id] = { episode: cloudEp, timestamp: cloudTs };
          }
        }
      }

      // Merge Settings from cloud (compares updatedAt timestamps to resolve conflicts)
      let nextSettings = { ...settingsRef.current };
      if (profileData?.settings && Object.keys(profileData.settings).length > 0) {
        const cloudTime = profileData.settings.updatedAt || 0;
        const localTime = settingsRef.current.updatedAt || 0;
        if (cloudTime > localTime) {
          nextSettings = { ...settingsRef.current, ...profileData.settings };
        } else {
          nextSettings = { ...profileData.settings, ...settingsRef.current };
        }
      }

      // Merge Recently Viewed (Continue Watching)
      let nextRecently = [...recentlyViewedRef.current];
      const cloudRecently = profileData?.recently_viewed || [];
      if (cloudRecently.length > 0) {
        const mergedMap = new Map();
        nextRecently.forEach(item => {
          if (item?.anime?.id) mergedMap.set(item.anime.id, item);
        });
        cloudRecently.forEach(item => {
          if (item?.anime?.id) {
            const existing = mergedMap.get(item.anime.id);
            if (!existing || item.timestamp > existing.timestamp) {
              mergedMap.set(item.anime.id, item);
            }
          }
        });
        nextRecently = Array.from(mergedMap.values())
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 15);
      }

      // Apply merged state (flat, no nesting)
      setWatchlist(nextWatchlist);
      setFavorites(nextFavorites);
      setProgress(nextProgress);
      setSettings(nextSettings);
      setRecentlyViewed(nextRecently);

      // Upstream Watchlist & Progress Sync: push local-only/newer items to cloud in a single bulk upsert
      const upsertRows = [];
      const allAnimeIds = new Set([
        ...Object.keys(nextWatchlist),
        ...Object.keys(nextProgress),
        ...Object.keys(nextFavorites)
      ]);

      for (const id of allAnimeIds) {
        const localItem = nextWatchlist[id];
        const localProg = nextProgress[id];
        const localFav  = !!nextFavorites[id];

        const cloudItem = cloudItems?.find(x => String(x.anime_id) === String(id));

        const localStatus = localItem?.status || (cloudItem?.status || 'temp_watching');
        const cloudFav    = cloudItem ? !!cloudItem.favorite : false;
        const cloudEp     = cloudItem?.progress?.episode || null;
        const localEp     = localProg?.episode || null;

        // If it doesn't exist in the cloud, or any of the values differ, queue for sync
        if (
          !cloudItem ||
          cloudItem.status !== localStatus ||
          cloudFav !== localFav ||
          cloudEp !== localEp
        ) {
          upsertRows.push({
            user_id: u.id,
            anime_id: String(id),
            status: localStatus,
            favorite: localFav,
            progress: {
              episode: localEp,
              timestamp: localProg?.timestamp || (cloudItem?.progress?.timestamp || null),
              anime: localItem?.anime || nextFavorites[id] || (cloudItem?.progress?.anime || { id })
            },
            updated_at: new Date().toISOString()
          });
        }
      }

      if (upsertRows.length > 0) {
        console.log(`[Supabase Sync] Bulk upserting ${upsertRows.length} items upstream...`);
        const { error } = await supabase
          .from('watchlist')
          .upsert(upsertRows, { onConflict: 'user_id,anime_id' });
        if (error) throw error;
        console.log('[Supabase Sync] Bulk upsert completed successfully.');
      } else {
        console.log('[Supabase Sync] Watchlist up to date.');
      }

      // Upstream Profile Sync: push merged settings/recently_viewed back if they differ
      const cloudSettingsStr = JSON.stringify(profileData?.settings || {});
      const nextSettingsStr  = JSON.stringify(nextSettings);
      const cloudRecentlyStr = JSON.stringify(cloudRecently);
      const nextRecentlyStr  = JSON.stringify(nextRecently);

      const profileUpdate = {};
      let needsProfileUpdate = false;

      if (cloudSettingsStr !== nextSettingsStr) {
        profileUpdate.settings = nextSettings;
        needsProfileUpdate = true;
      }
      if (cloudRecentlyStr !== nextRecentlyStr) {
        profileUpdate.recently_viewed = nextRecently;
        needsProfileUpdate = true;
      }

      if (needsProfileUpdate) {
        console.log('[Supabase Sync] Syncing profile to cloud...');
        let profileErr;
        if (!profileData) {
          console.log('[Supabase Sync] Profile row missing in DB. Creating new profile row...');
          const nickname = u.raw_user_meta_data?.nickname || u.email?.split('@')[0] || 'User';
          const { error } = await supabase
            .from('user_profiles')
            .insert({
              id: u.id,
              nickname,
              ...profileUpdate
            });
          profileErr = error;
        } else {
          console.log('[Supabase Sync] Profile row exists. Updating profile row...');
          const { error } = await supabase
            .from('user_profiles')
            .update(profileUpdate)
            .eq('id', u.id);
          profileErr = error;
        }
        if (profileErr) throw profileErr;
        console.log('[Supabase Sync] Cloud profile sync completed.');
      }

    } catch (e) {
      console.error('[Supabase Sync Error]', e.message);
    } finally {
      isSyncingRef.current = false;
      if (hasPendingSyncRef.current) {
        hasPendingSyncRef.current = false;
        console.log('[Supabase Sync] Flushing queued pending sync...');
        triggerDebouncedSync();
      }
    }
  }, [user, loaded]);

  // Keep ref current
  useEffect(() => { syncWithCloudRef.current = syncWithCloud; }, [syncWithCloud]);

  // Trigger cloud sync when local data is fully loaded and user is present
  useEffect(() => {
    if (loaded && user) {
      syncWithCloud();
    }
  }, [loaded, user, syncWithCloud]);

  // Auth observer — registered ONCE, uses ref to avoid infinite re-registrations
  useEffect(() => {
    // Restore existing session on app open
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        syncWithCloudRef.current?.(session.user);
      }
    }).catch(e => console.warn('[Auth] getSession error:', e.message));

    // Single persistent listener for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(session.user);
        // Only sync on actual sign-in/token refresh, not every tick
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          syncWithCloudRef.current?.(session.user);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []); // ← empty deps: registered ONCE only

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

  // ── Auto-save Settings when changed ───────────────────────────
  useEffect(() => {
    if (!loaded) return;
    Preferences.set({ key: 'aniplay_settings', value: JSON.stringify(settings) }).catch(console.error);
  }, [settings, loaded]);

  const syncTimeoutRef = useRef(null);

  const triggerDebouncedSync = useCallback(() => {
    if (!user) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      console.log('[Supabase Sync] Debounced background sync triggered...');
      syncWithCloud().catch(e => console.warn('[Supabase Sync] Background sync failed:', e.message));
    }, 12000);
  }, [user, syncWithCloud]);

  const flushSync = useCallback(async () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    console.log('[Supabase Sync] Flushing sync immediately...');
    await syncWithCloud();
  }, [syncWithCloud]);

  const flushSyncRef = useRef(null);
  useEffect(() => {
    flushSyncRef.current = flushSync;
  }, [flushSync]);

  useEffect(() => {
    let active = true;
    let subPromise = null;
    try {
      subPromise = App.addListener('appStateChange', async (state) => {
        if (!active) return;
        if (!state.isActive) {
          console.log('[App State] App backgrounded. Flushing sync to Supabase...');
          try {
            await flushSyncRef.current?.();
          } catch (e) {
            console.warn('[App State] Sync flush failed on background:', e.message);
          }
        }
      });
    } catch (err) {
      console.warn('[App State] AppState listener not supported in this environment:', err.message);
    }
    return () => {
      active = false;
      if (subPromise) {
        subPromise.then(h => h.remove()).catch(console.error);
      }
    };
  }, []);

  // ── Update Settings Helper ──────────────────────────────────────
  const updateSettings = useCallback((partial) => {
    setSettings(prev => ({ ...prev, ...partial, updatedAt: Date.now() }));
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  // ── Apply theme/accent/compact styles to CSS variables/body when settings change ───
  useEffect(() => {
    if (!loaded) return;
    // Apply accent color and its variants to CSS variables dynamically
    const accent = settings.accentColor || '#7c3aed';
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-hover', accent);
    document.documentElement.style.setProperty('--accent-dim', `${accent}20`);
    document.documentElement.style.setProperty('--shadow-glow', `0 0 20px ${accent}4d`);
    // Apply dark mode (body class)
    document.body.classList.toggle('theme-light', !settings.darkMode);
    // Apply compact cards (body class)
    document.body.classList.toggle('compact-cards', !!settings.compactCards);
  }, [settings.accentColor, settings.darkMode, settings.compactCards, loaded]);

  const addToWatchlist = useCallback((anime, status = 'plan_to_watch') => {
    setWatchlist(prev => ({
      ...prev,
      [anime.id]: { anime, status, addedAt: Date.now() },
    }));
    showToast('Added to My List ✓');
    triggerDebouncedSync();
  }, [showToast, triggerDebouncedSync]);

  const removeFromWatchlist = useCallback((animeId) => {
    setWatchlist(prev => {
      const next = { ...prev };
      delete next[animeId];
      return next;
    });
    showToast('Removed from My List');

    if (user) {
      supabase
        .from('watchlist')
        .delete()
        .eq('user_id', user.id)
        .eq('anime_id', String(animeId))
        .then(({ error }) => {
          if (error) console.warn('[Sync error]', error.message);
        });
    }
  }, [user, showToast]);

  const updateWatchlistStatus = useCallback((animeId, status) => {
    setWatchlist(prev => ({
      ...prev,
      [animeId]: { ...prev[animeId], status },
    }));
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  const isInWatchlist = useCallback((animeId) => Boolean(watchlist[animeId]), [watchlist]);

  const toggleFavorite = useCallback((animeId, anime = null) => {
    let isFav = false;
    setFavorites(prev => {
      const next = { ...prev };
      if (next[animeId]) {
        delete next[animeId];
        showToast('Removed from Favorites');
        isFav = false;
      } else {
        next[animeId] = anime || { id: animeId };
        showToast('Added to Favorites ❤️');
        isFav = true;
      }
      return next;
    });

    if (user) {
      const status = watchlistRef.current[animeId]?.status || 'temp_watching';
      const ep = progressRef.current[animeId]?.episode || null;
      const ts = progressRef.current[animeId]?.timestamp || null;
      supabase
        .from('watchlist')
        .upsert({
          user_id: user.id,
          anime_id: String(animeId),
          status: status,
          favorite: isFav,
          progress: {
            episode: ep,
            timestamp: ts,
            anime: anime || watchlistRef.current[animeId]?.anime || { id: animeId }
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,anime_id' })
        .then(({ error }) => {
          if (error) console.warn('[Supabase Favorite Sync Error]', error.message);
        });
    }

    triggerDebouncedSync();
  }, [user, showToast, triggerDebouncedSync]);

  const isFavorite = useCallback((animeId) => Boolean(favorites[animeId]), [favorites]);

  const setEpisodeProgress = useCallback((animeId, episode) => {
    const timestamp = Date.now();
    setProgress(prev => ({ ...prev, [animeId]: { episode, timestamp } }));
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  const getEpisodeProgress = useCallback((animeId) => progress[animeId] || null, [progress]);

  const addToRecentlyViewed = useCallback((anime, episode) => {
    setRecentlyViewed(prev => {
      const filtered = prev.filter(item => item.anime.id !== anime.id);
      
      // Keep only essential fields to prevent Supabase storage bloat
      const minimizedAnime = {
        id: anime.id,
        title: anime.title || {},
        coverImage: anime.coverImage || {},
        genres: anime.genres || [],
        averageScore: anime.averageScore || 70,
        status: anime.status || 'FINISHED'
      };

      return [{ anime: minimizedAnime, episode, timestamp: Date.now() }, ...filtered].slice(0, 15);
    });
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  const removeFromRecentlyViewed = useCallback((animeId) => {
    setRecentlyViewed(prev => prev.filter(item => item.anime.id !== animeId));
    showToast('Removed from Continue Watching');
    triggerDebouncedSync();
  }, [showToast, triggerDebouncedSync]);

  return (
    <AppContext.Provider value={{
      watchlist, addToWatchlist, removeFromWatchlist, updateWatchlistStatus, isInWatchlist,
      favorites, toggleFavorite, isFavorite,
      progress, setEpisodeProgress, getEpisodeProgress,
      recentlyViewed, addToRecentlyViewed, removeFromRecentlyViewed,
      showToast, toast, loaded, user, syncWithCloud, flushSync,
      settings, updateSettings
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
