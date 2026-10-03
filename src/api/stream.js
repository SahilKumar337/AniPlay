// Client-Side Stream API (Way 4)
// High-performance streaming engine with persistent local caching

/**
 * Client-Side Stream API (Way 4)
 * Runs anime stream scraper logic directly in the React frontend.
 * Bypasses CORS via Capacitor native network stack, routing HLS segments
 * through a lightweight Cloudflare Worker header proxy if configured.
 */

import { scrapeAniNeko, scrapeAniWaves, scrapeAniKoto, clientFetch, formatSubtitleProxyUrl, extractWavesDirectStream } from './scrapers.js';
import { scrapeHStream, scrapeHentaiCity } from './adultScraper.js';
import { resolveMegaPlayStream } from '../utils/megaplayDecrypt.js';
import { resolveVidPlayStream, isVidPlayEmbed } from '../utils/vidplayDecrypt.js';
import { scrapeEmbedDirectly, unpackUniversalJS } from './embedScraper.js';
import { getNetworkProfile } from '../utils/networkSpeed.js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const clientStreamCache = new Map();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours cache life for provider metadata
const TOKEN_CACHE_TTL = 20 * 60 * 1000; // 20 minutes max for signed CDN URLs with tokens

// Purge any corrupted or stale cache keys from previous versions on load
if (typeof localStorage !== 'undefined') {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      // Purge old versioned entries (v20 and older) to ensure complete isolation and prevent episode leaks
      if (k && (
        k.startsWith('stream_v') && !k.startsWith('stream_v21_') ||
        k.startsWith('res_srv_') && !k.startsWith('res_srv_v21_') ||
        k.startsWith('neko_ep_') && !k.startsWith('neko_ep_v21_') ||
        k.startsWith('waves_servers_') && !k.startsWith('waves_servers_v21_') ||
        k.startsWith('ep_subs_v1_')
      )) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}
}

/**
 * Strict validator for genuine direct video streams (HLS/MP4).
 * Returns false for iframe/embed pages (e.g. megaplay.buzz/stream/..., echovideo.ru/embed/...).
 */
export function isDirectStreamUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  const low = url.toLowerCase();
  if (low.includes('proxy/iframe') || low.includes('proxy/placeholder')) return false;
  if (low.includes('megaplay.buzz/stream/') || low.includes('megaplay.buzz/videojs/')) return false;
  if (low.includes('/embed') || low.includes('echovideo.ru/embed')) return false;
  if (low.includes('anineko.to/watch') || low.includes('anineko.es/watch')) return false;
  return (
    low.includes('.m3u8') ||
    low.includes('/cdn/') ||
    low.includes('.mp4') ||
    low.includes('.webm') ||
    low.includes('token=') ||
    low.includes('savedly.net') ||
    low.includes('cdn.') ||
    low.includes('1anime.site/stream/') ||
    low.includes('1anime.site/videos/')
  );
}

// â”€â”€ Slug Persistence Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// After successfully resolving a slug for an anime on any scraper, persist it
// in localStorage. Next time the scraper skips the slow title-search step and
// jumps directly to the episode fetch â€” turns ~1.5s search â†’ ~150ms direct.
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

/**
 * Adaptive timeout â€” scales based on real network speed.
 * On fast networks (4G/WiFi) keeps original fast timeouts for instant playback.
 * On slow networks (2G/3G/KBs) extends timeouts so scrapers can still complete.
 * This is how YouTube shows all quality options even on 2G.
 */
function getAdaptiveTimeout(baseMs) {
  try {
    const net = getNetworkProfile();
    if (net.isCriticalSlow) return baseMs * 5;   // 2G / < 0.8 Mbps â†’ 5Ã— (e.g. 4500 â†’ 22500ms)
    if (net.isSlow)         return baseMs * 3;   // 3G / < 2 Mbps  â†’ 3Ã— (e.g. 4500 â†’ 13500ms)
    return baseMs;                               // 4G / WiFi      â†’ keep original
  } catch { return baseMs; }
}

/**
 * Known server placeholders â€” these are shown INSTANTLY in the UI while scraping runs.
 * Same approach YouTube uses: show all quality options immediately, resolve URLs lazily.
 * Placeholders have isPlaceholder=true so the UI can show a loading spinner on them.
 */
const KNOWN_SERVER_PLACEHOLDERS = [
  { name: 'AniHD',      type: 'sub', isPlaceholder: true },
  { name: 'AniHD',      type: 'dub', isPlaceholder: true },
  { name: 'WavesHD',    type: 'sub', isPlaceholder: true },
  { name: 'MegaPlay',   type: 'sub', isPlaceholder: true },
];

export const KNOWN_ADULT_SERVER_PLACEHOLDERS = [
  { name: 'HStream-HD', type: 'sub', isPlaceholder: true },
  { name: 'HentaiCity', type: 'sub', isPlaceholder: true },
  { name: 'HStream-HD (DUB)', type: 'dub', isPlaceholder: true },
  { name: 'HentaiCity (DUB)', type: 'dub', isPlaceholder: true },
];

/**
 * Universal adult / hentai content detector.
 * Checks official AniList isAdult flag, Hentai genres, tags, and ratings.
 */
export function checkIsAdultAnime(anime) {
  if (!anime) return false;
  if (String(anime.id) === '2697') return true;
  if (anime.isAdult === true) return true;
  if (Array.isArray(anime.genres) && anime.genres.some(g => typeof g === 'string' && /hentai|erotica/i.test(g))) return true;
  if (Array.isArray(anime.tags) && anime.tags.some(t => {
    const name = typeof t === 'string' ? t : (t?.name || '');
    return /hentai|erotica/i.test(name) || t?.isAdult === true;
  })) return true;
  if (typeof anime.rating === 'string' && /r18|rx/i.test(anime.rating)) return true;
  const titles = [anime.title?.romaji, anime.title?.english, ...(anime.synonyms || [])].filter(Boolean);
  if (titles.some(t => /donburi kazoku|like mother.*like daughter/i.test(t))) return true;
  return false;
}

