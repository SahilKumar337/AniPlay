const MEMORY_CACHE = new Map();

/**
 * Synchronously retrieves cached data from memory or localStorage.
 * Used at render-time for instant initial state — zero-flicker page loads.
 */
export function getCachedData(key) {
  const memEntry = MEMORY_CACHE.get(key);
  if (memEntry?.data) return memEntry.data;
  try {
    const lsRaw = localStorage.getItem(`aniplay_cache_${key}`);
    if (lsRaw) {
      const lsEntry = JSON.parse(lsRaw);
      if (lsEntry?.data) {
        MEMORY_CACHE.set(key, lsEntry);
        return lsEntry.data;
      }
    }
  } catch (_) { /* localStorage unavailable or corrupted — silently continue */ }
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
  const memEntry = MEMORY_CACHE.get(key);
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
 * Stale-While-Revalidate (SWR) Cache Manager — Production-grade
 *
 * Pattern:
 *   1. getCachedData(key) provides INSTANT synchronous state for first render.
 *   2. withSWR(key, fetcher, maxAgeMinutes) runs in background, returns
 *      fresh data via Promise. If cache is still fresh, skips network call.
 *
 * Worst-case handling:
 *   - Network down → returns stale cached data (warns, never crashes)
 *   - localStorage full → skips persistence, keeps memory cache
 *   - Corrupted cache → clears entry, fetches fresh
 *   - Fetcher returns empty → preserves last-known-good data
 *
 * @param {string}   key             Unique cache key (e.g. 'trending')
 * @param {function} fetcher         Async function → fresh data
 * @param {number}   maxAgeMinutes   Max cache age in minutes (default 15)
 * @returns {Promise<any>}           Resolves with data (cached or fresh)
 */
export async function withSWR(key, fetcher, maxAgeMinutes = 15) {
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const now = Date.now();

  // ── 1. Memory Cache — instant, zero disk-access ──
  const memEntry = MEMORY_CACHE.get(key);
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
          MEMORY_CACHE.set(key, lsEntry);
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
      MEMORY_CACHE.set(key, newEntry);

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
        } catch (_) { /* Give up on persistence — memory cache still works */ }
      }
    }

    return freshData;
  } catch (error) {
    // ── Worst case: network failed — serve stale data if available ──
    const staleEntry = memEntry || MEMORY_CACHE.get(key);
    if (staleEntry?.data) {
      console.warn(`[SWR] Network failed for "${key}", serving stale data:`, error.message);
      return staleEntry.data;
    }

    // No cached data at all — propagate the error
    throw error;
  }
}

