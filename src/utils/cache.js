import offlineCatalog from '../data/offlineCatalog.json' with { type: 'json' };

const MAX_MEMORY_ENTRIES = 100;
const MEMORY_CACHE = new Map();

function getMemoryCache(key) {
  if (!MEMORY_CACHE.has(key)) return undefined;
  const entry = MEMORY_CACHE.get(key);
  // Re-insert to keep MRU order
  MEMORY_CACHE.delete(key);
  MEMORY_CACHE.set(key, entry);
  return entry;
}

function setMemoryCache(key, value) {
  if (MEMORY_CACHE.has(key)) {
    MEMORY_CACHE.delete(key);
  } else if (MEMORY_CACHE.size >= MAX_MEMORY_ENTRIES) {
    // Evict least-recently used entry
    const oldestKey = MEMORY_CACHE.keys().next().value;
    if (oldestKey !== undefined) MEMORY_CACHE.delete(oldestKey);
  }
  MEMORY_CACHE.set(key, value);
}

// One-time purge of any poisoned kitsu cache entries from previous versions
try {
  if (typeof localStorage !== 'undefined') {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('aniplay_cache_') || k.startsWith('aniplay_detail_') || k.startsWith('anilist_cache_'))) {
        const val = localStorage.getItem(k);
        if (val && val.includes('kitsu.app')) {
          toRemove.push(k);
        }
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }
} catch (_) {}

const MAX_DETAIL_CACHE_ITEMS = 60;

/**
 * Synchronously retrieves cached data from memory, localStorage, or pre-bundled offline seed catalog.
 * Used at render-time for instant initial state — zero-flicker page loads even on fresh cold start.
 */
export function getCachedData(key) {
  // 1. L1 Memory Cache
  const memEntry = getMemoryCache(key);
  if (memEntry?.data) return memEntry.data;

  // 2. L2 LocalStorage Cache
  try {
    const lsRaw = localStorage.getItem(`aniplay_cache_${key}`);
    if (lsRaw) {
      const lsEntry = JSON.parse(lsRaw);
      if (lsEntry?.data) {
        setMemoryCache(key, lsEntry);
        return lsEntry.data;
      }
    }
  } catch (_) { /* localStorage unavailable or corrupted — silently continue */ }

  // 3. L3 Pre-bundled Offline Seed Catalog (guarantees cold-start on day 1 never shows empty screen)
  if (offlineCatalog && offlineCatalog[key]) {
    const offlineData = offlineCatalog[key];
    // CRITICAL: timestamp must be 0 so withSWR treats this as cold-start seed data
    // and IMMEDIATELY revalidates against live AniList API in the background.
    setMemoryCache(key, { data: offlineData, timestamp: 0 });
    return offlineData;
  }

  return null;
}

/**
 * Force-invalidates a cache key from both memory and localStorage.
 * Useful when upstream data changes (e.g. user updates watchlist, notification dismissed).
 * @param {string} key  The cache key to invalidate
 */
export function invalidateCache(key) {
  MEMORY_CACHE.delete(key);
  try { localStorage.removeItem(`aniplay_cache_${key}`); } catch (_) {}
}

/**
 * Returns how many minutes ago the cache for `key` was last written.
 * Returns null if the key has never been cached.
 * Useful for "Updated X mins ago" UI indicators.
 * @param {string} key
 * @returns {number|null} Age in minutes, or null
 */
export function getCacheAge(key) {
  const memEntry = getMemoryCache(key);
  if (memEntry?.timestamp) return Math.floor((Date.now() - memEntry.timestamp) / 60000);
  try {
    const lsRaw = localStorage.getItem(`aniplay_cache_${key}`);
    if (lsRaw) {
      const lsEntry = JSON.parse(lsRaw);
      if (lsEntry?.timestamp) return Math.floor((Date.now() - lsEntry.timestamp) / 60000);
    }
  } catch (_) {}
  return null;
}

/**
 * Stale-While-Revalidate (SWR) Cache Manager — Zero-Downtime Production Grade
 *
 * Pattern:
 *   1. getCachedData(key) provides INSTANT synchronous state for first render.
 *   2. withSWR(key, fetcher, maxAgeMinutes) runs in background, returns
 *      fresh data via Promise. If cache is still fresh, skips network call.
 *
 * Resilience Rules:
 *   - Network failure/AniList 503/403/timeout → returns stale data without throwing.
 *   - Cold-start failure (no cache yet) → serves pre-bundled offline seed catalog.
 *   - Stale data NEVER expires destructively during network outages.
 *
 * @param {string}   key             Unique cache key (e.g. 'trending')
 * @param {function} fetcher         Async function → fresh data
 * @param {number}   maxAgeMinutes   Max cache age in minutes (default 15)
 * @returns {Promise<any>}           Resolves with data (cached, fresh, or offline fallback)
 */
