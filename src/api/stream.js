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
        // Prevent duplicate server items
        if (!combinedServers.some(x => x.name === s.name && x.type === s.type)) {
          combinedServers.push({ ...s, name: s.name });
        }
      });
      if (data.animeTitle) mainTitle = data.animeTitle;
      if (data.slug) activeSlug = data.slug;

      // Deduplicate and prioritize servers list: Animetsu -> Neko -> Waves
      combinedServers.sort((a, b) => {
        const getPriority = (name) => {
          if (name.includes('AniHD')) return 1;
          if (name.includes('Neko')) return 2;
          if (name.includes('Waves')) return 3;
          return 4;
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
    return null;
  })();

  // Run all concurrently but with high timeouts since callback updates UI progressively!
  const results = await Promise.allSettled([
    runWithTimeout(nekoPromise, 18000, 'AniNeko').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(wavesPromise, 18000, 'AniWaves').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(animetsuPromise, 35000, 'Animetsu').catch(e => { console.warn(e.message); return null; })
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
    isPartial
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
