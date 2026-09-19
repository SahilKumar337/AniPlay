/**
 * Stream API — native client for the AniLab proxy server
 */

export const PROXY = 'https://anilab-backend.onrender.com';
export const API_KEY = 'shadowloq333-anilab-key';

export function formatServerUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  let fullUrl = `${PROXY}${url.startsWith('/') ? '' : '/'}${url}`;
  if (API_KEY) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + `api_key=${encodeURIComponent(API_KEY)}`;
  }
  return fullUrl;
}

export async function getAniNekoServers(anime, episode) {
  // Collect all title variants (romaji first, then english, then native)
  const titles = [
    anime.title?.romaji,
    anime.title?.english,
    anime.title?.native,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  if (titles.length === 0) throw new Error('No anime title available');

  // Send titles pipe-separated (||| as delimiter)
  const titlesParam = titles.join('|||');
  
  // Use a cache-buster query parameter to bypass HTTP caching
  const url = `${PROXY}/api/anineko-servers?titles=${encodeURIComponent(titlesParam)}&episode=${episode}&_t=${Date.now()}`;

  const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
  
  const res = await fetch(url, { 
    headers,
    signal: AbortSignal.timeout(90000) 
  });
  
  if (!res.ok) {
    throw new Error(`Server returned status ${res.status}`);
  }

  const data = await res.json();

  if (data.ok && data.servers?.length) {
    const formattedServers = data.servers.map(s => ({
      ...s,
      videoUrl: formatServerUrl(s.videoUrl),
      subtitles: (s.subtitles || []).map(sub => ({
        ...sub,
        file: formatServerUrl(sub.file)
      }))
    }));
    return { ...data, servers: formattedServers };
  }

  throw new Error(data.error || 'No streaming servers found');
}

/** Check if the proxy server is running */
export async function checkProxy() {
  const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${PROXY}/api/ping`, { 
        headers,
        signal: AbortSignal.timeout(2000) 
      });
      if (res.ok) return true;
    } catch {
      if (i < 2) await new Promise(r => setTimeout(r, 800));
    }
  }
  return false;
}
