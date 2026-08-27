/**
 * Client-Side Stream API (Way 4)
 * Runs anime stream scraper logic directly in the React frontend.
 * Bypasses CORS via Capacitor native network stack, routing HLS segments
 * through a lightweight Cloudflare Worker header proxy if configured.
 */

import { scrapeAniNeko, scrapeAniWaves, scrapeAniKoto } from './scrapers';

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

/** Invalidates the in-memory stream cache for the given anime + episode.
 *  Call this when a CDN token expires mid-play so the next getAniNekoServers()
 *  call re-scrapes fresh embed/HLS URLs instead of serving the stale cached ones. */
export function invalidateStreamCache(anime, episode) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  clientStreamCache.delete(cacheKey);
  console.log(`[ClientEngine] Invalidated stream cache for: ${cacheKey}`);
}

/**
 * Silently pre-scrapes episode N+1 in the background during playback.
 * Uses the fast AniNeko-only path (onlyNeko=true) — takes ~200-500ms.
 * No-op if: already cached, at the last episode, or totalEps unknown.
 * Call this ~30s after playback starts to warm the cache for the next episode.
 */
export function prefetchNextEpisode(anime, currentEpisode, totalEps) {
  if (!anime || !currentEpisode) return;
  const nextEp = currentEpisode + 1;
  if (totalEps && nextEp > totalEps) return; // already at last episode

  const cacheKey = `${anime.id || anime.idMal || anime.title?.romaji || 'unknown'}-${nextEp}-neko`;
  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Prefetch] Episode ${nextEp} already cached — skipping`);
      return;
    }
  }

  console.log(`[Prefetch] Silently scraping episode ${nextEp} for instant next-ep play...`);
  // Fire-and-forget: errors are swallowed, this is a best-effort optimization
  getAniNekoServers(anime, nextEp, null, true).catch(() => {});
}

export async function getAniNekoServers(anime, episode, onServersFound, onlyNeko = false) {
  const cacheKey = `${anime.id || anime.idMal || anime.title?.romaji || 'unknown'}-${episode}${onlyNeko ? '-neko' : ''}`;
  
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

  // Collect all title variants (romaji, english, native) plus useful synonyms
  const isMini = anime.format === 'TV_SHORT' ||
    /\bmini\b/i.test(anime.title?.english || '') ||
    /\bmini\b/i.test(anime.title?.romaji || '') ||
    (anime.synonyms || []).some(s => /\bmini\b/i.test(s));

  const baseTitles = [
    anime.title?.romaji,
    anime.title?.english,
    anime.title?.native,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  // Include English-looking synonyms (no CJK characters, reasonable length)
  // These help cross-site matching where a site may use an alternate English/romaji title
  const usefulSynonyms = (anime.synonyms || [])
    .filter(s =>
      s &&
      s.length >= 4 &&
      s.length <= 100 &&
      !/[\u3000-\u9fff\uff00-\uffef]/.test(s) // no CJK characters
    )
    .slice(0, 3); // cap at 3 synonyms to avoid too many search queries

  // Full list: romaji first (best for Japanese-named sites), then english, then synonyms
  const allTitles = [
    anime.title?.romaji,
    anime.title?.english,
    ...usefulSynonyms,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  // For mini-series: also try searching with " Mini" appended so scrapers can
  // match entries like "Anime Title Mini" or "Anime Title (Mini)" on streaming sites
  const titles = isMini
    ? [...baseTitles, ...baseTitles.map(t => `${t} Mini`)].filter((t, i, arr) => arr.indexOf(t) === i)
    : baseTitles;

  if (titles.length === 0) throw new Error('No anime title available');

  const combinedServers = [];
  const errors = [];
  let mainTitle = anime.title?.english || anime.title?.romaji || '';
  let activeSlug = '';
  const isMovie = anime.format === 'MOVIE';

  const handleScraperResult = (data) => {
    if (data?.servers?.length) {
      data.servers.forEach(s => {
        const baseName = s.name.replace(/\s*\(DUB\)\s*/i, '').trim().split(' ')[0];
        // Allowed servers: NekoHD (direct HLS, no Cloudflare)
        // BLOCKED: Neko-StreamHG, Neko-Earnvids, otakuhg — Cloudflare-protected
        const sNameLow = (s.name || '').toLowerCase();
        const sEmbedLow = (s.embedUrl || '').toLowerCase();
        const sVideoLow = (s.videoUrl || '').toLowerCase();
        if (sNameLow.includes('streamhg') || sNameLow.includes('earnvids') || sNameLow.includes('otakuhg')) return;
        if (sEmbedLow.includes('otakuhg') || sEmbedLow.includes('streamhg') || sEmbedLow.includes('earnvids')) return;
        if (sVideoLow.includes('otakuhg') || sVideoLow.includes('streamhg') || sVideoLow.includes('earnvids')) return;

        const isAllowed = onlyNeko
          ? baseName.startsWith('Neko')
          : (baseName.startsWith('Neko') || baseName.startsWith('Waves') || ['WavesHD', 'AniHD', 'AniVid'].includes(baseName));
        if (!isAllowed) return; // skip non-allowed servers

        // Prevent duplicate server items
        if (!combinedServers.some(x => x.name === s.name && x.type === s.type)) {
          combinedServers.push({ ...s, name: s.name });
        }
      });
      if (data.animeTitle) mainTitle = data.animeTitle;
      if (data.slug) activeSlug = data.slug;

      // Prioritize ultra-fast direct CDN streaming servers: AniHD > Neko-HD-2 (Cloudflare) > WavesHD > AniVid > NekoHD (HD-1 ByteDance)
      combinedServers.sort((a, b) => {
        const getPriority = (name) => {
          if (name.startsWith('AniHD') || name === 'AniHD') return 0;
          if (name.includes('HD-2') || name === 'Neko-HD-2' || name === 'Neko-HD-2 (DUB)') return 1;
          if (name.includes('Waves') || name === 'WavesHD') return 2;
          if (name.startsWith('AniVid') || name === 'AniVid') return 3;
          if (name === 'NekoHD' || name === 'NekoHD (DUB)' || name === 'NekoHD-HardSub') return 4;
          if (name.startsWith('Neko')) return 5;
          return 6;
        };
        return getPriority(a.name) - getPriority(b.name);
      });

      if (onServersFound) {
        onServersFound([...combinedServers]);
      }

      // Prefetch the top-priority server's M3U8 playlist immediately after resolution
      // so the player reads pre-fetched variants without any additional network wait.
      const topSrv = combinedServers[0];
      if (topSrv?.isHLS && topSrv?.videoUrl && topSrv.videoUrl.startsWith('http')) {
        prefetchM3U8(topSrv.videoUrl, topSrv.referer).catch(() => {});
      }
    }
  };

  // Single call per scraper — each scraper already handles all title variants internally
  // via its allTitles param. Firing N calls was redundant and multiplied network requests.
  const primaryTitle = anime.title?.romaji || anime.title?.english || titles[0];
  const tryScraper = async (scraperFn, scraperName) => {
    try {
      console.log(`[ClientEngine] ${scraperName} scraping ep ${episode} (primary: "${primaryTitle}")`);
      const data = await scraperFn(primaryTitle, episode, isMovie, anime.id, allTitles);
      if (data?.servers?.length) { handleScraperResult(data); return data; }
      errors.push(`${scraperName}: returned no servers`);
      return null;
    } catch (e) {
      console.warn(`[ClientEngine] ${scraperName} failed: ${e.message}`);
      errors.push(`${scraperName}: ${e.message}`);
      return null;
    }
  };

  const nekoPromise = tryScraper(scrapeAniNeko, 'AniNeko');

  let results;
  if (onlyNeko) {
    // Ultra-fast path: only fetch AniNeko (takes ~200-400ms, no waiting for third-party scrapers)
    results = await Promise.allSettled([
      runWithTimeout(nekoPromise, 12000, 'AniNeko').catch(e => { console.warn(e.message); return null; })
    ]);
  } else {
    const wavesPromise   = tryScraper(scrapeAniWaves,  'AniWaves');
    const anikotoPromise = tryScraper(scrapeAniKoto,   'AniKoto');

    results = await Promise.allSettled([
      runWithTimeout(nekoPromise,    18000, 'AniNeko').catch(e  => { console.warn(e.message); return null; }),
      runWithTimeout(wavesPromise,   18000, 'AniWaves').catch(e => { console.warn(e.message); return null; }),
      runWithTimeout(anikotoPromise, 18000, 'AniKoto').catch(e  => { console.warn(e.message); return null; }),
    ]);
  }

  if (combinedServers.length === 0) {
    throw new Error(`Failed to resolve any video servers. Details:\n${errors.join('\n')}`);
  }

  const nekoSuccess = results[0].status === 'fulfilled' && results[0].value;
  const isPartial = onlyNeko ? !nekoSuccess : (!nekoSuccess || results[1]?.status !== 'fulfilled' || results[2]?.status !== 'fulfilled');

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

export async function resolvePlaceholderServer(anime, episode, serverName, serverType) {
  const titles = [
    anime.title?.romaji,
    anime.title?.english,
    anime.title?.native,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  if (titles.length === 0) throw new Error('No anime title available');
  const isMovie = anime.format === 'MOVIE';

  for (const title of titles) {
    try {
      let data = null;
      // No placeholder servers — this branch is unused after AniHD removal

      if (data?.servers?.length) {
        const found = data.servers.find(s => s.name === serverName && s.type === serverType)
                   || data.servers.find(s => s.type === serverType);
        if (found) {
          // Update client cache if present
          const cacheKey = `${anime.id || anime.idMal || anime.title?.romaji || 'unknown'}-${episode}`;
          if (clientStreamCache.has(cacheKey)) {
            const cached = clientStreamCache.get(cacheKey);
            const srvs = cached.data.servers;
            const idx = srvs.findIndex(s => s.name === serverName && s.type === serverType);
            if (idx !== -1) {
              srvs[idx] = { 
                ...srvs[idx], 
                videoUrl: found.videoUrl, 
                embedUrl: found.embedUrl, 
                isHLS: found.isHLS, 
                subtitles: found.subtitles 
              };
              clientStreamCache.set(cacheKey, { 
                timestamp: Date.now(), 
                data: { ...cached.data, servers: srvs } 
              });
            }
          }
          return found;
        }
      }
    } catch (e) {
      console.warn(`[ClientEngine] Failed to resolve placeholder for "${title}":`, e.message);
    }
  }
  throw new Error(`Failed to resolve streaming link for ${serverName}`);
}

// ── M3U8 Prefetch Cache ──────────────────────────────────────────────────────
// Stores pre-fetched and pre-parsed HLS playlist variants keyed by videoUrl.
// TTL: 20 minutes (playlist segments typically expire in ~30 min).
const m3u8PrefetchCache = new Map();
const M3U8_PREFETCH_TTL = 20 * 60 * 1000;

/**
 * Prefetch and parse an HLS master playlist immediately after server resolution.
 * The parsed quality variants are stored in cache AND attached to the server obj
 * as `server._prefetchedVariants`, so AniPlayer reads them with zero extra wait.
 *
 * Called fire-and-forget: errors are silently swallowed.
 */
export async function prefetchM3U8(videoUrl, referer) {
  if (!videoUrl || !videoUrl.startsWith('http')) return;

  // Skip if already prefetched and still fresh
  const existing = m3u8PrefetchCache.get(videoUrl);
  if (existing && Date.now() - existing.timestamp < M3U8_PREFETCH_TTL) {
    console.log(`[Prefetch] M3U8 already prefetched: ${videoUrl.slice(0, 60)}...`);
    return existing.variants;
  }

  try {
    console.log(`[Prefetch] Pre-fetching HLS playlist: ${videoUrl.slice(0, 60)}...`);
    const playlistText = await fetchM3U8Playlist(videoUrl, referer);
    const variants = parseMasterPlaylist(videoUrl, playlistText);
    if (variants.length > 0) {
      m3u8PrefetchCache.set(videoUrl, { variants, timestamp: Date.now() });
      console.log(`[Prefetch] HLS playlist cached \u2014 ${variants.length} quality levels: ${variants.map(v => v.label).join(', ')}`);
      return variants;
    }
  } catch (e) {
    // Silently swallow — prefetch is a best-effort optimization
    console.log(`[Prefetch] M3U8 prefetch failed (non-critical): ${e.message}`);
  }
  return null;
}

/**
 * Returns pre-fetched HLS variants if available and still fresh.
 * Call this before parsing the playlist from scratch in the player.
 */
export function getPrefetchedM3U8Variants(videoUrl) {
  if (!videoUrl) return null;
  const cached = m3u8PrefetchCache.get(videoUrl);
  if (cached && Date.now() - cached.timestamp < M3U8_PREFETCH_TTL) {
    console.log(`[Prefetch] M3U8 cache HIT \u2014 serving ${cached.variants.length} variants instantly`);
    return cached.variants;
  }
  return null;
}
