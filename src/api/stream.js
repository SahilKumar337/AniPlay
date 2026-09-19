// Purge legacy stream caches and unverified search caches on load
try {
  if (typeof sessionStorage !== 'undefined') {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('stream_') || k.startsWith('neko_ep_') || k.startsWith('res_srv_'))) {
        sessionStorage.removeItem(k);
      }
    }
  }
  if (typeof localStorage !== 'undefined') {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('koto_search_') || k.startsWith('waves_search_') || k.startsWith('waves_servers_'))) {
        localStorage.removeItem(k);
      }
    }
  }
} catch {}

/**
 * Client-Side Stream API (Way 4)
 * Runs anime stream scraper logic directly in the React frontend.
 * Bypasses CORS via Capacitor native network stack, routing HLS segments
 * through a lightweight Cloudflare Worker header proxy if configured.
 */

import { scrapeAniNeko, scrapeAniWaves, scrapeAniKoto, clientFetch, formatSubtitleProxyUrl, extractWavesDirectStream } from './scrapers.js';
import { resolveMegaPlayStream } from '../utils/megaplayDecrypt.js';
import { scrapeEmbedDirectly, unpackUniversalJS } from './embedScraper.js';
import { getNetworkProfile } from '../utils/networkSpeed.js';

const clientStreamCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache life

// ── Slug Persistence Cache ─────────────────────────────────────────────────
// After successfully resolving a slug for an anime on any scraper, persist it
// in localStorage. Next time the scraper skips the slow title-search step and
// jumps directly to the episode fetch — turns ~1.5s search → ~150ms direct.
const SLUG_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getPersistedSlug(animeId, provider) {
  if (!animeId || !provider) return null;
  try {
    const raw = localStorage.getItem(`ani_slug_${provider}_${animeId}`);
    if (!raw) return null;
    const { slug, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(`ani_slug_${provider}_${animeId}`); return null; }
    return slug;
  } catch { return null; }
}

