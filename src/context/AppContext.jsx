import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { supabase, fetchCloudWatchlist, syncCloudProgress, fetchUserProfile, updateCloudRecentlyViewed, updateCloudSettings } from '../api/supabase';
import { getAnimesByIds } from '../api/anilist';

const AppContext = createContext(null);

// Full anime metadata for local storage (covers My List, Favorites, History display needs)
function minimizeAnime(anime) {
  if (!anime) return null;
  return {
    id: anime.id,
    title: { romaji: anime.title?.romaji, english: anime.title?.english, native: anime.title?.native },
    coverImage: { large: anime.coverImage?.large, medium: anime.coverImage?.medium },
    episodes: anime.episodes,
    genres: anime.genres?.slice(0, 5),
    averageScore: anime.averageScore,
    status: anime.status,
    season: anime.season,
    seasonYear: anime.seasonYear,
    format: anime.format,
  };
}

// Ultra-minimal anime stub for Supabase cloud storage ONLY.
// ~120 bytes vs ~450 bytes for minimizeAnime. Stores just enough for My List display
// on a brand-new device. Episode progress (continue watching) is stored separately.
function tinyMinimize(anime) {
  if (!anime) return null;
  return {
    id: anime.id,
    title: { romaji: anime.title?.romaji || anime.title?.english || anime.title?.native || '' },
    coverImage: { medium: anime.coverImage?.medium || anime.coverImage?.large || '' },
  };
}


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
  downloadLocation: 'AniPlay',
  updatedAt: 0,
};

