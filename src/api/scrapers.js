import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { scrapeEmbedNative, solveCloudflareNative, getCookiesForUrlNative, fetchViaWebViewNative, extractEmbedIdsNative, unpackUniversalJS } from './embedScraper.js';
import { resolveMegaPlayStream } from '../utils/megaplayDecrypt.js';
import {
  norm,
  cleanAnimeTitle,
  extractSeasonNumber,
  extractPartNumber,
  isMovieIndicator,
  isSpecialIndicator,
  diceSimilarity,
  tokenSimilarity,
  calculateMatchScore,
  generateCanonicalSlugs,
  generateSearchQueries,
  INDUSTRY_MAPPINGS,
  getVerifiedSlug,
  saveVerifiedSlug,
  getResolvedMappedSlug,
  fetchMalSyncCandidateSlugs,
  resolveAmbiguityWithAI,
  findExactNekoSlug,
  clearVerifiedSlug,
  VERIFIED_SLUGS_KEY
} from '../utils/slugMatcher.js';
import { getSlugMapping, batchPrefetchMappings, reportSuccessfulPlay } from '../utils/slugMapClient.js';


const isCapacitorApp = typeof window !== 'undefined' && (
  Capacitor.isNativePlatform() || 
  (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
  (!window.location.port && window.location.hostname === 'localhost')
);

const nativeCookieJar = new Map();

export async function syncNativeCookies(url) {
  try {
    const origin = new URL(url).origin;
    const cookies = await getCookiesForUrlNative(url);
    if (cookies) {
      nativeCookieJar.set(origin, cookies);
      console.log(`[CookieSync] Synced cookies for ${origin}:`, cookies.slice(0, 50));
    }
  } catch (e) {
    console.warn(`[CookieSync] Failed to sync cookies for ${url}:`, e.message);
  }
}

export let ANINEKO = 'https://anineko.es';
export let AW = 'https://aniwaves.ru';
export let ANIMETSU = ''; // DEAD: animetsu.net domain is parked/gone
export let ANIKOTO = 'https://anikoto.cz';


export function setDynamicDomains(newDomains) {
  if (!newDomains) return;
  if (newDomains.neko) {
    // anineko.to is retired/broken (database connection refused); always enforce working anineko.es
    ANINEKO = newDomains.neko.includes('anineko.to') ? 'https://anineko.es' : newDomains.neko;
  }
  if (newDomains.waves) AW = newDomains.waves;
  if (newDomains.animetsu) ANIMETSU = newDomains.animetsu;
  if (newDomains.anikoto) ANIKOTO = newDomains.anikoto;
  console.log('[Scrapers] Dynamic domains updated:', { ANINEKO, AW, ANIMETSU, ANIKOTO });
}

// ─── ID-Based Cross-Reference Mapping System ───
// Built from industry standard verified catalog + dynamic runtime store + persistent auto-learning
const STATIC_MAPPINGS = INDUSTRY_MAPPINGS;

let dynamicMappings = {};

export function setDynamicMappings(mappings) {
  if (mappings) {
    dynamicMappings = mappings;
    console.log('[Scrapers] Dynamic ID mappings loaded:', Object.keys(mappings).length);
  }
}

export { getVerifiedSlug, saveVerifiedSlug };

export function getMappedSlug(animeId, provider) {
  if (!animeId) return null;
  return getResolvedMappedSlug(animeId, provider, dynamicMappings);
}

export function getMappedId(animeId, provider) {
  if (!animeId) return null;
  const idStr = String(animeId);
  return dynamicMappings[idStr]?.[provider + 'Id'] || INDUSTRY_MAPPINGS[idStr]?.[provider + 'Id'] || null;
}


const UA = isCapacitorApp 
  ? 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const STREAM_PROXY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_STREAM_PROXY_URL) || '';
const PROXY = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PROXY_URL) || '';

function formatProxyUrl(targetUrl, referer) {
  if (!STREAM_PROXY) return targetUrl;
  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  if (isNative && (STREAM_PROXY.includes('localhost') || STREAM_PROXY.includes('127.0.0.1'))) {
    return targetUrl;
  }
  const hasQuery = STREAM_PROXY.includes('?');
  if (hasQuery) {
    return `${STREAM_PROXY}&url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
  }
  const endsWithSlash = STREAM_PROXY.endsWith('/');
  if (endsWithSlash) {
    return `${STREAM_PROXY}?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
  }
  if (STREAM_PROXY.endsWith('hls') || STREAM_PROXY.endsWith('segment')) {
    return `${STREAM_PROXY}?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
  }
  return `${STREAM_PROXY}/?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
}

function formatIframeProxyUrl(targetUrl, referer) {
  if (!PROXY) return targetUrl;
  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  if (isNative && (PROXY.includes('localhost') || PROXY.includes('127.0.0.1'))) {
    return targetUrl;
  }
  return `${PROXY}/api/iframe-proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
}

export function formatSubtitleProxyUrl(targetUrl, referer) {
  if (!STREAM_PROXY) return targetUrl;
  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  if (isNative && (STREAM_PROXY.includes('localhost') || STREAM_PROXY.includes('127.0.0.1'))) {
    // On native: encode both URL + referer so AniPlayer's native fetch path can
    // extract the correct Referer header. Without this, the raw VTT URL alone
    // causes 403s because the subtitle CDN requires the embed origin as Referer.
    return `subtitle-native://fetch?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
  }
  try {
    const urlObj = new URL(STREAM_PROXY);
    return `${urlObj.origin}/api/stream/subtitle?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
  } catch {
    return `/api/stream/subtitle?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
  }
}


const wavesSearchCache = new Map();
const nekoSearchCache = new Map();
const animetsuSearchCache = new Map();
const animetsuEpsCache = new Map(); // Cache episode list per anime ID to skip re-fetch

// Ã¢â€â‚¬Ã¢â€â‚¬ localStorage-backed persistent cache helpers Ã¢â€â‚¬Ã¢â€â‚¬
// Persist search results across app restarts (6-hour TTL)
const LS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function lsSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + LS_CACHE_TTL }));
  } catch {
    // Quota exceeded — evict expired anisearch_ entries, then retry
    try {
      const now = Date.now();
      const searchKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('anisearch_')) searchKeys.push(k);
      }
      // Remove expired entries first
      let freed = 0;
      for (const k of searchKeys) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const { expires } = JSON.parse(raw);
            if (!expires || now > expires) { localStorage.removeItem(k); freed++; }
          }
        } catch { localStorage.removeItem(k); freed++; }
      }
      // If nothing expired, evict oldest half
      if (freed === 0 && searchKeys.length > 4) {
        searchKeys.slice(0, Math.ceil(searchKeys.length / 2)).forEach(k => localStorage.removeItem(k));
      }
      localStorage.setItem(key, JSON.stringify({ data, expires: now + LS_CACHE_TTL }));
    } catch { /* Storage strictly blocked — memory cache still works */ }
  }
}

// Purge legacy v1 anisearch cache
if (typeof localStorage !== 'undefined') {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('anisearch_') && !k.startsWith('anisearch_v2_')) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

function lsSearchKey(scraper, title) {
  return `anisearch_v2_${scraper}_${title.toLowerCase().replace(/\s+/g, '_').slice(0, 60)}`;
}

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Helper Matching Functions ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬



function extractSeason(t) {
  const s = t.toLowerCase();
  let m;
  if ((m = s.match(/\bseason\s*(\d+)\b/)))    return parseInt(m[1]);
  if ((m = s.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/))) return parseInt(m[1]);
  if ((m = s.match(/\bpart\s*(\d+)\b/)))       return parseInt(m[1]);
  if ((m = s.match(/\bs(\d+)\b/)))             return parseInt(m[1]);
  
  if (/\biv\b/.test(s)) return 4;
  if (/\biii\b/.test(s)) return 3;
  if (/\bii\b/.test(s)) return 2;

  // Match any trailing space followed by a number at the end of the clean title
  // e.g. "Oshi no Ko 2", "Oshi no Ko 2 (Dub)", "Oshi no Ko 2nd"
  const cleanTitle = s.replace(/\b(dub|sub|uncensored|uncut|tv|movie|ova|ona|special|recap|film|series|audio|multi)\b/g, '').trim();
  if ((m = cleanTitle.match(/\b(\d+)(?:nd|rd|th|st)?$/))) {
    return parseInt(m[1]);
  }

  return 1;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Cross-language trigram helpers (for English Ã¢â€ â€ Japanese-romaji bridging) Ã¢â€â‚¬Ã¢â€â‚¬

function getTrigrams(str) {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.length < 3) return s.split('');
  const grams = [];
  for (let i = 0; i < s.length - 2; i++) grams.push(s.slice(i, i + 3));
  return grams;
}

function trigramSimilarity(a, b) {
  const t1 = getTrigrams(a);
  const t2 = getTrigrams(b);
  if (!t1.length || !t2.length) return 0;
  const s1 = new Set(t1);
  let overlap = 0;
  for (const g of t2) { if (s1.has(g)) overlap++; }
  return (2 * overlap) / (t1.length + t2.length);
}

/**
 * Cross-language title score: handles English Ã¢â€ â€ Japanese-romanized mismatch.
 * When word-level matching fails because the site uses a different naming system
 * (e.g. "Komi Can't Communicate" vs "Komi-san wa, Comyushou desu."),
 * use first-word-prefix + season matching as the signal.
 *
 * Full-title trigram similarity CANNOT be used here because cross-language pairs
 * share almost no character trigrams ("communicate" vs "comyushou" = ~0% overlap).
 * Instead, anime titles in different languages almost always share the same character
 * name at the start (e.g. "Komi" in both "Komi Can't Communicate" and "Komi-san wa...").
 *
 * Requirements to activate the fallback:
 *  1. Same season number must match.
 *  2. First significant word must share at least its first 3 characters (character name anchor).
 *  3. Neither title may have a "movie/film" marker if the other doesn't.
 *
 * Returns 0.55 — above the 0.35 cross-lang acceptance floor but safely below the
 * 0.75 same-language threshold, so it never beats a proper word-intersection match.
 */
function crossLangScore(resultTitle, queryTitle) {
  const rn = norm(resultTitle);
  const qn = norm(queryTitle);

  // Season must match before we even attempt cross-lang scoring
  if (extractSeason(rn) !== extractSeason(qn)) return 0;

  // Movie/TV consistency Ã¢â‚¬â€ don't cross-match movies with series
  const resultIsMovie = /\b(movie|film)\b/i.test(rn);
  const queryIsMovie  = /\b(movie|film)\b/i.test(qn);
  if (resultIsMovie !== queryIsMovie) return 0;

  // The first meaningful word must be shared Ã¢â‚¬â€ anchors the character/show name
  // e.g. both "Komi Can't Communicate" and "Komi-san wa, Comyushou desu." start with "komi"
  const firstWord = s => s.replace(/^\s*(the|a|an)\s+/i, '').split(/\s+/)[0] || '';
  const rFirst = firstWord(rn);
  const qFirst = firstWord(qn);
  if (rFirst.length < 2 || qFirst.length < 2) return 0;

  // First words must share at least their first 3 characters (same character name prefix)
  const prefixLen = Math.min(rFirst.length, qFirst.length, 4);
  if (rFirst.slice(0, prefixLen) !== qFirst.slice(0, prefixLen)) return 0;

  // Also verify the first words themselves are reasonably similar (both romaji/english
  // for the same character name are usually identical or very close: "komi" = "komi")
  // Use trigrams on just the first words as a secondary quality gate
  const firstWordSim = trigramSimilarity(rFirst, qFirst);
  // Threshold raised to 0.70 (was 0.50) to prevent false positives where unrelated anime
  // share a common 3-char prefix (e.g. "Another" vs "Attack on Titan" both starting with "a").
  if (firstWordSim < 0.70) return 0;

  // Additional guard: first words must be >= 4 chars long. Short first words like "a",
  // "on", "the" pass the prefix check trivially but carry no semantic signal.
  if (rFirst.length < 4 || qFirst.length < 4) return 0;

  // All checks passed - this is a plausible cross-language match.
  // Return a fixed 0.55 confidence: above the 0.35 acceptance floor but safely below
  // the 0.88 same-language threshold so it never beats a proper word-intersection match.
  return 0.55;
}

