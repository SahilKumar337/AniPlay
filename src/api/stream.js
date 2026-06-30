/**
 * Stream API — frontend client for the AniLab proxy server
 * v5: sends all title variants, handles SUB + DUB server types
 */

const isCapacitor = typeof window !== 'undefined' && (
  !!window.Capacitor || 
  (!window.location.port && window.location.hostname === 'localhost')
);

const isLocal = !isCapacitor && (
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.startsWith('192.168.') ||
  window.location.hostname.startsWith('10.') ||
  window.location.hostname.startsWith('172.')
);

export const PROXY = import.meta.env.VITE_PROXY_URL || (
  isLocal
    ? `http://${window.location.hostname}:4000`
    : 'https://anilab-backend.onrender.com'
);

export function formatServerUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  let fullUrl = `${PROXY}${url.startsWith('/') ? '' : '/'}${url}`;
  const apiKey = import.meta.env.VITE_API_KEY || '';
  if (apiKey) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + `api_key=${encodeURIComponent(apiKey)}`;
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

  // Send titles pipe-separated (||| as delimiter to avoid URL encoding issues)
  const titlesParam = titles.join('|||');
  const url = `${PROXY}/api/anineko-servers?titles=${encodeURIComponent(titlesParam)}&episode=${episode}&_t=${Date.now()}`;

  const apiKey = import.meta.env.VITE_API_KEY || '';
  const headers = apiKey ? { 'X-API-Key': apiKey } : {};
  
  const res = await fetch(url, { 
    headers,
    signal: AbortSignal.timeout(90000) 
  });
  
  if (!res.ok) {
    throw new Error(`Server returned status ${res.status}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Server returned an invalid non-JSON response');
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
    const formattedData = { ...data, servers: formattedServers };
    return formattedData;
  }

  throw new Error(data.error || 'No streaming servers found');
}

/** Check if the proxy server is running */
export async function checkProxy() {
  const apiKey = import.meta.env.VITE_API_KEY || '';
  const headers = apiKey ? { 'X-API-Key': apiKey } : {};
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