export function getCachedServers(anime, episode) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;

  const validateResult = (data) => {
    if (!data) return null;
    const epNum = Number(episode);
    if (data.episode && Number(data.episode) !== epNum) {
      console.warn(`[getCachedServers] Episode mismatch in cache for ${cacheKey} (has ep ${data.episode}, requested ${epNum}) — invalidating`);
      invalidateStreamCache(anime, episode);
      return null;
    }
    if (epNum > 1 && data.servers?.length > 0) {
      try {
        const baseKey = anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown';
        const checkEps = [1];
        if (epNum > 2) checkEps.push(2);
        if (epNum > 3 && epNum - 1 > 2) checkEps.push(epNum - 1);

        for (const prevEp of checkEps) {
          const prevKey = `${baseKey}-${prevEp}`;
          const prevUrls = [];
          if (clientStreamCache.has(prevKey)) {
            const srvs = clientStreamCache.get(prevKey)?.data?.servers || [];
            srvs.forEach(s => {
              if (s.videoUrl) prevUrls.push(s.videoUrl);
              if (s.embedUrl) prevUrls.push(s.embedUrl);
            });
          } else {
            const raw = localStorage.getItem(`stream_v21_cache_${prevKey}`);
            if (raw) {
              const srvs = JSON.parse(raw)?.data?.servers || [];
              srvs.forEach(s => {
                if (s.videoUrl) prevUrls.push(s.videoUrl);
                if (s.embedUrl) prevUrls.push(s.embedUrl);
              });
            }
          }
          if (prevUrls.length > 0) {
            const contaminated = data.servers.some(s =>
              (s.videoUrl && prevUrls.includes(s.videoUrl)) ||
              (s.embedUrl && prevUrls.includes(s.embedUrl))
            );
            if (contaminated) {
              console.warn(`[getCachedServers] Purging contaminated cache for episode ${episode} (matches ep ${prevEp} stream)`);
              invalidateStreamCache(anime, episode);
              return null;
            }
          }
        }

        // Check if any server stream URL explicitly contains a different episode number tag
        for (const s of data.servers) {
          const u = (s.videoUrl || '') + ' ' + (s.embedUrl || '');
          const match = u.match(/(?:_Episode_|[\/-]episode[\/-]|[\/-]ep[\.\/-])(\d+)(?:[_\.\/-]|$)/i);
          if (match && Number(match[1]) !== epNum && Number(match[1]) > 0) {
            console.warn(`[getCachedServers] Purging cache for episode ${episode} (URL contains ep ${match[1]} tag)`);
            invalidateStreamCache(anime, episode);
            return null;
          }
        }
      } catch (_) {}
    }
    return data;
  };

  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (!cached.data?.isPartial) {
      const hasTokenizedUrl = cached.data?.servers?.some(s => s.videoUrl && (s.videoUrl.includes('token=') || s.videoUrl.includes('.m3u8')));
      const effectiveTtl = hasTokenizedUrl ? TOKEN_CACHE_TTL : CACHE_TTL;
      if (Date.now() - cached.timestamp < effectiveTtl) {
        return validateResult(cached.data);
      } else {
        clientStreamCache.delete(cacheKey);
      }
    }
  }
  // Check localStorage persistence (0.05ms instant hit across app restarts)
  try {
    const raw = localStorage.getItem(`stream_v21_cache_${cacheKey}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.data?.isPartial) {
        localStorage.removeItem(`stream_v21_cache_${cacheKey}`);
        return null;
      }
      const hasTokenizedUrl = parsed.data?.servers?.some(s => s.videoUrl && (s.videoUrl.includes('token=') || s.videoUrl.includes('.m3u8')));
      const effectiveTtl = hasTokenizedUrl ? TOKEN_CACHE_TTL : CACHE_TTL;
      if (Date.now() - parsed.timestamp < effectiveTtl) {
        clientStreamCache.set(cacheKey, parsed);
        return validateResult(parsed.data);
      } else {
        localStorage.removeItem(`stream_v21_cache_${cacheKey}`);
      }
    }
  } catch {}
  return null;
}

/** Invalidates the in-memory and persisted stream cache for the given anime + episode. */
export function invalidateStreamCache(anime, episode) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  clientStreamCache.delete(cacheKey);
  try {
    localStorage.removeItem(`stream_v21_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v20_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v19_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v17_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v21_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v20_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v19_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v17_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v16_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v15_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v9_cache_${cacheKey}`);
  } catch {}
  console.log(`[ClientEngine] Invalidated stream cache for: ${cacheKey}`);
}

/**
 * Persists an episode's servers, merging with already cached ones and keeping direct HLS streams.
 */
export function saveCachedServers(anime, episode, servers, isPartial = false) {
  if (!anime || !episode || !servers || servers.length === 0) return;
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  
  let existingServers = [];
  if (clientStreamCache.has(cacheKey)) {
    existingServers = clientStreamCache.get(cacheKey)?.data?.servers || [];
  } else {
    try {
      const raw = localStorage.getItem(`stream_v21_cache_${cacheKey}`);
      if (raw) {
        existingServers = JSON.parse(raw)?.data?.servers || [];
      }
    } catch {}
  }

  const merged = [...servers];
  for (const ex of existingServers) {
    const exName = (ex.name || '').trim().toLowerCase();
    const exType = (ex.type || 'sub').trim().toLowerCase();
    const matchIdx = merged.findIndex(m => 
      (m.name || '').trim().toLowerCase() === exName && 
      (m.type || 'sub').trim().toLowerCase() === exType
    );
    if (matchIdx === -1) {
      merged.push(ex);
    } else if (ex.isHLS && isDirectStreamUrl(ex.videoUrl) && !merged[matchIdx].isHLS) {
      // Keep previously resolved direct HLS stream ONLY if embed URLs match or are absent
      if (!ex.embedUrl || !merged[matchIdx].embedUrl || ex.embedUrl === merged[matchIdx].embedUrl) {
        merged[matchIdx] = { ...merged[matchIdx], ...ex };
      }
    }
  }

  const resultData = {
    ok: true,
    episode: Number(episode),
    servers: merged,
    animeTitle: anime?.title?.romaji || anime?.title?.english || 'Anime',
    isPartial,
  };

  const entry = { data: resultData, timestamp: Date.now() };
  clientStreamCache.set(cacheKey, entry);
  try {
    localStorage.setItem(`stream_v21_cache_${cacheKey}`, JSON.stringify(entry));
    sessionStorage.setItem(`stream_v21_cache_${cacheKey}`, JSON.stringify(entry));
  } catch {}
}

/**
 * Updates a single resolved direct server in the episode cache so reloads are 0ms instant!
 */
export function updateCachedEpisodeServer(anime, episode, resolvedServer) {
  if (!anime || !episode || !resolvedServer?.videoUrl || !isDirectStreamUrl(resolvedServer.videoUrl)) return;
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  
  let entry = clientStreamCache.get(cacheKey);
  if (!entry) {
    try {
      const raw = localStorage.getItem(`stream_v21_cache_${cacheKey}`);
      if (raw) entry = JSON.parse(raw);
    } catch {}
  }

  if (entry?.data?.servers) {
    entry.data.episode = Number(episode);
    const targetName = (resolvedServer.name || '').trim().toLowerCase();
    const targetType = (resolvedServer.type || 'sub').trim().toLowerCase();
    let updated = false;

    entry.data.servers = entry.data.servers.map(s => {
      const sName = (s.name || '').trim().toLowerCase();
      const sType = (s.type || 'sub').trim().toLowerCase();
      if (sName === targetName && sType === targetType) {
        updated = true;
        return {
          ...s,
          videoUrl: resolvedServer.videoUrl,
          isHLS: Boolean(resolvedServer.isHLS),
          subtitles: (resolvedServer.subtitles?.length > 0) ? resolvedServer.subtitles : s.subtitles,
          referer: resolvedServer.referer || s.referer,
          _subtitlesPending: false
        };
      }
      return s;
    });

    if (!updated) {
      entry.data.servers.push({
        ...resolvedServer,
        isHLS: Boolean(resolvedServer.isHLS),
        _subtitlesPending: false
      });
    }

    entry.timestamp = Date.now();
    clientStreamCache.set(cacheKey, entry);
    try {
      localStorage.setItem(`stream_v21_cache_${cacheKey}`, JSON.stringify(entry));
      sessionStorage.setItem(`stream_v21_cache_${cacheKey}`, JSON.stringify(entry));
    } catch {}
  }
}

// Persistent in-memory cache for lazily resolved single server streams
const resolvedServerStreamCache = new Map();
const inFlightResolutions = new Map();

// â”€â”€ Episode Subtitles Persistent Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const episodeSubtitlesCache = new Map();
const EPISODE_SUBS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getEpisodeSubtitles(animeId, episode) {
  if (!animeId || !episode) return [];
  const key = `${animeId}_${episode}`;
  if (episodeSubtitlesCache.has(key)) {
    return episodeSubtitlesCache.get(key);
  }
  try {
    const raw = localStorage.getItem(`ep_subs_v2_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.expires || Date.now() < parsed.expires) {
        if (Array.isArray(parsed.subtitles) && parsed.subtitles.length > 0) {
          episodeSubtitlesCache.set(key, parsed.subtitles);
          return parsed.subtitles;
        }
      } else {
        localStorage.removeItem(`ep_subs_v2_${key}`);
      }
    }
  } catch (_) {}
  return [];
}