function titleScore(resultTitle, queryTitle, isMovie = false) {
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(queryTitle)) return 0.7;

  const rn = norm(resultTitle);
  const qn = norm(queryTitle);

  const rSeason = extractSeason(rn);
  const qSeason = extractSeason(qn);
  if (rSeason !== qSeason) return 0;

  // Gate spin-offs, summaries, recaps, previews, side-stories (Strict two-way gate)
  const recapKeywords = /\b(recap|summary|preview|side\s*story|special|specials|ova|ona)\b/i;
  const resultHasRecap = recapKeywords.test(resultTitle) || recapKeywords.test(rn);
  const queryHasRecap = recapKeywords.test(queryTitle) || recapKeywords.test(qn);
  if (resultHasRecap !== queryHasRecap) return 0;

  // Gate mini-episodes, shorts, chibi, spinoffs, and break time specials (Strict two-way gate)
  const miniKeywords = /\b(mini|short|shorts|chibi|break\s*time|breaktime|petit|petite|spin\s*off|spinoff)\b/i;
  const resultHasMini = miniKeywords.test(resultTitle) || miniKeywords.test(rn);
  const queryHasMini = miniKeywords.test(queryTitle) || miniKeywords.test(qn);
  if (resultHasMini !== queryHasMini) return 0;

  // Check if result or query title mentions "movie" or "film"
  const resultHasMovie = /\b(movie|film)\b/i.test(resultTitle) || /\b(movie|film)\b/i.test(rn);

  // If query is a TV show (isMovie = false) but result title mentions Movie -> Reject
  if (!isMovie && resultHasMovie && !/\b(movie|film)\b/i.test(queryTitle)) {
    return 0;
  }

  // If query is a Movie (isMovie = true) but result mentions TV, episodes, or season -> Reject
  if (isMovie && /\b(tv|series|season|episodes|ep)\b/i.test(resultTitle) && !resultHasMovie) {
    return 0;
  }

  const GENERIC_WORDS = new Set([
    'the', 'and', 'of', 'in', 'a', 'an', 'to', 'is', 'it', 'on', 'for',
    'no', 'wa', 'ga', 'wo', 'ni', 'de', 'mo', 'to', 'ya', 'ka',
    'girl', 'boy', 'guy', 'man', 'woman', 'people', 'person',
    'anime', 'manga', 'tv', 'sub', 'dub', 'ova', 'ona', 'movie', 'film',
  ]);

  const strip = t =>
    t
      .replace(/[''ÃŠÂ¼Ã‚Â´`']/g, '')     // remove all forms of apostrophes first: journey's Ã¢â€ â€™ journeys
      .replace(/\b(season|part|s)\s*\d+\b/gi, '')
      .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
      .replace(/\b(season|part|arc|s)\s*\d+\b/gi, '')
      .replace(/\b(sub|dub|uncensored|uncut|tv|movie|ova|ona|special|specials|multi|audio|recap|summary|preview|side\s*story|mini|short|shorts|chibi|break\s*time|breaktime|petit|petite|spin\s*off|spinoff|arc)\b/gi, '')
      .trim();

  const qWords = strip(qn).split(/\s+/).filter(w => w.length > 1);
  const rWords = strip(rn).split(/\s+/).filter(w => w.length > 1);

  if (!qWords.length || !rWords.length) return 0;

  const intersection = qWords.filter(w =>
    rWords.includes(w) || rWords.some(rw => trigramSimilarity(w, rw) >= 0.7)
  );

  // Ã¢â€â‚¬Ã¢â€â‚¬ Cross-language fallback Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // When word-intersection is zero, the two titles may be the same anime but in
  // different naming systems (English vs Japanese-romanized). Use trigram similarity
  // as a soft bridge. This is capped at 0.75 so it never beats a true word-match.
  if (intersection.length === 0) {
    return crossLangScore(resultTitle, queryTitle);
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  const score = (2 * intersection.length) / (qWords.length + rWords.length);

  // Hard-block FORWARD: if result has ANY significant extra word not in the query title,
  // it's a different show (spin-off, sequel subtitle, etc.) Ã¢â‚¬â€ return 0.
  // Standalone numbers (years like 2011, counts) are excluded.
  const extraWords = rWords.filter(w => !qWords.includes(w));
  const nonMetaExtra = extraWords.filter(w => {
    if (GENERIC_WORDS.has(w)) return false;
    if (/^(season|part|episode|ep|tv|movie|ova|ona|special|specials|dub|sub|uncensored|uncut|multi|audio)$/i.test(w)) return false;
    if (/^\d+$/.test(w)) return false;

    // Fuzzy matching for spelling variants / typos (e.g. comyushou vs komyushou)
    const isFuzzyMatch = qWords.some(qw => trigramSimilarity(w, qw) >= 0.7);
    if (isFuzzyMatch) return false;

    return true;
  });
  if (nonMetaExtra.length > 0) return 0;

  // Hard-block REVERSE: if the query has significant unique words (5+ chars, non-generic)
  // that are completely absent from the result, it's a different (shorter-named) show.
  // e.g. query="...Nanoha EXCEEDS Gun BlazeVengeance" vs result="...Nanoha" Ã¢â‚¬â€ block it.
  const uniqueQueryWords = qWords.filter(w =>
    w.length >= 5
    && !GENERIC_WORDS.has(w)
    && !/^(season|part|episode|ep|tv|movie|ova|ona|special|specials|dub|sub|uncensored|uncut|multi|audio)$/i.test(w)
    && !/^\d+$/.test(w)
  );
  if (uniqueQueryWords.length > 0) {
    const missingFromResult = uniqueQueryWords.filter(w => !rWords.includes(w));
    // If ANY unique discriminating word from the query is absent from the result Ã¢â€ â€™ hard block
    if (missingFromResult.length > 0) {
      // Fuzzy matching for missing words as well
      const missingNonFuzzy = missingFromResult.filter(qw =>
        !rWords.some(rw => trigramSimilarity(qw, rw) >= 0.7)
      );
      if (missingNonFuzzy.length > 0) return 0;
    }
  }

  return score;
}

function getLongestWord(title) {
  const cleaned = title.replace(/\b(?:season|part|s|ep|episode|recap|ova|ona|movie)\b/gi, '');
  const words = cleaned.split(/[^a-zA-Z0-9]/).filter(w => w.length > 2);
  if (!words.length) return title;
  return words.reduce((a, b) => a.length > b.length ? a : b);
}

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Helper matching and validation ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬

function isCloudflareChallenge(text) {
  const lower = text.toLowerCase();
  const isCfBlock = lower.includes('cloudflare') && (
    lower.includes('cf-challenge') ||
    lower.includes('ray id:') ||
    lower.includes('just a moment') ||
    lower.includes('checking your browser') ||
    lower.includes('attention required!') ||
    lower.includes('cf-cookie-error') ||
    lower.includes('challenge-platform')
  );
  const isDdosGuard = lower.includes('ddos-guard') && (
    lower.includes('ddos-guard.net') ||
    lower.includes('checking your browser')
  );
  return isCfBlock || isDdosGuard;
}

function isDatabaseOutage(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('sqlstate') ||
    lower.includes('connection refused') ||
    lower.includes('phalcon\\db') ||
    lower.includes('pdo->__construct') ||
    lower.includes('database error') ||
    lower.includes('mysql connection failed')
  );
}

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Generic Fetch Helper with Headers ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬

export async function clientFetch(url, opts = {}) {
  if (isCapacitorApp) {
    const useWebView = opts.useWebView;
    if (useWebView) {
      console.log(`[clientFetch] Executing fetch via WebView for: ${url}`);
      try {
        const origin = new URL(url).origin;
        const html = await fetchViaWebViewNative(url, opts.referer, origin);
        if (html && !isCloudflareChallenge(html)) {
          return html;
        }
        console.warn(`[clientFetch] WebView fetch failed or hit Cloudflare for: ${url}`);
      } catch (e) {
        console.error(`[clientFetch] WebView fetch error for ${url}:`, e.message);
      }
    }

    try {
      const urlObj = new URL(url);
      const origin = urlObj.origin;
      const cachedCookies = nativeCookieJar.get(origin);
      
      const reqHeaders = {
        'User-Agent': UA,
        ...(opts.referer ? { 'Referer': opts.referer } : {}),
        ...(opts.headers || {}),
      };
      
      if (cachedCookies) {
        reqHeaders['Cookie'] = cachedCookies;
        console.log(`[CookieInject] Injected cookies for ${origin}:`, cachedCookies.slice(0, 45));
      }

      const response = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: reqHeaders,
        connectTimeout: opts.timeout || 15000,
        readTimeout: opts.timeout || 15000
      });
      
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      if (response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      if (isCloudflareChallenge(text)) {
        throw new Error('Cloudflare challenge detected');
      }
      if (isDatabaseOutage(text)) {
        throw new Error('Upstream provider database outage (SQLSTATE / Connection refused)');
      }
      return text;
    } catch (e) {
      console.error(`[CapacitorHttp] Direct Request failed for ${url}:`, e.message);
      throw e;
    }
  }

  // If running in local desktop browser dev environment, proxy through the local backend proxy to bypass CORS!
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    try {
      const proxyUrl = `/api/scrape?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(opts.referer || new URL(url).origin)}`;
      console.log(`[LocalProxy] Scraping via backend proxy: ${url}`);
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(opts.timeout || 60000),
        headers: opts.headers
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from proxy`);
      
      const pText = await res.text();
      if (isCloudflareChallenge(pText)) throw new Error('Cloudflare block from proxy');
      if (isDatabaseOutage(pText)) throw new Error('Upstream provider database outage (SQLSTATE / Connection refused)');
      return pText;
    } catch (e) {
      console.warn(`[LocalProxy] Fetch failed for ${url} via proxy:`, e.message);
    }
  }

  // Fallback direct request
  const headers = {
    'User-Agent': UA,
    ...(opts.referer ? { 'Referer': opts.referer } : {}),
    ...opts.headers
  };
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 60000),
    headers
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const fText = await res.text();
  if (isCloudflareChallenge(fText)) throw new Error('Cloudflare challenge detected');
  if (isDatabaseOutage(fText)) throw new Error('Upstream provider database outage (SQLSTATE / Connection refused)');
  return fText;
}

async function awSearch(title, isMovie = false) {
  // 1. Primary queries: exact title and clean title (MUST NOT strip season or part numbers!)
  const fullTitle = title.trim();
  const cleanTitle = cleanAnimeTitle(title);

  // Auxiliary shortened strategies ONLY as secondary fallback if full title yields no hits
  const engWords = cleanTitle.split(/[^a-zA-Z0-9]/).filter(w =>
    w.length > 3 && !/^(the|and|with|from|that|this|into|over|under|behind|you)$/i.test(w)
  );
  const longestWord = engWords.length ? engWords.reduce((a, b) => a.length >= b.length ? a : b) : null;
  const firstTwo = cleanTitle.split(' ').slice(0, 2).join(' ');
  const firstThree = cleanTitle.split(' ').slice(0, 3).join(' ');

  // Helper: fetch and parse one search keyword
  async function tryKeyword(keyword) {
    if (!keyword || keyword.length < 2) return [];
    try {
      const rawText = await clientFetch(`${AW}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
        referer: AW,
        timeout: 5000,
      });
      const parsed = JSON.parse(rawText);
      if (parsed.status === 404 || !parsed.result?.html) return [];
      const html = parsed.result.html;
      const itemRe = /href="\/watch\/([\w%-]+-(\d+))"[\s\S]*?class="name d-title"[^>]*>([^<]+)<\/div>/g;
      let m;
      const localResults = [];
      while ((m = itemRe.exec(html)) !== null) {
        localResults.push({ slug: m[1], animeId: m[2], animeTitle: m[3].trim() });
      }
      if (localResults.length === 0) {
        const slugRe = /href="\/watch\/([\w-]+-(\d+))"/g;
        while ((m = slugRe.exec(html)) !== null) {
          localResults.push({ slug: m[1], animeId: m[2], animeTitle: m[1].replace(/-\d+$/, '').replace(/-/g, ' ') });
        }
      }
      return localResults;
    } catch (_) {
      return [];
    }
  }

  // Scoring function: evaluate candidates against target title
  function scoreCandidates(cands) {
    let best = null, maxScore = -1;
    for (const r of cands) {
      if (norm(r.animeTitle) === norm(title)) return { best: r, score: 1.0 };

      let score = calculateMatchScore({ title: r.animeTitle, slug: r.slug }, title, isMovie);
      const slugText = r.slug.replace(/-\d+$/, '').replace(/-/g, ' ');
      score = Math.max(score, calculateMatchScore({ title: slugText, slug: r.slug }, title, isMovie));
      if (score > maxScore) { maxScore = score; best = r; }
    }
    return { best, score: maxScore };
  }

  // PASS 1: Try exact full title & clean title first!
  const primaryKeywords = [fullTitle, cleanTitle].filter((s, i, a) => s && a.indexOf(s) === i);
  const pass1Results = await Promise.all(primaryKeywords.map(kw => tryKeyword(kw)));
  const combinedPass1 = pass1Results.flat();

  if (combinedPass1.length > 0) {
    const { best: pBest, score: pScore } = scoreCandidates(combinedPass1);
    if (pBest && pScore >= 0.85) {
      return pBest;
    }
  }

  // PASS 2: If full title had no confident match, try secondary expansion keywords
  const secondaryKeywords = [firstThree, firstTwo, longestWord].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i && !primaryKeywords.includes(s));
  const pass2Results = await Promise.all(secondaryKeywords.map(kw => tryKeyword(kw)));
  const allResults = [...combinedPass1, ...pass2Results.flat()];

  if (allResults.length === 0) throw new Error(`Anime "${title}" not found on AniWaves`);

  let { best, score: maxScore } = scoreCandidates(allResults);

  // AI Ambiguity Resolution (Gemini Nano on-device + Micro-Vector AI fallback)
  if (allResults.length > 1 && maxScore < 0.85) {
    try {
      const candidates = allResults.map(r => ({ slug: r.slug, title: r.animeTitle }));
      const aiMatch = await resolveAmbiguityWithAI({ title, isMovie }, candidates);
      if (aiMatch && aiMatch.slug) {
        const found = allResults.find(r => r.slug === aiMatch.slug);
        if (found) {
          best = found;
          maxScore = Math.max(maxScore, 0.90);
          console.log(`[AniWaves] AI Ambiguity Resolution HIT (${aiMatch.source}):`, best.slug);
        }
      }
    } catch (aiErr) {
      console.warn('[AniWaves] AI disambiguation error:', aiErr.message);
    }
  }

  // Strict confidence threshold — must match the full anime name with high confidence
  // Raised from 0.80 → 0.85 to prevent accepting wrong-anime near-misses.
  if (!best || maxScore < 0.85) {
    throw new Error(`No confident match on AniWaves for "${title}" (best score: ${maxScore.toFixed(2)})`);
  }
  return best;
}

// Persistent cache for Waves server lists: animeId/episode -> { servers, expires }
// TTL = 25 minutes — stored in localStorage so it survives app restarts (zero re-scrape on revisit)
const WAVES_CACHE_TTL_MS = 25 * 60 * 1000;

function getWavesServersCache(animeId, episode) {
  try {
    const key = `waves_servers_${animeId}_${episode}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { localStorage.removeItem(key); return null; }
    console.log(`[AniWaves] Cache HIT for servers ep${episode} — instant play`);
    return data;
  } catch { return null; }
}

function setWavesServersCache(animeId, episode, data) {
  try {
    const key = `waves_servers_${animeId}_${episode}`;
    localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + WAVES_CACHE_TTL_MS }));
  } catch {}
}

