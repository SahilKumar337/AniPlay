/**
 * Stream API — frontend client for the AniLab proxy server
 * v5: sends all title variants, handles SUB + DUB server types
 */

export const PROXY = import.meta.env.VITE_PROXY_URL || (
  window.location.port === '3000'
    ? `http://${window.location.hostname}:4000`
    : window.location.origin
);

export function formatServerUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${PROXY}${url.startsWith('/') ? '' : '/'}${url}`;
}

// Cache for search results (keyed by animeId-episode)
const cache = new Map();

/**
 * Fetch watch servers for an anime episode.
 * Sends romaji + english titles pipe-separated so the backend can try both.
 * Returns { servers: [{name, videoUrl, type}], animeTitle, slug }
 */
export async function getAniNekoServers(anime, episode) {
  const key = `${anime.id}-${episode}`;
  if (cache.has(key)) return cache.get(key);

  // Collect all title variants (romaji first, then english, then native)
  const titles = [
    anime.title?.romaji,
    anime.title?.english,
    anime.title?.native,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  if (titles.length === 0) throw new Error('No anime title available');

  // Send titles pipe-separated (||| as delimiter to avoid URL encoding issues)
  const titlesParam = titles.join('|||');
  const url = `${PROXY}/api/anineko-servers?titles=${encodeURIComponent(titlesParam)}&episode=${episode}`;

  const res  = await fetch(url, { signal: AbortSignal.timeout(90000) });
  const data = await res.json();

  if (data.ok && data.servers?.length) {
    const formattedServers = data.servers.map(s => ({
      ...s,
      videoUrl: formatServerUrl(s.videoUrl)
    }));
    const formattedData = { ...data, servers: formattedServers };
    cache.set(key, formattedData);
    return formattedData;
  }

  throw new Error(data.error || 'No streaming servers found');
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
