/**
 * Consumet API — GogoAnime scraper
 * Routes through local proxy server at port 4000
 */

const PROXY = 'http://localhost:4000/consumet';
const STREAM_PROXY = 'http://localhost:4000/stream?url=';

async function get(path) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(PROXY + path, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`Consumet ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

/* ── Search GogoAnime by title ────────────────────────────────── */
export async function gogoSearch(title) {
  const d = await get(`/anime/gogoanime/${encodeURIComponent(title)}`);
  return d?.results || [];
}

/* ── Get GogoAnime anime info (with episodes) ─────────────────── */
export async function gogoInfo(gogoId) {
  return await get(`/anime/gogoanime/info/${gogoId}`);
}

/* ── Get stream sources for an episode ───────────────────────── */
export async function gogoWatch(episodeId) {
  const d = await get(`/anime/gogoanime/watch/${episodeId}`);
  return d?.sources || [];
}

/* ── Proxy stream URL through the server ─────────────────────── */
function toProxyUrl(url) {
  if (!url || url.startsWith('http://localhost:4000')) return url;
  return STREAM_PROXY + encodeURIComponent(url);
}

/* ── Find GogoAnime ID for an AniList anime ───────────────────── */
export async function findGogoId(anime) {
  const queries = [anime?.title?.english, anime?.title?.romaji].filter(Boolean);
  for (const q of queries) {
    try {
      const results = await gogoSearch(q);
      if (!results.length) continue;
      const exact = results.find(r => r.title?.toLowerCase() === q.toLowerCase());
      return exact?.id || results[0]?.id;
    } catch { /* try next */ }
  }
  return null;
}

/* ── Get streaming URL for episode N ─────────────────────────── */
export async function getGogoStream(anime, episode) {
  const gogoId    = await findGogoId(anime);
  if (!gogoId) throw new Error('Not found on GogoAnime');

  const episodeId = `${gogoId}-episode-${episode}`;
  const sources   = await gogoWatch(episodeId);
  if (!sources.length) throw new Error('No sources found');

  const preferred = ['1080p', '720p', '480p', '360p', 'default'];
  let src = null;
  for (const q of preferred) {
    src = sources.find(s => s.quality === q);
    if (src) break;
  }
  src = src || sources[0];

  return {
    url:    toProxyUrl(src.url),
    isM3U8: src.isM3U8 || src.url?.includes('.m3u8'),
    gogoId,
    episodeId,
  };
}