function getWavesEmbedCache(linkId) {
  try {
    const key = `waves_embed_${linkId}`;
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!raw) return null;
    const { url, expires } = JSON.parse(raw);
    if (Date.now() > expires) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      return null;
    }
    return url;
  } catch { return null; }
}

function setWavesEmbedCache(linkId, url) {
  try {
    const key = `waves_embed_${linkId}`;
    localStorage.setItem(key, JSON.stringify({ url, expires: Date.now() + WAVES_CACHE_TTL_MS }));
  } catch {}
}

// Fetch episode list for an anime and map episode number → internal episode ID
// AniWaves (aniwatch-based) uses internal episode IDs in its server API, not episode numbers.
// Per-episode IDs are persisted in localStorage with a 24h TTL — survives app restarts.
const WAVES_EPID_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
async function awGetEpisodeId(animeId, episodeNumber, slug) {
  const cacheKey = `waves_epid_${animeId}_${episodeNumber}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id && Date.now() < parsed.expires) return parsed.id;
        localStorage.removeItem(cacheKey);
      } catch {
        // Legacy plain-string value (pre-migration) — still valid
        return raw;
      }
    }
  } catch {}

  const referer = slug ? `${AW}/watch/${slug}` : AW;
  const text = await clientFetch(`${AW}/ajax/anime/episode-list?id=${animeId}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': referer },
    timeout: 4000,
  });
  // AniWaves episode list returns empty body for some IDs (CDN quirk).
  // In this case, we fall back to episode number directly (awGetServers uses eps= param anyway).
  if (!text || text.trim().length === 0) throw new Error('Empty episode list response');
  const parsed = JSON.parse(text);
  if (!parsed.status || !parsed.result) throw new Error('No episode list');

    const html = parsed.result;
  let foundId = null;

  // 1. Direct O(1) Boyer-Moore needle search for requested episode
  const epNeedle = `data-number="${episodeNumber}"`;
  const idx = html.indexOf(epNeedle);
  if (idx !== -1) {
    const start = Math.max(0, idx - 150);
    const snippet = html.slice(start, idx + 250);
    const idMatch = snippet.match(/data-id="([^"]+)"/);
    if (idMatch) foundId = idMatch[1];
  }

  // 2. Fallback: targeted regex scan with immediate break upon match
  if (!foundId) {
    const epRe = /data-id="([^"]+)"[^>]*data-number="(\d+)"|data-number="(\d+)"[^>]*data-id="([^"]+)"/g;
    let m;
    while ((m = epRe.exec(html)) !== null) {
      const id  = m[1] || m[4];
      const num = parseInt(m[2] || m[3], 10);
      if (num === episodeNumber && id) {
        foundId = id;
        break;
      }
    }
  }

  if (!foundId) throw new Error(`Episode ${episodeNumber} ID not found in list`);
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ id: foundId, expires: Date.now() + WAVES_EPID_CACHE_TTL_MS }));
  } catch {}
  return foundId;
}

async function awGetServers(animeId, episode, slug) {
  const referer = slug ? `${AW}/watch/${slug}` : AW;

  // AniWaves natively takes the episode number in the eps parameter
  const epsParam = episode;

  const url = `${AW}/ajax/server/list?servers=${animeId}&eps=${epsParam}`;
  const text = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': referer },
    timeout: 6000,
  });
  const parsed = JSON.parse(text);
  if (parsed.status !== 200 || !parsed.result) {
    throw new Error(`No servers for ep ${episode}`);
  }

  const html = parsed.result;
  const servers = [];
  
  // Robust parsing: split by the start of each type block to avoid fragile regex div nesting issues
  const sections = html.split(/<div\s+class="type"/i);
  for (const section of sections) {
    const typeMatch = section.match(/data-type="(sub|dub)"/i);
    if (!typeMatch) continue;
    const type = typeMatch[1].toLowerCase();

    const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]+?)<\/li>/g;
    let liMatch;
    while ((liMatch = liRe.exec(section)) !== null) {
      const name = liMatch[2].replace(/<[^>]+>/g, '').trim();
      servers.push({ type, linkId: liMatch[1], serverName: name });
    }
  }

  return servers;
}

async function awGetEmbedUrl(linkId, watchPageSlug) {
  // Check embed cache first — same linkId always resolves to same URL within session
  const cached = getWavesEmbedCache(linkId);
  if (cached) {
    console.log(`[AniWaves] Embed cache HIT for linkId ${linkId}`);
    return cached;
  }

  const url = `${AW}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`;
  const text = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': `${AW}/watch/${watchPageSlug}` },
    timeout: 4000,
  });
  const parsed = JSON.parse(text);
  if (parsed.status !== 200 || !parsed.result?.url) throw new Error(`No embed URL`);
  setWavesEmbedCache(linkId, parsed.result.url);
  return parsed.result.url;
}

/**
 * Direct HLS extractor for AniWaves EchoVideo embeds (play.echovideo.ru / embed-1/...)
 * EchoVideo provides an instant /getSources API that returns the raw .m3u8 CDN stream URL.
 */
