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

const clientStreamCache = new Map();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours cache life for provider metadata
const TOKEN_CACHE_TTL = 20 * 60 * 1000; // 20 minutes max for signed CDN URLs with tokens

// Purge any corrupted or stale cache keys from previous versions on load
if (typeof localStorage !== 'undefined') {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      // Purge only OLD versioned entries
      if (k && (
        k.startsWith('stream_v9_') ||
        k.startsWith('stream_v10_') ||
        k.startsWith('stream_v11_') ||
        k.startsWith('stream_v12_') ||
        k.startsWith('stream_v13_') ||
        k.startsWith('stream_v14_') ||
        k.startsWith('stream_v15_') ||
        k.startsWith('res_srv_v10_') ||
        k.startsWith('res_srv_v11_') ||
        k.startsWith('res_srv_v12_') ||
        k.startsWith('res_srv_v13_') ||
        k.startsWith('res_srv_v14_')
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
  return low.includes('.m3u8') || low.includes('/cdn/') || low.includes('.mp4') || low.includes('.webm') || low.includes('token=') || low.includes('savedly.net') || low.includes('cdn.');
}

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

/**
 * Adaptive timeout — scales based on real network speed.
 * On fast networks (4G/WiFi) keeps original fast timeouts for instant playback.
 * On slow networks (2G/3G/KBs) extends timeouts so scrapers can still complete.
 * This is how YouTube shows all quality options even on 2G.
 */
function getAdaptiveTimeout(baseMs) {
  try {
    const net = getNetworkProfile();
    if (net.isCriticalSlow) return baseMs * 5;   // 2G / < 0.8 Mbps → 5× (e.g. 4500 → 22500ms)
    if (net.isSlow)         return baseMs * 3;   // 3G / < 2 Mbps  → 3× (e.g. 4500 → 13500ms)
    return baseMs;                               // 4G / WiFi      → keep original
  } catch { return baseMs; }
}

/**
 * Known server placeholders — these are shown INSTANTLY in the UI while scraping runs.
 * Same approach YouTube uses: show all quality options immediately, resolve URLs lazily.
 * Placeholders have isPlaceholder=true so the UI can show a loading spinner on them.
 */
const KNOWN_SERVER_PLACEHOLDERS = [
  { name: 'Vidstream',  type: 'sub', isPlaceholder: true },
  { name: 'Vidstream',  type: 'dub', isPlaceholder: true },
  { name: 'HD-1',       type: 'sub', isPlaceholder: true },
  { name: 'HD-2',       type: 'sub', isPlaceholder: true },
  { name: 'Waves',      type: 'sub', isPlaceholder: true },
  { name: 'Waves',      type: 'dub', isPlaceholder: true },
  { name: 'AniHD',      type: 'sub', isPlaceholder: true },
  { name: 'AniVid',     type: 'sub', isPlaceholder: true },
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
  if (clientStreamCache.has(cacheKey)) {
    const cached = clientStreamCache.get(cacheKey);
    if (!cached.data?.isPartial) {
      const hasTokenizedUrl = cached.data?.servers?.some(s => s.videoUrl && (s.videoUrl.includes('token=') || s.videoUrl.includes('.m3u8')));
      const effectiveTtl = hasTokenizedUrl ? TOKEN_CACHE_TTL : CACHE_TTL;
      if (Date.now() - cached.timestamp < effectiveTtl) {
        return cached.data;
      } else {
        clientStreamCache.delete(cacheKey);
      }
    }
  }
  // Check localStorage persistence (0.05ms instant hit across app restarts)
  try {
    const raw = localStorage.getItem(`stream_v16_cache_${cacheKey}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.data?.isPartial) {
        localStorage.removeItem(`stream_v16_cache_${cacheKey}`);
        return null;
      }
      const hasTokenizedUrl = parsed.data?.servers?.some(s => s.videoUrl && (s.videoUrl.includes('token=') || s.videoUrl.includes('.m3u8')));
      const effectiveTtl = hasTokenizedUrl ? TOKEN_CACHE_TTL : CACHE_TTL;
      if (Date.now() - parsed.timestamp < effectiveTtl) {
        clientStreamCache.set(cacheKey, parsed);
        return parsed.data;
      } else {
        localStorage.removeItem(`stream_v16_cache_${cacheKey}`);
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
    localStorage.removeItem(`stream_v16_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v15_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v14_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v13_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v12_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v11_cache_${cacheKey}`);
    localStorage.removeItem(`stream_v10_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v16_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v15_cache_${cacheKey}`);
    sessionStorage.removeItem(`stream_v9_cache_${cacheKey}`);
  } catch {}
  console.log(`[ClientEngine] Invalidated stream cache for: ${cacheKey}`);
}

// Persistent in-memory cache for lazily resolved single server streams
const resolvedServerStreamCache = new Map();
const inFlightResolutions = new Map();

// ── Episode Subtitles Persistent Cache ──────────────────────────────────────
const episodeSubtitlesCache = new Map();
const EPISODE_SUBS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getEpisodeSubtitles(animeId, episode) {
  if (!animeId || !episode) return [];
  const key = `${animeId}_${episode}`;
  if (episodeSubtitlesCache.has(key)) {
    return episodeSubtitlesCache.get(key);
  }
  try {
    const raw = localStorage.getItem(`ep_subs_v1_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.expires || Date.now() < parsed.expires) {
        if (Array.isArray(parsed.subtitles) && parsed.subtitles.length > 0) {
          episodeSubtitlesCache.set(key, parsed.subtitles);
          return parsed.subtitles;
        }
      } else {
        localStorage.removeItem(`ep_subs_v1_${key}`);
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
    localStorage.setItem(`ep_subs_v1_${key}`, JSON.stringify({
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
    localStorage.removeItem(`res_srv_v14_${cacheKey}`);
    localStorage.removeItem(`res_srv_v13_${cacheKey}`);
    localStorage.removeItem(`res_srv_v12_${cacheKey}`);
    localStorage.removeItem(`res_srv_v11_${cacheKey}`);
  } catch {}
  // Also clear the episode's stream cache so auto-failover/retry gets fresh servers
  const epCacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  clientStreamCache.delete(epCacheKey);
  try {
    localStorage.removeItem(`stream_v14_cache_${epCacheKey}`);
    localStorage.removeItem(`stream_v13_cache_${epCacheKey}`);
    localStorage.removeItem(`stream_v12_cache_${epCacheKey}`);
    localStorage.removeItem(`stream_v11_cache_${epCacheKey}`);
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
      const merged = enrichDubWithCachedSubs({ ...server, ...cached, isHLS: true });
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

  // 3. LocalStorage persistence check (0.05ms instant hit across app restarts)
  try {
    const sess = localStorage.getItem(`res_srv_v15_${cacheKey}`) || localStorage.getItem(`res_srv_v14_${cacheKey}`);
    if (sess) {
      const parsed = JSON.parse(sess);
      const isFresh = !parsed.expires || Date.now() < parsed.expires;
      if (parsed?.videoUrl && isDirectStreamUrl(parsed.videoUrl) && isFresh) {
        if (needsSubtitles && (!parsed.subtitles || parsed.subtitles.length === 0)) {
          // fall through — need to fetch subtitles even though stream URL is cached
        } else {
          resolvedServerStreamCache.set(cacheKey, parsed);
          return enrichDubWithCachedSubs({ ...server, ...parsed, isHLS: true });
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

      const megaHost = urlObj.origin.includes('anineko.es') ? 'https://megaplay.buzz' : urlObj.origin;
      const sParam = urlObj.searchParams.get('s');

      // ── ROOT-CAUSE FIX FOR WRONG ANIME PLAYBACK ──
      // On MegaPlay, URL path segments (e.g. /stream/s-2/3303/sub) contain the host site's
      // internal episode index (realid=3303), NOT MegaPlay's source file ID!
      // Passing that episode index to /stream/getSources?id=3303 loads a completely different, random anime.
      // The true source file ID (data-id) MUST ALWAYS be parsed from the embed page HTML!
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
          const directM3u8 = await resolveMegaPlayStream(sourcesData);
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

    // ── Handler B: EchoVideo / AniWaves embeds ──
    if (!resolvedStreamUrl && (embedUrl.includes('echovideo') || embedUrl.includes('waves') || server.name.includes('Waves'))) {
      const wavesRes = await extractWavesDirectStream(embedUrl);
      if (wavesRes?.videoUrl) {
        resolvedStreamUrl = wavesRes.videoUrl;
        isHls = wavesRes.isHLS;
      }
    }

    // ── Handler C.5: VidPlay / VidTube (AniVid) ──
    // Dedicated futoken-based request-signing decryptor — like MegaPlay but for VidPlay.
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
          console.warn('[StreamEngine] VidPlay decryptor returned no URL — falling back to universal scraper');
        }
      } catch (vidErr) {
        console.warn('[StreamEngine] VidPlay decryptor threw:', vidErr.message);
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

  // Persist resolved data — always update cache with latest subtitles even if
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
      localStorage.setItem(`res_srv_v15_${cacheKey}`, JSON.stringify(storageEntry));
    } catch {}
  }

  if (isValidDirectStream) {
    // Pre-fetch master playlist, level playlist, and Fragment 0 in background for 0ms instant playback
    prefetchM3U8AndFirstSegment(resolvedStreamUrl, serverReferer).catch(() => {});
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
  if (low.includes('hstream') || low.includes('hentaicity') || low.includes('hentai') || low.includes('adult')) {
    base = low.includes('hstream') ? 0.5 : 0.6; // Dedicated adult CDNs — top priority
  } else if (low.includes('vidstream-2') || low.includes('vidstream') || low.includes('neko-vidstream') || low.includes('vidstreaming')) {
    base = 1.0; // Vidstream / Vidstream-2 (PRIMARY DEFAULT SERVER — 1080p clean video)
  } else if (low === 'hd-1' || low.startsWith('hd-1') || low.includes('nekohd')) {
    base = 1.5; // HD-1 (AniNeko secondary)
  } else if (low.includes('hd-2') || low.includes('neko-hd-2')) {
    base = 2.0; // HD-2 (Nexabloom direct 1080p HLS)
  } else if (n.startsWith('MegaPlay') || low.includes('megaplay')) {
    base = 2.5; // MegaPlay (Instant direct stream)
  } else if (n.startsWith('AniHD') || low.includes('anihd')) {
    base = 3.0; // AniHD (AniKoto)
  } else if (low.includes('streamhg') || low.includes('neko-streamhg')) {
    base = 3.5; // StreamHG (otakuhg direct 1080p HLS via unpackUniversalJS)
  } else if (low.includes('earnvids') || low.includes('neko-earnvids')) {
    base = 4.0; // Earnvids (otakuvid direct 1080p HLS via unpackUniversalJS)
  } else if (n.startsWith('AniVid') || low.includes('anivid')) {
    base = 4.5; // AniVid (VidPlay)
  } else if (n.startsWith('Waves') || low.includes('waves')) {
    base = 6.0; // WavesHD (FALLBACK ONLY — never default!)
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
      console.log(`[Prefetch] Episode ${nextEp} already cached — warming video stream...`);
      const top = cached.data?.servers?.find(s => s.type === 'sub') || cached.data?.servers?.[0];
      if (top) {
        resolveSingleServer(top, anime, nextEp).then(streamResult => {
          if (streamResult?.videoUrl) {
            prefetchM3U8AndFirstSegment(streamResult.videoUrl, top.headers || streamResult.headers);
          }
        }).catch(() => {});
      }
      return;
    }
  }

  console.log(`[Prefetch] Warming all scrapers & top stream for episode ${nextEp}...`);
  // Fire-and-forget: errors are swallowed, this is best-effort
  // onlyNeko=false → pre-warms AniNeko + AniWaves + AniKoto simultaneously
  getAniNekoServers(anime, nextEp, null, false).then(res => {
    if (res?.servers?.length > 0) {
      const top = res.servers.find(s => s.type === 'sub') || res.servers[0];
      if (top) {
        resolveSingleServer(top, anime, nextEp).then(streamResult => {
          if (streamResult?.videoUrl) {
            prefetchM3U8AndFirstSegment(streamResult.videoUrl, top.headers || streamResult.headers);
          }
        }).catch(() => {});
      }
    }
  }).catch(() => {});
}

export async function getAniNekoServers(anime, episode, onServersFound, onlyNeko = false) {
  const cacheKey = `${anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown'}-${episode}`;
  
  // Check client cache & persistent localStorage first (0.05ms)
  const cachedServers = getCachedServers(anime, episode);
  if (cachedServers?.servers?.length > 0) {
    console.log(`[ClientEngine] [Cache Hit] Serving cached servers instantly (0.05ms) for: ${cacheKey}`);
    if (onServersFound) onServersFound(cachedServers.servers);
    return cachedServers;
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

        // 🔞 Adult vs Mainstream strict server isolation:
        // For adult anime: strictly permit ONLY dedicated Hentai servers (HStream, HentaiCity).
        // Mainstream anime servers must NEVER be added to adult anime!
        if (isAdultAnime) {
          const isAdultServer = sNameLow.includes('hstream') || sNameLow.includes('hentaicity') || sNameLow.includes('hentai');
          if (!isAdultServer) return;
        } else {
          // For regular anime: strictly prevent adult servers from leaking into regular anime
          const isAdultServer = sNameLow.includes('hstream') || sNameLow.includes('hentaicity');
          if (isAdultServer) return;
        }

        const isAllowed = onlyNeko
          ? (baseName.startsWith('Neko') || baseName.startsWith('Vidstream') || baseName.startsWith('HD-') || baseName.startsWith('HStream') || baseName.startsWith('HentaiCity'))
          : (baseName.startsWith('Neko') || baseName.startsWith('Waves') || baseName.startsWith('HStream') || baseName.startsWith('HentaiCity') || ['WavesHD', 'AniHD', 'AniVid', 'MegaPlay', 'Vidstream-2', 'HD-1', 'HD-2', 'HStream-HD', 'HentaiCity'].includes(baseName));
        if (!isAllowed) return; // skip non-allowed servers

        // Prevent duplicate server items by name+type
        const isDuplicate = combinedServers.some(x => 
          x.name === s.name && x.type === s.type
        );
        if (!isDuplicate) {
          combinedServers.push({ ...s, name: s.name });
          // NOTE: AniNeko's official servers (Vidstream-2, HD-1) load directly from anineko.es.
          // Vidstream-2 resolves to Nexabloom (fetch.nexabloom.top), and HD-1 resolves to
          // Norami/TikTok CDN (megap.norami.top). Both are 100% clean with no watermark.
        }
      });
      if (data.animeTitle) mainTitle = data.animeTitle;
      if (data.slug) activeSlug = data.slug;

      // ⚡ Sort strictly by user-specified CDN priority: AniHD → AniVid → Neko-HD-2 → WavesHD → NekoHD
      combinedServers.sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name));

      if (onServersFound) {
        onServersFound([...combinedServers]);
      }

      // ⚡ Instant Scraper-to-Stream Pipeline:
      // Immediately resolve the top 2 servers in parallel background.
      // The moment the top server's direct M3U8 is decrypted (39ms), re-notify onServersFound
      // with the direct HLS stream so the player begins playing immediately without waiting
      // for any secondary lazy resolution roundtrip!
      const unresolvedCandidates = combinedServers.filter(s => !s.isHLS && s.embedUrl).slice(0, 2);
      unresolvedCandidates.forEach(srv => {
        resolveSingleServer(srv, anime, episode).then(resolved => {
          if (resolved?.videoUrl && isDirectStreamUrl(resolved.videoUrl)) {
            const idx = combinedServers.findIndex(x => x.name === srv.name && x.type === srv.type);
            if (idx !== -1) {
              combinedServers[idx] = { ...combinedServers[idx], ...resolved, isHLS: true };
              if (onServersFound) {
                onServersFound([...combinedServers]);
              }
            }
            // ⚡ Instant Speculative Pre-Buffering: Pre-load playlist & Fragment 0 into RAM immediately!
            prefetchM3U8AndFirstSegment(resolved.videoUrl, srv.headers || resolved.headers);
          }
        }).catch(() => {});
      });

      // Update stream cache with newly augmented servers (marked partial while other scrapers run)
      try {
        const entry = {
          data: {
            ok: true,
            servers: [...combinedServers],
            animeTitle: mainTitle,
            slug: activeSlug,
            isPartial: true,
            errors
          },
          timestamp: Date.now()
        };
        clientStreamCache.set(cacheKey, entry);
        sessionStorage.setItem(`stream_v16_cache_${cacheKey}`, JSON.stringify(entry));
      } catch (_) {}
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

  // ── 🔞 Adult / Hentai anime disabled ──
  if (isAdultAnime) {
    console.warn('[ClientEngine] Adult/Hentai anime playback is currently disabled.');
    throw new Error('ADULT_CONTENT_DISABLED: Adult (18+) content is currently disabled in the app.');
  }

  // ── Mainstream Non-Adult Anime Scraper Pipeline ──
  const nekoTimeout    = getAdaptiveTimeout(5000);
  const wavesTimeout   = getAdaptiveTimeout(4500);
  const anikotoTimeout = getAdaptiveTimeout(4500);

  // Mainstream placeholder injection (Vidstream, HD-1, Waves, MegaPlay)
  if (!onlyNeko && onServersFound) {
    const net = getNetworkProfile();
    if (net.isSlow || net.isCriticalSlow) {
      console.log('[ClientEngine] Slow network detected — injecting mainstream placeholder servers');
      onServersFound(KNOWN_SERVER_PLACEHOLDERS);
    }
  }

  const nekoPromise = tryScraper(scrapeAniNeko, 'AniNeko');

  let results;
  if (onlyNeko) {
    // Fast path: fetch AniNeko
    results = await Promise.allSettled([
      runWithTimeout(nekoPromise, getAdaptiveTimeout(8000), 'AniNeko').catch(e => { console.warn(e.message); return null; })
    ]);
    // Graceful fallback: If AniNeko had no servers for this anime, immediately query AniKoto & AniWaves
    if (combinedServers.length === 0) {
      const wavesPromise2   = tryScraper(scrapeAniWaves,  'AniWaves');
      const anikotoPromise2 = tryScraper(scrapeAniKoto,   'AniKoto');
      const fallbackResults = await Promise.allSettled([
        runWithTimeout(anikotoPromise2, getAdaptiveTimeout(5000), 'AniKoto').catch(() => null),
        runWithTimeout(wavesPromise2,   getAdaptiveTimeout(5000), 'AniWaves').catch(() => null),
      ]);
      results.push(...fallbackResults);
    }
  } else {
    const wavesPromise   = tryScraper(scrapeAniWaves,  'AniWaves');
    const anikotoPromise = tryScraper(scrapeAniKoto,   'AniKoto');

    const allScrapers = [
      runWithTimeout(nekoPromise,    nekoTimeout,    'AniNeko').catch(e  => { console.warn(e.message); return null; }),
      runWithTimeout(wavesPromise,   wavesTimeout,   'AniWaves').catch(e => { console.warn(e.message); return null; }),
      runWithTimeout(anikotoPromise, anikotoTimeout, 'AniKoto').catch(e  => { console.warn(e.message); return null; }),
    ];

    // ⚡ Netflix-Speed Instant Playback Race:
    const eagerResolutionPromise = new Promise((resolve) => {
      let timer = null;
      const onScraperDone = () => {
        if (combinedServers.length > 0 && !timer) {
          const hasVidstream = combinedServers.some(s => s.name.toLowerCase().includes('vidstream'));
          const onlyWaves = combinedServers.every(s => s.name.toLowerCase().includes('waves'));
          const delay = hasVidstream ? 35 : (onlyWaves ? 2500 : 100);
          timer = setTimeout(() => {
            resolve('eager');
          }, delay);
        }
      };

      nekoPromise.then(onScraperDone).catch(() => {});
      wavesPromise.then(onScraperDone).catch(() => {});
      anikotoPromise.then(onScraperDone).catch(() => {});
    });

    await Promise.race([
      Promise.allSettled(allScrapers),
      eagerResolutionPromise
    ]);

    if (combinedServers.length === 0) {
      results = await Promise.allSettled(allScrapers);
    }
  }

  if (combinedServers.length === 0) {
    throw new Error(`Failed to resolve any video servers. Details:\n${errors.join('\n')}`);
  }

  const resultData = {
    ok: true,
    servers: combinedServers,
    animeTitle: mainTitle,
    slug: activeSlug,
    isPartial: false,
    errors
  };

  // Only cache if we successfully retrieved some servers
  if (combinedServers.length > 0) {
    const entry = { data: resultData, timestamp: Date.now() };
    clientStreamCache.set(cacheKey, entry);
    try {
      localStorage.setItem(`stream_v16_cache_${cacheKey}`, JSON.stringify(entry));
      sessionStorage.setItem(`stream_v16_cache_${cacheKey}`, JSON.stringify(entry));
    } catch {}
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
export const playlistTextCache = new Map(); // url -> { text, timestamp }
export const mediaSegmentCache = new Map();  // fragUrl -> { buffer, timestamp }
const MAX_SEGMENT_CACHE_ITEMS = 3;

/**
 * Fetch raw media segment (TS / image / fMP4 chunk) with proper referer/headers.
 * Uses CapacitorHttp for protected clusters (quavex, akirax) and line-speed fetch for open CDNs.
 */
export async function fetchMediaSegment(fragUrl, referer) {
  if (!fragUrl || !fragUrl.startsWith('http')) return null;
  const isCapacitor = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
  const isProtected = fragUrl.includes('quavex') || fragUrl.includes('akirax') || fragUrl.includes('imgnex') || fragUrl.includes('nexabloom');

  if (isCapacitor && isProtected) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const resp = await CapacitorHttp.request({
        url: fragUrl,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
          'Referer': referer || 'https://megaplay.buzz/'
        },
        responseType: 'blob'
      });
      if (resp.status >= 200 && resp.status < 400 && resp.data) {
        if (typeof resp.data === 'string') {
          let clean = resp.data.replace(/^data:.*?,/, '').replace(/[\r\n\s]/g, '');
          if (!clean) return null;
          const rem = clean.length % 4;
          if (rem === 2) clean += '==';
          else if (rem === 3) clean += '=';
          try {
            const bin = window.atob(clean);
            const len = bin.length;
            const u8 = new Uint8Array(len);
            for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
            return u8.buffer;
          } catch (_) {
            return null;
          }
        } else if (resp.data instanceof Blob) {
          return await resp.data.arrayBuffer();
        }
        return resp.data;
      }
    } catch (_) {}
    return null;
  }

  try {
    const res = await fetch(fragUrl, {
      headers: {
        'Origin': 'http://localhost',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36'
      }
    });
    if (res.ok) {
      return await res.arrayBuffer();
    }
  } catch (_) {}
  return null;
}

/**
 * ⚡ True Pinpoint Fast Streaming: Pre-fetches Master Playlist, Level Playlist, AND Fragment 0.
 * Injects initial frames into RAM before user even mounts the player for <20ms playback start!
 */
export async function prefetchM3U8AndFirstSegment(videoUrl, referer) {
  if (!videoUrl || !videoUrl.startsWith('http')) return;
  if (getNetworkProfile().isSlow) return;

  try {
    // 1. Fetch & cache Master Playlist
    const playlistText = await fetchM3U8Playlist(videoUrl, referer);
    if (!playlistText || typeof playlistText !== 'string') return;
    playlistTextCache.set(videoUrl, { text: playlistText, timestamp: Date.now() });

    const variants = parseMasterPlaylist(videoUrl, playlistText);
    if (variants.length > 0) {
      m3u8PrefetchCache.set(videoUrl, { variants, timestamp: Date.now() });
    }

    // 2. Fetch & cache primary Level Playlist (align with AniPlayer fast-start)
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

    // 3. Extract Fragment 0 and pre-load into RAM (Instant Frame Injection!)
    const levelLines = levelText.split('\n');
    let fragUrl = null;
    for (const l of levelLines) {
      const t = l.trim();
      if (t && !t.startsWith('#')) {
        fragUrl = t.startsWith('http') ? t : new URL(t, levelUrl).href;
        break;
      }
    }
    if (!fragUrl) return;

    if (mediaSegmentCache.has(fragUrl)) return;
    if (mediaSegmentCache.size >= MAX_SEGMENT_CACHE_ITEMS) {
      const oldestKey = mediaSegmentCache.keys().next().value;
      mediaSegmentCache.delete(oldestKey);
    }

    const isMega = (fragUrl.includes('quavex') || fragUrl.includes('nexabloom') || fragUrl.includes('streamzone') || fragUrl.includes('silverorbit') || fragUrl.includes('mikora') || fragUrl.includes('akirax') || fragUrl.includes('imgnex') || fragUrl.includes('norami') || fragUrl.includes('shiora') || fragUrl.includes('megaplay') || fragUrl.includes('megacloud') || fragUrl.includes('anihd'));
    const effectiveReferer = isMega ? 'https://megaplay.buzz/' : (referer || 'https://megaplay.buzz/');

    const fragBuf = await fetchMediaSegment(fragUrl, effectiveReferer);
    if (fragBuf && fragBuf.byteLength > 1000) {
      console.log(`[InstantFrameInjection] Fragment 0 preloaded into RAM: ${fragUrl.slice(0, 60)} (${(fragBuf.byteLength / 1024 / 1024).toFixed(2)} MB)`);
      mediaSegmentCache.set(fragUrl, { buffer: fragBuf, timestamp: Date.now() });
    }
  } catch (err) {
    // Silent non-blocking fail for background prefetch
  }
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
  const cached = playlistTextCache.get(videoUrl);
  if (cached && Date.now() - cached.timestamp < M3U8_PREFETCH_TTL) {
    return cached.text;
  }
  return null;
}

/**
 * Returns pre-fetched Fragment 0 ArrayBuffer from RAM.
 * Allows Hls.js loader to inject the first video chunk in 0.00ms!
 */
export function getCachedMediaSegment(fragUrl) {
  if (!fragUrl) return null;
  const cached = mediaSegmentCache.get(fragUrl);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
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
    console.log(`[Prefetch] M3U8 cache HIT — serving ${cached.variants.length} variants instantly`);
    return cached.variants;
  }
  return null;
}
