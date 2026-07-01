/**
 * Client-Side Stream API (Way 4)
 * Runs anime stream scraper logic directly in the React frontend.
 * Bypasses CORS via Capacitor native network stack, routing HLS segments
 * through a lightweight Cloudflare Worker header proxy if configured.
 */

import { scrapeAniNeko, scrapeAniWaves, scrapeAnimetsu } from './scrapers';

function runWithTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${name}`)), ms))
  ]);
}

export async function getAniNekoServers(anime, episode) {
  // Collect all title variants
  const titles = [
    anime.title?.romaji,
    anime.title?.english,
    anime.title?.native,
  ].filter(Boolean).filter((t, i, arr) => arr.indexOf(t) === i);

  if (titles.length === 0) throw new Error('No anime title available');

  const errors = [];

  // Define Neko execution
  const nekoPromise = (async () => {
    for (const title of titles) {
      try {
        console.log(`[ClientEngine] AniNeko trying: "${title}" ep ${episode}`);
        const data = await scrapeAniNeko(title, episode);
        if (data?.servers?.length) return data;
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
        const data = await scrapeAniWaves(title, episode);
        if (data?.servers?.length) return data;
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
        const data = await scrapeAnimetsu(title, episode);
        if (data?.servers?.length) return data;
      } catch (e) {
        console.warn(`[ClientEngine] Animetsu failed for "${title}": ${e.message}`);
        errors.push(`Animetsu[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
    return null;
  })();

  // Run all scrapers concurrently
  const [nekoData, wavesData, animetsuData] = await Promise.all([
    runWithTimeout(nekoPromise, 15000, 'AniNeko').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(wavesPromise, 25000, 'AniWaves').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(animetsuPromise, 30000, 'Animetsu').catch(e => { console.warn(e.message); return null; })
  ]);

  // Combine servers in priority order: Animetsu -> Neko -> Waves
  const combinedServers = [];
  let mainTitle = anime.title?.english || anime.title?.romaji || '';
  let activeSlug = '';

  if (animetsuData?.servers?.length) {
    animetsuData.servers.forEach(s => {
      combinedServers.push({ ...s, name: s.name });
    });
    mainTitle = animetsuData.animeTitle || mainTitle;
    activeSlug = animetsuData.slug || activeSlug;
  }

  if (nekoData?.servers?.length) {
    nekoData.servers.forEach(s => {
      combinedServers.push({ ...s, name: `Neko ${s.name}` });
    });
    mainTitle = nekoData.animeTitle || mainTitle;
    activeSlug = nekoData.slug || activeSlug;
  }

  if (wavesData?.servers?.length) {
    wavesData.servers.forEach(s => {
      combinedServers.push({ ...s, name: `Waves ${s.name}` });
    });
    mainTitle = wavesData.animeTitle || mainTitle;
    activeSlug = wavesData.slug || activeSlug;
  }

  if (combinedServers.length === 0) {
    throw new Error(`Failed to resolve any video servers. Details:\n${errors.join('\n')}`);
  }

  // Identify if any source failed (isPartial = true)
  const animetsuSuccess = !!animetsuData?.servers?.length;
  const nekoSuccess = !!nekoData?.servers?.length;
  const wavesSuccess = !!wavesData?.servers?.length;
  const isPartial = !animetsuSuccess || !nekoSuccess || !wavesSuccess;

  return {
    ok: true,
    servers: combinedServers,
    animeTitle: mainTitle,
    slug: activeSlug,
    isPartial
  };
}

export async function checkProxy() {
  // Client-side scraper engine is always ready in Capacitor mobile app!
  return true;
}
