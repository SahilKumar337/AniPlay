/**
 * HiAnime (formerly Zoro.to) API
 * ─────────────────────────────────────────────────────────────────
 * Routes through our local proxy server (port 4000) which:
 *  - Calls aniwatch-api instances (the Zoro scraper)
 *  - Gets real m3u8 stream URLs by decrypting HiAnime's source
 *  - The stream URL is then played via /stream?url= proxy
 *    which injects the correct Referer header
 *
 * This is exactly how Anilab works: scrape → decrypt → proxy → play
 */

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || (
  window.location.port === '3000'
    ? `http://${window.location.hostname}:4000`
    : window.location.origin
);

const PROXY = `${PROXY_BASE}/aniwatch`;

async function get(path) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(PROXY + path, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HiAnime API ${res.status}: ${path}`);
    return await res.json();
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

/* ── Search ───────────────────────────────────────────────────── */
export async function hiSearch(query, page = 1) {
  const d = await get(`/api/v2/hianime/search?q=${encodeURIComponent(query)}&page=${page}`);
  return d?.data?.animes || [];
}

/* ── Anime Info ───────────────────────────────────────────────── */
export async function hiAnimeInfo(animeId) {
  const d = await get(`/api/v2/hianime/anime/${animeId}`);
  return d?.data?.anime || null;
}

/* ── Episode List ─────────────────────────────────────────────── */
export async function hiEpisodes(animeId) {
  const d = await get(`/api/v2/hianime/anime/${animeId}/episodes`);
  return d?.data?.episodes || [];
}

/* ── Episode Sources ──────────────────────────────────────────── */
export async function hiSources(episodeId, server = 'vidstreaming', category = 'sub') {
  const q = new URLSearchParams({
    animeEpisodeId: episodeId,
    server,
    category,
  });
  const d = await get(`/api/v2/hianime/episode/sources?${q}`);
  return d?.data || null;
}

/* ── Wrap the stream URL through the local proxy ──────────────── */
export function toProxyUrl(url) {
  if (!url) return null;
  if (url.includes('/stream?url=')) return url;
  return `${PROXY_BASE}/stream?url=${encodeURIComponent(url)}`;
}

/* ── HIGH-LEVEL: Find HiAnime ID for an AniList anime ────────── */
export async function findHiAnimeId(anime) {
  const queries = [
    anime?.title?.english,
    anime?.title?.romaji,
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const results = await hiSearch(q);
      if (!results.length) continue;

      // 1. Exact name match
      const exact = results.find(r =>
        r.name?.toLowerCase() === q.toLowerCase() ||
        r.jname?.toLowerCase() === q.toLowerCase()
      );
      if (exact) return exact.id;

      // 2. Match by episode count
      if (anime.episodes) {
        const epMatch = results.find(r => r.episodes?.sub === anime.episodes);
        if (epMatch) return epMatch.id;
      }

      // 3. First result
      return results[0].id;
    } catch (err) {
      console.warn('[HiAnime] search failed for', q, err.message);
    }
  }
  return null;
}

/* ── HIGH-LEVEL: Get stream for episode N ─────────────────────── */
export async function getHiAnimeStream(anime, episodeNumber) {
  // Step 1: Find the HiAnime anime ID
  const hiId = await findHiAnimeId(anime);
  if (!hiId) throw new Error('Not found on HiAnime');

  // Step 2: Get episode list and find the correct episode
  const episodes = await hiEpisodes(hiId);
  const episode  = episodes.find(e => e.number === episodeNumber);
  if (!episode) throw new Error(`Episode ${episodeNumber} not on HiAnime`);

  // Step 3: Try each server in order
  const servers = ['vidstreaming', 'vidcloud', 'streamsb', 'streamtape'];
  for (const server of servers) {
    try {
      const sources = await hiSources(episode.episodeId, server, 'sub');
      if (!sources?.sources?.length) continue;

      const src = sources.sources.find(s => s.type === 'hls') || sources.sources[0];
      if (!src?.url) continue;

      // Route the stream URL through our proxy
      return {
        url:    toProxyUrl(src.url),
        isM3U8: src.type === 'hls' || src.url.includes('.m3u8'),
        tracks: (sources.tracks || []).map(t => ({
          ...t,
          file: toProxyUrl(t.file),
        })),
        intro:  sources.intro  || null,
        outro:  sources.outro  || null,
        server,
        hiId,
        episodeId: episode.episodeId,
      };
    } catch (err) {
      console.warn(`[HiAnime] server ${server} failed:`, err.message);
    }
  }

  throw new Error('No working stream found on HiAnime');
}