export function saveEpisodeSubtitles(animeId, episode, subtitles) {
  if (!animeId || !episode || !Array.isArray(subtitles) || subtitles.length === 0) return;
  const key = `${animeId}_${episode}`;
  const existing = getEpisodeSubtitles(animeId, episode) || [];

  const seenUrls = new Set(existing.map(s => s.file || s.url));
  const merged = [...existing];
  for (const s of subtitles) {
    const url = s.file || s.url;
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      merged.push(s);
    }
  }

  episodeSubtitlesCache.set(key, merged);
  try {
    localStorage.setItem(`ep_subs_v2_${key}`, JSON.stringify({
      subtitles: merged,
      expires: Date.now() + EPISODE_SUBS_CACHE_TTL
    }));
  } catch (_) {}
}

/**
 * Invalidates the cached stream URL for a single server (e.g. on fatal HLS error / 403).
 * Clears both in-memory cache and localStorage so the next resolution re-fetches a fresh URL.
 * Call this from onStreamExpired before retrying a failed server.
 */
export function invalidateServerStreamCache(server, anime, episode) {
  if (!server) return;
  const animeId = anime?.id || anime?.idMal || anime?.title?.english || anime?.title?.romaji || 'anime';
  const cacheKey = `${server.name}_${animeId}_${episode}_${server.type || 'sub'}`;
  resolvedServerStreamCache.delete(cacheKey);
  inFlightResolutions.delete(cacheKey);
  try {
    localStorage.removeItem(`res_srv_v21_${cacheKey}`);
    localStorage.removeItem(`res_srv_v20_${cacheKey}`);
    localStorage.removeItem(`res_srv_v19_${cacheKey}`);
    localStorage.removeItem(`res_srv_v17_${cacheKey}`);
  } catch {}
  // Also clear the episode's stream cache so auto-failover/retry gets fresh servers
  const epCacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  clientStreamCache.delete(epCacheKey);
  try {
    localStorage.removeItem(`stream_v21_cache_${epCacheKey}`);
    localStorage.removeItem(`stream_v20_cache_${epCacheKey}`);
    localStorage.removeItem(`stream_v19_cache_${epCacheKey}`);
    localStorage.removeItem(`stream_v17_cache_${epCacheKey}`);
  } catch {}
  console.log(`[StreamEngine] Invalidated server stream cache for: ${server.name} (ep ${episode})`);
}

/**
 * Lazily resolve a single streaming server on demand.
 * Scrapes and decrypts ONLY the selected server when chosen in the UI.
 * Results are cached in memory and sessionStorage for 0ms instant playback on re-selection.
 */
