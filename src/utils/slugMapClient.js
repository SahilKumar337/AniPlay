/**
 * AniPlay Slug Map Client
 * =======================
 * Talks to the Cloudflare Worker to get verified AniList ID → provider slug mappings.
 *
 * Priority order:
 *  1. localStorage instant cache (0ms) — survives app restarts
 *  2. Cloudflare Worker edge API (<5ms) — globally cached at edge
 *  3. Auto-resolve (3-10s) — server searches all providers for new anime
 *
 * Usage:
 *  import { getSlugMapping, batchPrefetchMappings } from './slugMapClient.js';
 *
 *  const mapping = await getSlugMapping(animeId);
 *  // { neko: "jujutsu-kaisen-tv", koto: "jujutsu-kaisen-tv-8ssye", waves: "...", status: "verified" }
 */

// Deployed Cloudflare Worker URL
const SLUG_MAP_API = 'https://aniplay-slugmap.skr246357.workers.dev';
const LS_KEY = 'aniplay_slugmap_v1';
const LS_TTL = 24 * 60 * 60 * 1000; // 24h local cache

// ─── Primary API ──────────────────────────────────────────────────────────────

/**
 * Get verified slug mapping for an anime.
 * Returns immediately from cache if available, else fetches from server.
 *
 * @param {number} anilistId - AniList anime ID
 * @returns {Promise<{neko, koto, kotoId, waves, status}|null>}
 */
export async function getSlugMapping(anilistId) {
  if (!anilistId) return null;

  // 1. Check localStorage (instant)
  const cached = getLocalCache(anilistId);
  if (cached) return cached;

  // 2. Fetch from edge server
  try {
    const res = await fetchWithTimeout(
      `${SLUG_MAP_API}/slug/${anilistId}`,
      {},
      4000 // 4s timeout — if server is slow, fall through to scraper fallback
    );

    if (!res.ok) return null;
    const data = await res.json();

    // Cache locally if we have a real result
    if (data.status === 'verified' || data.status === 'partial') {
      setLocalCache(anilistId, data);
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Batch-prefetch slug mappings for multiple anime at once.
 * Call this when loading an anime list page — fires one request for all IDs.
 *
 * @param {number[]} anilistIds - Array of AniList IDs
 */
export async function batchPrefetchMappings(anilistIds) {
  if (!anilistIds?.length) return;

  // Only fetch IDs not already in localStorage
  const missing = anilistIds.filter(id => !getLocalCache(id));
  if (!missing.length) return;

  try {
    const res = await fetchWithTimeout(
      `${SLUG_MAP_API}/batch?ids=${missing.join(',')}`,
      {},
      5000
    );
    if (!res.ok) return;
    const data = await res.json();

    // Cache all results
    for (const [id, mapping] of Object.entries(data.results || {})) {
      if (mapping.status === 'verified' || mapping.status === 'partial') {
        setLocalCache(parseInt(id), mapping);
      }
    }
  } catch {}
}

/**
 * Notify server that an anime was successfully played with a specific slug.
 * This helps the server learn correct mappings from real user plays.
 *
 * @param {number} anilistId
 * @param {{neko?, koto?, kotoId?, waves?}} slugs
 */
export async function reportSuccessfulPlay(anilistId, slugs) {
  if (!anilistId || !slugs) return;
  // Save to local cache immediately
  setLocalCache(anilistId, { ...slugs, status: 'verified' });
  // Also report to server (fire and forget)
  try {
    fetch(`${SLUG_MAP_API}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anilistId, ...slugs }),
    }).catch(() => {}); // intentionally ignore errors
  } catch {}
}

/**
 * ⚡ Cloudflare Edge Stream Cache (5-15ms worldwide)
 * Retrieves pre-resolved streams directly from Cloudflare Worker KV.
 * Completely eliminates cold scraper delays and decryption time.
 */
export async function getCloudStream(anilistId, episode) {
  if (!anilistId || !episode) return null;
  try {
    const res = await fetchWithTimeout(
      `${SLUG_MAP_API}/stream/${anilistId}/${episode}`,
      {},
      1500 // Fast 1.5s timeout — edge KV responds in 10-25ms
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.cached && (data.sources?.length > 0 || data.servers?.length > 0)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reports newly resolved stream to Cloudflare Edge KV.
 * Fire-and-forget: ensures instant edge playback for the next 2 hours.
 */
export function reportCloudStream(anilistId, episode, streamData) {
  if (!anilistId || !episode || !streamData) return;
  try {
    fetch(`${SLUG_MAP_API}/stream/${anilistId}/${episode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(streamData),
    }).catch(() => {});
  } catch {}
}


// ─── localStorage Cache ───────────────────────────────────────────────────────

function getLocalCache(anilistId) {
  try {
    const raw = localStorage.getItem(`${LS_KEY}_${anilistId}`);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) {
      localStorage.removeItem(`${LS_KEY}_${anilistId}`);
      return null;
    }
    return data;
  } catch { return null; }
}

function setLocalCache(anilistId, data) {
  try {
    localStorage.setItem(`${LS_KEY}_${anilistId}`, JSON.stringify({
      data,
      exp: Date.now() + LS_TTL
    }));
  } catch {}
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, options, ms) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}