export async function withSWR(key, fetcher, maxAgeMinutes = 15) {
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const now = Date.now();

  // ── 1. Memory Cache — instant, zero disk-access ──
  const memEntry = getMemoryCache(key);
  if (memEntry && now - memEntry.timestamp < maxAgeMs) {
    return memEntry.data;
  }

  // ── 2. LocalStorage Cache — cold-start warm-up ──
  if (!memEntry) {
    try {
      const lsRaw = localStorage.getItem(`aniplay_cache_${key}`);
      if (lsRaw) {
        const lsEntry = JSON.parse(lsRaw);
        if (lsEntry?.data) {
          setMemoryCache(key, lsEntry);
          if (now - lsEntry.timestamp < maxAgeMs) {
            return lsEntry.data;
          }
        }
      }
    } catch (e) {
      // Corrupted localStorage entry — purge it
      try { localStorage.removeItem(`aniplay_cache_${key}`); } catch (_) {}
    }
  }

  // ── 3. Network Fetch — revalidate with fresh data ──
  try {
    const freshData = await fetcher();

    // Only cache non-empty results; preserve last-known-good on empty response
    if (freshData && (!Array.isArray(freshData) || freshData.length > 0)) {
      const newEntry = { data: freshData, timestamp: now };
      setMemoryCache(key, newEntry);

      // Persist to localStorage (quota-safe)
      try {
        localStorage.setItem(`aniplay_cache_${key}`, JSON.stringify(newEntry));
      } catch (e) {
        // localStorage full — clear old caches to make room
        try {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('aniplay_cache_'));
          if (keys.length > 3) {
            keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
            localStorage.setItem(`aniplay_cache_${key}`, JSON.stringify(newEntry));
          }
        } catch (_) { /* Memory cache still works */ }
      }
      return freshData;
    }

    // If fetcher returned empty, fallback to stale
    const existingStale = memEntry || getMemoryCache(key);
    if (existingStale?.data) return existingStale.data;
    if (offlineCatalog && offlineCatalog[key]) return offlineCatalog[key];
    return freshData;
  } catch (error) {
    // ── Resilient Failure Handling: Never throw if ANY data exists anywhere ──
    const staleEntry = memEntry || getMemoryCache(key);
    if (staleEntry?.data) {
      console.warn(`[SWR] Network failed for "${key}", serving local stale data:`, error.message);
      return staleEntry.data;
    }

    // Check localStorage one more time unconditionally (ignoring age)
    try {
      const lsRaw = localStorage.getItem(`aniplay_cache_${key}`);
      if (lsRaw) {
        const lsEntry = JSON.parse(lsRaw);
        if (lsEntry?.data) {
          setMemoryCache(key, lsEntry);
          console.warn(`[SWR] Network failed for "${key}", recovered from localStorage:`, error.message);
          return lsEntry.data;
        }
      }
    } catch (_) {}

    // Check pre-bundled offline seed catalog (cold install safety net)
    if (offlineCatalog && offlineCatalog[key]) {
      console.warn(`[SWR] Network failed for "${key}", serving pre-bundled offline seed catalog:`, error.message);
      return offlineCatalog[key];
    }

    // No cached or offline data at all — propagate error as last resort
    throw error;
  }
}

/**
 * Persists an anime's full detail object in localStorage with LRU eviction.
 * Used by AnimePage and useAnimeDetail to ensure visited anime open with zero latency
 * and work completely offline without hitting AniList.
 */
export function saveDetailCache(id, anime) {
  if (!id || !anime) return;
  const key = `aniplay_detail_${id}`;
  try {
    // Keep track of recent keys for LRU eviction
    let recentKeys = [];
    try {
      recentKeys = JSON.parse(localStorage.getItem('aniplay_detail_lru_keys') || '[]');
    } catch (_) {}

    // Add current key to front
    recentKeys = [String(id), ...recentKeys.filter(k => k !== String(id))];

    // Evict oldest if exceeding limit
    if (recentKeys.length > MAX_DETAIL_CACHE_ITEMS) {
      const toRemove = recentKeys.slice(MAX_DETAIL_CACHE_ITEMS);
      recentKeys = recentKeys.slice(0, MAX_DETAIL_CACHE_ITEMS);
      for (const oldId of toRemove) {
        localStorage.removeItem(`aniplay_detail_${oldId}`);
      }
    }

    localStorage.setItem(key, JSON.stringify({ data: anime, timestamp: Date.now() }));
    localStorage.setItem('aniplay_detail_lru_keys', JSON.stringify(recentKeys));
  } catch (err) {
    // Quota reached: prune half the detail items
    try {
      const recentKeys = JSON.parse(localStorage.getItem('aniplay_detail_lru_keys') || '[]');
      const half = Math.ceil(recentKeys.length / 2);
      const toRemove = recentKeys.slice(half);
      for (const oldId of toRemove) {
        localStorage.removeItem(`aniplay_detail_${oldId}`);
      }
      localStorage.setItem('aniplay_detail_lru_keys', JSON.stringify(recentKeys.slice(0, half)));
      localStorage.setItem(key, JSON.stringify({ data: anime, timestamp: Date.now() }));
    } catch (_) { /* Silently skip persistence if storage is strictly blocked */ }
  }
}

/**
 * Retrieves an anime's detail object from localStorage or offline catalog.
 */
export function getDetailCache(id) {
  if (!id) return null;
  const key = `aniplay_detail_${id}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.data) return parsed.data;
    }
  } catch (_) {}

  // Check offline catalog details (100% authentic AniList seed data)
  if (offlineCatalog?.details && offlineCatalog.details[id]) {
    return offlineCatalog.details[id];
  }

  return null;
}