export function persistSlug(animeId, provider, slug) {
  if (!animeId || !provider || !slug) return;
  try {
    localStorage.setItem(`ani_slug_${provider}_${animeId}`,
      JSON.stringify({ slug, expires: Date.now() + SLUG_CACHE_TTL }));
  } catch {}
}

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
  // Check sessionStorage persistence
  try {
    const raw = sessionStorage.getItem(`stream_v9_cache_${cacheKey}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp < CACHE_TTL) {
        clientStreamCache.set(cacheKey, parsed);
        return parsed.data;
      } else {
        sessionStorage.removeItem(`stream_v9_cache_${cacheKey}`);
      }
    }
  } catch {}
  return null;
}

/** Invalidates the in-memory and persisted stream cache for the given anime + episode. */
export function invalidateStreamCache(anime, episode) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  clientStreamCache.delete(cacheKey);
  try { sessionStorage.removeItem(`stream_v9_cache_${cacheKey}`); } catch {}
  console.log(`[ClientEngine] Invalidated stream cache for: ${cacheKey}`);
}

// Persistent in-memory cache for lazily resolved single server streams
const resolvedServerStreamCache = new Map();
const inFlightResolutions = new Map();

/**
 * Lazily resolve a single streaming server on demand.
 * Scrapes and decrypts ONLY the selected server when chosen in the UI.
 * Results are cached in memory and sessionStorage for 0ms instant playback on re-selection.
 */
export async function resolveSingleServer(server, anime, episode) {
  if (!server) return null;

  const animeId = anime?.id || anime?.idMal || anime?.title?.english || anime?.title?.romaji || 'anime';
  const cacheKey = `${server.name}_${animeId}_${episode}_${server.type || 'sub'}`;

  // For already-resolved HLS servers that still need subtitles (e.g. AniNeko stubs with
  // _subtitlesPending=true returned before getSources was called), bypass the early-return
  // so we can fetch the real tracks[] from getSources and populate subtitles.
  const needsSubtitles = server._subtitlesPending && (!server.subtitles || server.subtitles.length === 0);

  if (!needsSubtitles && server.isHLS && server.videoUrl &&
      server.videoUrl.startsWith('http') &&
      !server.videoUrl.includes('proxy/placeholder') &&
      !server.videoUrl.includes('proxy/iframe')) {
    return server;
  }

  // 1. In-memory cache check (0ms)
  if (resolvedServerStreamCache.has(cacheKey)) {
    const cached = resolvedServerStreamCache.get(cacheKey);
    const merged = { ...server, ...cached, isHLS: true };
    // If subtitles are still missing from a previous cached resolve, strip the
    // pending flag so we fall through to full resolution below.
    if (needsSubtitles && (!cached.subtitles || cached.subtitles.length === 0)) {
      // fall through to full resolution to obtain subtitle tracks
    } else {
      return merged;
    }
  }

  // 2. In-flight resolution deduplication (coalesces background pre-warm and active playback)
  if (inFlightResolutions.has(cacheKey)) {
    return inFlightResolutions.get(cacheKey);
  }

  // 3. SessionStorage cache check (0ms)
  try {
    const sess = sessionStorage.getItem(`res_srv_${cacheKey}`);
    if (sess) {
      const parsed = JSON.parse(sess);
      if (parsed?.videoUrl) {
        if (needsSubtitles && (!parsed.subtitles || parsed.subtitles.length === 0)) {
          // fall through — need to fetch subtitles even though stream URL is cached
        } else {
          resolvedServerStreamCache.set(cacheKey, parsed);
          return { ...server, ...parsed, isHLS: true };
        }
      }
    }
  } catch {}

  const embedUrl = server.embedUrl || server.videoUrl;
  if (!embedUrl || !embedUrl.startsWith('http')) return server;

  const resolutionPromise = (async () => {
    console.log(`[StreamEngine] Lazily resolving single server "${server.name}" (${embedUrl.slice(0, 80)})...`);

  let resolvedStreamUrl = null;
  let resolvedSubtitles = server.subtitles || [];
  let isHls = false;
  let serverReferer = server.referer;

  try {
    const urlObj = new URL(embedUrl);
    serverReferer = serverReferer || `${urlObj.origin}/`;

    // ── Handler A: MegaPlay / MegaCloud embeds ──
    const isMega = embedUrl.includes('megaplay') || embedUrl.includes('megacloud') || embedUrl.includes('anineko.es');
    if (isMega) {
      serverReferer = 'https://megaplay.buzz/';
      let dataId = null;
      try {
        const pageHtml = await clientFetch(embedUrl, {
          referer: serverReferer,
          timeout: 6000
        });

        const idMatch = pageHtml.match(/data-id="(\d+)"/i) || 
                        pageHtml.match(/id="player"\s+data-id="(\d+)"/i) || 
                        pageHtml.match(/File\s+(\d+)/i) ||
                        pageHtml.match(/"id"\s*:\s*(\d+)/i) ||
                        pageHtml.match(/cid\s*:\s*'([^']+)'/i);
        if (idMatch) dataId = idMatch[1];

        if (!dataId) {
          const directUnpack = unpackUniversalJS(pageHtml);
          if (directUnpack) {
            resolvedStreamUrl = directUnpack;
            isHls = true;
          }
        }
      } catch (e) {
        console.warn(`[StreamEngine] Failed to fetch embed HTML for ${server.name}:`, e.message);
      }

      if (!dataId && !embedUrl.includes('/s-2/')) {
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        dataId = pathSegments.find(p => /^\d+$/.test(p));
      }

      if (dataId) {
        const megaHost = urlObj.origin.includes('anineko.es') ? 'https://megaplay.buzz' : urlObj.origin;
        const sParam = urlObj.searchParams.get('s');
        const sUrl = sParam
          ? `${megaHost}/stream/getSources?id=${dataId}&s=${sParam}`
          : `${megaHost}/stream/getSources?id=${dataId}`;

        const sourcesResp = await clientFetch(sUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          referer: embedUrl,
          timeout: 6000
        });

        const sourcesData = typeof sourcesResp === 'string' ? JSON.parse(sourcesResp) : sourcesResp;
        const directM3u8 = await resolveMegaPlayStream(sourcesData);
        if (directM3u8) {
          resolvedStreamUrl = directM3u8;
          isHls = true;
        }
        // Always extract subtitle tracks from getSources regardless of stream URL
        // (stream may already be cached but subtitles were never fetched for this embed ID)
        const tracks = sourcesData?.tracks || [];
        const fetchedSubs = tracks
          .filter(t => t.kind === 'captions' || t.kind === 'subtitles')
          .map((t, i) => ({
            id: i,
            label: t.label || 'English',
            file: formatSubtitleProxyUrl(t.file, 'https://megaplay.buzz/'),
            referer: 'https://megaplay.buzz/',
            default: !!t.default
          }));
        if (fetchedSubs.length > 0) {
          resolvedSubtitles = fetchedSubs;
        }
      }
    }

    // ── Handler B: EchoVideo / AniWaves embeds ──
    if (!resolvedStreamUrl && (embedUrl.includes('echovideo') || embedUrl.includes('waves') || server.name.includes('Waves'))) {
      const wavesRes = await extractWavesDirectStream(embedUrl);
      if (wavesRes?.videoUrl) {
        resolvedStreamUrl = wavesRes.videoUrl;
        isHls = wavesRes.isHLS;
      }
    }

    // ── Handler C: Universal Direct Embed Scraper Fallback ──
    if (!resolvedStreamUrl) {
      const direct = await scrapeEmbedDirectly(embedUrl, serverReferer);
      if (direct?.videoUrl || direct?.url) {
        resolvedStreamUrl = direct.videoUrl || direct.url;
        isHls = true;
        if (direct.subtitles?.length) {
          resolvedSubtitles = direct.subtitles;
        }
      }
    }
  } catch (err) {
    console.warn(`[StreamEngine] Error resolving ${server.name}:`, err.message);
  }

  // Persist resolved data — always update cache with latest subtitles even if
  // the stream URL was already known (subtitle tracks may have been missing before).
  const resolvedData = {
    videoUrl: resolvedStreamUrl || server.videoUrl,
    subtitles: resolvedSubtitles,
    isHLS: resolvedStreamUrl ? isHls : server.isHLS,
    referer: serverReferer
  };

  if (resolvedStreamUrl || resolvedSubtitles.length > 0) {
    resolvedServerStreamCache.set(cacheKey, resolvedData);
    try {
      sessionStorage.setItem(`res_srv_${cacheKey}`, JSON.stringify(resolvedData));
    } catch {}
  }

  if (resolvedStreamUrl) {
    // Pre-fetch master playlist in background so AniPlayer gets it with zero delay
    prefetchM3U8(resolvedStreamUrl, serverReferer).catch(() => {});
    return { ...server, ...resolvedData, _subtitlesPending: false };
  }

  // Stream URL not resolved but subtitles were fetched — return merged
  if (resolvedSubtitles.length > 0) {
    return { ...server, subtitles: resolvedSubtitles, _subtitlesPending: false };
  }

  return server;
  })();

  inFlightResolutions.set(cacheKey, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    inFlightResolutions.delete(cacheKey);
  }
}

/**
 * Priority lineup strictly requested by user:
 * AniHD (1) → AniVid (2) → Neko-HD-2 (3) → WavesHD (4) → NekoHD (5)
 * HardSub variants are placed immediately after their softsub counterparts (+0.5).
 * DUB variants are placed after SUB servers (+100).
 */
export function getServerSortPriority(name) {
  const n = (name || '').trim();
  const low = n.toLowerCase();
  const isDub = low.includes('dub') || low.includes('(dub)');
  const isHard = low.includes('hardsub') || low.includes('hard');

  let base = 6;
  if (n.startsWith('AniHD') || low.includes('anihd')) {
    base = 1.0; // AniHD (Unified Nexabloom / Streamzone instant stream)
  } else if (low.includes('vidstream') || low.includes('neko-vidstream')) {
    base = 1.4; // Neko-VidStream (Vidstream-2 instant Nexabloom / Streamzone direct 1080p HLS)
  } else if (n.startsWith('NekoHD') || low.includes('nekohd')) {
    base = 1.5; // NekoHD (Instant MegaPlay stream)
  } else if (low.includes('hd-2') || low.includes('neko-hd-2')) {
    base = 1.6; // Neko-HD-2 (Nexabloom direct 1080p HLS)
  } else if (n.startsWith('MegaPlay') || low.includes('megaplay')) {
    base = 1.8; // MegaPlay (Instant direct stream)
  } else if (low.includes('streamhg') || low.includes('neko-streamhg')) {
    base = 2.2; // StreamHG (otakuhg direct 1080p HLS via unpackUniversalJS)
  } else if (low.includes('earnvids') || low.includes('neko-earnvids')) {
    base = 2.4; // Earnvids (otakuvid direct 1080p HLS via unpackUniversalJS)
  } else if (n.startsWith('Waves') || low.includes('waves')) {
    base = 2.5; // WavesHD (EchoVideo direct 1080p HLS)
  } else if (n.startsWith('AniVid') || low.includes('anivid')) {
    base = 3.0; // AniVid (VidPlay)
  } else if (low.includes('vivibebe') || low.includes('bibiemb')) {
    base = 9.0; // Deprecated/broken servers (ibyteimg 403)
  }

  const hardOffset = isHard ? 0.5 : 0;
  const dubOffset = isDub ? 100 : 0;
  return dubOffset + base + hardOffset;
}


/**
 * Silently pre-scrapes episode N+1 in the background during playback.
 * Warms ALL 3 scrapers (AniNeko + AniWaves + AniKoto) in parallel.
 * No-op if: already cached, at the last episode, or totalEps unknown.
 * Call this ~30s after playback starts to warm the cache for the next episode.
 */
export function prefetchNextEpisode(anime, currentEpisode, totalEps) {
  if (!anime || !currentEpisode) return;
  // On slow/congested networks, skip prefetching to preserve bandwidth for currently playing video
  if (getNetworkProfile().isSlow) {
    console.log('[Prefetch] Network is slow/congested — skipping next-episode prefetch to prevent rebuffering');
    return;
  }
  const nextEp = currentEpisode + 1;
  if (totalEps && nextEp > totalEps) return; // already at last episode

  const cacheKey = `${anime.id || anime.idMal || anime.title?.romaji || 'unknown'}-${nextEp}`;
  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Prefetch] Episode ${nextEp} already fully cached — skipping`);
      return;
    }
  }

  console.log(`[Prefetch] Warming all scrapers for episode ${nextEp}...`);
  // Fire-and-forget: errors are swallowed, this is best-effort
  // onlyNeko=false → pre-warms AniNeko + AniWaves + AniKoto simultaneously
  getAniNekoServers(anime, nextEp, null, false).catch(() => {});
}