export async function extractWavesDirectStream(embedUrl) {
  if (!embedUrl) return null;
  try {
    const match = embedUrl.match(/\/embed-\d+\/([^\/\?#]+)/);
    if (match && match[1]) {
      const id = match[1];
      const urlObj = new URL(embedUrl);
      const basePath = urlObj.pathname.replace(/\/([^\/\?#]+)$/, '');
      const apiUrl = `${urlObj.origin}${basePath}/getSources?id=${encodeURIComponent(id)}`;

      console.log(`[AniWaves] Extracting direct stream from EchoVideo: ${apiUrl}`);
      const resText = await clientFetch(apiUrl, {
        headers: {
          'Referer': embedUrl,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, */*'
        },
        timeout: 4500
      });

      const data = typeof resText === 'string' ? JSON.parse(resText) : resText;
      let streamUrl = null;
      let isHlsStream = false;

      if (typeof data?.sources === 'string') {
        streamUrl = data.sources;
        isHlsStream = streamUrl.includes('.m3u8');
      } else if (Array.isArray(data?.sources) && data.sources.length > 0) {
        const first = data.sources[0];
        streamUrl = typeof first === 'string' ? first : (first?.file || first?.url);
        isHlsStream = streamUrl ? streamUrl.includes('.m3u8') : false;
      } else if (data?.sources && typeof data.sources === 'object') {
        // Quality map: HD > HQ > 1080p > 720p > SD
        const qualityList = data.sources.HD || data.sources.HQ || data.sources['1080p'] || data.sources['720p'] || data.sources.SD || Object.values(data.sources)[0];
        if (Array.isArray(qualityList) && qualityList.length > 0) {
          streamUrl = qualityList[0];
        } else if (typeof qualityList === 'string') {
          streamUrl = qualityList;
        }
        isHlsStream = streamUrl ? streamUrl.includes('.m3u8') : false;
      }

      if (streamUrl) {
        console.log(`[AniWaves] Successfully extracted direct WavesHD stream: ${streamUrl.slice(0, 60)}... (isHLS: ${isHlsStream})`);
        return {
          videoUrl: streamUrl,
          isHLS: isHlsStream
        };
      }
    }
  } catch (err) {
    console.warn(`[AniWaves] Failed to extract direct stream from ${embedUrl}:`, err.message);
  }
  return null;
}

export async function scrapeAniWaves(title, episode, isMovie = false, animeId = null, allTitles = null, language = 'english') {
  const missKey = String(animeId || title).toLowerCase();
  if (wavesMissCache.has(missKey)) {
    const exp = wavesMissCache.get(missKey);
    if (Date.now() < exp) {
      throw new Error(`[AniWaves] Cached negative hit for "${title}" — skipping (0ms)`);
    }
  }

  let searchResult = wavesSearchCache.get(title);

  // ── Step 0: Cloudflare Edge Server Mapping (<15ms, zero search) ──
  if (!searchResult && animeId) {
    const serverMapping = await getSlugMapping(animeId);
    if (serverMapping?.waves && (serverMapping.status === 'verified' || serverMapping.status === 'partial')) {
      const idMatch = serverMapping.waves.match(/-(\d+)$/);
      if (idMatch) {
        console.log(`[AniWaves] 🌐 Server slug HIT for ${animeId}: "${serverMapping.waves}" (id: ${idMatch[1]})`);
        searchResult = { slug: serverMapping.waves, animeId: idMatch[1], animeTitle: title };
      }
    }
  }
  
  // Try industry-standard ID-based cross-referencing first
  if (!searchResult) {
    const mappedSlug = getMappedSlug(animeId, 'waves');
    if (mappedSlug) {
      const idMatch = mappedSlug.match(/-(\d+)$/);
      if (idMatch) {
        searchResult = { slug: mappedSlug, animeId: idMatch[1], animeTitle: title };
        console.log(`[AniWaves] ID Cross-Ref HIT for AniList ID ${animeId} ➔ "${mappedSlug}" (id: ${idMatch[1]})`);
      }
    }
  }
  
  if (!searchResult) {
    // Check localStorage before hitting the network
    const lsCached = lsGet(lsSearchKey('waves', title));
    if (lsCached) {
      console.log(`[AniWaves] localStorage cache HIT for "${title}" — instant`);
      searchResult = lsCached;
      wavesSearchCache.set(title, searchResult);
    } else {
      // Parallel race: all title variants fire simultaneously — first match wins.
      const titlesToTry = allTitles?.length ? allTitles : [title];
      try {
        searchResult = await Promise.any(
          titlesToTry.map(t =>
            awSearch(t, isMovie).then(r => {
              wavesSearchCache.set(title, r);
              lsSet(lsSearchKey('waves', title), r);
              return r;
            })
          )
        );
      } catch {
        wavesMissCache.set(missKey, Date.now() + MISS_TTL);
        throw new Error(`Anime "${title}" not found on AniWaves (tried ${titlesToTry.length} title variants)`);
      }
    }
  }
  const { slug, animeId: wavesId, animeTitle } = searchResult;

  // Check session cache — skip all API calls if same episode was already fetched
  const cached = getWavesServersCache(wavesId, episode);
  if (cached) return { servers: cached, animeTitle, slug };

  const rawServers = await awGetServers(wavesId, episode, slug);
  const servers = [];

  // Parallelize sub and dub server resolution with direct HLS extraction
  const [subRes, dubRes] = await Promise.all([
    (async () => {
      const subServers = rawServers.filter(s => s.type === 'sub').slice(0, 2);
      for (const s of subServers) {
        try {
          const embedUrl = await awGetEmbedUrl(s.linkId, slug);
          let directHls = false;
          let finalVideoUrl = formatIframeProxyUrl(embedUrl, `${AW}/watch/${slug}`);

          // 1. Direct HLS extraction from EchoVideo (instant line-speed playback)
          try {
            const stream = await extractWavesDirectStream(embedUrl);
            if (stream?.videoUrl) {
              finalVideoUrl = stream.videoUrl;
              directHls = true;
            }
          } catch (_) {}

          // 2. Fallback: Packed JS unpacking
          if (!directHls) {
            try {
              const embedHtml = await clientFetch(embedUrl, { referer: `${AW}/watch/${slug}`, timeout: 3500 });
              const unpacked = unpackUniversalJS(embedHtml);
              if (unpacked) {
                finalVideoUrl = unpacked;
                directHls = true;
                console.log(`[AniWaves] Direct HLS unpacked for WavesHD: ${finalVideoUrl.slice(0, 60)}...`);
              }
            } catch (_) {}
          }

          return {
            name: 'WavesHD',
            videoUrl: finalVideoUrl,
            type: 'sub',
            embedUrl,
            serverName: s.serverName,
            referer: directHls ? embedUrl : `${AW}/watch/${slug}`,
            isHLS: directHls
          };
        } catch (e) {
          console.warn(`[AniWaves] Sub server ${s.serverName} resolution failed:`, e.message);
        }
      }
      return null;
    })(),
    (async () => {
      const dubServers = rawServers.filter(s => s.type === 'dub').slice(0, 2);
      for (const s of dubServers) {
        try {
          const embedUrl = await awGetEmbedUrl(s.linkId, slug);
          let directHls = false;
          let finalVideoUrl = formatIframeProxyUrl(embedUrl, `${AW}/watch/${slug}`);

          // 1. Direct HLS extraction from EchoVideo (instant line-speed playback)
          try {
            const stream = await extractWavesDirectStream(embedUrl);
            if (stream?.videoUrl) {
              finalVideoUrl = stream.videoUrl;
              directHls = true;
            }
          } catch (_) {}

          // 2. Fallback: Packed JS unpacking
          if (!directHls) {
            try {
              const embedHtml = await clientFetch(embedUrl, { referer: `${AW}/watch/${slug}`, timeout: 5000 });
              const unpacked = unpackUniversalJS(embedHtml);
              if (unpacked) {
                finalVideoUrl = unpacked;
                directHls = true;
                console.log(`[AniWaves] Direct HLS unpacked for WavesHD (DUB): ${finalVideoUrl.slice(0, 60)}...`);
              }
            } catch (_) {}
          }

          return {
            name: 'WavesHD (DUB)',
            videoUrl: finalVideoUrl,
            type: 'dub',
            embedUrl,
            serverName: s.serverName,
            referer: directHls ? embedUrl : `${AW}/watch/${slug}`,
            isHLS: directHls
          };
        } catch (e) {
          console.warn(`[AniWaves] Dub server ${s.serverName} resolution failed:`, e.message);
        }
      }
      return null;
    })()
  ]);

  if (subRes) servers.push(subRes);
  if (dubRes) servers.push(dubRes);

  // Cache the resolved server list for this episode (avoids re-fetching on revisit)
  if (servers.length > 0) setWavesServersCache(wavesId, episode, servers);

  return { servers, animeTitle, slug };
}

// ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ AniNeko Scraper ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬

// Persistent cache for Neko episode servers: slug+episode -> { servers, expires }
// 2 hours — MegaPlay embed URLs and video IDs expire/rotate frequently.
// Using 48h caused stale embed IDs to break playback on revisit.
const NEKO_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getNekoEpisodeCache(slug, episode) {
  try {
    const key = `neko_ep_${slug}_${episode}`;
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      return null;
    }
    console.log(`[AniNeko] Cache HIT for ${slug} ep${episode} ➔ instant play (0.05ms)`);
    return data;
  } catch { return null; }
}

function setNekoEpisodeCache(slug, episode, servers) {
  try {
    const key = `neko_ep_${slug}_${episode}`;
    localStorage.setItem(key, JSON.stringify({ data: servers, expires: Date.now() + NEKO_CACHE_TTL_MS }));
  } catch {}
}

const nekoMissCache = new Map();
const kotoMissCache = new Map();
const wavesMissCache = new Map();
const MISS_TTL = 15 * 60 * 1000;

export async function scrapeAniNeko(title, episode, isMovie = false, animeId = null, allTitles = null, language = 'english', idMal = null, isFallback = false) {
  let best, results, cachedPrimaryHtml = null;

  if (typeof title === 'object' && title !== null) {
    const obj = title;
    title = obj.title?.english || obj.title?.romaji || obj.title?.native || obj.name || '';
    if (!animeId) animeId = obj.id;
    if (!idMal) idMal = obj.idMal;
    if (!allTitles) allTitles = [obj.title?.english, obj.title?.romaji, obj.title?.native, ...(Array.isArray(obj.synonyms) ? obj.synonyms : [])].filter(t => t && typeof t === 'string');
    if (obj.format === 'MOVIE') isMovie = true;
  }

  const missKey = String(animeId || title).toLowerCase();
  if (!isFallback && nekoMissCache.has(missKey)) {
    const exp = nekoMissCache.get(missKey);
    if (Date.now() < exp) {
      throw new Error(`[AniNeko] Cached negative hit for "${title}" — skipping (0ms)`);
    }
  }

  const LANG_SUFFIXES = {
    hindi: 'Hindi Dub',
    german: 'German Dub',
    french: 'French Dub',
    italian: 'Italian Dub',
    spanish: 'Spanish Dub'
  };
  
  // ── Step 0A: Server Slug Map (highest priority — covers ALL seeded anime) ──
  // The Cloudflare Worker has verified slugs for 20,000+ anime from bulk seeding.
  // This is the fastest and most accurate path — NO title matching involved.
  let serverMapping = null;
  if (!isFallback && animeId) {
    serverMapping = await getSlugMapping(animeId);
    if (serverMapping?.neko && (serverMapping.status === 'verified' || serverMapping.status === 'partial')) {
      console.log(`[AniNeko] 🌐 Server slug HIT for ${animeId}: "${serverMapping.neko}" (status: ${serverMapping.status})`);
      // Use server mapping directly — skip ALL local matching
      best = { slug: serverMapping.neko, title };
      results = [best];
    }
  }

  // ── Step 0B: Instant 1-Step Exact Slug Matcher (O(1) multi-hash index, < 0.05ms) ──
  // Skipped during fallback search pass to prevent recursive loops
  const exactHit = (isFallback || best) ? null : findExactNekoSlug({
    id: animeId,
    idMal,
    title: { english: title, romaji: (allTitles && allTitles[0]) || title },
    synonyms: allTitles,
    format: isMovie ? 'MOVIE' : 'TV'
  }, isMovie);

  const mappedSlug = (isFallback || best) ? null : (exactHit?.slug || getMappedSlug(animeId, 'neko'));
  const knownSlug = mappedSlug;

  if (!best && knownSlug) {
    best = { slug: knownSlug, title: exactHit?.title || title };
    results = [best];
    console.log(`[AniNeko] ⚡ Instant Known/Mapped Slug HIT: "${knownSlug}" in 0.00ms`);
  } else if (!best) {
    // Fallback to memory search cache
    const cached = nekoSearchCache.get(title);
    if (cached) {
      best = cached.best;
      results = cached.results;
    } else {
      // Step 1: Speculative Target Episode Canonical Slug Probing (Zero-search instant hit in < 700ms)
      const safeAllTitles = Array.isArray(allTitles) ? allTitles : (allTitles && typeof allTitles === 'object' ? Object.values(allTitles) : []);
      const canonicalCandidates = [
        ...generateCanonicalSlugs(title, isMovie),
        ...safeAllTitles.flatMap(t => typeof t === 'string' ? generateCanonicalSlugs(t, isMovie) : [])
      ];
      const uniqueCanonical = Array.from(new Set(canonicalCandidates)).slice(0, 3);
      if (uniqueCanonical.length > 0) {
        try {
          const targetEp = episode || 1;
          const probePromises = uniqueCanonical.map(async (candSlug) => {
            try {
              // Direct target episode probe: loads ep-N directly in a single request!
              const probeHtml = await clientFetch(`${ANINEKO}/watch/${candSlug}/ep-${targetEp}`, { referer: ANINEKO, timeout: 2500 });
              const isHome = probeHtml.includes('<title>AniNeko - Stream Free') || probeHtml.includes('class="home-') || !probeHtml.includes('ep-servers');
              const hasServers = probeHtml.includes('data-link-id') || probeHtml.includes('ep-server-item') || /\<button[^\>]*class="[^"]*server/i.test(probeHtml);
              if (probeHtml && !isHome && hasServers) {
                // ── CRITICAL: Validate page title matches our anime before accepting this slug ──
                // Without this, a wrong slug that matches a different anime's AniNeko page
                // would be accepted, causing an entirely different anime to play.
                const pageTitleMatch = probeHtml.match(/<title>([^<]+)<\/title>/i);
                const pageH1Match = probeHtml.match(/<h1[^>]*class="[^"]*(?:title|name|anime)[^"]*"[^>]*>([^<]+)<\/h1>/i)
                  || probeHtml.match(/<h2[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)<\/h2>/i);
                const pageTitleRaw = (pageH1Match?.[1] || pageTitleMatch?.[1] || '').replace(/\s*[-–—|]\s*Episode.*$/i, '').replace(/\s*[-–—|]\s*(AniNeko|Watch|Stream).*$/i, '').trim();

                const candSeason = extractSeasonNumber(candSlug);
                const qSeason = extractSeasonNumber(title);
                if (candSeason !== qSeason) {
                  console.warn(`[AniNeko] Slug probe "${candSlug}" rejected: season mismatch (slug: ${candSeason} vs query: ${qSeason})`);
                  return null;
                }

                if (pageTitleRaw) {
                  // Score the page title against all our known title variants
                  const allKnown = Array.from(new Set([title, ...(allTitles || [])].filter(Boolean)));
                  const titleMatchScore = Math.max(...allKnown.map(qt => calculateMatchScore(
                    { title: pageTitleRaw, jp: '', slug: candSlug },
                    qt,
                    isMovie
                  )));

                  if (titleMatchScore < 0.85) {
                    console.warn(`[AniNeko] Slug probe "${candSlug}" returned WRONG ANIME page: "${pageTitleRaw}" (score: ${titleMatchScore.toFixed(2)} < 0.85 for "${title}") — REJECTED`);
                    // Auto-evict this canonical slug from the verified store if it was cached
                    if (animeId) {
                      try {
                        const raw = localStorage.getItem('aniplay_verified_slugs_v2');
                        if (raw) {
                          const store = JSON.parse(raw);
                          if (store[String(animeId)]?.neko === candSlug) {
                            delete store[String(animeId)].neko;
                            localStorage.setItem('aniplay_verified_slugs_v2', JSON.stringify(store));
                            console.warn(`[AniNeko] Auto-evicted poisoned verified slug "${candSlug}" for anime ${animeId}`);
                          }
                        }
                      } catch {}
                    }
                    return null; // Reject wrong anime
                  }
                  console.log(`[AniNeko] Slug probe "${candSlug}" validated: "${pageTitleRaw}" (score: ${titleMatchScore.toFixed(2)}) ✓`);
                  return { slug: candSlug, html: probeHtml, score: titleMatchScore };
                }

                return { slug: candSlug, html: probeHtml, score: 0.85 };
              }
              // Fallback for ep > 1: check if ep-1 exists to confirm valid slug
              if (targetEp > 1) {
                const ep1Html = await clientFetch(`${ANINEKO}/watch/${candSlug}/ep-1`, { referer: ANINEKO, timeout: 1800 });
                const hasEp1 = ep1Html && !ep1Html.includes('<title>AniNeko - Stream Free') && (ep1Html.includes('data-link-id') || ep1Html.includes('ep-server-item'));
                if (hasEp1) {
                  const candSeason = extractSeasonNumber(candSlug);
                  const qSeason = extractSeasonNumber(title);
                  if (candSeason !== qSeason) return null;

                  // Validate ep-1 page too
                  const pageTitleMatch = ep1Html.match(/<title>([^<]+)<\/title>/i);
                  const pageTitleRaw = (pageTitleMatch?.[1] || '').replace(/\s*[-–—|]\s*Episode.*$/i, '').replace(/\s*[-–—|]\s*(AniNeko|Watch|Stream).*$/i, '').trim();
                  if (pageTitleRaw) {
                    const allKnown = Array.from(new Set([title, ...(allTitles || [])].filter(Boolean)));
                    const titleMatchScore = Math.max(...allKnown.map(qt => calculateMatchScore({ title: pageTitleRaw, jp: '', slug: candSlug }, qt, isMovie)));
                    if (titleMatchScore < 0.85) {
                      console.warn(`[AniNeko] ep-1 slug probe "${candSlug}" returned WRONG ANIME: "${pageTitleRaw}" (score: ${titleMatchScore.toFixed(2)}) — REJECTED`);
                      return null;
                    }
                    return { slug: candSlug, html: null, score: titleMatchScore };
                  }
                  return { slug: candSlug, html: null, score: 0.85 };
                }
              }
            } catch (_) {}
            return null;
          });

          const probeResults = await Promise.all(probePromises);
          // Prefer hit with actual target HTML; fall back to slug-only
          const validHit = probeResults.find(p => p && p.html) || probeResults.find(p => p && p.slug);
          if (validHit) {
            best = { slug: validHit.slug, title };
            results = [best];
            if (validHit.html) cachedPrimaryHtml = validHit.html;
            console.log(`[AniNeko] Parallel Canonical Slug Probe HIT: "${validHit.slug}" (instant)`);
            if (animeId && (validHit.score === undefined || validHit.score >= 0.85)) {
              saveVerifiedSlug(animeId, 'neko', validHit.slug, { title });
            }
          }
        } catch (_) {}
      }

      // Step 1.5: MAL-Sync primary cross-reference (ground-truth slug lookup before fuzzy search)
      // MAL-Sync provides verified slugs for 90%+ of anime — far more reliable than string matching.
      // We cache results in localStorage with a 24h TTL to avoid hammering the free API.
      if (!best && (idMal || animeId)) {
        const malSyncCacheKey = `malsync_neko_${idMal || animeId}`;
        let malSyncSlugs = null;
        try {
          const cached = localStorage.getItem(malSyncCacheKey);
          if (cached) {
            const { slugs, expires } = JSON.parse(cached);
            if (Date.now() < expires) malSyncSlugs = slugs;
          }
        } catch {}

        if (!malSyncSlugs) {
          try {
            malSyncSlugs = await fetchMalSyncCandidateSlugs(idMal || animeId);
            localStorage.setItem(malSyncCacheKey, JSON.stringify({
              slugs: malSyncSlugs,
              expires: Date.now() + 24 * 60 * 60 * 1000
            }));
          } catch { malSyncSlugs = []; }
        }

        if (malSyncSlugs?.length) {
          console.log(`[AniNeko] MAL-Sync primary: checking ${malSyncSlugs.length} candidate slugs for "${title}"`);
          // Check each slug in parallel — first confirmed hit wins
          const targetEp = episode || 1;
          const msProbeResults = await Promise.allSettled(
            malSyncSlugs.slice(0, 6).map(async (ms) => {
              try {
                const probeHtml = await clientFetch(`${ANINEKO}/watch/${ms}/ep-${targetEp}`, { referer: ANINEKO, timeout: 3000 });
                const hasServers = probeHtml && (probeHtml.includes('data-link-id') || probeHtml.includes('ep-server-item'));
                if (!hasServers) return null;
                // Validate page title
                const pageTitleMatch = probeHtml.match(/<title>([^<]+)<\/title>/i);
                const pageH1Match = probeHtml.match(/<h1[^>]*class="[^"]*(?:title|name|anime)[^"]*"[^>]*>([^<]+)<\/h1>/i);
                const pageTitleRaw = (pageH1Match?.[1] || pageTitleMatch?.[1] || '').replace(/\s*[-–—|]\s*Episode.*$/i, '').replace(/\s*[-–—|]\s*(AniNeko|Watch|Stream).*$/i, '').trim();
                if (!pageTitleRaw) return null;
                const allKnown = Array.from(new Set([title, ...(allTitles || [])].filter(Boolean)));
                const titleMatchScore = Math.max(...allKnown.map(qt => calculateMatchScore({ title: pageTitleRaw, jp: '', slug: ms }, qt, isMovie)));
                if (titleMatchScore < 0.85) return null;
                console.log(`[AniNeko] MAL-Sync primary HIT: "${ms}" validated "${pageTitleRaw}" (score: ${titleMatchScore.toFixed(2)})`);
                return { slug: ms, html: probeHtml, score: titleMatchScore };
              } catch { return null; }
            })
          );
          const msHit = msProbeResults.find(r => r.status === 'fulfilled' && r.value);
          if (msHit?.value) {
            best = { slug: msHit.value.slug, title };
            results = [best];
            cachedPrimaryHtml = msHit.value.html;
            if (animeId) saveVerifiedSlug(animeId, 'neko', msHit.value.slug, { title, confidence: msHit.value.score });
            console.log(`[AniNeko] ⚡ MAL-Sync primary resolved: "${msHit.value.slug}" (skipped fuzzy search)`);
          }
        }
      }

      // Step 2: Smart Query Expansion with Fast REST Suggestions & Bilingual Scoring
      if (!best) {
        const searchQueries = generateSearchQueries(title, allTitles, language);
        results = [];
        const allQueryTitles = Array.from(new Set([title, ...(allTitles || [])].filter(Boolean)));
        const RE_PATTERN_OLD = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>/g;

        if (searchQueries.length === 0) throw new Error('No search queries generated for AniNeko');

        // Fast parallel dual search: Query both REST Suggestions AND HTML Filter concurrently
        const topQueries = searchQueries.slice(0, 4);
        const seenSlugs = new Set();
        const addResult = (r) => {
          if (!r || !r.slug || seenSlugs.has(r.slug)) return;
          seenSlugs.add(r.slug);
          results.push(r);
        };

        await Promise.all(topQueries.map(async (keyword) => {
          // 2A. Fast native REST suggestions (up to 5 items)
          const p1 = (async () => {
            try {
              const raw = await clientFetch(`${ANINEKO}/wp-json/v1/aniwaves/search/suggestions?keyword=${encodeURIComponent(keyword)}`, {
                referer: ANINEKO,
                timeout: 3000
              });
              if (raw && raw.includes('"html"')) {
                const parsed = JSON.parse(raw);
                if (parsed?.html) {
                  const itemRe = /<a[^>]*class="item"[^>]*href="[^"]*\/watch\/([^"\/]+)(?:\/ep-\d+)?"[^>]*>([\s\S]*?)<\/a>/g;
                  let m;
                  while ((m = itemRe.exec(parsed.html)) !== null) {
                    const slug = m[1];
                    const inner = m[2];
                    const nameMatch = inner.match(/<div[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                    const jpMatch = inner.match(/data-jp="([^"]+)"/i);
                    const itemTitle = nameMatch ? cleanAnimeTitle(nameMatch[1].replace(/<[^>]+>/g, '')) : slug;
                    const jp = jpMatch ? cleanAnimeTitle(jpMatch[1]) : '';
                    addResult({ slug, title: itemTitle, jp });
                  }
                }
              }
            } catch (_) {}
          })();

          // 2B. Full HTML Filter search (up to 30 items per page with data-jp)
          const p2 = (async () => {
            try {
              const searchHtml = await clientFetch(`${ANINEKO}/filter?keyword=${encodeURIComponent(keyword)}`, {
                referer: ANINEKO,
                timeout: 4500
              });
              const localRe1 = /<a class="name d-title"([^>]+)>([\s\S]*?)<\/a>/g;
              const localRe2 = new RegExp(RE_PATTERN_OLD.source, 'g');
              let m;
              let foundAny = false;

              while ((m = localRe1.exec(searchHtml)) !== null) {
                const attrs = m[1];
                const inner = m[2];
                const hrefM = attrs.match(/href="[^"]*\/watch\/([^/"\s]+)(?:\/ep-\d+)?"/);
                const jpM = attrs.match(/data-jp="([^"]+)"/);
                if (hrefM) {
                  foundAny = true;
                  addResult({
                    slug: hrefM[1],
                    title: cleanAnimeTitle(inner.replace(/<[^>]+>/g, '')),
                    jp: jpM ? cleanAnimeTitle(jpM[1]) : ''
                  });
                }
              }
              if (!foundAny) {
                while ((m = localRe2.exec(searchHtml)) !== null) {
                  addResult({ slug: m[1], title: cleanAnimeTitle(m[2]), jp: '' });
                }
              }
            } catch (_) {}
          })();

          await Promise.all([p1, p2]);
        }));

        // Step 3: Comprehensive Industry-Standard Scoring
        let maxScore = -1;
        for (const r of results) {
          let score = 0;
          for (const qt of allQueryTitles) {
            score = Math.max(score, calculateMatchScore(r, qt, isMovie));
          }
          if (score > maxScore) { maxScore = score; best = r; }
        }

        // Step 3.5: AI Ambiguity Resolution (Gemini Nano on-device + Micro-Vector AI fallback)
        if (results.length > 1 && best && maxScore < 0.90) {
          try {
            const aiMatch = await resolveAmbiguityWithAI(
              {
                title,
                romaji: (typeof allTitles === 'object' && allTitles?.romaji) ? allTitles.romaji : '',
                season: extractSeasonNumber(title),
                isMovie
              },
              results
            );
            if (aiMatch && aiMatch.slug) {
              const matchedCand = results.find(r => r.slug === aiMatch.slug);
              if (matchedCand) {
                console.log(`[AniNeko] AI Ambiguity Resolution HIT (${aiMatch.source}):`, matchedCand.slug);
                best = matchedCand;
                maxScore = Math.max(maxScore, 0.92);
              }
            }
          } catch (aiErr) {
            console.warn('[AniNeko] AI ambiguity resolution error:', aiErr.message);
          }
        }

        // Step 4: MAL-Sync Cloud Cross-Reference Fallback if search score is low
        if ((!best || maxScore < 0.70) && (idMal || animeId)) {
          try {
            console.log(`[AniNeko] Attempting MAL-Sync cross-reference for anime ${idMal || animeId}...`);
            const malSlugs = await fetchMalSyncCandidateSlugs(idMal || animeId);
            for (const ms of malSlugs) {
              const probeHtml = await clientFetch(`${ANINEKO}/watch/${ms}/ep-${episode}`, { referer: ANINEKO, timeout: 3500 });
              if (probeHtml && (probeHtml.includes('data-link-id') || probeHtml.includes('data-video') || probeHtml.includes('player'))) {
                best = { slug: ms, title };
                results = [best];
                cachedPrimaryHtml = probeHtml;
                maxScore = 0.90;
                console.log(`[AniNeko] MAL-Sync Fallback HIT: "${ms}"`);
                break;
              }
            }
          } catch (e) {
            console.warn('[AniNeko] MAL-Sync fallback error:', e.message);
          }
        }

        // Raised from 0.80 → 0.85 to prevent accepting wrong-anime near-misses.
        if (!best || maxScore < 0.85) {
          nekoMissCache.set(missKey, Date.now() + MISS_TTL);
          throw new Error(`No confident match on AniNeko for "${title}" (score: ${maxScore.toFixed(2)})`);
        }

        if (animeId && best?.slug && maxScore >= 0.85) {
          saveVerifiedSlug(animeId, 'neko', best.slug, { title: best.title });
        }

        nekoSearchCache.set(title, { best, results });
      }
    }
  }

  // Check episode-level session cache before fetching any watch pages
  const nekoEpCached = getNekoEpisodeCache(best.slug, episode);
  if (nekoEpCached) return { servers: nekoEpCached, animeTitle: best.title, slug: best.slug };

  let primaryHtml = cachedPrimaryHtml;
  if (!primaryHtml) {
    const primaryWatchUrl = `${ANINEKO}/watch/${best.slug}/ep-${episode}`;
    try {
      primaryHtml = await clientFetch(primaryWatchUrl, { referer: ANINEKO, timeout: 8000 });
    } catch (err) {
      console.warn(`[scrapeAniNeko] Primary watch page fetch failed:`, err.message);
    }
  }

  const fetchedPages = [{ html: primaryHtml, isDubPage: best.slug.endsWith('-dub') }];

  // Only fetch separate -dub page if primary page returned no dub servers and a -dub slug exists
  const hasDubInPrimary = Boolean(primaryHtml && (primaryHtml.includes('data-type="dub"') || primaryHtml.includes('/dub') || primaryHtml.includes('DUB')));
  if (!hasDubInPrimary && !best.slug.endsWith('-dub')) {
    const dubCand = results.find(r => r.slug === `${best.slug}-dub`);
    if (dubCand) {
      try {
        const dubHtml = await clientFetch(`${ANINEKO}/watch/${dubCand.slug}/ep-${episode}`, { referer: ANINEKO, timeout: 6000 });
        if (dubHtml) fetchedPages.push({ html: dubHtml, isDubPage: true });
      } catch (_) {}
    }
  }

  const rawServers = [];

  // AniNeko uses two button formats depending on the site version:
  // OLD (anineko.to): <button data-video="https://embed.url"> (direct iframe url in attribute)
  // NEW (anineko.es): <li class="ep-server-item" data-link-id="BASE64=="> (base64 encoded megaplay.buzz url)
  const btnRe = /<button[^>]*class="[^"]*server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
  const linkIdRe = /<li[^>]*class="[^"]*(?:ep-server-item|server-item)[^"]*"[^>]*data-link-id="([^"]+)"[^>]*>([\s\S]+?)<\/li>/g;

  for (const page of fetchedPages) {
    const html = page.html || (page.status === 'fulfilled' ? page.value?.html : '');
    const isDubPage = page.isDubPage ?? (page.status === 'fulfilled' ? page.value?.isDubPage : false);
    if (!html) continue;

    // Format 1: Old-style direct data-video buttons (anineko.to style)
    btnRe.lastIndex = 0;
    let m;
    while ((m = btnRe.exec(html)) !== null) {
      let videoUrl = m[1];
      if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
      const rawText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const low = rawText.toLowerCase();

      let isDub = false;
      if (low.includes('dub')) isDub = true;
      else if (low.includes('sub') || low.includes('soft') || low.includes('hard')) isDub = false;
      else isDub = isDubPage;

      const isHardSub = !isDub && low.includes('hard');
      const isSoftSub = !isDub && (low.includes('sort') || low.includes('soft'));

      rawServers.push({ videoUrl, rawText, isDub, isHardSub, isSoftSub });
    }

    // Format 2: New-style data-link-id (base64 encoded megaplay.buzz URL) from anineko.es
    linkIdRe.lastIndex = 0;
    while ((m = linkIdRe.exec(html)) !== null) {
      const b64 = m[1];
      const rawText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      let videoUrl = '';
      try { videoUrl = atob(b64); } catch { continue; }
      if (!videoUrl.startsWith('http')) continue;

      const low = rawText.toLowerCase();
      // anineko.es labels: "HD-1" / "Vidstream-2" etc. + SUB/DUB section container
      // Detect dub by checking the videoUrl (/dub) or the parent section label
      const matchIdx = m.index || 0;
      const dubSectionMatch = html.slice(Math.max(0, matchIdx - 800), matchIdx);
      const isDub = videoUrl.includes('/dub') || dubSectionMatch.includes('data-type="dub"') || dubSectionMatch.includes('title="DUB"') || low.includes('dub');
      rawServers.push({ videoUrl, rawText: rawText || 'MegaPlay', isDub, isHardSub: false, isSoftSub: false });
    }
  }

  if (rawServers.length === 0) {
    if (mappedSlug && !isFallback) {
      console.warn(`[AniNeko] Mapped slug "${mappedSlug}" yielded 0 servers on anineko.es — falling back to live search`);
      // Evict the poisoned slug from the persistent verified store so future visits re-run search
      if (animeId) clearVerifiedSlug(animeId, 'neko', mappedSlug);
      try {
        const raw = localStorage.getItem(VERIFIED_SLUGS_KEY);
        if (raw) {
          const store = JSON.parse(raw);
          if (store[String(animeId)]?.neko) {
            delete store[String(animeId)].neko;
            localStorage.setItem(VERIFIED_SLUGS_KEY, JSON.stringify(store));
          }
        }
      } catch {}
      const searchRes = await scrapeAniNeko(title, episode, isMovie, null, allTitles, language, idMal, true);
      if (searchRes?.slug && animeId) {
        saveVerifiedSlug(animeId, 'neko', searchRes.slug);
      }
      return searchRes;
    }
    throw new Error(`AniNeko watch page for "${best?.slug || title}" yielded 0 active video servers`);
  }

  // Subtitle strategy: AniNeko uses MegaPlay embeds whose subtitle tracks are only
  // available inside the getSources API response (tracks[]), NOT in URL query params.
  // Instead of guessing subtitle URLs here, we mark every SUB server stub with
  // `_subtitlesPending: true`. resolveSingleServer reads this flag and always
  // extracts the real tracks[] from getSources when it decrypts the embed — giving
  // 100% subtitle accuracy for every anime and every server.

  const cleanServerName = (rawText, isDub, isHardSub) => {
    const low = rawText.toLowerCase();
    let base = 'HD-1';
    if (low.includes('vidstream-2') || low.includes('vidstream')) base = 'Vidstream-2';
    else if (low.includes('hd-1')) base = 'HD-1';
    else if (low.includes('hd-2')) base = 'HD-2';
    else if (low.includes('megaplay') || low.includes('mega')) base = 'MegaPlay';
    else if (low.includes('streamhg')) base = 'StreamHG';
    else if (low.includes('earnvid')) base = 'Earnvids';
    else base = rawText.split(' ')[0] || 'Vidstream-2';

    if (isDub) return `${base} (DUB)`;
    if (isHardSub) return `${base}-HardSub`;
    return base;
  };

  const seen = new Set();
  const servers = [];

  // Sort order: Prioritize verified working direct HLS servers (StreamHG > Earnvids)
  const sortedRaw = [...rawServers].sort((a, b) => {
    const score = (item) => {
      const low = item.rawText.toLowerCase();
      // SUB ordering
      if (!item.isDub && low.includes('streamhg')) return 1;
      if (!item.isDub && low.includes('earnvid')) return 2;
      if (!item.isDub && !item.isHardSub) return 3;
      if (!item.isDub) return 4;
      // DUB ordering
      if (item.isDub && low.includes('streamhg')) return 5;
      if (item.isDub && low.includes('earnvid')) return 6;
      if (item.isDub) return 7;
      return 8;
    };
    return score(a) - score(b);
  });

  for (const s of sortedRaw) {
    if (seen.has(s.videoUrl)) continue;
    seen.add(s.videoUrl);

    // Skip dead embed hosts (dood: DMCA-gone, playmogo: domain parked, bibiemb/vivibebe/ibyteimg: ByteDance 403 Forbidden)
    const sNameLow = s.rawText.toLowerCase();
    const sUrlLow = (s.videoUrl || '').toLowerCase();
    if (sNameLow.includes('dood') || sUrlLow.includes('dood') || sUrlLow.includes('playmogo')) continue;
    if (sUrlLow.includes('bibiemb') || sUrlLow.includes('vibevibe.workers.dev') || sUrlLow.includes('vivibebe') || sUrlLow.includes('ibyteimg')) continue;

    // MegaPlay/MegaCloud detection: match only by actual embed domain, not by server label.
    // The old check (sNameLow.includes('hd') || sNameLow.includes('vidstream')) matched
    // non-MegaPlay servers like StreamHG and Earnvids, routing them through the wrong referer.
    const embedUrlLow = (s.videoUrl || '').toLowerCase();
    const isMega = embedUrlLow.includes('megaplay') || embedUrlLow.includes('megacloud') ||
                   embedUrlLow.includes('anineko.es') ||
                   embedUrlLow.includes('kryntal') || embedUrlLow.includes('norami') ||
                   embedUrlLow.includes('imgnex') || embedUrlLow.includes('shiora') ||
                   embedUrlLow.includes('mikora') || embedUrlLow.includes('akirax') ||
                   embedUrlLow.includes('dokicloud');
    const serverReferer = isMega ? 'https://megaplay.buzz/' :
                          (embedUrlLow.includes('otakuhg') || embedUrlLow.includes('cdn-centaurus')) ? 'https://otakuhg.site/' :
                          (embedUrlLow.includes('otakuvid') || embedUrlLow.includes('dramiyos') || embedUrlLow.includes('acek-cdn')) ? 'https://otakuvid.online/' :
                          (ANINEKO + '/');

    const serverDisplayName = cleanServerName(s.rawText, s.isDub, s.isHardSub);
    // Subtitles are resolved on-demand via resolveSingleServer → getSources tracks[].
    // The _subtitlesPending flag instructs the resolver to always fetch them even when
    // a cached stream URL is returned.
    const subtitles = [];
    const proxiedUrl = formatIframeProxyUrl(s.videoUrl, serverReferer);

    servers.push({
      name: serverDisplayName,
      videoUrl: proxiedUrl,
      embedUrl: s.videoUrl,
      referer: serverReferer,
      type: s.isDub ? 'dub' : 'sub',
      subtitles,
      // Flag: instructs resolveSingleServer to always extract subtitle tracks from
      // the getSources API response even when a cached stream URL is available.
      _subtitlesPending: !s.isDub && !s.isHardSub,
      isHLS: false
    });
  }

  // ── Return servers IMMEDIATELY so UI shows them without waiting for m3u8 extraction ──
  // Pre-extraction used to block here for up to 8s (4s per embed × 2 servers),
  // causing the Neko server list to arrive after timeout — appearing invisible.
  // Now we return servers first, then resolve .m3u8 URLs in the background.
  // When each embed URL is resolved, the session cache is updated transparently.

  // Keep servers that have a valid URL — prefer direct HLS but fall back to embed proxy.
  const validServers = servers.filter(s => s.videoUrl && s.videoUrl.startsWith('http'));
  const finalServers = validServers.length > 0 ? validServers : servers;

  // Cache immediately so the player can discover servers in <400ms
  if (finalServers.length > 0) setNekoEpisodeCache(best.slug, episode, finalServers);

  // Return server stubs immediately without running heavy parallel decryptions
  // The selected server will be decrypted on-demand via resolveSingleServer (<300ms)
  return { servers: finalServers, animeTitle: best.title, slug: best.slug };
}


// ─── AniKoto Scraper ───

const kotoSearchCache = new Map();  // title → { slug, animeId, animeTitle, watchUrl }
const kotoEpListCache = new Map();  // animeId -> epsHtml (full episode list HTML)
const kotoEpMapCache = new Map();   // animeId -> Map<epNum, targetIds> (indexed O(1) episode map)
const kotoEpCache = new Map();      // slug-episode -> { servers, animeTitle, slug }

/**
 * Fast lightweight JSON search on AniKoto (same pattern as AniWaves).
 * Returns a results array or throws on failure.
 */
async function kotoJsonSearch(domain, keyword) {
  const url = `${domain}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`;
  const rawText = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
    referer: domain,
    timeout: 4000,
  });
  const parsed = JSON.parse(rawText);
  if (parsed.status === 404 || !parsed.result?.html) return [];
  const html = parsed.result.html;
  const itemRe = /href="(?:https?:\/\/[^\/]+)?\/watch\/(\w[\w%-]*)"[\s\S]*?class="name d-title"[^>]*>([^<]+)<\/div>/g;
  let m;
  const results = [];
  while ((m = itemRe.exec(html)) !== null) {
    results.push({ slug: m[1], animeTitle: m[2].trim() });
  }
  return results;
}

/**
 * Filter-page HTML search (heavier, but more complete result set).
 * Fetches /filter?keyword= and parses the full page HTML.
 */
async function kotoFilterSearch(domain, keyword) {
  const filterUrl = `${domain}/filter?keyword=${encodeURIComponent(keyword)}`;
  const searchHtml = await clientFetch(filterUrl, { referer: domain, timeout: 7000 });
  const itemRe = /<a\s+class="name d-title"\s+href="([^"]*?\/watch\/([^"\/]+)(?:\/ep-\d+)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const results = [];
  while ((m = itemRe.exec(searchHtml)) !== null) {
    results.push({ fullUrl: m[1], slug: m[2], animeTitle: m[3].replace(/<[^>]*>/g, '').trim() });
  }
  return results;
}

export async function scrapeAniKoto(title, episode, isMovie = false, animeId = null, allTitles = null, language = 'english') {
  const missKey = String(animeId || title).toLowerCase();
  if (kotoMissCache.has(missKey)) {
    const exp = kotoMissCache.get(missKey);
    if (Date.now() < exp) {
      throw new Error(`[AniKoto] Cached negative hit for "${title}" — skipping (0ms)`);
    }
  }

  const domain = ANIKOTO;

  // ── Step 0: Cloudflare Edge Server Mapping (<15ms, zero search) ──
  let best = null;
  if (animeId) {
    const serverMapping = await getSlugMapping(animeId);
    if (serverMapping?.koto && (serverMapping.status === 'verified' || serverMapping.status === 'partial')) {
      console.log(`[AniKoto] 🌐 Server slug HIT for ${animeId}: "${serverMapping.koto}" (id: ${serverMapping.kotoId || 'resolve'})`);
      best = { slug: serverMapping.koto, animeTitle: title, animeId: serverMapping.kotoId || null };
    }
  }

  // ── Step 1: ID mapping (Industry-standard ground truth — bypass search & stale cache) ──
  if (!best) {
    const mappedSlug = getMappedSlug(animeId, 'anikoto');
    const mappedInternalId = getMappedId(animeId, 'anikoto');

    if (mappedSlug) {
      best = { slug: mappedSlug, animeTitle: title, animeId: mappedInternalId };
      console.log(`[AniKoto] ID Cross-Ref HIT for AniList ID ${animeId} ➔ "${mappedSlug}" (internalId: ${mappedInternalId || 'resolve'})`);
    }
  }

  // ── Step 2: Search cache (memory first, then localStorage) ──
  let searchResult = best ? null : kotoSearchCache.get(title);
  if (!best && !searchResult) {
    const lsCached = lsGet(lsSearchKey('koto', title));
    if (lsCached) {
      console.log(`[AniKoto] localStorage cache HIT for "${title}" — instant`);
      searchResult = lsCached;
      kotoSearchCache.set(title, searchResult);
    }
  }

  // ── Step 2.5: MAL-Sync primary cross-reference (before fuzzy search) ──
  // Probes MAL-Sync confirmed slugs with title validation — far more reliable than fuzzy matching.
  if (!searchResult && !best && animeId) {
    const malSyncCacheKey = `malsync_koto_${animeId}`;
    let malSyncSlugs = null;
    try {
      const cachedMs = localStorage.getItem(malSyncCacheKey);
      if (cachedMs) {
        const { slugs, expires } = JSON.parse(cachedMs);
        if (Date.now() < expires) malSyncSlugs = slugs;
      }
    } catch {}

    if (!malSyncSlugs) {
      try {
        malSyncSlugs = await fetchMalSyncCandidateSlugs(animeId);
        localStorage.setItem(malSyncCacheKey, JSON.stringify({
          slugs: malSyncSlugs,
          expires: Date.now() + 24 * 60 * 60 * 1000
        }));
      } catch { malSyncSlugs = []; }
    }

    if (malSyncSlugs?.length) {
      console.log(`[AniKoto] MAL-Sync primary: checking ${malSyncSlugs.length} slugs for "${title}"`);
      const allQueryTitlesMs = allTitles?.length ? allTitles : [title];
      for (const ms of malSyncSlugs.slice(0, 6)) {
        try {
          const watchUrl = `${domain}/watch/${ms}`;
          const probeHtml = await clientFetch(watchUrl, { referer: domain, timeout: 3500 });
          const hasId = probeHtml && (probeHtml.includes('data-id="') || probeHtml.includes('data-id ='));
          if (!hasId) continue;
          // Validate title
          const pageTitleMatch = probeHtml.match(/<title>([^<]+)<\/title>/i);
          const pageH1Match = probeHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
          const pageTitleRaw = (pageH1Match?.[1] || pageTitleMatch?.[1] || '').replace(/\s*[-–—|]\s*(AniKoto|Watch|Stream).*$/i, '').trim();
          if (!pageTitleRaw) continue;
          const msScore = Math.max(...allQueryTitlesMs.map(qt =>
            calculateMatchScore({ title: pageTitleRaw, slug: ms }, qt, isMovie)
          ));
          if (msScore < 0.85) continue;
          // Extract internal ID from page
          const idM = probeHtml.match(/data-id="(\d+)"/i);
          const kotoInternalId = idM?.[1];
          if (!kotoInternalId) continue;
          console.log(`[AniKoto] ⚡ MAL-Sync primary HIT: "${ms}" (score: ${msScore.toFixed(2)}, id: ${kotoInternalId})`);
          best = { slug: ms, animeTitle: title, animeId: kotoInternalId };
          searchResult = { slug: ms, animeId: kotoInternalId, animeTitle: title, watchUrl };
          kotoSearchCache.set(title, searchResult);
          lsSet(lsSearchKey('koto', title), searchResult);
          if (animeId) saveVerifiedSlug(animeId, 'anikoto', ms, { title, confidence: msScore });
          break;
        } catch { continue; }
      }
    }
  }

  // ── Step 3: Fuzzy search fallback if neither ID mapping nor cache matched ──
  if (!searchResult && !best) {

    const safeAllTitles = Array.isArray(allTitles) ? allTitles : (allTitles && typeof allTitles === 'object' ? Object.values(allTitles) : []);
    const titlesToSearch = safeAllTitles.length ? safeAllTitles : [title];
    const allQueryTitles = safeAllTitles.length ? safeAllTitles : [title];
    const strategiesSet = new Set();
    for (const t of titlesToSearch) {
      if (typeof t !== 'string') continue;
      const cleanT = cleanAnimeTitle(t);
      const engWords = cleanT.split(/[^a-zA-Z0-9]/).filter(w => w.length > 3);
      const longest = engWords.length ? engWords.reduce((a, b) => a.length >= b.length ? a : b) : null;
      strategiesSet.add(cleanT);
      strategiesSet.add(cleanT.split(' ').slice(0, 3).join(' '));
      strategiesSet.add(cleanT.split(' ').slice(0, 2).join(' '));
      if (longest) strategiesSet.add(longest);

      // Expand "Part X" -> "Season X" and "Xnd Season"
      const pMatch = cleanT.match(/\bpart\s*(\d+)\b/i);
      if (pMatch) {
        const pNum = pMatch[1];
        const ord = (pNum === '1') ? '1st' : (pNum === '2') ? '2nd' : (pNum === '3') ? '3rd' : `${pNum}th`;
        strategiesSet.add(cleanT.replace(/\bpart\s*(\d+)\b/i, `Season ${pNum}`));
        strategiesSet.add(cleanT.replace(/\bpart\s*(\d+)\b/i, `${ord} Season`));
      }
      // Expand 86
      if (/\b86\b/.test(cleanT)) {
        const stripped = cleanT.replace(/\b86\s*/gi, '').trim();
        if (stripped) {
          strategiesSet.add(stripped);
          strategiesSet.add(stripped.split(' ').slice(0, 2).join(' '));
        }
      }
    }
    const strategies = [...strategiesSet].filter(Boolean);
    const primaryCleanTitle = cleanAnimeTitle(title);

    console.log(`[AniKoto] Racing JSON search + filter page for "${title}" (${strategies.length} strategies)...`);

    let settled = false;
    // Score results against ALL title variants — best cross-title pairing wins
    const scoreResults = (results) => {
      // Exact normalized match against any query title (highest priority)
      for (const qt of allQueryTitles) {
        const normQuery = norm(qt);
        const exactMatch = results.find(r => norm(r.animeTitle) === normQuery);
        if (exactMatch) return { best: exactMatch, score: 1.0, isExact: true };
      }
      let localBest = null, localMax = -1;
      for (const r of results) {
        let s = 0;
        for (const qt of allQueryTitles) {
          s = Math.max(s, calculateMatchScore({ title: r.animeTitle, slug: r.slug }, qt, isMovie));
        }
        if (s > localMax) { localMax = s; localBest = r; }
      }
      return { best: localBest, score: localMax, isExact: false };
    };

    // Strict confidence threshold: raised to 0.88 (was 0.85) to prevent near-miss wrong anime matches.
    // AniKoto search results sometimes return romaji-only titles that fuzzy-match unrelated anime.
    const STRICT_MATCH_THRESHOLD = 0.88;
    const raceResult = await new Promise((resolve) => {
      let pending = strategies.length + 1; // +1 for filter page
      let bestSoFar = null;
      const tryResolve = (results, source = 'fast') => {
        if (settled) return;
        const { best: b, score: s, isExact } = scoreResults(results);
        // Only terminate race early if an exact match is confirmed
        if (b && isExact) {
          settled = true;
          resolve({ best: b, score: s, source });
          return;
        }
        // Strict confidence check — reject any random anime
        if (b && s >= STRICT_MATCH_THRESHOLD) {
          if (!bestSoFar || s > bestSoFar.score) bestSoFar = { best: b, score: s, source };
        }
        pending--;
        if (pending <= 0 && !settled) {
          settled = true;
          resolve(bestSoFar);
        }
      };
      for (const kw of strategies) {
        kotoJsonSearch(domain, kw).then(res => tryResolve(res, 'fast')).catch(() => {
          pending--;
          if (pending <= 0 && !settled) { settled = true; resolve(bestSoFar); }
        });
      }
      kotoFilterSearch(domain, primaryCleanTitle).then(results => {
        tryResolve(results, 'filter');
      }).catch(() => {
        pending--;
        if (pending <= 0 && !settled) { settled = true; resolve(bestSoFar); }
      });
    });

    if (!raceResult) {
      kotoMissCache.set(missKey, Date.now() + MISS_TTL);
      throw new Error(`No confident match on AniKoto for "${title}"`);
    }
    best = raceResult.best;
    const matchType = raceResult.score >= STRICT_MATCH_THRESHOLD ? 'same-lang' : 'cross-lang';
    console.log(`[AniKoto] Best match [${raceResult.source}/${matchType}]: "${best.animeTitle}" (score: ${raceResult.score.toFixed(2)})`);
    if (animeId && best?.slug && raceResult.score >= STRICT_MATCH_THRESHOLD) {
      saveVerifiedSlug(animeId, 'anikoto', best.slug, { title: best.animeTitle });
    }
  }

  // ── Step 4: Resolve internal numeric anime ID ──
  if (!searchResult) {
    const currentSlug = best ? best.slug : '';
    const currentTitle = best ? best.animeTitle : '';
    let kotoInternalId = (best?.animeId && best.animeId !== 'resolve') ? best.animeId : lsGet(`koto_int_id_${currentSlug}`);
    const watchUrl = (best?.fullUrl && best?.fullUrl.startsWith('http'))
      ? best.fullUrl
      : `${domain}/watch/${currentSlug}`;

    if (!kotoInternalId) {
      console.log(`[AniKoto] Fetching watch page to resolve real ID: ${watchUrl}`);
      const watchHtml = await clientFetch(watchUrl, { referer: domain, timeout: 7000 });
      const idMatch = watchHtml.match(/data-id="(\d+)"/i)
        || watchHtml.match(/const mangaId = (\d+);/i)
        || watchHtml.match(/\/getinfo\/(\d+)/i);
      if (!idMatch) throw new Error('Could not resolve anime ID on AniKoto');
      kotoInternalId = idMatch[1];
      console.log(`[AniKoto] Extracted internal animeId: ${kotoInternalId}`);
      lsSet(`koto_int_id_${currentSlug}`, kotoInternalId);
    } else {
      console.log(`[AniKoto] Using verified internal animeId: ${kotoInternalId}`);
    }

    searchResult = { slug: currentSlug, animeId: kotoInternalId, animeTitle: currentTitle, watchUrl };
    kotoSearchCache.set(title, searchResult);
    lsSet(lsSearchKey('koto', title), searchResult);
  }

  const { slug, animeId: kotoId, animeTitle, watchUrl } = searchResult;

  // Per-episode result cache
  const cacheKey = `${slug}-${episode}`;
  if (kotoEpCache.has(cacheKey)) {
    return kotoEpCache.get(cacheKey);
  }

  // ── Super-Fast O(1) Episode Lookup Algorithm ──
  let targetIds = null;

  // 0. Check in-memory or persisted episode Map cache (0.0001 ms instant hash lookup)
  let epMap = kotoEpMapCache.get(kotoId);
  if (!epMap) {
    const lsMap = lsGet(`koto_epmap_${kotoId}`);
    if (lsMap && typeof lsMap === 'object') {
      epMap = new Map(Object.entries(lsMap).map(([k, v]) => [Number(k), v]));
      kotoEpMapCache.set(kotoId, epMap);
    }
  }
  if (epMap && epMap.has(Number(episode))) {
    targetIds = epMap.get(Number(episode));
  }

  // Episode list cache (only fetched if targetIds not already in epMap!)
  let epsHtml = '';
  if (!targetIds) {
    epsHtml = kotoEpListCache.get(kotoId) || '';
    if (!epsHtml) {
      const lsEps = lsGet(`koto_eplist_${kotoId}`);
      if (lsEps) {
        epsHtml = typeof lsEps === 'object' && lsEps?.html ? lsEps.html : (typeof lsEps === 'string' ? lsEps : '');
        if (epsHtml) kotoEpListCache.set(kotoId, epsHtml);
      }
    }
    if (!epsHtml) {
      const epsUrl = `${domain}/ajax/episode/list/${kotoId}`;
      console.log(`[AniKoto] Fetching episode list: ${epsUrl}`);
      const epsResp = await clientFetch(epsUrl, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        referer: watchUrl,
        timeout: 6000
      });
      const epsParsed = JSON.parse(epsResp);
      if (epsParsed.status !== 200 || !epsParsed.result) {
        throw new Error(`Failed to load episodes for ${animeTitle}`);
      }
      epsHtml = typeof epsParsed.result === 'object' && epsParsed.result?.html ? epsParsed.result.html : (typeof epsParsed.result === 'string' ? epsParsed.result : '');
      if (!epsHtml) throw new Error(`Empty episode HTML for ${animeTitle}`);
      kotoEpListCache.set(kotoId, epsHtml);
      lsSet(`koto_eplist_${kotoId}`, epsHtml);
    }

    // Direct Boyer-Moore needle search (0.05 ms search directly for data-num="N")
    const epNumStr = String(episode);
    const needle = `data-num="${epNumStr}"`;
    const idx = epsHtml.indexOf(needle);
    if (idx !== -1) {
      const start = Math.max(0, idx - 100);
      const snippet = epsHtml.slice(start, idx + 400);
      const mIds = snippet.match(/data-ids="([^"]+)"/);
      if (mIds) {
        targetIds = mIds[1];
      }
    }

    // Parse & index all episodes into kotoEpMapCache & localStorage for 0ms future lookups
    if (!epMap) {
      epMap = new Map();
      const looserRe = /data-num="(\d+)"[^>]*data-ids="([^"]+)"|data-ids="([^"]+)"[^>]*data-num="(\d+)"/g;
      let lMatch;
      while ((lMatch = looserRe.exec(epsHtml)) !== null) {
        const num = parseInt(lMatch[1] || lMatch[4], 10);
        const ids = lMatch[2] || lMatch[3];
        if (!isNaN(num) && ids) {
          epMap.set(num, ids);
        }
      }
      if (epMap.size > 0) {
        kotoEpMapCache.set(kotoId, epMap);
        lsSet(`koto_epmap_${kotoId}`, Object.fromEntries(epMap));
        if (!targetIds && epMap.has(Number(episode))) {
          targetIds = epMap.get(Number(episode));
        }
      }
    }

    // Ultimate fallback: original regex
    if (!targetIds) {
      const epRe = /data-id="([^"]+)"[^>]*data-num="(\d+)"[^>]*data-slug="[^"]*"[^>]*data-mal="[^"]*"[^>]*data-timestamp="[^"]*"[^>]*data-sub="[^"]*"[^>]*data-dub="[^"]*"[^>]*data-ids="([^"]+)"/g;
      let epMatch;
      while ((epMatch = epRe.exec(epsHtml)) !== null) {
        const epNum = epMatch[2];
        const epIds = epMatch[3];
        if (parseInt(epNum, 10) === parseInt(episode, 10)) {
          targetIds = epIds;
          break;
        }
      }
    }
  }

  if (!targetIds) {
    // Episode not found — clear any cached match for this title so a bad match
    // doesn't persist across app restarts via localStorage
    kotoSearchCache.delete(title);
    try { localStorage.removeItem(lsSearchKey('koto', title)); } catch {}
    throw new Error(`Episode ${episode} not found on AniKoto (matched: "${animeTitle}") — server hidden`);
  }

  // Get server list
  const srvUrl = `${domain}/ajax/server/list?servers=${encodeURIComponent(targetIds)}`;
  console.log(`[AniKoto] Fetching server list: ${srvUrl}`);
  const srvResp = await clientFetch(srvUrl, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    referer: watchUrl,
    timeout: 6000
  });
  const srvParsed = JSON.parse(srvResp);
  if (srvParsed.status !== 200 || !srvParsed.result) {
    throw new Error(`Failed to load server list for episode ${episode}`);
  }

  const srvHtml = srvParsed.result;
  const sections = srvHtml.split(/<div\s+class="type"/i);
  const rawServers = [];
  for (const sec of sections) {
    const typeMatch = sec.match(/data-type="(sub|dub|hsub|raw)"/i);
    if (!typeMatch) continue;
    const type = typeMatch[1];
    if (type !== 'sub' && type !== 'dub') continue;
    const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]+?)<\/li>/g;
    let liMatch;
    while ((liMatch = liRe.exec(sec)) !== null) {
      const linkId = liMatch[1];
      const name = liMatch[2].replace(/<[^>]+>/g, '').trim();
      rawServers.push({ type, linkId, serverName: name });
    }
  }

  if (rawServers.length === 0) {
    throw new Error(`No servers found for episode ${episode} on AniKoto`);
  }

  // Resolve AniHD, MegaPlay, and AniVid from distinct server streams
  const hasHd1 = rawServers.some(s => s.serverName === 'HD-1');
  const ALLOWED_SERVERS = [
    { match: name => hasHd1 ? name === 'HD-1' : /vidstream-?2/i.test(name), label: 'AniHD', isHLS: false },
    { match: name => /vidstream-?2/i.test(name) || (!hasHd1 && /vidstream/i.test(name)), label: 'MegaPlay', isHLS: false },
    { match: name => /vidstream-?1/i.test(name) || /vidplay|vidtube/i.test(name), label: 'AniVid', isHLS: false },
  ];

  const filteredServers = [];
  for (const allowed of ALLOWED_SERVERS) {
    for (const s of rawServers) {
      if (allowed.match(s.serverName)) {
        filteredServers.push({ ...s, label: allowed.label, isHLS: allowed.isHLS });
      }
    }
  }

  if (filteredServers.length === 0) {
    throw new Error(`No AniHD/MegaPlay servers found for episode ${episode} on AniKoto`);
  }

  const resolved = await Promise.allSettled(
    filteredServers.map(async (s) => {
      try {
        const getUrl = `${domain}/ajax/server?get=${encodeURIComponent(s.linkId)}`;
        const resp = await clientFetch(getUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          referer: watchUrl,
          timeout: 3000
        });
        const parsed = JSON.parse(resp);
        const embedUrl = parsed.result?.url || '';
        if (!embedUrl) return null;

        let serverReferer = domain + '/';
        try {
          if (embedUrl) serverReferer = new URL(embedUrl).origin + '/';
        } catch (_) {}

        const displayName = s.type === 'dub' && !s.label.includes('DUB') ? `${s.label} (DUB)` : s.label;

        return {
          name: displayName,
          videoUrl: formatIframeProxyUrl(embedUrl, domain),
          embedUrl,
          referer: serverReferer,
          type: s.type,
          subtitles: [],
          isHLS: false
        };
      } catch (err) {
        return null;
      }
    })
  );

  const seenKeys = new Set();
  const seenUrls = new Set();
  const servers = resolved
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .filter(srv => {
      const k = `${srv.name}_${srv.type}`;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });

  if (servers.length === 0) {
    throw new Error(`Failed to resolve KotoHD/KotoVid stream URLs for episode ${episode}`);
  }

  const resultData = { servers, animeTitle, slug };
  kotoEpCache.set(cacheKey, resultData);
  return resultData;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Animetsu Scraper Ã¢â€â‚¬Ã¢â€â‚¬

// Stream URL cache: animeId/episode/type -> { data, expires } (TTL: 4 hours)
const STREAM_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function getStreamCache(animeId, episode, sourceType) {
  try {
    const key = `animetsu_stream_${animeId}_${episode}_${sourceType}`;
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      return null;
    }
    console.log(`[Animetsu] Cache HIT for ${sourceType} ep${episode} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â instant play`);
    return data;
  } catch { return null; }
}

function setStreamCache(animeId, episode, sourceType, data) {
  try {
    const key = `animetsu_stream_${animeId}_${episode}_${sourceType}`;
    localStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + STREAM_CACHE_TTL_MS }));
  } catch {}
}

