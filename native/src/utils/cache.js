/**
 * AniLab Cache Utility
 * Stale-While-Revalidate pattern using AsyncStorage
 * - Shows cached data INSTANTLY on app open
 * - Refreshes in background when stale
 * - Falls back to cache if network fails
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'anilab_cache_';

// TTLs in milliseconds
const TTL = {
  trending:       30 * 60 * 1000,   // 30 minutes
  airing:         15 * 60 * 1000,   // 15 minutes
  newReleases:    15 * 60 * 1000,   // 15 minutes
  popularSeason:  30 * 60 * 1000,   // 30 minutes
  topRated:       60 * 60 * 1000,   // 1 hour
  movies:         60 * 60 * 1000,   // 1 hour
  schedule:       10 * 60 * 1000,   // 10 minutes
  animeDetail:    60 * 60 * 1000,   // 1 hour per anime
};

/**
 * Save data to cache with expiry timestamp
 */
export async function cacheSet(key, data) {
  try {
    const entry = {
      data,
      cachedAt: Date.now(),
    };
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // Cache write failure is non-fatal
    console.warn('[Cache] Write failed for', key, e.message);
  }
}

/**
 * Get cached data. Returns { data, isStale } or null if no cache.
 */
export async function cacheGet(key, ttlMs) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const age = Date.now() - entry.cachedAt;
    return {
      data: entry.data,
      isStale: age > ttlMs,
      age,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Stale-While-Revalidate fetch.
 * - Calls onData(data, isStale) immediately with cached data (if any)
 * - Fetches fresh data in background
 * - Calls onData(data, false) again when fresh data arrives
 * - Calls onError(err) only if BOTH cache and network fail
 * 
 * @param {string} key - cache key
 * @param {string} ttlKey - key to look up TTL in the TTL table
 * @param {Function} fetcher - async function that fetches fresh data
 * @param {Function} onData - called with (data, isStale)
 * @param {Function} onError - called if no data at all
 */
export async function swrFetch(key, ttlKey, fetcher, onData, onError) {
  const ttlMs = TTL[ttlKey] || 30 * 60 * 1000;

  // Step 1: Serve cache immediately (fast path)
  let hadCache = false;
  const cached = await cacheGet(key, ttlMs);
  if (cached?.data) {
    onData(cached.data, cached.isStale);
    hadCache = true;
    // If fresh enough, skip re-fetching
    if (!cached.isStale) return;
  }

  // Step 2: Fetch fresh data in background
  try {
    const fresh = await fetcher();
    if (fresh && (Array.isArray(fresh) ? fresh.length > 0 : true)) {
      await cacheSet(key, fresh);
      onData(fresh, false);
    }
  } catch (err) {
    // Network failed — if we already showed cached data, silently ignore
    if (!hadCache) {
      onError(err);
    } else {
      console.warn('[Cache] Background refresh failed for', key, '— serving stale cache');
    }
  }
}

/**
 * Clear all AniLab API caches (useful for a manual refresh button)
 */
export async function clearAllCaches() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
    return cacheKeys.length;
  } catch (e) {
    console.warn('[Cache] Clear failed:', e.message);
    return 0;
  }
}

export { TTL };