export async function resolveSingleServer(server, anime, episode) {
  if (!server) return null;

  const animeId = anime?.id || anime?.idMal || anime?.title?.english || anime?.title?.romaji || 'anime';
  const cacheKey = `${server.name}_${animeId}_${episode}_${server.type || 'sub'}`;
  const isDub = server.type === 'dub' || (server.name || '').toLowerCase().includes('dub');

  // Helper to merge cached episode dialogue subtitles into DUB servers
  const enrichDubWithCachedSubs = (srv) => {
    if (!isDub) return srv;
    const cachedSubs = getEpisodeSubtitles(animeId, episode);
    if (!cachedSubs || cachedSubs.length === 0) return srv;
    const existing = Array.isArray(srv.subtitles) ? [...srv.subtitles] : [];
    const seenFiles = new Set(existing.map(s => s.file || s.url));
    const combined = [...existing];
    for (const cs of cachedSubs) {
      const f = cs.file || cs.url;
      if (f && !seenFiles.has(f)) {
        seenFiles.add(f);
        combined.push(cs);
      }
    }
    return { ...srv, subtitles: combined };
  };

  // For already-resolved HLS servers that still need subtitles (e.g. AniNeko stubs with
  // _subtitlesPending=true returned before getSources was called), bypass the early-return
  // so we can fetch the real tracks[] from getSources and populate subtitles.
  const needsSubtitles = server._subtitlesPending && (!server.subtitles || server.subtitles.length === 0);

  if (!needsSubtitles && server.isHLS && isDirectStreamUrl(server.videoUrl)) {
    return enrichDubWithCachedSubs(server);
  }

  // 1. In-memory cache check (0ms)
  if (resolvedServerStreamCache.has(cacheKey)) {
    const cached = resolvedServerStreamCache.get(cacheKey);
    if (isDirectStreamUrl(cached.videoUrl)) {
      const isCachedHls = cached.isHLS !== undefined ? cached.isHLS : Boolean(cached.videoUrl?.includes('.m3u8'));
      const merged = enrichDubWithCachedSubs({ ...server, ...cached, isHLS: isCachedHls });
      if (needsSubtitles && (!merged.subtitles || merged.subtitles.length === 0)) {
        // fall through to full resolution to obtain subtitle tracks
      } else {
        return merged;
      }
    }
  }

  // 2. In-flight resolution deduplication (coalesces background pre-warm and active playback)
  if (inFlightResolutions.has(cacheKey)) {
    return inFlightResolutions.get(cacheKey);
  }

  const embedUrl = server.embedUrl || server.videoUrl;
  if (!embedUrl || !embedUrl.startsWith('http')) return server;

  // âš¡ CRITICAL FIX: URL-based dedup key MUST include episode to prevent cross-episode stream contamination.
  // Without the episode, ep1 and ep12 sharing the same embed URL would return ep1's resolved stream for ep12!
  const urlKey = `url_ep${episode}_${embedUrl}`;
  if (inFlightResolutions.has(urlKey)) {
    return inFlightResolutions.get(urlKey);
  }

  // 3. LocalStorage persistence check (0.05ms instant hit across app restarts)
  try {
    const sess = localStorage.getItem(`res_srv_v21_${cacheKey}`);
    if (sess) {
      const parsed = JSON.parse(sess);
      const isFresh = !parsed.expires || Date.now() < parsed.expires;
      if (parsed?.videoUrl && isDirectStreamUrl(parsed.videoUrl) && isFresh) {
        if (needsSubtitles && (!parsed.subtitles || parsed.subtitles.length === 0)) {
          // fall through — need to fetch subtitles even though stream URL is cached
        } else {
          resolvedServerStreamCache.set(cacheKey, parsed);
          const isParsedHls = parsed.isHLS !== undefined ? parsed.isHLS : Boolean(parsed.videoUrl?.includes('.m3u8'));
          return enrichDubWithCachedSubs({ ...server, ...parsed, isHLS: isParsedHls });
        }
      }
    }
  } catch {}

  let resolutionPromise;
  resolutionPromise = (async () => {
    console.log(`[StreamEngine] Lazily resolving single server "${server.name}" (${embedUrl.slice(0, 80)})...`);

  let resolvedStreamUrl = null;
  let resolvedSubtitles = server.subtitles || [];
  let isHls = false;
  let serverReferer = server.referer;

  try {
    const urlObj = new URL(embedUrl);
    serverReferer = serverReferer || `${urlObj.origin}/`;

    // â”€â”€ Handler A: MegaPlay / MegaCloud embeds (including Akirax, DokiCloud, etc.) â”€â”€
    const lowEmbed = embedUrl.toLowerCase();
    const isMega = lowEmbed.includes('megaplay') || lowEmbed.includes('megacloud') || lowEmbed.includes('anineko.es')
      || lowEmbed.includes('rabbitstream') || lowEmbed.includes('mfast') || lowEmbed.includes('rapid-cloud')
      || lowEmbed.includes('kryntal') || lowEmbed.includes('norami') || lowEmbed.includes('imgnex')
      || lowEmbed.includes('dokicloud') || lowEmbed.includes('akirax') || lowEmbed.includes('shiora')
      || lowEmbed.includes('mikora') || lowEmbed.includes('quavex') || lowEmbed.includes('nexabloom')
      || lowEmbed.includes('streamzone') || lowEmbed.includes('silverorbit') || lowEmbed.includes('midnightvale')
      || lowEmbed.includes('hiddenvertex') || lowEmbed.includes('vertex');
    if (isMega) {
      serverReferer = 'https://megaplay.buzz/';
      let dataId = null;

      const megaHost = (urlObj.origin.includes('anineko.es') || lowEmbed.includes('megaplay')) ? 'https://megaplay.buzz' : urlObj.origin;
      const rawSParam = urlObj.searchParams.get('s');
      // âš¡ CRITICAL: Never pass 'tcdn' (TikTok CDN). In India and other countries, *.tiktokcdn.com is blocked
      // by ISPs at the network firewall level, causing Hls.js to hang at 0:00/0:00 indefinitely.
      // Omitting s=tcdn forces MegaPlay to return the fast global CDN (nexabloom.top / midnightvale.top).
      const sParam = (rawSParam && rawSParam !== 'tcdn') ? rawSParam : null;

      // â”€â”€ ROOT-CAUSE FIX FOR WRONG ANIME PLAYBACK â”€â”€
      // On MegaPlay, URL path segments (e.g. /stream/s-2/3303/sub) contain the host site's
      // internal episode index (realid=3303), NOT MegaPlay's source file ID!
      // Passing that episode index to /stream/getSources?id=3303 loads a completely different, random anime.
      // The true source file ID (data-id) MUST ALWAYS be parsed from the embed page HTML!
      try {
        const pageHtml = await clientFetch(embedUrl, {
          referer: serverReferer,
          timeout: 6000
        });

        if (!pageHtml || pageHtml.includes('Oops! Something went wrong') || pageHtml.includes('Error Code: <span>404</span>')) {
          console.warn(`[StreamEngine] Embed ${embedUrl} returned 404 error page â€” skipping`);
          return server;
        }

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

        if (dataId && !resolvedStreamUrl) {
          const sUrl = sParam
            ? `${megaHost}/stream/getSources?id=${dataId}&s=${sParam}`
            : `${megaHost}/stream/getSources?id=${dataId}`;

          const sourcesResp = await clientFetch(sUrl, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            referer: embedUrl,
            timeout: 6000
          });

          const sourcesData = typeof sourcesResp === 'string' ? JSON.parse(sourcesResp) : sourcesResp;
          let directM3u8 = await resolveMegaPlayStream(sourcesData);
          if (directM3u8 && directM3u8.includes('tiktokcdn.com')) {
            // Guard: If it ever returns a TikTok CDN URL, retry without s parameter to get clean CDN
            try {
              const fbResp = await clientFetch(`${megaHost}/stream/getSources?id=${dataId}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                referer: embedUrl,
                timeout: 5000
              });
              const fbData = typeof fbResp === 'string' ? JSON.parse(fbResp) : fbResp;
              const cleanM3u8 = await resolveMegaPlayStream(fbData);
              if (cleanM3u8 && !cleanM3u8.includes('tiktokcdn.com')) {
                directM3u8 = cleanM3u8;
              }
            } catch (_) {}
          }
          if (directM3u8) {
            resolvedStreamUrl = directM3u8;
            isHls = true;
          }
          const tracks = sourcesData?.tracks || [];
          const hasCleanEng = tracks.some(t => (t.label || '').trim().toLowerCase() === 'english');
          const fetchedSubs = tracks
            .filter(t => t.kind === 'captions' || t.kind === 'subtitles')
            .map((t, i) => {
              const lbl = (t.label || 'English').trim();
              const isCleanEng = lbl.toLowerCase() === 'english';
              const isForced = /forced/i.test(lbl);
              return {
                id: i,
                label: lbl,
                file: formatSubtitleProxyUrl(t.file, 'https://megaplay.buzz/'),
                referer: 'https://megaplay.buzz/',
                default: isCleanEng ? true : (isForced ? false : !!t.default)
              };
            });
          if (fetchedSubs.length > 0) {
            resolvedSubtitles = fetchedSubs;
          }
        }
      } catch (e) {
        console.warn(`[StreamEngine] Failed to resolve MegaPlay for ${server.name}:`, e.message);
      }
    }

    // â”€â”€ Handler B: EchoVideo / AniWaves embeds â”€â”€
    if (!resolvedStreamUrl && (embedUrl.includes('echovideo') || embedUrl.includes('waves') || server.name.includes('Waves'))) {
      const wavesRes = await extractWavesDirectStream(embedUrl);
      if (wavesRes?.videoUrl) {
        resolvedStreamUrl = wavesRes.videoUrl;
        isHls = wavesRes.isHLS;
      }
    }

    // â”€â”€ Handler C.5: VidPlay / VidTube (AniVid) â”€â”€
    // Dedicated futoken-based request-signing decryptor â€” like MegaPlay but for VidPlay.
    // Replaces the slow iframe proxy fallback with a direct <500ms API call.
    if (!resolvedStreamUrl && isVidPlayEmbed(embedUrl)) {
      console.log(`[StreamEngine] VidPlay detected, using dedicated decryptor for: ${embedUrl.slice(0, 80)}`);
      try {
        const vidRes = await resolveVidPlayStream(embedUrl, serverReferer);
        if (vidRes?.videoUrl) {
          resolvedStreamUrl = vidRes.videoUrl;
          isHls = vidRes.isHLS !== false;
          serverReferer = vidRes.referer || serverReferer;
          if (vidRes.subtitles?.length > 0) {
            resolvedSubtitles = vidRes.subtitles;
          }
          console.log(`[StreamEngine] VidPlay decryptor SUCCESS: ${resolvedStreamUrl.slice(0, 80)}`);
        } else {
          console.warn('[StreamEngine] VidPlay decryptor returned no URL â€” falling back to universal scraper');
        }
      } catch (vidErr) {
        console.warn('[StreamEngine] VidPlay decryptor threw:', vidErr.message);
      }
    }

    // â”€â”€ Handler C: Universal Direct Embed Scraper Fallback â”€â”€
    if (!resolvedStreamUrl) {
      const low = (embedUrl || '').toLowerCase();
      // Skip dead endpoints and 404s to prevent mobile WebView freeze
      if (!low.includes('megaplay.buzz/stream/mal') && !low.includes('/404') && !server.videoUrl?.includes('404')) {
        const direct = await scrapeEmbedDirectly(embedUrl, serverReferer);
        if (direct?.videoUrl || direct?.url) {
          resolvedStreamUrl = direct.videoUrl || direct.url;
          isHls = direct.isHLS !== undefined ? direct.isHLS : (resolvedStreamUrl.includes('.m3u8'));
          if (direct.subtitles?.length) {
            resolvedSubtitles = direct.subtitles;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[StreamEngine] Error resolving ${server.name}:`, err.message);
  }

  // If this is a DUB server, merge any cached episode dialogue subtitles from SUB servers
  if (isDub) {
    const cachedSubs = getEpisodeSubtitles(animeId, episode);
    if (cachedSubs && cachedSubs.length > 0) {
      const seenFiles = new Set(resolvedSubtitles.map(s => s.file || s.url));
      const combined = [...resolvedSubtitles];
      for (const cs of cachedSubs) {
        const f = cs.file || cs.url;
        if (f && !seenFiles.has(f)) {
          seenFiles.add(f);
          combined.push(cs);
        }
      }
      resolvedSubtitles = combined;
    }
  }

  // If subtitles were resolved, save them to the episode cache for sharing across SUB/DUB
  if (resolvedSubtitles && resolvedSubtitles.length > 0) {
    saveEpisodeSubtitles(animeId, episode, resolvedSubtitles);
  }

  // Persist resolved data â€” always update cache with latest subtitles even if
  const isValidDirectStream = isDirectStreamUrl(resolvedStreamUrl);
  const resolvedData = {
    videoUrl: isValidDirectStream ? resolvedStreamUrl : server.videoUrl,
    subtitles: resolvedSubtitles,
    isHLS: Boolean(isValidDirectStream && isHls),
    referer: serverReferer
  };

  if (isValidDirectStream) {
    resolvedServerStreamCache.set(cacheKey, resolvedData);
    try {
      const storageEntry = { ...resolvedData, expires: Date.now() + TOKEN_CACHE_TTL }; // 20 min TTL — CDN tokens expire fast
      localStorage.setItem(`res_srv_v21_${cacheKey}`, JSON.stringify(storageEntry));
    } catch {}

    // âš¡ Instant Reload: Update the episode's cached server list so reloads are 0ms!
    updateCachedEpisodeServer(anime, episode, {
      ...server,
      ...resolvedData,
      isHLS: Boolean(isHls),
      _subtitlesPending: false
    });
  }

  if (isValidDirectStream) {
    return { ...server, ...resolvedData, _subtitlesPending: false };
  }

  // Stream URL not resolved but subtitles were fetched â€” return merged
  if (resolvedSubtitles.length > 0) {
    return { ...server, subtitles: resolvedSubtitles, _subtitlesPending: false };
  }

  return server;
  })();

  inFlightResolutions.set(cacheKey, resolutionPromise);
  inFlightResolutions.set(urlKey, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    inFlightResolutions.delete(cacheKey);
    inFlightResolutions.delete(urlKey);
  }
}

/**
 * Priority lineup strictly requested by user:
 * AniHD (1) â†’ AniVid (2) â†’ Neko-HD-2 (3) â†’ WavesHD (4) â†’ NekoHD (5)
 * HardSub variants are placed immediately after their softsub counterparts (+0.5).
 * DUB variants are placed after SUB servers (+100).
 */
export function getServerSortPriority(name) {
  const n = (name || '').trim();
  const low = n.toLowerCase();
  const isDub = low.includes('dub') || low.includes('(dub)');
  const isHard = low.includes('hardsub') || low.includes('hard');

  let base = 6;
  if (low.includes('hstream') || low.includes('hentaicity') || low.includes('hentai') || low.includes('adult')) {
    base = low.includes('hstream') ? 0.5 : 0.6; // Dedicated adult CDNs â€” top priority
  } else if (n.startsWith('AniHD') || low.includes('anihd')) {
    base = 1.0; // AniHD (PRIMARY DEFAULT SERVER â€” 1080p multi-quality HLS + 13 subtitles)
  } else if (n.startsWith('MegaPlay') || low.includes('megaplay')) {
    base = 1.2; // MegaPlay (PRIMARY DEFAULT SERVER â€” 1080p clean HLS)
  } else if (low.includes('vidstream-2') || low.includes('vidstream') || low.includes('neko-vidstream') || low.includes('vidstreaming')) {
    base = 1.4; // Vidstream / Vidstream-2 (1080p clean video)
  } else if (n.startsWith('AniVid') || low.includes('anivid')) {
    base = 1.6; // AniVid (VidPlay)
  } else if (low.includes('hd-2') || low.includes('neko-hd-2')) {
    base = 2.0; // HD-2 (Nexabloom direct 1080p HLS)
  } else if (n.startsWith('Waves') || low.includes('waves')) {
    base = 2.5; // WavesHD (AniWaves 1080p HLS)
  } else if (low.includes('streamhg') || low.includes('neko-streamhg')) {
    base = 3.5; // StreamHG (otakuhg direct 1080p HLS via unpackUniversalJS)
  } else if (low.includes('earnvids') || low.includes('neko-earnvids')) {
    base = 4.0; // Earnvids (otakuvid direct 1080p HLS via unpackUniversalJS)
  } else if (low === 'hd-1' || low.startsWith('hd-1') || low.includes('nekohd')) {
    base = 5.0; // HD-1 (AniNeko MP4 fallback â€” never default!)
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
    console.log('[Prefetch] Network is slow/congested â€” skipping next-episode prefetch to prevent rebuffering');
    return;
  }
  const epNum = Number(currentEpisode);
  if (isNaN(epNum) || epNum <= 0) return;
  const nextEp = epNum + 1;
  if (totalEps && nextEp > Number(totalEps)) return; // already at last episode

  const cacheKey = `${anime.id || anime.idMal || anime.title?.romaji || 'unknown'}-${nextEp}`;
  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Prefetch] Episode ${nextEp} already cached â€” skipping network prefetch`);
      return;
    }
  }

  console.log(`[Prefetch] Warming fast server list for episode ${nextEp}...`);
  // âš¡ CRITICAL FIX: onlyNeko = true!
  // Fast, lightweight query using AniNeko mapped slug or Cloudflare KV cache (<50ms).
  // NEVER fire heavy 3-scraper passes (AniWaves, AniKoto) or spawn WebViews in the background while video is actively playing!
  getAniNekoServers(anime, nextEp, null, true).then(res => {
    if (res?.servers?.length > 0) {
      console.log(`[Prefetch] Successfully pre-warmed ${res.servers.length} servers for episode ${nextEp}`);
    }
  }).catch(() => {});
}

const inFlightScrapes = new Map();

export async function getAniNekoServers(anime, episode, onServersFound, onlyNeko = false) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  
  // Check client cache & persistent localStorage first (0.05ms)
  const cachedServers = getCachedServers(anime, episode);
  if (cachedServers?.servers?.length > 0) {
    console.log(`[ClientEngine] [Cache Hit] Serving cached servers instantly (0.05ms) for: ${cacheKey}`);
    if (onServersFound) onServersFound(cachedServers.servers);
    return cachedServers;
  }

  // Deduplicate concurrent scrape requests for the same anime + episode
  const scrapeKey = `${cacheKey}_${onlyNeko}`;
  if (inFlightScrapes.has(scrapeKey)) {
    console.log(`[ClientEngine] Deduplicating concurrent scrape for: ${scrapeKey}`);
    const inFlightPromise = inFlightScrapes.get(scrapeKey);
    return inFlightPromise.then(res => {
      if (onServersFound && res?.servers?.length > 0) {
        onServersFound(res.servers);
      }
      return res;
    });
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

  const isAdultAnime = checkIsAdultAnime(anime);
  const isAdultMode = typeof localStorage === 'undefined' || localStorage.getItem('anilab_adult_mode') !== 'false';

  const combinedServers = [];
  const errors = [];
  let mainTitle = anime.title?.english || anime.title?.romaji || '';
  let activeSlug = '';
  const isMovie = anime.format === 'MOVIE';

  // â”€â”€ Smart Primary/Backup Server System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PRIMARY servers: one best server per scraper (AniNeko top-ranked, WavesHD, AniHD from AniKoto)
  // BACKUP servers:  all remaining servers from each scraper, stored and expanded lazily
  //                  only when the user clicks a primary server that fails to resolve.
  // This drastically reduces scraping load (3 requests â†’ shown immediately)
  // and prevents app freeze from massive parallel scrapes.

  // PRIMARY server names per scraper (ordered by preference)
  const NEKO_PRIMARY_SERVERS = ['Vidstream', 'Vidstream-2'];
  const WAVES_PRIMARY_SERVERS = ['WavesHD'];
  const KOTO_PRIMARY_SERVERS = ['AniHD', 'MegaPlay', 'AniVid'];

  // Backup server registry: cacheKey â†’ Array of remaining servers not yet shown
  // These are only injected into the UI when a primary server fails
  const backupServerRegistry = new Map();

  /**
   * Picks primary servers from a scraper's server list based on primaryNames.
   * Multiple distinct primary servers (e.g. AniHD + MegaPlay) are preserved.
   * Remaining servers are stored in backupServerRegistry for lazy expansion.
   */
  const selectPrimaryServer = (scraperLabel, allScraperServers, primaryNames) => {
    const validServers = allScraperServers.filter(s => {
      const sNameLow = (s.name || '').toLowerCase();
      const sEmbedLow = (s.embedUrl || '').toLowerCase();
      const sVideoLow = (s.videoUrl || '').toLowerCase();
      if (sNameLow.includes('dood') || sNameLow.includes('playmogo') || sEmbedLow.includes('dood') || sEmbedLow.includes('playmogo')) return false;
      if (sEmbedLow.includes('bibiemb') || sVideoLow.includes('bibiemb') || sVideoLow.includes('vibevibe.workers.dev')) return false;
      if (sEmbedLow.includes('vivibebe') || sVideoLow.includes('vivibebe') || sVideoLow.includes('ibyteimg')) return false;
      return true;
    });

    const subServers = validServers.filter(s => s.type !== 'dub');
    const dubServers = validServers.filter(s => s.type === 'dub');

    // Collect all designated primary sub servers
    const primarySubs = [];
    for (const pName of primaryNames) {
      const found = subServers.find(s => {
        const base = (s.name || '').replace(/\s*\(DUB\)\s*/i, '').trim();
        return base === pName || base.startsWith(pName);
      });
      if (found && !primarySubs.some(x => x.name === found.name)) {
        primarySubs.push(found);
      }
    }
    if (primarySubs.length === 0 && subServers.length > 0) {
      primarySubs.push([...subServers].sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name))[0]);
    }

    // Collect all designated primary dub servers
    const primaryDubs = [];
    for (const pName of primaryNames) {
      const found = dubServers.find(s => {
        const base = (s.name || '').replace(/\s*\(DUB\)\s*/i, '').trim();
        return base === pName || base.startsWith(pName);
      });
      if (found && !primaryDubs.some(x => x.name === found.name)) {
        primaryDubs.push(found);
      }
    }
    if (primaryDubs.length === 0 && dubServers.length > 0) {
      primaryDubs.push([...dubServers].sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name))[0]);
    }

    const primarySet = [...primarySubs, ...primaryDubs].filter(Boolean);
    const primaryNames_ = new Set(primarySet.map(s => `${s.name}_${s.type}`));
    const backups = validServers.filter(s => !primaryNames_.has(`${s.name}_${s.type}`));

    // Store backups for this scraper â€” will be injected later if needed
    if (backups.length > 0) {
      const existing = backupServerRegistry.get(cacheKey) || [];
      backupServerRegistry.set(cacheKey, [...existing, ...backups]);
    }

    console.log(`[ClientEngine] [${scraperLabel}] Primary: [${primarySet.map(s=>s.name+'('+s.type+')').join(', ')}] | Backups stored: ${backups.length}`);
    return primarySet;
  };

  const handleScraperResult = (data, primaryNames, scraperLabel) => {
    if (data?.servers?.length) {
      // Select primary servers and store backups
      const primaryServers = primaryNames
        ? selectPrimaryServer(scraperLabel, data.servers, primaryNames)
        : data.servers; // onlyNeko path: use all

      primaryServers.forEach(s => {
        const baseName = s.name.replace(/\s*\(DUB\)\s*/i, '').trim().split(' ')[0];
        const sNameLow = (s.name || '').toLowerCase();

        // ðŸ”ž Adult vs Mainstream strict server isolation
        if (isAdultAnime) {
          const isAdultServer = sNameLow.includes('hstream') || sNameLow.includes('hentaicity') || sNameLow.includes('hentai');
          if (!isAdultServer) return;
        } else {
          const isAdultServer = sNameLow.includes('hstream') || sNameLow.includes('hentaicity');
          if (isAdultServer) return;
        }

        const isAllowed = onlyNeko
          ? (baseName.startsWith('Neko') || baseName.startsWith('Vidstream') || baseName.startsWith('HD-') || baseName.startsWith('HStream') || baseName.startsWith('HentaiCity'))
          : (baseName.startsWith('Neko') || baseName.startsWith('Waves') || baseName.startsWith('HStream') || baseName.startsWith('HentaiCity') || ['WavesHD', 'AniHD', 'AniVid', 'MegaPlay', 'Vidstream', 'Vidstream-2', 'HD-1', 'HD-2', 'HStream-HD', 'HentaiCity'].includes(baseName));
        if (!isAllowed) return;

        // Prevent duplicate server items by normalized name + type
        const normName = (s.name || '').trim().toLowerCase();
        const normType = (s.type || 'sub').trim().toLowerCase();

        // 1. Check if same server name & type exists
        const existingIdx = combinedServers.findIndex(x =>
          (x.name || '').trim().toLowerCase() === normName &&
          (x.type || 'sub').trim().toLowerCase() === normType
        );

        if (existingIdx === -1) {
          combinedServers.push({ ...s, name: s.name, type: s.type || 'sub', _isBackupAvailable: (backupServerRegistry.get(cacheKey) || []).length > 0 });
        } else {
          // If already present, upgrade to HLS direct if the new entry has direct HLS
          if (s.isHLS && isDirectStreamUrl(s.videoUrl) && !combinedServers[existingIdx].isHLS) {
            combinedServers[existingIdx] = { ...combinedServers[existingIdx], ...s };
          }
        }
      });

      if (data.animeTitle) mainTitle = data.animeTitle;
      if (data.slug) activeSlug = data.slug;

      // âš¡ Sort by CDN priority: AniHD â†’ MegaPlay â†’ AniVid â†’ WavesHD â†’ HD-2 â†’ HD-1
      combinedServers.sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name));

      if (onServersFound) {
        onServersFound([...combinedServers]);
      }

      // ⚡ Instant Scraper-to-Stream Pipeline:
      // Immediately resolve BOTH top primary SUB and DUB servers in background.
      // When decrypted, re-notify onServersFound with direct HLS for instant playback and 0ms SUB <-> DUB switching!
      const topSub = combinedServers.find(s => s.type !== 'dub' && !s.isHLS && s.embedUrl && !s._resolving);
      const topDub = combinedServers.find(s => s.type === 'dub' && !s.isHLS && s.embedUrl && !s._resolving);
      const unresolvedCandidates = [topSub, topDub].filter(Boolean);

      unresolvedCandidates.forEach(srv => {
        srv._resolving = true;
        resolveSingleServer(srv, anime, episode).then(resolved => {
          srv._resolving = false;
          if (resolved?.videoUrl && isDirectStreamUrl(resolved.videoUrl)) {
            const idx = combinedServers.findIndex(x => x.name === srv.name && x.type === srv.type);
            if (idx !== -1) {
              const isHlsStream = Boolean(resolved.isHLS !== undefined ? resolved.isHLS : (resolved.videoUrl?.includes('.m3u8')));
              combinedServers[idx] = { ...combinedServers[idx], ...resolved, isHLS: isHlsStream };
              if (onServersFound) {
                onServersFound([...combinedServers]);
              }
            }
            // ⚡ Instant Speculative Pre-Buffering: Pre-load playlist text into RAM immediately!
            if (resolved.isHLS || resolved.videoUrl?.includes('.m3u8')) {
              prefetchM3U8AndFirstSegment(resolved.videoUrl, srv.headers || resolved.headers);
            }
          } else {
            // Primary failed — expand backups now so user has alternatives
            expandBackupServers(cacheKey, combinedServers, onServersFound);
          }
        }).catch(() => {
          srv._resolving = false;
          // Primary failed — expand backups
          expandBackupServers(cacheKey, combinedServers, onServersFound);
        });
      });

      // Update stream cache with primary servers (marked partial)
      try {
        const entry = {
          data: {
            ok: true,
            episode: Number(episode),
            servers: [...combinedServers],
            animeTitle: mainTitle,
            slug: activeSlug,
            isPartial: true,
            errors
          },
          timestamp: Date.now()
        };
        clientStreamCache.set(cacheKey, entry);
        sessionStorage.setItem(`stream_v21_cache_${cacheKey}`, JSON.stringify(entry));
        localStorage.setItem(`stream_v21_cache_${cacheKey}`, JSON.stringify(entry));
      } catch (_) {}
    }
  };

  /**
   * Expands backup servers into the active server list when a primary fails.
   * Injects stored backup servers and notifies the UI callback.
   * Idempotent â€” safe to call multiple times.
   */
  const expandBackupServers = (epCacheKey, activeServers, notifyFn) => {
    const backups = backupServerRegistry.get(epCacheKey);
    if (!backups || backups.length === 0) return;
    backupServerRegistry.delete(epCacheKey); // consume once

    let added = 0;
    for (const srv of backups) {
      const normName = (srv.name || '').trim().toLowerCase();
      const normType = (srv.type || 'sub').trim().toLowerCase();
      const alreadyPresent = activeServers.some(x =>
        (x.name || '').trim().toLowerCase() === normName &&
        (x.type || 'sub').trim().toLowerCase() === normType
      );
      if (!alreadyPresent) {
        activeServers.push({ ...srv, _fromBackup: true });
        added++;
      }
    }

    if (added > 0) {
      activeServers.sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name));
      console.log(`[ClientEngine] Backup expansion: +${added} servers added for episode ${episode}`);
      if (notifyFn) notifyFn([...activeServers]);
    }
  };

  // Single call per scraper â€” each scraper handles all title variants internally.
  const primaryTitle = anime.title?.romaji || anime.title?.english || titles[0];
  const tryScraper = async (scraperFn, scraperName, primaryNames) => {
    try {
      console.log(`[ClientEngine] ${scraperName} scraping ep ${episode} (primary: "${primaryTitle}")`);
      const data = await scraperFn(primaryTitle, episode, isMovie, anime.id, allTitles, 'english', anime.idMal);
      if (data?.servers?.length) { handleScraperResult(data, primaryNames, scraperName); return data; }
      errors.push(`${scraperName}: returned no servers`);
      return null;
    } catch (e) {
      console.warn(`[ClientEngine] ${scraperName} failed: ${e.message}`);
      errors.push(`${scraperName}: ${e.message}`);
      return null;
    }
  };

  // â”€â”€ ðŸ”ž Adult / Hentai anime disabled â”€â”€
  if (isAdultAnime) {
    console.warn('[ClientEngine] Adult/Hentai anime playback is currently disabled.');
    throw new Error('ADULT_CONTENT_DISABLED: Adult (18+) content is currently disabled in the app.');
  }

  // â”€â”€ Mainstream Non-Adult Anime Scraper Pipeline (Primary/Backup Tier System) â”€â”€
  // Phase 1: Fire all 3 scrapers in parallel but surface only ONE primary server
  //          per scraper. Backup servers are stored and injected lazily on failure.
  const nekoTimeout    = getAdaptiveTimeout(9000);
  const wavesTimeout   = getAdaptiveTimeout(8000);
  const anikotoTimeout = getAdaptiveTimeout(8000);

  // Inject minimal placeholders on slow networks so UI is not empty
  if (!onlyNeko && onServersFound) {
    const net = getNetworkProfile();
    if (net.isSlow || net.isCriticalSlow) {
      console.log('[ClientEngine] Slow network detected â€” injecting primary placeholder servers');
      onServersFound(KNOWN_SERVER_PLACEHOLDERS);
    }
  }

  const nekoPromise = tryScraper(scrapeAniNeko, 'AniNeko', NEKO_PRIMARY_SERVERS);

  let results;
  let raceWinner = 'all';
  if (onlyNeko) {
    // Fast path: fetch AniNeko only (prefetch path)
    results = await Promise.allSettled([
      runWithTimeout(nekoPromise, getAdaptiveTimeout(10000), 'AniNeko').catch(e => { console.warn(e.message); return null; })
    ]);
    // Graceful fallback: If AniNeko had no servers for this anime, query AniKoto & AniWaves
    if (combinedServers.length === 0) {
      const wavesPromise2   = tryScraper(scrapeAniWaves, 'AniWaves', WAVES_PRIMARY_SERVERS);
      const anikotoPromise2 = tryScraper(scrapeAniKoto, 'AniKoto', KOTO_PRIMARY_SERVERS);
      const fallbackResults = await Promise.allSettled([
        runWithTimeout(anikotoPromise2, getAdaptiveTimeout(8000), 'AniKoto').catch(() => null),
        runWithTimeout(wavesPromise2,   getAdaptiveTimeout(8000), 'AniWaves').catch(() => null),
      ]);
      results.push(...fallbackResults);
    }
  } else {
    // â”€â”€ Phase 1: Primary server scrape (all 3 scrapers in parallel) â”€â”€
    const wavesPromise   = tryScraper(scrapeAniWaves, 'AniWaves', WAVES_PRIMARY_SERVERS);
    const anikotoPromise = tryScraper(scrapeAniKoto, 'AniKoto', KOTO_PRIMARY_SERVERS);

    const allScrapers = [
      runWithTimeout(nekoPromise,    nekoTimeout,    'AniNeko').catch(e  => { console.warn(e.message); return null; }),
      runWithTimeout(wavesPromise,   wavesTimeout,   'AniWaves').catch(e => { console.warn(e.message); return null; }),
      runWithTimeout(anikotoPromise, anikotoTimeout, 'AniKoto').catch(e  => { console.warn(e.message); return null; }),
    ];

    // âš¡ Adaptive Early Resolution:
    // Return to UI as soon as we have â‰¥1 primary server from each scraper OR
    // after a short grace window â€” whichever comes first.
    // This prevents blocking the user while waiting for slow scrapers.
    const eagerResolutionPromise = new Promise((resolve) => {
      let timer = null;
      const onScraperDone = () => {
        if (combinedServers.length > 0 && !timer) {
          const subCount = combinedServers.filter(s => s.type === 'sub').length;
          const hasMultipleSources = subCount >= 2;
          const delay = hasMultipleSources ? 400 : 2000;
          timer = setTimeout(() => resolve('eager'), delay);
        }
      };

      nekoPromise.then(onScraperDone).catch(() => {});
      wavesPromise.then(onScraperDone).catch(() => {});
      anikotoPromise.then(onScraperDone).catch(() => {});
    });

    raceWinner = await Promise.race([
      Promise.allSettled(allScrapers).then(() => 'all'),
      eagerResolutionPromise
    ]);

    // âš¡ Background Merge: Ensure late-finishing scrapers persist their primaries AND notify UI!
    Promise.allSettled(allScrapers).then(() => {
      if (combinedServers.length > 0) {
        saveCachedServers(anime, episode, combinedServers, false);
        if (onServersFound) {
          onServersFound([...combinedServers]);
        }
      }
    }).catch(() => {});

    if (combinedServers.length === 0) {
      results = await Promise.allSettled(allScrapers);
    }
  }

  // â”€â”€ Phase 2 Safety Net: If we have fewer than 2 sub servers (e.g. AniWaves or AniKoto missing), expand backups â”€â”€
  const currentSubCount = combinedServers.filter(s => s.type === 'sub').length;
  if (currentSubCount < 2) {
    expandBackupServers(cacheKey, combinedServers, onServersFound);
  }

  if (combinedServers.length === 0) {
    throw new Error(`Failed to resolve any video servers. Details:\n${errors.join('\n')}`);
  }

  const isPartial = raceWinner === 'eager';
  saveCachedServers(anime, episode, combinedServers, isPartial);

  return {
    ok: true,
    servers: combinedServers,
    animeTitle: mainTitle,
    slug: activeSlug,
    isPartial,
    errors,
    // Expose backup expander so the player can trigger it on server failure
    expandBackups: () => expandBackupServers(cacheKey, combinedServers, onServersFound)
  };
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
    if (url.includes('kryntal.top') || url.includes('megaplay') || url.includes('megacloud') || url.includes('norami') || url.includes('imgnex') || url.includes('dokicloud') || url.includes('megap') || url.includes('shiora') || url.includes('mikora') || url.includes('akirax') || url.includes('quavex') || url.includes('nexabloom')) {
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
    const isMega = (url.includes('quavex') || url.includes('nexabloom') || url.includes('streamzone') || url.includes('silverorbit') || url.includes('mikora') || url.includes('akirax') || url.includes('imgnex') || url.includes('norami') || url.includes('shiora') || url.includes('megaplay') || url.includes('megacloud') || url.includes('anihd'));
    const effectiveReferer = isMega ? 'https://megaplay.buzz/' : (referer || 'https://megaplay.buzz/');

    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': effectiveReferer
      }
    });
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

  // Find the specific server by exact name + type, ensuring it is a real resolved server
  const srv = servers.find(s => s.name === serverName && s.type === serverType && !s.isPlaceholder && (s.embedUrl || s.videoUrl));

  if (!srv) {
    // Server not in cache or still unresolved — re-fetch all servers and try again
    console.log(`[StreamEngine] resolvePlaceholderServer: server "${serverName}" not in cache, fetching...`);
    const freshData = await getAniNekoServers(anime, episode, null, false);
    const freshSrv = freshData?.servers?.find(s => s.name === serverName && s.type === serverType && !s.isPlaceholder && (s.embedUrl || s.videoUrl));
    if (!freshSrv) throw new Error(`Server "${serverName}" not found after re-fetch`);
    return resolveSingleServer(freshSrv, anime, episode);
  }

  return resolveSingleServer(srv, anime, episode);
}

// â”€â”€ M3U8 Prefetch Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
export const playlistTextCache = new Map(); // url -> { text, timestamp }

/**
 * âš¡ Fast Streaming: Pre-fetches Master Playlist and Level Playlist text.
 * Warms playlist text in RAM for 0ms HLS initialization without downloading media chunks.
 */
export async function prefetchM3U8AndFirstSegment(videoUrl, referer) {
  if (!videoUrl || !videoUrl.startsWith('http')) return;
  if (getNetworkProfile().isSlow) return;

  try {
    // 1. Fetch & cache Master Playlist text
    const playlistText = await fetchM3U8Playlist(videoUrl, referer);
    if (!playlistText || typeof playlistText !== 'string') return;
    playlistTextCache.set(videoUrl, { text: playlistText, timestamp: Date.now() });

    const variants = parseMasterPlaylist(videoUrl, playlistText);
    if (variants.length > 0) {
      m3u8PrefetchCache.set(videoUrl, { variants, timestamp: Date.now() });
    }

    // 2. Fetch & cache primary Level Playlist text (align with AniPlayer fast-start)
    let levelUrl = null;
    if (variants && variants.length > 0) {
      const fastVariant = variants.find(v => v.label?.includes('480p') || v.label?.includes('360p')) || variants.find(v => v.label?.includes('720p')) || variants[0];
      levelUrl = fastVariant.url;
    } else {
      const lines = playlistText.split('\n');
      const levelLine = lines.find(l => l.trim().endsWith('.m3u8') || l.trim().includes('.m3u8'));
      if (levelLine) {
        levelUrl = new URL(levelLine.trim(), videoUrl).href;
      }
    }
    if (!levelUrl) return;

    const levelText = await fetchM3U8Playlist(levelUrl, referer);
    if (!levelText || typeof levelText !== 'string') return;
    playlistTextCache.set(levelUrl, { text: levelText, timestamp: Date.now() });

    // 3. Speculatively pre-warm segment 0 for instant 0ms playback
    const segLines = levelText.split('\n');
    const firstSegLine = segLines.find(l => {
      const trimmed = l.trim();
      return trimmed && !trimmed.startsWith('#') && (trimmed.includes('.ts') || trimmed.includes('.m4s') || trimmed.includes('.mp4') || trimmed.includes('/'));
    });
    if (firstSegLine) {
      const segUrl = new URL(firstSegLine.trim(), levelUrl).href;
      fetchFirstSegmentBuffer(segUrl, referer);
    }
  } catch (err) {
    // Silent non-blocking fail for background prefetch
  }
}

export const mediaSegmentCache = new Map(); // url -> { buffer, timestamp }
const MAX_MEDIA_SEGMENTS = 2; // Keep at most 2 segment buffers in RAM to avoid Android OOM
const SEGMENT_CACHE_TTL = 3 * 60 * 1000; // 3 min TTL

async function fetchFirstSegmentBuffer(segUrl, referer) {
  if (!segUrl || mediaSegmentCache.has(segUrl)) return;
  // âš¡ On native Android: Skip background segment binary downloads!
  // Downloading multi-megabyte Base64 strings across the Capacitor bridge while video is playing
  // exhausts the Dalvik/V8 heap and freezes the UI thread. AniPlayer's HlsLoader loads segments on demand.
  if (Capacitor.isNativePlatform?.()) return;

  try {
    const isMega = (segUrl.includes('quavex') || segUrl.includes('nexabloom') || segUrl.includes('streamzone') || segUrl.includes('silverorbit') || segUrl.includes('midnightvale') || segUrl.includes('hiddenvertex') || segUrl.includes('vertex') || segUrl.includes('mikora') || segUrl.includes('akirax') || segUrl.includes('imgnex') || segUrl.includes('norami') || segUrl.includes('shiora') || segUrl.includes('megaplay') || segUrl.includes('megacloud') || segUrl.includes('anihd'));
    const effectiveReferer = isMega ? 'https://megaplay.buzz/' : (referer || 'https://megaplay.buzz/');

    const resp = await fetch(segUrl, { headers: { Referer: effectiveReferer } });
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      if (buf && buf.byteLength > 0) {
        if (mediaSegmentCache.size >= MAX_MEDIA_SEGMENTS) {
          const oldestKey = mediaSegmentCache.keys().next().value;
          if (oldestKey) mediaSegmentCache.delete(oldestKey);
        }
        mediaSegmentCache.set(segUrl, { buffer: buf, timestamp: Date.now() });
      }
    }
  } catch (_) {}
}

export function prefetchM3U8(videoUrl, referer) {
  return prefetchM3U8AndFirstSegment(videoUrl, referer);
}

/**
 * Returns raw pre-fetched M3U8 playlist text if available in RAM.
 * Allows Hls.js loader to resolve master playlist in 0ms without network roundtrip.
 */
export function getCachedPlaylistText(videoUrl) {
  if (!videoUrl) return null;
  const target = Array.isArray(videoUrl) ? videoUrl[0] : (typeof videoUrl === 'string' ? videoUrl : '');
  if (!target) return null;
  const cached = playlistTextCache.get(target);
  if (cached && Date.now() - cached.timestamp < M3U8_PREFETCH_TTL) {
    return cached.text;
  }
  return null;
}

export function getCachedMediaSegment(fragUrl) {
  if (!fragUrl) return null;
  const target = Array.isArray(fragUrl) ? fragUrl[0] : (typeof fragUrl === 'string' ? fragUrl : '');
  if (!target) return null;
  const cached = mediaSegmentCache.get(target);
  if (cached && Date.now() - cached.timestamp < SEGMENT_CACHE_TTL) {
    return cached.buffer;
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
    console.log(`[Prefetch] M3U8 cache HIT â€” serving ${cached.variants.length} variants instantly`);
    return cached.variants;
  }
  return null;
}