// Fetches a stream URL from Animetsu ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â all servers race in PARALLEL, fastest wins.
async function fetchAnimetsuStream(animeId, episode, sourceType) {
  // Check session cache first ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â avoids re-fetching same episode within 25 min
  const cached = getStreamCache(animeId, episode, sourceType);
  if (cached) return cached;

  const proxyBase = 'https://swiftstream.top/proxy';
  const SERVERS = ['hd1', 'vidstream', 'filemoon'];

  const attempts = SERVERS.map(async (server) => {
    const url = `${ANIMETSU}/v2/api/anime/oppai/${animeId}/${episode}?server=${server}&source_type=${sourceType}`;
    const html = await clientFetch(url, { referer: `${ANIMETSU}/watch/${animeId}`, timeout: 12000 });
    const data = JSON.parse(html);
    if (!data.sources?.length) throw new Error(`${server}: no sources`);
    const source = data.sources[0];
    const rawVideoUrl = source.url.startsWith('http') ? source.url : `${proxyBase}${source.url}`;
    console.log(`[Animetsu] ${sourceType} resolved via server: ${server}`);
    return { rawVideoUrl, subs: data.subs || [], server };
  });

  try {
    // Promise.any returns the FIRST fulfilled promise ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â fastest server wins
    const result = await Promise.any(attempts);
    // Cache the result for repeat plays
    setStreamCache(animeId, episode, sourceType, result);
    return result;
  } catch {
    // AggregateError: all servers failed
    return null;
  }
}