export async function getAniNekoServers(anime, episode, onServersFound, onlyNeko = false) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  
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
        const sNameLow = (s.name || '').toLowerCase();
        const sEmbedLow = (s.embedUrl || '').toLowerCase();
        const sVideoLow = (s.videoUrl || '').toLowerCase();

        // Block dead/poisoned hosts: dood/playmogo (DMCA-gone), bibiemb (dead), vivibebe/ibyteimg (ByteDance 403 Forbidden)
        if (sNameLow.includes('dood') || sNameLow.includes('playmogo') || sEmbedLow.includes('dood') || sEmbedLow.includes('playmogo')) return;
        if (sEmbedLow.includes('bibiemb') || sVideoLow.includes('bibiemb') || sVideoLow.includes('vibevibe.workers.dev')) return;
        if (sEmbedLow.includes('vivibebe') || sVideoLow.includes('vivibebe') || sVideoLow.includes('ibyteimg')) return;

        const isAllowed = onlyNeko
          ? baseName.startsWith('Neko')
          : (baseName.startsWith('Neko') || baseName.startsWith('Waves') || ['WavesHD', 'AniHD', 'AniVid', 'MegaPlay'].includes(baseName));
        if (!isAllowed) return; // skip non-allowed servers

        // Prevent duplicate server items by name+type
        const isDuplicate = combinedServers.some(x => 
          x.name === s.name && x.type === s.type
        );
        if (!isDuplicate) {
          combinedServers.push({ ...s, name: s.name });
          // NOTE: No Neko Bridge here. AniNeko and AniKoto are independent sites that both
          // use MegaPlay as their CDN, but each has its own separate embed IDs per episode.
          // Cloning AniKoto's embed ID under a "Neko-VidStream" label was (a) a mislabeled
          // duplicate of AniHD, and (b) showing AniKoto content with the wrong brand name.
          // AniNeko's own servers (NekoHD, Neko-VidStream) appear naturally when AniNeko
          // scraping succeeds — those have AniNeko's real embed IDs and correct subtitles.
        }
      });
      if (data.animeTitle) mainTitle = data.animeTitle;
      if (data.slug) activeSlug = data.slug;

      // ⚡ Sort strictly by user-specified CDN priority: AniHD → AniVid → Neko-HD-2 → WavesHD → NekoHD
      combinedServers.sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name));

      if (onServersFound) {
        onServersFound([...combinedServers]);
      }

      // ⚡ Pre-warm top unresolved servers in parallel background so embed decrypt is done before user taps.
      // BUT if network is slow/congested, skip pre-warming to preserve mobile bandwidth for instant playback!
      const netProfile = getNetworkProfile();
      if (!netProfile.isSlow) {
        const unresolvedCandidates = combinedServers.filter(s => !s.isHLS && s.embedUrl).slice(0, 2);
        unresolvedCandidates.forEach(srv => {
          resolveSingleServer(srv, anime, episode).catch(() => {});
        });
      }

    }
  };

  // Single call per scraper — each scraper already handles all title variants internally
  // via its allTitles param. Firing N calls was redundant and multiplied network requests.
  const primaryTitle = anime.title?.romaji || anime.title?.english || titles[0];
  const tryScraper = async (scraperFn, scraperName) => {
    try {
      console.log(`[ClientEngine] ${scraperName} scraping ep ${episode} (primary: "${primaryTitle}")`);
      const data = await scraperFn(primaryTitle, episode, isMovie, anime.id, allTitles, 'english', anime.idMal);
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
    // Fast path: fetch AniNeko
    results = await Promise.allSettled([
      runWithTimeout(nekoPromise, 8000, 'AniNeko').catch(e => { console.warn(e.message); return null; })
    ]);
    // Graceful fallback: If AniNeko had no servers for this anime, immediately query AniKoto & AniWaves
    // so pre-warming never fails for any of the 2000+ anime!
    if (combinedServers.length === 0) {
      const wavesPromise   = tryScraper(scrapeAniWaves,  'AniWaves');
      const anikotoPromise = tryScraper(scrapeAniKoto,   'AniKoto');
      const fallbackResults = await Promise.allSettled([
        runWithTimeout(anikotoPromise, 5000, 'AniKoto').catch(() => null),
        runWithTimeout(wavesPromise,   5000, 'AniWaves').catch(() => null),
      ]);
      results.push(...fallbackResults);
    }
  } else {
    const wavesPromise   = tryScraper(scrapeAniWaves,  'AniWaves');
    const anikotoPromise = tryScraper(scrapeAniKoto,   'AniKoto');

    results = await Promise.allSettled([
      runWithTimeout(nekoPromise,    8000, 'AniNeko').catch(e  => { console.warn(e.message); return null; }),
      runWithTimeout(wavesPromise,   6000, 'AniWaves').catch(e => { console.warn(e.message); return null; }),
      runWithTimeout(anikotoPromise, 6000, 'AniKoto').catch(e  => { console.warn(e.message); return null; }),
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
    const entry = { data: resultData, timestamp: Date.now() };
    clientStreamCache.set(cacheKey, entry);
    try { sessionStorage.setItem(`stream_v9_cache_${cacheKey}`, JSON.stringify(entry)); } catch {}
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
    
    // Build referer candidates with trailing slash
    const refererCandidates = [];
    if (referer) {
      try {
        const origin = new URL(referer).origin;
        refererCandidates.push(`${origin}/`);
      } catch (_) {}
    }
    if (url.includes('kryntal.top') || url.includes('megaplay') || url.includes('megacloud') || url.includes('norami') || url.includes('imgnex') || url.includes('dokicloud') || url.includes('megap') || url.includes('shiora') || url.includes('mikora') || url.includes('akirax')) {
      refererCandidates.push('https://megaplay.buzz/');
    }
    if (url.includes('vidtube') || url.includes('vidplay')) {
      refererCandidates.push('https://vidtube.site/');
    }
    if (url.includes('echovideo')) {
      refererCandidates.push('https://play.echovideo.ru/');
    }
    if (url.includes('bibiemb') || url.includes('vibevibe')) {
      refererCandidates.push('https://bibiemb.xyz/');
    }
    if (url.includes('vivibebe')) {
      refererCandidates.push('https://vivibebe.site/');
    }
    if (url.includes('anineko')) {
      refererCandidates.push('https://anineko.es/');
    }
    if (url.includes('otakuhg') || url.includes('cdn-centaurus')) {
      refererCandidates.push('https://otakuhg.site/');
    }
    if (url.includes('otakuvid') || url.includes('dramiyos') || url.includes('acek-cdn')) {
      refererCandidates.push('https://otakuvid.online/');
    }
    try {
      const urlOrigin = new URL(url).origin;
      refererCandidates.push(`${urlOrigin}/`);
    } catch (_) {}

    const uniqueReferers = [...new Set(refererCandidates.filter(Boolean))];
    let lastErr = null;

    for (const ref of uniqueReferers) {
      try {
        const refOrigin = new URL(ref).origin;
        const response = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Origin': refOrigin,
            'Referer': ref
          }
        });
        if (response.status === 200 && response.data) {
          const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
          if (text.includes('#EXTM3U') || text.includes('#EXT-X') || text.length > 20) {
            return text;
          }
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    throw new Error('Failed to fetch M3U8 playlist: status error or empty response');
  } else {
    // Dev browser fallback - proxy it if possible, or try direct
    const PROXY_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STREAM_PROXY_URL) || '';
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

/**
 * Resolve a server to a direct streamable URL on demand.
 *
 * Previously this function contained dead code (`let data = null`) that always
 * threw. It is now a thin delegation layer over `resolveSingleServer`, the same
 * proven resolution path used during live playback.
 *
 * The cache (`resolvedServerStreamCache` + sessionStorage) means a second call
 * for the same server/episode pair returns instantly from memory at 0ms.
 *
 * @param {object} anime    - Anime metadata object (needs .id/.idMal/.title)
 * @param {number} episode  - Episode number
 * @param {string} serverName - Display name of the target server
 * @param {string} serverType - 'sub' | 'dub'
 */
export async function resolvePlaceholderServer(anime, episode, serverName, serverType) {
  // Look up the server object from the client stream cache
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  const cached = clientStreamCache.get(cacheKey);
  const servers = cached?.data?.servers || [];

  // Find the specific server by name + type (exact match first, type-only fallback)
  const srv = servers.find(s => s.name === serverName && s.type === serverType)
           || servers.find(s => s.type === serverType);

  if (!srv) {
    // Server not in cache — re-fetch all servers and try again
    console.log(`[StreamEngine] resolvePlaceholderServer: server "${serverName}" not in cache, fetching...`);
    const freshData = await getAniNekoServers(anime, episode, null, false);
    const freshSrv = freshData?.servers?.find(s => s.name === serverName && s.type === serverType)
                  || freshData?.servers?.find(s => s.type === serverType);
    if (!freshSrv) throw new Error(`Server "${serverName}" not found after re-fetch`);
    return resolveSingleServer(freshSrv, anime, episode);
  }

  return resolveSingleServer(srv, anime, episode);
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
  // Skip prefetch on slow networks to keep socket open for active video stream
  if (getNetworkProfile().isSlow) return;

  // Skip if already prefetched and still fresh
  const existing = m3u8PrefetchCache.get(videoUrl);
  if (existing && Date.now() - existing.timestamp < M3U8_PREFETCH_TTL) {
    return existing.variants;
  }

  try {
    const playlistText = await fetchM3U8Playlist(videoUrl, referer);
    const variants = parseMasterPlaylist(videoUrl, playlistText);
    if (variants.length > 0) {
      m3u8PrefetchCache.set(videoUrl, { variants, timestamp: Date.now() });
      return variants;
    }
  } catch (e) {
    // Silently swallow — prefetch is a best-effort optimization
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
