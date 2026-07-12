/**
 * Jikan v4 — Unofficial MAL API (free, no key required)
 * https://api.jikan.moe/v4
 */
const BASE = 'https://api.jikan.moe/v4';

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 10000);
      const res  = await fetch(url.toString(), { signal: ctrl.signal });
      clearTimeout(tid);

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
        continue;
      }
      if (!res.ok) throw new Error(`Jikan ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') break;
      lastErr = err;
      if (i < 2) await new Promise(r => setTimeout(r, (i + 1) * 1000));
    }
  }
  throw lastErr;
}

/* ── Weekly Airing Schedule by Day ───────────────────────────── */
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
export async function getJikanSchedule(dayIndex) {
  const filter = DAYS[dayIndex] || 'monday';
  const d = await get('/schedules', { filter, sfw: true, limit: 25 });
  return d?.data || [];
}

/* ── Top Airing (supplemental) ────────────────────────────────── */
export async function getJikanTopAiring(page = 1) {
  const d = await get('/top/anime', { filter: 'airing', sfw: true, limit: 12, page });
  return d?.data || [];
}

/* ── Top Anime ────────────────────────────────────────────────── */
export async function getJikanTopAnime(page = 1) {
  const d = await get('/top/anime', { type: 'tv', sfw: true, limit: 12, page });
  return d?.data || [];
}

/* ── Seasonal ─────────────────────────────────────────────────── */
export async function getJikanSeasonal() {
  const d = await get('/seasons/now', { sfw: true, limit: 12 });
  return d?.data || [];
}

/* ── Search ───────────────────────────────────────────────────── */
export async function jikanSearch(q, page = 1) {
  const d = await get('/anime', { q, sfw: true, limit: 20, page });
  return d?.data || [];
}

/* ── Anime Full (by MAL ID) ───────────────────────────────────── */
export async function getJikanAnime(malId) {
  const d = await get(`/anime/${malId}/full`);
  return d?.data || null;
}

/* ── Episodes (by MAL ID) ─────────────────────────────────────── */
export async function getJikanEpisodes(malId, page = 1) {
  const d = await get(`/anime/${malId}/episodes`, { page });
  return { data: d?.data || [], pagination: d?.pagination };
}

/* ── Helper: MAL cover image ──────────────────────────────────── */
export function jikanCover(anime) {
  return anime?.images?.jpg?.large_image_url
    || anime?.images?.jpg?.image_url
    || anime?.images?.webp?.large_image_url
    || '';
}

export function jikanTitle(anime) {
  return anime?.title_english || anime?.title || 'Unknown';
}
