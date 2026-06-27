/**
 * Stream API — frontend client for the AniLab proxy server (port 4000)
 */

const PROXY = window.location.port === '3000'
  ? `http://${window.location.hostname}:4000`
  : window.location.origin;

// Cache for search results
const cache = new Map();

/**
 * Fetch watch servers for an anime from the AniNeko scraper backend.
 */
export async function getAniNekoServers(anime, episode) {
  const key = `${anime.id}-${episode}`;
  if (cache.has(key)) return cache.get(key);

  const titles = [...new Set([
    anime.title?.romaji,
    anime.title?.english,
  ].filter(Boolean))];

  let lastErr = 'Anime not found on AniNeko';

  for (const title of titles) {
    try {
      const url = `${PROXY}/api/anineko-servers?title=${encodeURIComponent(title)}&episode=${episode}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const data = await res.json();
      if (data.ok && data.servers?.length) {
        cache.set(key, data);
        return data;
      }
      lastErr = data.error || lastErr;
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr);
}

/** Check if the proxy server is running */
export async function checkProxy() {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${PROXY}/api/ping`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      if (i < 2) await new Promise(r => setTimeout(r, 800));
    }
  }
  return false;
}
