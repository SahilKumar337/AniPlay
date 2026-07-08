/**
 * Client-Side Stream API (Way 4)
 * Runs anime stream scraper logic directly in the React frontend.
 * Bypasses CORS via Capacitor native network stack, routing HLS segments
 * through a lightweight Cloudflare Worker header proxy if configured.
 */

import { scrapeAniNeko, scrapeAniWaves, scrapeAnimetsu } from './scrapers';

const clientStreamCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache life

function runWithTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${name}`)), ms))
  ]);
}

export function getCachedServers(anime, episode) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }
  return null;
}

export async function getAniNekoServers(anime, episode, onServersFound) {
  const cacheKey = `${anime.id || anime.idMal || anime.title?.romaji || 'unknown'}-${episode}`;
  
  // Check client cache first
  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[ClientEngine] [Cache Hit] Serving cached servers instantly for: ${cacheKey}`);
      if (onServersFound) onServersFound(cached.data.servers);
      return cached.data;
    } else {
      clientStreamCache.delete(cacheKey);
    }
  }

  // Collect all title variants
  const titles = [
    anime.title?.romaji,
    anime.title?.english,
    anime.title?.native,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  if (titles.length === 0) throw new Error('No anime title available');

  const combinedServers = [];
  const errors = [];
  let mainTitle = anime.title?.english || anime.title?.romaji || '';
  let activeSlug = '';
  const isMovie = anime.format === 'MOVIE';

  const handleScraperResult = (data) => {
    if (data?.servers?.length) {
      data.servers.forEach(s => {
        const baseName = s.name.replace(/\s*\(DUB\)\s*/i, '').trim();
        const isAllowed = ['AniHD', 'Neko', 'WavesHD'].includes(baseName);
        if (!isAllowed) return; // skip all other servers

        // Prevent duplicate server items
        if (!combinedServers.some(x => x.name === s.name && x.type === s.type)) {
          combinedServers.push({ ...s, name: s.name });
        }
      });
      if (data.animeTitle) mainTitle = data.animeTitle;
      if (data.slug) activeSlug = data.slug;

      // Deduplicate and prioritize servers list: Neko → AniHD → WavesHD
      combinedServers.sort((a, b) => {
        const getPriority = (name) => {
          if (name.includes('Neko')) return 0;
          if (name.includes('AniHD')) return 1;
          if (name.includes('WavesHD')) return 2;
          return 3;
        };
        return getPriority(a.name) - getPriority(b.name);
      });

      if (onServersFound) {
        onServersFound([...combinedServers]);
      }
    }
  };

  // Define Neko execution
  const nekoPromise = (async () => {
    for (const title of titles) {
      try {
        console.log(`[ClientEngine] AniNeko trying: "${title}" ep ${episode}`);
        const data = await scrapeAniNeko(title, episode, isMovie);
        if (data?.servers?.length) {
          handleScraperResult(data);
          return data;
        }
      } catch (e) {
        console.warn(`[ClientEngine] AniNeko failed for "${title}": ${e.message}`);
        errors.push(`Neko[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
    return null;
  })();

  // Define Waves execution
  const wavesPromise = (async () => {
    for (const title of titles) {
      try {
        console.log(`[ClientEngine] AniWaves trying: "${title}" ep ${episode}`);
        const data = await scrapeAniWaves(title, episode, isMovie);
        if (data?.servers?.length) {
          handleScraperResult(data);
          return data;
        }
      } catch (e) {
        console.warn(`[ClientEngine] AniWaves failed for "${title}": ${e.message}`);
        errors.push(`Waves[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
    return null;
  })();

  // Define Animetsu (AniHD) execution
  const animetsuPromise = (async () => {
    for (const title of titles) {
      if (/[\u3000-\u9fff\uff00-\uffef]/.test(title)) continue; // Skip Japanese native
      try {
        console.log(`[ClientEngine] Animetsu trying: "${title}" ep ${episode}`);
        const data = await scrapeAnimetsu(title, episode, isMovie);
        if (data?.servers?.length) {
          handleScraperResult(data);
          return data;
        }
      } catch (e) {
        console.warn(`[ClientEngine] Animetsu failed for "${title}": ${e.message}`);
        errors.push(`Animetsu[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
    // Fallback placeholder so AniHD button is always visible in the server list
    handleScraperResult({
      servers: [{
        name: 'AniHD',
        videoUrl: 'https://animetsu.net/proxy/placeholder',
        type: 'sub',
        embedUrl: 'https://animetsu.net/proxy/placeholder',
        referer: 'https://animetsu.net/',
        subtitles: [],
        isHLS: true
      }]
    });
    return null;
  })();

  const results = await Promise.allSettled([
    runWithTimeout(nekoPromise, 60000, 'AniNeko').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(wavesPromise, 60000, 'AniWaves').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(animetsuPromise, 60000, 'Animetsu').catch(e => { console.warn(e.message); return null; })
  ]);

  if (combinedServers.length === 0) {
    throw new Error(`Failed to resolve any video servers. Details:\n${errors.join('\n')}`);
  }

  const nekoSuccess = results[0].status === 'fulfilled' && results[0].value;
  const wavesSuccess = results[1].status === 'fulfilled' && results[1].value;
  const animetsuSuccess = results[2].status === 'fulfilled' && results[2].value;
  const isPartial = !nekoSuccess || !wavesSuccess || !animetsuSuccess;

  const resultData = {
    ok: true,
    servers: combinedServers,
    animeTitle: mainTitle,
    slug: activeSlug,
    isPartial,
    errors
  };

  // Only cache if we successfully retrieved some servers
  if (combinedServers.length > 0) {
    clientStreamCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
  }

  return resultData;
}

export async function checkProxy() {
  // Client-side scraper engine is always ready in Capacitor mobile app!
  return true;
}

export async function fetchM3U8Playlist(url, referer) {
  const isCapacitor = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
  if (isCapacitor) {
    const { CapacitorHttp } = await import('@capacitor/core');
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers: {
        ...(referer ? { 'Referer': referer } : {})
      }
    });
    if (response.status >= 400) {
      throw new Error(`HTTP error ${response.status}`);
    }
    return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  } else {
    // Dev browser fallback - proxy it if possible, or try direct
    const PROXY_URL = import.meta.env.VITE_STREAM_PROXY_URL || '';
    let fetchUrl = url;
    if (PROXY_URL) {
      fetchUrl = `${PROXY_URL}?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer || '')}`;
    }
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    return response.text();
  }
}

export function parseMasterPlaylist(playlistUrl, playlistText) {
  const lines = playlistText.split('\n');
  const variants = [];
  
  let currentInfo = null;
  const baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
  
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      currentInfo = line;
    } else if (line && !line.startsWith('#') && currentInfo) {
      // This is the URL line for the previous stream info
      let resolution = '';
      const resMatch = currentInfo.match(/RESOLUTION=(\d+x\d+)/i);
      if (resMatch) {
        const res = resMatch[1];
        if (res.includes('1920x1080')) resolution = '1080p (FHD)';
        else if (res.includes('1280x720')) resolution = '720p (HD)';
        else if (res.includes('854x480')) resolution = '480p (SD)';
        else if (res.includes('640x360')) resolution = '360p (LQ)';
        else {
          const height = res.split('x')[1];
          resolution = `${height}p`;
        }
      }
      
      // If resolution is not found, try to estimate by bandwidth
      if (!resolution) {
        const bwMatch = currentInfo.match(/BANDWIDTH=(\d+)/i);
        if (bwMatch) {
          const bw = parseInt(bwMatch[1], 10);
          if (bw > 2500000) resolution = '1080p (FHD)';
          else if (bw > 1200000) resolution = '720p (HD)';
          else if (bw > 600000) resolution = '480p (SD)';
          else resolution = '360p (LQ)';
        } else {
          resolution = 'Auto';
        }
      }
      
      let resolvedUrl = line;
      if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
        if (resolvedUrl.startsWith('/')) {
          try {
            const parsedUrl = new URL(playlistUrl);
            resolvedUrl = `${parsedUrl.origin}${resolvedUrl}`;
          } catch {
            resolvedUrl = `${baseUrl}${resolvedUrl}`;
          }
        } else {
          resolvedUrl = `${baseUrl}${resolvedUrl}`;
        }
      }
      
      variants.push({
        label: resolution,
        url: resolvedUrl
      });
      currentInfo = null;
    }
  }
  
  // Sort variants by quality high to low
  variants.sort((a, b) => {
    const getResValue = (lbl) => {
      if (lbl.includes('1080')) return 1080;
      if (lbl.includes('720')) return 720;
      if (lbl.includes('480')) return 480;
      if (lbl.includes('360')) return 360;
      const parsed = parseInt(lbl, 10);
      return isNaN(parsed) ? 0 : parsed;
    };
    return getResValue(b.label) - getResValue(a.label);
  });
  
  return variants;
}