export async function scrapeAnimetsu(title, episode, isMovie = false) {
  let best = animetsuSearchCache.get(title);
  if (!best) {
    const cleanTitle = title.replace(/[\u2018\u2019\u0060\u00B4'`']/g, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); // Strip all apostrophe variants
    const words = cleanTitle.split(' ').filter(w => w.length > 1);
    let searchQueries = [cleanTitle];
    if (words.length > 2) {
      searchQueries.push(words.slice(0, 3).join(' '));
    }
    searchQueries = [...new Set(searchQueries)].filter(Boolean);

    let results = [];
    for (const query of searchQueries) {
      try {
        const searchUrl = `${ANIMETSU}/v2/api/anime/search/?query=${encodeURIComponent(query)}`;
        const searchHtml = await clientFetch(searchUrl, { referer: `${ANIMETSU}/watch/`, timeout: 10000 });
        const searchData = JSON.parse(searchHtml);
        if (searchData.results && searchData.results.length > 0) {
          searchData.results.forEach(r => {
            results.push({ id: r.id, title: r.title.english || r.title.romaji || r.title.native || '' });
          });
          break;
        }
      } catch {}
    }

    if (!results.length) throw new Error(`Anime not found on Animetsu`);

    best = null;
    let maxScore = -1;
    for (const r of results) {
      const score = titleScore(r.title, title, isMovie);
      if (score > maxScore) { maxScore = score; best = r; }
    }
    if (!best || maxScore < 0.75) throw new Error(`No match on Animetsu (score too low: ${maxScore.toFixed(2)})`);  // Strict threshold prevents wrong-anime matches

    animetsuSearchCache.set(title, best);
  }

  // Use cached episode list if available (saves 1 round-trip per episode click)
  let epsData = animetsuEpsCache.get(best.id);
  if (!epsData) {
    const epsUrl = `${ANIMETSU}/v2/api/anime/eps/${best.id}`;
    const epsHtml = await clientFetch(epsUrl, { referer: `${ANIMETSU}/watch/${best.id}`, timeout: 10000 });
    epsData = JSON.parse(epsHtml);
    if (epsData && epsData.length) {
      animetsuEpsCache.set(best.id, epsData);
    }
  }
  if (!epsData || !epsData.length) throw new Error(`No episodes found`);

  let epItem = null;
  const targetEpNum = Number(episode);
  if (epsData[targetEpNum - 1] && Number(epsData[targetEpNum - 1].ep_num) === targetEpNum) {
    epItem = epsData[targetEpNum - 1];
  } else {
    epItem = epsData.find(x => Number(x.ep_num) === targetEpNum);
  }
  if (!epItem) throw new Error(`Episode not found`);

  // Fetch sub and dub streams in parallel, each trying multiple servers
  const [subResult, dubResult] = await Promise.allSettled([
    fetchAnimetsuStream(best.id, episode, 'sub'),
    fetchAnimetsuStream(best.id, episode, 'dub'),
  ]);

  const servers = [];
  if (subResult.status === 'fulfilled' && subResult.value) {
    const { rawVideoUrl, subs } = subResult.value;
    const videoUrl = formatProxyUrl(rawVideoUrl, `${ANIMETSU}/`);
    const subtitles = subs.map((sub, i) => {
      const absoluteSubUrl = sub.url.startsWith('http') ? sub.url : `${ANIMETSU}${sub.url.startsWith('/') ? '' : '/'}${sub.url}`;
      return {
        id: i,
        label: sub.lang || 'English',
        file: absoluteSubUrl,
        referer: `${ANIMETSU}/`,
      };
    });
    servers.push({ name: 'AniHD', videoUrl, type: 'sub', embedUrl: rawVideoUrl, referer: `${ANIMETSU}/`, subtitles, isHLS: true });
  }
  if (dubResult.status === 'fulfilled' && dubResult.value) {
    const { rawVideoUrl } = dubResult.value;
    const videoUrl = formatProxyUrl(rawVideoUrl, `${ANIMETSU}/`);
    servers.push({ name: 'AniHD (DUB)', videoUrl, type: 'dub', embedUrl: rawVideoUrl, subtitles: [], isHLS: true });
  }

  if (!servers.length) throw new Error(`No sources available from Animetsu for episode ${episode}`);

  return { servers, animeTitle: best.title, slug: best.id };
}