export function AppProvider({ children }) {
  const [watchlist, setWatchlist] = useState({});
  const [favorites, setFavorites] = useState({});
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [progress, setProgress] = useState({});
  const [likedComments, setLikedComments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // userProfile stub — fetched externally by Profile/AnimePage, kept here for context API compat
  const userProfile = null;

  // Refs to always hold the LATEST state values without stale closures
  const watchlistRef      = useRef({});
  const favoritesRef      = useRef({});
  const progressRef       = useRef({});
  const settingsRef       = useRef(DEFAULT_SETTINGS);
  const recentlyViewedRef = useRef([]);
  const userRef           = useRef(null);  // stable user access for [] callbacks

  useEffect(() => { watchlistRef.current      = watchlist;      }, [watchlist]);
  useEffect(() => { favoritesRef.current      = favorites;      }, [favorites]);
  useEffect(() => { progressRef.current       = progress;       }, [progress]);
  useEffect(() => { settingsRef.current       = settings;       }, [settings]);
  useEffect(() => { recentlyViewedRef.current = recentlyViewed; }, [recentlyViewed]);
  useEffect(() => { userRef.current           = user;           }, [user]);

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
        const lcVal = await Preferences.get({ key: 'aniplay_liked_comments' });

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

        if (finalWatchlist) {
          const minimizedW = {};
          Object.keys(finalWatchlist).forEach(id => {
            const item = finalWatchlist[id];
            minimizedW[id] = {
              ...item,
              anime: minimizeAnime(item?.anime)
            };
          });
          setWatchlist(minimizedW);
          finalWatchlist = minimizedW;
        }
        
        if (finalFavorites) {
          if (Array.isArray(finalFavorites)) {
            // Convert legacy list/Set array of IDs to object
            const migrated = {};
            finalFavorites.forEach(id => {
              migrated[id] = minimizeAnime(finalWatchlist?.[id]?.anime) || { id };
            });
            setFavorites(migrated);
          } else {
            const minimizedF = {};
            Object.keys(finalFavorites).forEach(id => {
              minimizedF[id] = minimizeAnime(finalFavorites[id]);
            });
            setFavorites(minimizedF);
          }
        }
        
        if (finalRecently)   setRecentlyViewed(finalRecently);
        if (finalProgress)   setProgress(finalProgress);
        if (lcVal.value) {
          try { setLikedComments(JSON.parse(lcVal.value)); } catch (_) {}
        }

      } catch (e) {
        console.error('[AppStorage] Error loading data from Capacitor Preferences:', e);
      } finally {
        setLoaded(true);
      }
    }
    loadData();
  }, []);

  // ── Sync Local to Cloud ───────────────────────────────────────────
  const syncWithCloudRef     = useRef(null);
  const isSyncingRef         = useRef(false);
  const hasPendingSyncRef    = useRef(false);
  // EGRESS: 12-hour cooldown — mutations write immediately via pushAnimeToCloud,
  // full reads (watchlist + profile) only needed ~2×/day for cross-device sync.
  // At 5,000 DAU this keeps monthly egress well under 5 GB.
  const SYNC_COOLDOWN_MS     = 12 * 60 * 60 * 1000; // 12 hours between full cloud reads
  const SYNC_TS_KEY          = 'aniplay_last_sync_at';

  // EGRESS: Only these 5 keys are synced to Supabase.
  // Everything else (volume, speed, subtitle tweaks, etc.) is local-only.
  const CLOUD_SETTINGS_KEYS  = ['darkMode', 'accentColor', 'autoplay', 'preferredServer', 'subtitleFontSize'];

  const syncWithCloud = useCallback(async (activeUser = null, force = false) => {
    if (isSyncingRef.current) {
      hasPendingSyncRef.current = true;
      return;
    }
    isSyncingRef.current = true;
    try {
      if (!loaded) return;
      const u = activeUser || user;
      if (!u) return;
      if (!activeUser && !settingsRef.current.autoBackup) return;

      // ── Sync Cooldown: skip if synced less than 10 minutes ago ──
      // (catches TOKEN_REFRESHED firing every hour, background flushes, etc.)
      const lastSyncAt = localStorage.getItem(SYNC_TS_KEY);
      const now        = Date.now();
      if (!force && lastSyncAt && (now - Number(lastSyncAt)) < SYNC_COOLDOWN_MS) {
        return; // skip — synced recently
      }

      // ── Incremental fetch: only download rows changed since last sync ──
      // On first ever sync (no lastSyncAt) download everything.
      const sinceTs = lastSyncAt
        ? new Date(Number(lastSyncAt)).toISOString()
        : null;

      // On SIGNED_IN (force=true) restore recently_viewed from cloud ONLY if local is empty.
      // This handles new installs / cleared app data. Subsequent syncs skip it (egress saving).
      const localIsEmpty = recentlyViewedRef.current.length === 0;
      const needsRecentlyViewed = force && localIsEmpty;

      const [cloudItems, profileData] = await Promise.all([
        fetchCloudWatchlist(sinceTs).catch(e => { console.warn('[Supabase Sync] Watchlist fetch failed:', e.message); return []; }),
        fetchUserProfile(u.id, { includeRecentlyViewed: needsRecentlyViewed }).catch(e => { console.warn('[Supabase Sync] Profile fetch failed:', e.message); return null; })
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
          // Prefer LOCAL anime metadata — cloud stores only a tiny stub (id+title+cover).
          // RECOVERY: check if local data has a real title. If the previous APK stored broken
          // {id, status} stubs, they have no title — fall back to cloud data to restore them.
          const localAnimeMeta = curWatchlist[id]?.anime;
          const hasGoodLocalMeta = localAnimeMeta &&
            (localAnimeMeta.title?.romaji || localAnimeMeta.title?.english || localAnimeMeta.title?.native);
          const animeMeta   = hasGoodLocalMeta ? localAnimeMeta : (cloudProg.anime || { id: id });

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

      // Merge Settings from cloud — only compare/apply the 5 cloud-synced keys
      let nextSettings = { ...settingsRef.current };
      if (profileData?.settings && Object.keys(profileData.settings).length > 0) {
        const cloudTime = profileData.settings.updatedAt || 0;
        const localTime = settingsRef.current.updatedAt   || 0;
        // Only pick up cloud values for the 5 keys we actually sync
        CLOUD_SETTINGS_KEYS.forEach(key => {
          if (profileData.settings[key] !== undefined) {
            if (cloudTime >= localTime) {
              nextSettings[key] = profileData.settings[key];
            }
          }
        });
        // Always preserve updatedAt winner
        if (cloudTime > localTime) nextSettings.updatedAt = cloudTime;
      }

      // Merge Recently Viewed (Continue Watching)
      let nextRecently = [...recentlyViewedRef.current];
      const cloudRecently = profileData?.recently_viewed || [];
      const mergedMap = new Map();

      // 1. Seed with local items
      nextRecently.forEach(item => {
        const id = item?.anime?.id || item?.id;
        if (id) mergedMap.set(String(id), item);
      });

      // 2. Merge cloud items (supports new {anime, episode, timestamp} & legacy {id, timestamp})
      cloudRecently.forEach(item => {
        const id = item?.anime?.id || item?.id || item?.anime_id;
        if (id) {
          const idStr = String(id);
          const localMeta = curWatchlist[idStr]?.anime || curFavorites[idStr];
          const hasGoodLocal = localMeta && (localMeta.title?.romaji || localMeta.title?.english || localMeta.title?.native);
          const animeMeta = hasGoodLocal ? localMeta : (item?.anime || nextWatchlist[idStr]?.anime || nextFavorites[idStr] || { id: Number(idStr) });
          const episode = item?.episode || nextProgress[idStr]?.episode || 1;
          const timestamp = item?.timestamp || nextProgress[idStr]?.timestamp || 0;

          const existing = mergedMap.get(idStr);
          if (!existing || timestamp > (existing.timestamp || 0)) {
            mergedMap.set(idStr, {
              anime: animeMeta,
              episode,
              timestamp
            });
          }
        }
      });

      // 3. Fallback: If any progress/watchlist items have episode progress but aren't in recentlyViewed, populate them
      Object.entries(nextProgress).forEach(([idStr, prog]) => {
        if (prog?.episode && !mergedMap.has(idStr)) {
          const animeMeta = nextWatchlist[idStr]?.anime || nextFavorites[idStr] || { id: Number(idStr) };
          mergedMap.set(idStr, {
            anime: animeMeta,
            episode: prog.episode,
            timestamp: prog.timestamp || 0
          });
        }
      });

      nextRecently = Array.from(mergedMap.values())
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 15);

      // ── Auto-Resolution of Missing Anime Titles/Covers & Ghost Entry Cleanup ──
      // If any anime objects only have an ID (missing title/cover due to minimal cloud storage),
      // fetch their full metadata from AniList in a single batch GraphQL call and populate them.
      const missingIds = new Set();
      const getAnimeId = (a) => a?.anime?.id || a?.id || a?.anime_id;
      const hasGoodTitle = (a) => {
        if (!a) return false;
        const titleObj = a?.title || a?.anime?.title;
        if (typeof titleObj === 'object' && titleObj !== null) {
          return !!(titleObj?.romaji || titleObj?.english || titleObj?.native);
        }
        if (typeof titleObj === 'string') {
          return titleObj.trim() !== '' && titleObj.toLowerCase() !== 'unknown';
        }
        return false;
      };

      Object.values(nextWatchlist).forEach(item => {
        const id = getAnimeId(item);
        if (id && !hasGoodTitle(item?.anime)) missingIds.add(Number(id));
      });
      Object.values(nextFavorites).forEach(anime => {
        const id = getAnimeId(anime);
        if (id && !hasGoodTitle(anime)) missingIds.add(Number(id));
      });
      nextRecently.forEach(item => {
        const id = getAnimeId(item);
        if (id && !hasGoodTitle(item?.anime)) missingIds.add(Number(id));
      });

      if (missingIds.size > 0) {
        console.log(`[Supabase Sync] Resolving missing titles/covers for ${missingIds.size} anime via AniList...`);
        try {
          const fetchedList = await getAnimesByIds(Array.from(missingIds));
          const animeMap = new Map();
          fetchedList.forEach(a => { if (a?.id) animeMap.set(Number(a.id), minimizeAnime(a)); });

          // Fill missing watchlist metadata
          Object.keys(nextWatchlist).forEach(id => {
            const numId = Number(id);
            if (animeMap.has(numId)) {
              nextWatchlist[id] = { ...nextWatchlist[id], anime: animeMap.get(numId) };
            }
          });

          // Fill missing favorites metadata
          Object.keys(nextFavorites).forEach(id => {
            const numId = Number(id);
            if (animeMap.has(numId)) {
              nextFavorites[id] = animeMap.get(numId);
            }
          });

          // Fill missing recentlyViewed metadata
          nextRecently = nextRecently.map(item => {
            const numId = Number(getAnimeId(item));
            const resolvedAnime = animeMap.get(numId) || (hasGoodTitle(item?.anime) ? item.anime : null);
            return {
              ...item,
              anime: resolvedAnime || { id: numId }
            };
          });
        } catch (err) {
          console.warn('[Supabase Sync] Failed to batch resolve missing anime metadata:', err.message);
        }
      }

      // ── Clean Ghost/Unknown Stubs ──
      // Purge any corrupted entries that failed resolution or have no valid title
      nextRecently = nextRecently.filter(item => hasGoodTitle(item?.anime));

      // Apply merged state (flat, no nesting)
      setWatchlist(nextWatchlist);
      setFavorites(nextFavorites);
      setProgress(nextProgress);
      setSettings(nextSettings);
      setRecentlyViewed(nextRecently);

      // If we just restored recently_viewed from cloud (new install), persist it locally
      // so the next app open doesn't need another cloud fetch
      if (needsRecentlyViewed && nextRecently.length > 0) {
        Preferences.set({ key: 'aniplay_recently_viewed', value: JSON.stringify(nextRecently) }).catch(() => {});
      }

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

        const cloudAnime = cloudItem?.progress?.anime;
        const needsMinimization = cloudAnime && (
          cloudAnime.characters || 
          cloudAnime.recommendations || 
          cloudAnime.description || 
          cloudAnime.bannerImage
        );

        // If it doesn't exist in the cloud, any of the values differ, or it needs data minimization, queue for sync
        if (
          !cloudItem ||
          cloudItem.status !== localStatus ||
          cloudFav !== localFav ||
          cloudEp !== localEp ||
          needsMinimization
        ) {
          upsertRows.push({
            user_id: u.id,
            anime_id: String(id),
            status: localStatus,
            favorite: localFav,
            // EGRESS: tinyMinimize stores only id+title+cover (~120 bytes) for new-device display.
            // Episode progress and continue watching are stored as episode + timestamp (unchanged).
            // This is 73% smaller than old minimizeAnime (~450 bytes) while keeping My List working.
            progress: {
              episode: localEp,
              timestamp: localProg?.timestamp || (cloudItem?.progress?.timestamp || null),
              anime: tinyMinimize(localItem?.anime || nextFavorites[id] || cloudAnime || null),
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
        // Only write the 5 cloud-synced keys — not the full settings object
        const slimSettings = {};
        CLOUD_SETTINGS_KEYS.forEach(k => { slimSettings[k] = nextSettings[k]; });
        slimSettings.updatedAt = nextSettings.updatedAt || Date.now();
        profileUpdate.settings = slimSettings;
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
      }

      // Mark successful sync time — used for incremental fetch next time
      localStorage.setItem(SYNC_TS_KEY, String(Date.now()));

    } catch (e) {
      console.error('[Supabase Sync Error]', e.message);
    } finally {
      isSyncingRef.current = false;
      if (hasPendingSyncRef.current) {
        hasPendingSyncRef.current = false;
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
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          // Full sync on explicit sign-in (force:true bypasses cooldown)
          syncWithCloudRef.current?.(session.user, true);
        }
        // TOKEN_REFRESHED fires every ~1hr — let the cooldown gate handle it
        // (sync only runs if >10 min since last sync)
        if (event === 'TOKEN_REFRESHED') {
          syncWithCloudRef.current?.(session.user);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        localStorage.removeItem('aniplay_last_sync_at');
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
    // Fast-path: mirror theme keys to localStorage so index.html can apply them
    // synchronously BEFORE React loads — eliminates the theme flash on every app open
    try {
      if (settings.accentColor) localStorage.setItem('aniplay_accent_fast', settings.accentColor);
      localStorage.setItem('aniplay_dark_fast', String(settings.darkMode !== false));
    } catch (_) {}
  }, [settings, loaded]);

  // ── Auto-save Liked Comments when changed ──────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    Preferences.set({ key: 'aniplay_liked_comments', value: JSON.stringify(likedComments) }).catch(console.error);
  }, [likedComments, loaded]);

  const syncTimeoutRef = useRef(null);

  const triggerDebouncedSync = useCallback(() => {
    if (!userRef.current) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      console.log('[Supabase Sync] Debounced background sync triggered...');
      syncWithCloudRef.current?.().catch(e => console.warn('[Supabase Sync] Background sync failed:', e.message));
    }, 12000);
  }, []); // STABLE — reads userRef + syncWithCloudRef at call-time

  // Ref so action callbacks can call triggerDebouncedSync without depending on it
  const triggerDebouncedSyncRef = useRef(null);
  useEffect(() => { triggerDebouncedSyncRef.current = triggerDebouncedSync; }, [triggerDebouncedSync]);

  const flushSync = useCallback(async () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    // All mutations (add/remove/favorite/status/episode/settings) now write immediately to
    // Supabase via pushAnimeToCloud / updateCloudSettings. There is nothing left to flush.
    // We still call syncWithCloud WITHOUT force so the 2-hour cooldown is respected.
    // Using force:true here caused a full cloud download on EVERY app-background event.
    console.log('[Supabase Sync] Flush requested — respecting 2h cooldown for cloud reads...');
    await syncWithCloudRef.current?.(); // no force:true
  }, []); // STABLE

  // ── Instant cloud write helper: upserts one row directly without sync cooldown ──
  // Use this for user-initiated mutations (add/remove/favorite/status change) so changes
  // reach Supabase immediately instead of waiting up to 10 minutes for the sync gate.
  const pushAnimeToCloud = useCallback((animeId, overrides = {}) => {
    const u = userRef.current;
    if (!u) return;
    const status   = overrides.status   ?? watchlistRef.current[animeId]?.status   ?? 'temp_watching';
    const favorite = overrides.favorite ?? !!favoritesRef.current[animeId];
    const ep       = overrides.episode  ?? progressRef.current[animeId]?.episode   ?? null;
    const ts       = overrides.timestamp ?? progressRef.current[animeId]?.timestamp ?? null;
    // EGRESS: store tiny anime stub (~120 bytes) for new-device My List display support.
    // Without this, new device logins show anime with no titles or covers on My List.
    const anime    = overrides.anime ?? watchlistRef.current[animeId]?.anime ?? favoritesRef.current[animeId] ?? null;
    supabase
      .from('watchlist')
      .upsert({
        user_id:    u.id,
        anime_id:   String(animeId),
        status,
        favorite,
        progress:   { episode: ep, timestamp: ts, anime: tinyMinimize(anime) }, // 120 bytes vs 450 bytes
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,anime_id' })
      .then(({ error }) => {
        if (error) console.warn('[Cloud Push Error]', error.message);
        else console.log('[Cloud Push] Synced anime', animeId, '| status:', status, '| fav:', favorite);
      });
  }, []); // STABLE — reads all refs at call-time

  const pushAnimeToCloudRef = useRef(null);
  useEffect(() => { pushAnimeToCloudRef.current = pushAnimeToCloud; }, [pushAnimeToCloud]);

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

  // ── Update Settings Helper ──────────────────────────────
  const updateSettings = useCallback((partial) => {
    // Compute next settings from ref (always current) so we can pass to both
    // setSettings and updateCloudSettings in the same tick
    const next = { ...settingsRef.current, ...partial, updatedAt: Date.now() };
    setSettings(next);
    // Instant cloud write — UPDATE on user_profiles, zero egress (no SELECT return)
    const u = userRef.current;
    if (u) {
      updateCloudSettings(next).catch(e => console.warn('[Settings Sync]', e.message));
    }
    triggerDebouncedSyncRef.current?.();
  }, []); // STABLE — reads settingsRef + userRef at call-time

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
    const minimized = minimizeAnime(anime);
    setWatchlist(prev => ({
      ...prev,
      [anime.id]: { anime: minimized, status, addedAt: Date.now() },
    }));
    showToast('Added to My List ✓');
    // Instant cloud write — don't rely on debounced sync which may be blocked by 10-min cooldown
    pushAnimeToCloudRef.current?.(anime.id, { status, favorite: false, anime: minimized });
    triggerDebouncedSyncRef.current?.();
  }, []); // STABLE — showToast is [] stable; reads pushAnimeToCloudRef + triggerDebouncedSyncRef at call-time

  const removeFromWatchlist = useCallback((animeId) => {
    setWatchlist(prev => {
      const next = { ...prev };
      delete next[animeId];
      return next;
    });
    showToast('Removed from My List');

    const u = userRef.current;
    if (u) {
      supabase
        .from('watchlist')
        .delete()
        .eq('user_id', u.id)
        .eq('anime_id', String(animeId))
        .then(({ error }) => {
          if (error) console.warn('[Sync error]', error.message);
        });
    }
  }, []); // STABLE — reads userRef.current at call-time

  const updateWatchlistStatus = useCallback((animeId, status) => {
    setWatchlist(prev => ({
      ...prev,
      [animeId]: { ...prev[animeId], status },
    }));
    // Instant cloud write — status changes must reach server immediately
    pushAnimeToCloudRef.current?.(animeId, { status });
    triggerDebouncedSyncRef.current?.();
  }, []); // STABLE — reads pushAnimeToCloudRef + triggerDebouncedSyncRef at call-time

  const isInWatchlist = useCallback((animeId) => Boolean(watchlist[animeId]), [watchlist]);

  const toggleFavorite = useCallback((animeId, anime = null) => {
    let isFav = false;
    const minimized = minimizeAnime(anime);
    setFavorites(prev => {
      const next = { ...prev };
      if (next[animeId]) {
        delete next[animeId];
        showToast('Removed from Favorites');
        isFav = false;
      } else {
        next[animeId] = minimized || { id: animeId };
        showToast('Added to Favorites ❤️');
        isFav = true;
      }
      return next;
    });

    const u = userRef.current;
    if (u) {
      const status = watchlistRef.current[animeId]?.status || 'temp_watching';
      const ep = progressRef.current[animeId]?.episode || null;
      const ts = progressRef.current[animeId]?.timestamp || null;
      supabase
        .from('watchlist')
        .upsert({
          user_id: u.id,
          anime_id: String(animeId),
          status: status,
          favorite: isFav,
          progress: {
            episode: ep,
            timestamp: ts,
            anime: minimized || minimizeAnime(watchlistRef.current[animeId]?.anime) || { id: animeId }
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,anime_id' })
        .then(({ error }) => {
          if (error) console.warn('[Supabase Favorite Sync Error]', error.message);
        });
    }

    triggerDebouncedSyncRef.current?.();
  }, []); // STABLE — reads userRef + watchlistRef + triggerDebouncedSyncRef at call-time

  const isFavorite = useCallback((animeId) => Boolean(favorites[animeId]), [favorites]);

  const setEpisodeProgress = useCallback((animeId, epOrObj) => {
    const rawEp = typeof epOrObj === 'object' && epOrObj !== null ? epOrObj.episode : epOrObj;
    const episode = typeof rawEp === 'object' && rawEp !== null ? (rawEp.episode || 1) : (Number(rawEp) || 1);
    const timestamp = (typeof epOrObj === 'object' && epOrObj !== null && epOrObj.timestamp) || Date.now();
    setProgress(prev => ({ ...prev, [animeId]: { episode, timestamp } }));
    pushAnimeToCloudRef.current?.(animeId, { episode, timestamp });
    triggerDebouncedSyncRef.current?.();
  }, []);

  const getEpisodeProgress = useCallback((animeId) => {
    const p = progress[animeId];
    if (!p) return null;
    const rawEp = typeof p.episode === 'object' && p.episode !== null ? p.episode.episode : p.episode;
    return { episode: Number(rawEp) || 1, timestamp: p.timestamp || 0 };
  }, [progress]);

  const addToRecentlyViewed = useCallback((anime, episode) => {
    let nextRecently = [];
    setRecentlyViewed(prev => {
      const filtered = prev.filter(item => item?.anime?.id !== anime.id);

      const minimizedAnime = {
        id: anime.id,
        title: anime.title || {},
        coverImage: anime.coverImage || {},
        genres: anime.genres || [],
        averageScore: anime.averageScore || 70,
        status: anime.status || 'FINISHED'
      };

      nextRecently = [{ anime: minimizedAnime, episode, timestamp: Date.now() }, ...filtered].slice(0, 15);
      return nextRecently;
    });

    const u = userRef.current;
    if (u) {
      updateCloudRecentlyViewed(nextRecently).catch(e => console.warn('[RecentlyViewed Sync]', e.message));
    }
    triggerDebouncedSyncRef.current?.();
  }, []); // STABLE

  const removeFromRecentlyViewed = useCallback((animeId) => {
    let nextRecently = [];
    // Remove from recentlyViewed array
    setRecentlyViewed(prev => {
      nextRecently = prev.filter(item => item?.anime?.id !== animeId);
      return nextRecently;
    });
    // Also remove from progress so it disappears from continueWatchingList (which combines both sources)
    setProgress(prev => {
      const next = { ...prev };
      delete next[animeId];
      return next;
    });
    showToast('Removed from Continue Watching');

    // Immediate cloud writes for BOTH watchlist table and user_profiles table!
    const u = userRef.current;
    if (u) {
      supabase
        .from('watchlist')
        .delete()
        .eq('user_id', u.id)
        .eq('anime_id', String(animeId))
        .then(({ error }) => { if (error) console.warn('[Sync] remove error:', error.message); });

      updateCloudRecentlyViewed(nextRecently).catch(e => console.warn('[RecentlyViewed Sync]', e.message));
    }
    triggerDebouncedSyncRef.current?.();
  }, []); // STABLE

  // ── Liked Comments (local only, for comment reaction UI) ───────────────
  const toggleLikeComment = useCallback((commentId) => {
    let isLiking = false;
    setLikedComments(prev => {
      if (prev.includes(commentId)) {
        return prev.filter(id => id !== commentId);
      } else {
        isLiking = true;
        return [...prev, commentId];
      }
    });
    return isLiking;
  }, []); // STABLE

  // ── Memoize context value ───────────────────────────────────────────────
  // PRODUCTION FIX: toast is intentionally EXCLUDED from the context value.
  // Including toast caused an app-wide re-render of all useApp() consumers
  // every 2.5 seconds (show + hide cycle). Toast is rendered directly inside
  // AppProvider without going through context. Only showToast (stable []) is
  // exposed so consumers can trigger it without subscribing to toast state.
  //
  // All action callbacks (addToWatchlist, toggleFavorite, etc.) are now []  
  // deps (stable, created once at mount) thanks to userRef and
  // triggerDebouncedSyncRef. On login, only syncWithCloud (which genuinely
  // needs user) updates in context — causing at most 1 Browse re-render.
  // Stub — future: count unread from Supabase notifications table
  const refreshUnreadCount = useCallback(() => {}, []); // STABLE

  const contextValue = useMemo(() => ({
    watchlist, addToWatchlist, removeFromWatchlist, updateWatchlistStatus, isInWatchlist,
    favorites, toggleFavorite, isFavorite,
    progress, setEpisodeProgress, getEpisodeProgress,
    recentlyViewed, addToRecentlyViewed, removeFromRecentlyViewed,
    likedComments, toggleLikeComment,
    showToast, loaded, user, userProfile, syncWithCloud, flushSync,
    settings, updateSettings,
    unreadCount: 0,         // reserved for future notification system
    refreshUnreadCount,     // used by Notifications.jsx
  }), [
    watchlist, addToWatchlist, removeFromWatchlist, updateWatchlistStatus, isInWatchlist,
    favorites, toggleFavorite, isFavorite,
    progress, setEpisodeProgress, getEpisodeProgress,
    recentlyViewed, addToRecentlyViewed, removeFromRecentlyViewed,
    likedComments, toggleLikeComment,
    showToast, loaded, user, syncWithCloud, flushSync,
    settings, updateSettings, refreshUnreadCount
  ]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
      {/* Global Toast — rendered directly (not via context) to avoid app-wide re-renders */}
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.msg}</div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
