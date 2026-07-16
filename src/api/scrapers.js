import { CapacitorHttp } from '@capacitor/core';
import { scrapeEmbedNative, solveCloudflareNative, getCookiesForUrlNative, fetchViaWebViewNative } from './embedScraper.js';

const isCapacitorApp = typeof window !== 'undefined' && window.Capacitor && (
  window.Capacitor.isNativePlatform() || 
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

export let ANINEKO = 'https://anineko.to';
export let AW = 'https://aniwaves.ru';
export let ANIMETSU = 'https://animetsu.net';
export let ANIKOTO = 'https://anikoto.cz';

export function setDynamicDomains(newDomains) {
  if (!newDomains) return;
  if (newDomains.neko) ANINEKO = newDomains.neko;
  if (newDomains.waves) AW = newDomains.waves;
  if (newDomains.animetsu) ANIMETSU = newDomains.animetsu;
  if (newDomains.anikoto) ANIKOTO = newDomains.anikoto;
  console.log('[Scrapers] Dynamic domains updated:', { ANINEKO, AW, ANIMETSU, ANIKOTO });
}

// ─── ID-Based Cross-Reference Mapping System ───
// Maps AniList IDs directly to piracy provider slugs to bypass unstable fuzzy string searching
const STATIC_MAPPINGS = {
  // Frieren: Beyond Journey's End
  '154587': {
    neko: 'frieren-beyond-journeys-end',
    anikoto: 'frieren-beyond-journey-s-end-c6fbj',
    waves: 'frieren-beyond-journey-s-end-c6fb'
  },
  // One Piece
  '21': {
    neko: 'one-piece',
    anikoto: 'one-piece-odmau',
    waves: 'one-piece-odmau'
  },
  // Sword Art Online
  '11757': {
    neko: 'sword-art-online',
    anikoto: 'sword-art-online-c6fbv',
    waves: 'sword-art-online-c6fbv'
  }
};

let dynamicMappings = {};

export function setDynamicMappings(mappings) {
  if (mappings) {
    dynamicMappings = mappings;
    console.log('[Scrapers] Dynamic ID mappings loaded:', Object.keys(mappings).length);
  }
}

export function getMappedSlug(animeId, provider) {
  if (!animeId) return null;
  const idStr = String(animeId);
  if (dynamicMappings[idStr]?.[provider]) {
    return dynamicMappings[idStr][provider];
  }
  if (STATIC_MAPPINGS[idStr]?.[provider]) {
    return STATIC_MAPPINGS[idStr][provider];
  }
  return null;
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

function formatSubtitleProxyUrl(targetUrl, referer) {
  if (!STREAM_PROXY) return targetUrl;
  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  if (isNative && (STREAM_PROXY.includes('localhost') || STREAM_PROXY.includes('127.0.0.1'))) {
    return targetUrl;
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

// ── localStorage-backed persistent cache helpers ──
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
  } catch {}
}

function lsSearchKey(scraper, title) {
  return `anisearch_${scraper}_${title.toLowerCase().replace(/\s+/g, '_').slice(0, 60)}`;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper Matching Functions Ã¢â€â‚¬Ã¢â€â‚¬

function norm(s) {
  return s.toLowerCase()
    .replace(/[’‘ʼ´`']/g, '')        // Normalize and contract all single quotes/apostrophes: journey’s → journeys
    .replace(/["“”]/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAnimeTitle(title) {
  return title
    .replace(/[’‘ʼ´`']/g, ' ')      // Replace all single quotes/apostrophes with space for searching
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// ── Cross-language trigram helpers (for English ↔ Japanese-romaji bridging) ──

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
 * Cross-language title score: handles English ↔ Japanese-romanized mismatch.
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
 * 0.88 same-language threshold, so it never beats a proper word-intersection match.
 */
function crossLangScore(resultTitle, queryTitle) {
  const rn = norm(resultTitle);
  const qn = norm(queryTitle);

  // Season must match before we even attempt cross-lang scoring
  if (extractSeason(rn) !== extractSeason(qn)) return 0;

  // Movie/TV consistency — don't cross-match movies with series
  const resultIsMovie = /\b(movie|film)\b/i.test(rn);
  const queryIsMovie  = /\b(movie|film)\b/i.test(qn);
  if (resultIsMovie !== queryIsMovie) return 0;

  // The first meaningful word must be shared — anchors the character/show name
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
  if (firstWordSim < 0.5) return 0;

  // All checks passed — this is a plausible cross-language match.
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
  const recapKeywords = /\b(recap|summary|preview|side\s*story|special|specials)\b/i;
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
      .replace(/[''ʼ´`']/g, '')     // remove all forms of apostrophes first: journey's → journeys
      .replace(/\b(season|part|s)\s*\d+\b/gi, '')
      .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
      .replace(/\b(sub|dub|uncensored|uncut|tv|movie|ova|ona|special|specials|multi|audio|recap|summary|preview|side\s*story|mini|short|shorts|chibi|break\s*time|breaktime|petit|petite|spin\s*off|spinoff)\b/gi, '')
      .trim();

  const qWords = strip(qn).split(/\s+/).filter(w => w.length > 1);
  const rWords = strip(rn).split(/\s+/).filter(w => w.length > 1);

  if (!qWords.length || !rWords.length) return 0;

  const intersection = qWords.filter(w =>
    rWords.includes(w) || rWords.some(rw => trigramSimilarity(w, rw) >= 0.7)
  );

  // ── Cross-language fallback ──────────────────────────────────────────────────
  // When word-intersection is zero, the two titles may be the same anime but in
  // different naming systems (English vs Japanese-romanized). Use trigram similarity
  // as a soft bridge. This is capped at 0.75 so it never beats a true word-match.
  if (intersection.length === 0) {
    return crossLangScore(resultTitle, queryTitle);
  }
  // ────────────────────────────────────────────────────────────────────────────

  const score = (2 * intersection.length) / (qWords.length + rWords.length);

  // Hard-block FORWARD: if result has ANY significant extra word not in the query title,
  // it's a different show (spin-off, sequel subtitle, etc.) — return 0.
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
  // e.g. query="...Nanoha EXCEEDS Gun BlazeVengeance" vs result="...Nanoha" — block it.
  const uniqueQueryWords = qWords.filter(w =>
    w.length >= 5
    && !GENERIC_WORDS.has(w)
    && !/^(season|part|episode|ep|tv|movie|ova|ona|special|specials|dub|sub|uncensored|uncut|multi|audio)$/i.test(w)
    && !/^\d+$/.test(w)
  );
  if (uniqueQueryWords.length > 0) {
    const missingFromResult = uniqueQueryWords.filter(w => !rWords.includes(w));
    // If ANY unique discriminating word from the query is absent from the result → hard block
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper matching and validation Ã¢â€â‚¬Ã¢â€â‚¬

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

// Ã¢â€â‚¬Ã¢â€â‚¬ Generic Fetch Helper with Headers Ã¢â€â‚¬Ã¢â€â‚¬

async function clientFetch(url, opts = {}) {
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
        connectTimeout: opts.timeout || 60000,
        readTimeout: opts.timeout || 60000
      });
      
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      if (response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      if (isCloudflareChallenge(text)) {
        throw new Error('Cloudflare challenge detected');
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
      return pText;
    } catch (e) {
      console.warn(`[LocalProxy] Fetch failed for ${url} via proxy:`, e.message);
    }
  }

  // Fallback direct request
  const headers = { ...opts.headers };
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 60000),
    headers
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const fText = await res.text();
  if (isCloudflareChallenge(fText)) throw new Error('Cloudflare challenge detected');
  return fText;
}

async function awSearch(title, isMovie = false) {
  const cleaned = title.replace(/\b(season|part|s)\s*\d+\b/gi, '').trim();
  const engWords = cleaned.split(/[^a-zA-Z0-9]/).filter(w =>
    w.length > 3 && !/^(the|and|with|from|that|this|into|over|under|behind|you)$/i.test(w)
  );
  const longestWord = engWords.length ? engWords.reduce((a, b) => a.length >= b.length ? a : b) : null;
  const firstTwo = cleaned.split(' ').slice(0, 2).join(' ');
  const firstThree = cleaned.split(' ').slice(0, 3).join(' ');

  const strategies = [cleaned, firstThree, firstTwo, longestWord].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);

  // Helper: fetch and parse one search keyword
  async function tryKeyword(keyword) {
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
  }

  // SPEED: fire all strategies simultaneously â€” resolve as soon as the first one returns results.
  // This is a true parallel race: if the full-title keyword responds in 800ms we don't wait
  // 4+ more seconds for the remaining strategies to finish.
  const results = await new Promise((resolve) => {
    let done = false;
    let pending = strategies.length;
    for (const kw of strategies) {
      tryKeyword(kw).then(r => {
        pending--;
        if (!done && r.length > 0) { done = true; resolve(r); }
        else if (pending === 0 && !done) resolve([]); // all failed
      }).catch(() => {
        pending--;
        if (pending === 0 && !done) resolve([]);
      });
    }
  });

  if (results.length === 0) throw new Error(`Anime "${title}" not found on AniWaves`);

  // ACCURACY: score every candidate; exact normalized match always wins
  let best = results[0], maxScore = -1;
  for (const r of results) {
    // Exact match short-circuit Ã¢â‚¬â€ guaranteed winner
    if (norm(r.animeTitle) === norm(title)) return r;

    let score = titleScore(r.animeTitle, title, isMovie);
    const slugText = r.slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    score = Math.max(score, titleScore(slugText, title, isMovie));
    if (score > maxScore) { maxScore = score; best = r; }
  }

  // Strict 0.88 threshold — must match the full anime name with high confidence
  if (!best || maxScore < 0.88) {
    throw new Error(`No confident match on AniWaves for "${title}" (best score: ${maxScore.toFixed(2)})`);
  }
  return best;
}

// Session cache for Waves server lists: animeId/episode -> { servers, expires }
// TTL = 25 minutes (matching Animetsu cache Ã¢â‚¬â€ embed URLs typically expire in ~30 min)
const WAVES_CACHE_TTL_MS = 25 * 60 * 1000;

function getWavesServersCache(animeId, episode) {
  try {
    const key = `waves_servers_${animeId}_${episode}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    console.log(`[AniWaves] Cache HIT for servers ep${episode} Ã¢â‚¬â€ instant play`);
    return data;
  } catch { return null; }
}

function setWavesServersCache(animeId, episode, data) {
  try {
    const key = `waves_servers_${animeId}_${episode}`;
    sessionStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + WAVES_CACHE_TTL_MS }));
  } catch {}
}

function getWavesEmbedCache(linkId) {
  try {
    const key = `waves_embed_${linkId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { url, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    return url;
  } catch { return null; }
}

function setWavesEmbedCache(linkId, url) {
  try {
    const key = `waves_embed_${linkId}`;
    sessionStorage.setItem(key, JSON.stringify({ url, expires: Date.now() + WAVES_CACHE_TTL_MS }));
  } catch {}
}

// Fetch episode list for an anime and map episode number Ã¢â€ â€™ internal episode ID
// AniWaves (aniwatch-based) uses internal episode IDs in its server API, not episode numbers.
async function awGetEpisodeId(animeId, episodeNumber, slug) {
  const cacheKey = `waves_epid_${animeId}_${episodeNumber}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch {}

  const referer = slug ? `${AW}/watch/${slug}` : AW;
  const text = await clientFetch(`${AW}/ajax/anime/episode-list?id=${animeId}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': referer },
    timeout: 6000,
  });
  const parsed = JSON.parse(text);
  if (!parsed.status || !parsed.result) throw new Error('No episode list');

  const html = parsed.result;
  // Episodes are rendered as <a data-id="123" data-number="5" ...> or <li data-id="123" data-number="5">
  const epRe = /data-id="([^"]+)"[^>]*data-number="(\d+)"|data-number="(\d+)"[^>]*data-id="([^"]+)"/g;
  let m, foundId = null;
  while ((m = epRe.exec(html)) !== null) {
    const id  = m[1] || m[4];
    const num = parseInt(m[2] || m[3]);
    if (!isNaN(num) && id) {
      try { sessionStorage.setItem(`waves_epid_${animeId}_${num}`, id); } catch {}
      if (num === episodeNumber) foundId = id;
    }
  }
  if (!foundId) throw new Error(`Episode ${episodeNumber} ID not found in list`);
  return foundId;
}

async function awGetServers(animeId, episode, slug) {
  const referer = slug ? `${AW}/watch/${slug}` : AW;

  // ACCURACY FIX: Resolve the real internal episode ID so we always get the correct episode.
  // AniWaves uses internal DB IDs in its server API Ã¢â‚¬â€ passing raw episode number causes
  // wrong episodes when the site's numbering differs from AniList (e.g. due to specials/OVAs).
  let epsParam = episode; // fallback: raw episode number
  try {
    const episodeId = await awGetEpisodeId(animeId, episode, slug);
    epsParam = episodeId;
    console.log(`[AniWaves] Resolved ep${episode} Ã¢â€ â€™ internal ID: ${episodeId}`);
  } catch (e) {
    console.warn(`[AniWaves] Episode ID lookup failed, using raw number: ${e.message}`);
  }

  const url = `${AW}/ajax/server/list?servers=${animeId}&eps=${epsParam}`;
  const text = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': referer },
    timeout: 8000,
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
  // Check embed cache first Ã¢â‚¬â€ same linkId always resolves to same URL within session
  const cached = getWavesEmbedCache(linkId);
  if (cached) {
    console.log(`[AniWaves] Embed cache HIT for linkId ${linkId}`);
    return cached;
  }

  const url = `${AW}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`;
  const text = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': `${AW}/watch/${watchPageSlug}` },
    timeout: 8000,
  });
  const parsed = JSON.parse(text);
  if (parsed.status !== 200 || !parsed.result?.url) throw new Error(`No embed URL`);
  setWavesEmbedCache(linkId, parsed.result.url);
  return parsed.result.url;
}


export async function scrapeAniWaves(title, episode, isMovie = false, animeId = null, allTitles = null) {
  let searchResult = wavesSearchCache.get(title);
  
  // Try industry-standard ID-based cross-referencing first
  const mappedSlug = getMappedSlug(animeId, 'waves');
  if (mappedSlug) {
    searchResult = { slug: mappedSlug, animeId: mappedSlug, animeTitle: title };
    console.log(`[AniWaves] ID Cross-Ref HIT for AniList ID ${animeId} ➔ "${mappedSlug}"`);
  } else if (!searchResult) {
    // Check localStorage before hitting the network
    const lsCached = lsGet(lsSearchKey('waves', title));
    if (lsCached) {
      console.log(`[AniWaves] localStorage cache HIT for "${title}" — instant`);
      searchResult = lsCached;
      wavesSearchCache.set(title, searchResult);
    } else {
      // Try all provided title variants — first successful match wins
      const titlesToTry = allTitles?.length ? allTitles : [title];
      let lastErr = null;
      for (const t of titlesToTry) {
        try {
          searchResult = await awSearch(t, isMovie);
          wavesSearchCache.set(title, searchResult);
          lsSet(lsSearchKey('waves', title), searchResult);
          break;
        } catch (e) {
          lastErr = e;
          console.warn(`[AniWaves] awSearch failed for "${t}": ${e.message}`);
        }
      }
      if (!searchResult) throw lastErr || new Error(`Anime "${title}" not found on AniWaves`);
    }
  }
  const { slug, animeId: wavesId, animeTitle } = searchResult;

  // Check session cache — skip all API calls if same episode was already fetched
  const cached = getWavesServersCache(wavesId, episode);
  if (cached) return { servers: cached, animeTitle, slug };

  const rawServers = await awGetServers(wavesId, episode, slug);
  const servers = [];

  // Parallelize sub and dub server resolution to halve latency
  const [subRes, dubRes] = await Promise.all([
    (async () => {
      const subServers = rawServers.filter(s => s.type === 'sub').slice(0, 2);
      for (const s of subServers) {
        try {
          const embedUrl = await awGetEmbedUrl(s.linkId, slug);
          const videoUrl = formatIframeProxyUrl(embedUrl, `${AW}/watch/${slug}`);
          return { name: 'WavesHD', videoUrl, type: 'sub', embedUrl, serverName: s.serverName, referer: `${AW}/watch/${slug}`, isHLS: false };
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
          const videoUrl = formatIframeProxyUrl(embedUrl, `${AW}/watch/${slug}`);
          return { name: 'WavesHD (DUB)', videoUrl, type: 'dub', embedUrl, serverName: s.serverName, referer: `${AW}/watch/${slug}`, isHLS: false };
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

// Ã¢â€â‚¬Ã¢â€â‚¬ AniNeko Scraper Ã¢â€â‚¬Ã¢â€â‚¬

// Session cache for Neko episode servers: slug+episode -> { servers, expires }
const NEKO_CACHE_TTL_MS = 25 * 60 * 1000;

function getNekoEpisodeCache(slug, episode) {
  try {
    const key = `neko_ep_${slug}_${episode}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    console.log(`[AniNeko] Cache HIT for ${slug} ep${episode} Ã¢â‚¬â€ instant play`);
    return data;
  } catch { return null; }
}

function setNekoEpisodeCache(slug, episode, servers) {
  try {
    const key = `neko_ep_${slug}_${episode}`;
    sessionStorage.setItem(key, JSON.stringify({ data: servers, expires: Date.now() + NEKO_CACHE_TTL_MS }));
  } catch {}
}

export async function scrapeAniNeko(title, episode, isMovie = false, animeId = null, allTitles = null) {
  let best, results;
  
  // Try industry-standard ID-based cross-referencing first
  const mappedSlug = getMappedSlug(animeId, 'neko');
  if (mappedSlug) {
    best = { slug: mappedSlug, title: title };
    results = [best];
    console.log(`[AniNeko] ID Cross-Ref HIT for AniList ID ${animeId} ➔ "${mappedSlug}"`);
  } else {
    // Fallback to memory search cache
    const cached = nekoSearchCache.get(title);
    if (cached) {
      best = cached.best;
      results = cached.results;
    } else {
      // Build search queries from ALL title variants (romaji, english, synonyms)
      // AniNeko uses Japanese-romanized names, so romaji is most likely to match directly
      const titlesToSearch = allTitles?.length ? allTitles : [title];
      const allQueries = new Set();
      for (const t of titlesToSearch) {
        const cleanT = t.replace(/'/g, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const words = cleanT.split(' ').filter(w => w.length > 1);
        allQueries.add(cleanT);
        if (words.length > 1) {
          allQueries.add(words.slice(0, 3).join(' '));
          allQueries.add(words.slice(0, 2).join(' '));
        }
        allQueries.add(getLongestWord(t));
      }
      const searchQueries = [...allQueries].filter(Boolean);

      results = [];
      const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>/g;

      // Search all queries in parallel for speed and aggregation
      await Promise.all(searchQueries.map(async (keyword) => {
        try {
          const searchHtml = await clientFetch(`${ANINEKO}/browser?keyword=${encodeURIComponent(keyword)}`, { referer: ANINEKO, timeout: 10000 });
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(searchHtml)) !== null) {
            const found = { slug: m[1], title: m[2].trim() };
            // Thread-safe inclusion check
            if (!results.some(r => r.slug === found.slug)) {
              results.push(found);
            }
          }
        } catch (e) {
          console.warn('[scrapeAniNeko] Search failed for ' + keyword + ':', e.message);
        }
      }));

      if (!results.length) throw new Error(`Anime not found on AniNeko`);

      best = results[0];
      let maxScore = -1;
      // Score against ALL provided titles — pick whichever pairing gives the highest score
      const allQueryTitles = allTitles?.length ? allTitles : [title];
      for (const r of results) {
        let score = 0;
        for (const qt of allQueryTitles) {
          score = Math.max(score, titleScore(r.title, qt, isMovie));
        }
        if (score > maxScore) { maxScore = score; best = r; }
      }
      // Threshold: cross-lang matches score up to 0.75, same-lang up to 1.0
      // Use 0.35 as the floor to accept cross-language matches
      if (!best || maxScore < 0.35) {
        throw new Error(`No match on AniNeko for "${title}" (score: ${maxScore.toFixed(2)})`);
      }
      if (maxScore < 0.88) {
        console.log(`[AniNeko] Cross-language match: "${best.title}" for "${title}" (score: ${maxScore.toFixed(2)})`);
      }

      nekoSearchCache.set(title, { best, results });
    }
  }

  // Check episode-level session cache before fetching any watch pages
  const nekoEpCached = getNekoEpisodeCache(best.slug, episode);
  if (nekoEpCached) return { servers: nekoEpCached, animeTitle: best.title, slug: best.slug };

  const subUrl = `${ANINEKO}/watch/${best.slug}/ep-${episode}`;
  const urlsToFetch = [{ url: subUrl, isDubPage: best.slug.endsWith('-dub') }];
  if (!best.slug.endsWith('-dub')) {
    const hasDubInSearch = results.some(r => r.slug === `${best.slug}-dub`);
    if (hasDubInSearch) {
      urlsToFetch.push({ url: `${ANINEKO}/watch/${best.slug}-dub/ep-${episode}`, isDubPage: true });
    }
  }

  const fetchedPages = await Promise.allSettled(
    urlsToFetch.map(async item => {
      const html = await clientFetch(item.url, { referer: ANINEKO, timeout: 25000 });
      return { html, isDubPage: item.isDubPage };
    })
  );

  const rawServers = [];
  for (const page of fetchedPages) {
    if (page.status !== 'fulfilled') continue;
    const { html, isDubPage } = page.value;
    const panelsRe = /<div[^>]+data-id="(sub|dub)[\s\S]*?<\/div>\s*<\/div>/g;
    let pMatch;
    while ((pMatch = panelsRe.exec(html)) !== null) {
      const panelId = pMatch[1];
      const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
      let m;
      while ((m = btnRe.exec(pMatch[0])) !== null) {
        let videoUrl = m[1];
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        // Load all available servers, not just HD-1
        rawServers.push({
          videoUrl,
          serverName: name,
          isDub: isDubPage || panelId === 'dub' || name.toLowerCase().includes('dub')
        });
      }
    }
  }

  // First pass: collect all subtitle URLs across all sub servers
  // and find the best sub server (prefer one WITH a subtitle URL)
  const seen = new Set();
  const servers = [];
  let bestSubServer = null;
  let bestSubtitleUrl = '';
  let bestDubServer = null;

  for (const s of rawServers) {
    if (seen.has(s.videoUrl)) continue;
    seen.add(s.videoUrl);

    let subtitleUrl = '';
    try {
      const urlObj = new URL(s.videoUrl);
      subtitleUrl = urlObj.searchParams.get('sub') || urlObj.searchParams.get('caption_1') || urlObj.searchParams.get('c1_file') || '';
    } catch {}

    if (!s.isDub) {
      // Prefer server with subtitle URL; fallback to first sub server found
      if (!bestSubServer || (subtitleUrl && !bestSubtitleUrl)) {
        bestSubServer = s;
        bestSubtitleUrl = subtitleUrl;
      }
    } else {
      if (!bestDubServer) bestDubServer = s;
    }
  }

  // Second pass: build the final servers array
  if (bestSubServer) {
    const subtitleFile = bestSubtitleUrl ? formatSubtitleProxyUrl(bestSubtitleUrl, bestSubServer.videoUrl) : '';
    const subtitles = subtitleFile ? [{ id: 0, label: 'English', file: subtitleFile, referer: ANINEKO + '/' }] : [];
    const proxiedUrl = formatIframeProxyUrl(bestSubServer.videoUrl, ANINEKO);
    servers.push({ name: 'NekoHD', videoUrl: proxiedUrl, embedUrl: bestSubServer.videoUrl, referer: ANINEKO + '/', type: 'sub', subtitles, isHLS: false });
  }
  if (bestDubServer) {
    const proxiedUrl = formatIframeProxyUrl(bestDubServer.videoUrl, ANINEKO);
    servers.push({ name: 'NekoHD (DUB)', videoUrl: proxiedUrl, embedUrl: bestDubServer.videoUrl, referer: ANINEKO + '/', type: 'dub', subtitles: [], isHLS: false });
  }

  // Cache the resolved servers for this episode
  if (servers.length > 0) setNekoEpisodeCache(best.slug, episode, servers);

  return { servers, animeTitle: best.title, slug: best.slug };
}


// ── AniKoto Scraper ──

const kotoSearchCache = new Map();  // title → { slug, animeId, animeTitle, watchUrl }
const kotoEpListCache = new Map();  // animeId → epsHtml (full episode list HTML)
const kotoEpCache = new Map();      // slug-episode → { servers, animeTitle, slug }

/**
 * Fast lightweight JSON search on AniKoto (same pattern as AniWaves).
 * Returns a results array or throws on failure.
 */
async function kotoJsonSearch(domain, keyword) {
  const url = `${domain}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`;
  const rawText = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
    referer: domain,
    timeout: 5000,
  });
  const parsed = JSON.parse(rawText);
  if (parsed.status === 404 || !parsed.result?.html) return [];
  const html = parsed.result.html;
  // Parse search results from HTML fragment
  // Slugs on AniKoto can be purely alphanumeric (e.g. "frieren-beyond-journey-s-end-c6fbj")
  // and URLs can be absolute (e.g. "https://anikoto.cz/watch/...") or relative.
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
  const searchHtml = await clientFetch(filterUrl, { referer: domain, timeout: 10000 });
  const itemRe = /<a\s+class="name d-title"\s+href="([^"]*?\/watch\/([^"\/]+)(?:\/ep-\d+)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const results = [];
  while ((m = itemRe.exec(searchHtml)) !== null) {
    results.push({ fullUrl: m[1], slug: m[2], animeTitle: m[3].replace(/<[^>]*>/g, '').trim() });
  }
  return results;
}

export async function scrapeAniKoto(title, episode, isMovie = false, animeId = null, allTitles = null) {
  const domain = ANIKOTO;

  // ── Step 1: Search cache (memory first, then localStorage) ──
  let searchResult = kotoSearchCache.get(title);
  if (!searchResult) {
    const lsCached = lsGet(lsSearchKey('koto', title));
    if (lsCached) {
      console.log(`[AniKoto] localStorage cache HIT for "${title}" — instant`);
      searchResult = lsCached;
      kotoSearchCache.set(title, searchResult);
    }
  }

  // ── Step 2: Resolve best match (ID mapping → network search) ──
  if (!searchResult) {
    let best = null;
    const mappedSlug = getMappedSlug(animeId, 'anikoto');

    if (mappedSlug) {
      // ── Industry-standard ID cross-reference: bypass search entirely ──
      best = { slug: mappedSlug, animeTitle: title };
      console.log(`[AniKoto] ID Cross-Ref HIT for AniList ID ${animeId} ➔ "${mappedSlug}"`);
    } else {
      // ── Fuzzy search fallback ──
      // Build strategies from ALL title variants (romaji, english, synonyms)
      // AniKoto uses Japanese-romanized names, so romaji usually matches directly
      const titlesToSearch = allTitles?.length ? allTitles : [title];
      const allQueryTitles = allTitles?.length ? allTitles : [title];
      const strategiesSet = new Set();
      for (const t of titlesToSearch) {
        const cleanT = cleanAnimeTitle(t);
        const engWords = cleanT.split(/[^a-zA-Z0-9]/).filter(w => w.length > 3);
        const longest = engWords.length ? engWords.reduce((a, b) => a.length >= b.length ? a : b) : null;
        strategiesSet.add(cleanT);
        strategiesSet.add(cleanT.split(' ').slice(0, 3).join(' '));
        strategiesSet.add(cleanT.split(' ').slice(0, 2).join(' '));
        if (longest) strategiesSet.add(longest);
      }
      const strategies = [...strategiesSet].filter(Boolean);
      const primaryCleanTitle = cleanAnimeTitle(title);

      console.log(`[AniKoto] Racing JSON search + filter page for "${title}" (${strategies.length} strategies)...`);

      let settled = false;
      // Score results against ALL title variants — best cross-title pairing wins
      const scoreResults = (results) => {
        // Exact normalized match against any query title
        for (const qt of allQueryTitles) {
          const normQuery = norm(qt);
          const exactMatch = results.find(r => norm(r.animeTitle) === normQuery);
          if (exactMatch) return { best: exactMatch, score: 1.0 };
        }
        let localBest = null, localMax = -1;
        for (const r of results) {
          let s = 0;
          for (const qt of allQueryTitles) {
            s = Math.max(s, titleScore(r.animeTitle, qt, isMovie));
          }
          if (s > localMax) { localMax = s; localBest = r; }
        }
        return { best: localBest, score: localMax };
      };

      // Two-tier threshold: same-language must reach 0.88, cross-language 0.35
      const SAME_LANG_THRESHOLD = 0.88;
      const CROSS_LANG_THRESHOLD = 0.35;
      const raceResult = await new Promise((resolve) => {
        let pending = strategies.length + 1; // +1 for filter page
        let bestSoFar = null; // track best cross-lang result in case nothing exceeds 0.88
        const tryResolve = (results) => {
          if (settled) return;
          const { best: b, score: s } = scoreResults(results);
          if (b && s >= SAME_LANG_THRESHOLD) {
            settled = true;
            resolve({ best: b, score: s, source: 'fast' });
            return;
          }
          // Track best cross-lang candidate
          if (b && s >= CROSS_LANG_THRESHOLD) {
            if (!bestSoFar || s > bestSoFar.score) bestSoFar = { best: b, score: s, source: 'fast' };
          }
          pending--;
          if (pending <= 0 && !settled) resolve(bestSoFar); // use best cross-lang if nothing same-lang matched
        };
        for (const kw of strategies) {
          kotoJsonSearch(domain, kw).then(tryResolve).catch(() => {
            pending--;
            if (pending <= 0 && !settled) resolve(bestSoFar);
          });
        }
        kotoFilterSearch(domain, primaryCleanTitle).then(results => {
          if (settled) return;
          const { best: b, score: s } = scoreResults(results);
          if (b && s >= SAME_LANG_THRESHOLD) {
            settled = true;
            console.log(`[AniKoto] Filter page search resolved "${b.animeTitle}" (score: ${s.toFixed(2)})`);
            resolve({ best: b, score: s, source: 'filter' });
            return;
          }
          if (b && s >= CROSS_LANG_THRESHOLD) {
            if (!bestSoFar || s > bestSoFar.score) bestSoFar = { best: b, score: s, source: 'filter' };
          }
          pending--;
          if (pending <= 0 && !settled) resolve(bestSoFar);
        }).catch(() => {
          pending--;
          if (pending <= 0 && !settled) resolve(bestSoFar);
        });
      });

      if (!raceResult) {
        throw new Error(`No confident match on AniKoto for "${title}"`);
      }
      best = raceResult.best;
      const matchType = raceResult.score >= SAME_LANG_THRESHOLD ? 'same-lang' : 'cross-lang';
      console.log(`[AniKoto] Best match [${raceResult.source}/${matchType}]: "${best.animeTitle}" (score: ${raceResult.score.toFixed(2)})`);
    }

    // ── Resolve the site's internal numeric ID from its watch page ──
    const watchUrl = (best.fullUrl && best.fullUrl.startsWith('http'))
      ? best.fullUrl
      : `${domain}/watch/${best.slug}`;

    console.log(`[AniKoto] Fetching watch page to resolve real ID: ${watchUrl}`);
    const watchHtml = await clientFetch(watchUrl, { referer: domain, timeout: 10000 });
    const idMatch = watchHtml.match(/data-id="(\d+)"/i)
      || watchHtml.match(/const mangaId = (\d+);/i)
      || watchHtml.match(/\/getinfo\/(\d+)/i);
    if (!idMatch) throw new Error('Could not resolve anime ID on AniKoto');
    const kotoInternalId = idMatch[1];
    console.log(`[AniKoto] Extracted internal animeId: ${kotoInternalId}`);

    searchResult = { slug: best.slug, animeId: kotoInternalId, animeTitle: best.animeTitle, watchUrl };
    kotoSearchCache.set(title, searchResult);
    lsSet(lsSearchKey('koto', title), searchResult);
  }

  const { slug, animeId: kotoId, animeTitle, watchUrl } = searchResult;

  // Per-episode result cache
  const cacheKey = `${slug}-${episode}`;
  if (kotoEpCache.has(cacheKey)) {
    return kotoEpCache.get(cacheKey);
  }

  // Episode list cache (per animeId – reused across all episodes of the same show!
  let epsHtml = kotoEpListCache.get(kotoId);
  if (!epsHtml) {
    const epsUrl = `${domain}/ajax/episode/list/${kotoId}`;
    console.log(`[AniKoto] Fetching episode list: ${epsUrl}`);
    const epsResp = await clientFetch(epsUrl, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      referer: watchUrl,
      timeout: 8000
    });
    const epsParsed = JSON.parse(epsResp);
    if (epsParsed.status !== 200 || !epsParsed.result) {
      throw new Error(`Failed to load episodes for ${animeTitle}`);
    }
    epsHtml = epsParsed.result;
    kotoEpListCache.set(kotoId, epsHtml);
  }

  const epRe = /data-id="([^"]+)"[^>]*data-num="(\d+)"[^>]*data-slug="[^"]*"[^>]*data-mal="[^"]*"[^>]*data-timestamp="[^"]*"[^>]*data-sub="[^"]*"[^>]*data-dub="[^"]*"[^>]*data-ids="([^"]+)"/g;
  let epMatch;
  let targetIds = null;
  while ((epMatch = epRe.exec(epsHtml)) !== null) {
    const epNum = epMatch[2];
    const epIds = epMatch[3];
    if (parseInt(epNum) === parseInt(episode)) {
      targetIds = epIds;
      break;
    }
  }

  if (!targetIds) {
    // Looser fallback regex
    const looserRe = /data-num="(\d+)"[^>]*data-ids="([^"]+)"|data-ids="([^"]+)"[^>]*data-num="(\d+)"/g;
    let lMatch;
    while ((lMatch = looserRe.exec(epsHtml)) !== null) {
      const num = lMatch[1] || lMatch[4];
      const ids = lMatch[2] || lMatch[3];
      if (parseInt(num) === parseInt(episode)) {
        targetIds = ids;
        break;
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
    timeout: 8000
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

  // Only resolve AniHD (HD-1 → megaplay s-5) and AniVid (VidPlay-1 → vidtube)
  const ALLOWED_SERVERS = [
    { key: 'HD-1',      label: 'AniHD', isHLS: false },
    { key: 'VidPlay-1', label: 'AniVid', isHLS: false },
  ];

  const filteredServers = [];
  for (const allowed of ALLOWED_SERVERS) {
    for (const s of rawServers) {
      if (s.serverName === allowed.key) {
        filteredServers.push({ ...s, label: allowed.label, isHLS: allowed.isHLS });
      }
    }
  }

  if (filteredServers.length === 0) {
    throw new Error(`No AniHD/AniVid servers found for episode ${episode} on AniKoto`);
  }

  const resolved = await Promise.allSettled(
    filteredServers.map(async (s) => {
      const getUrl = `${domain}/ajax/server?get=${encodeURIComponent(s.linkId)}`;
      const resp = await clientFetch(getUrl, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        referer: watchUrl,
        timeout: 6000
      });
      const parsed = JSON.parse(resp);
      const embedUrl = parsed.result?.url || '';
      if (!embedUrl) return null;
      const videoUrl = formatIframeProxyUrl(embedUrl, domain);
      return {
        name: s.label,
        videoUrl,
        embedUrl,
        referer: domain + '/',
        type: s.type,
        subtitles: [],
        isHLS: s.isHLS
      };
    })
  );

  const servers = resolved
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (servers.length === 0) {
    throw new Error(`Failed to resolve KotoHD/KotoVid stream URLs for episode ${episode}`);
  }

  const resultData = { servers, animeTitle, slug };
  kotoEpCache.set(cacheKey, resultData);
  return resultData;
}

// ── Animetsu Scraper ──

// Stream URL session cache: animeId/episode/type → { data, expires }
// TTL = 25 minutes (stream URLs typically expire in ~30 min)
const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;

function getStreamCache(animeId, episode, sourceType) {
  try {
    const key = `animetsu_stream_${animeId}_${episode}_${sourceType}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    console.log(`[Animetsu] Cache HIT for ${sourceType} ep${episode} Ã¢â‚¬â€ instant play`);
    return data;
  } catch { return null; }
}

function setStreamCache(animeId, episode, sourceType, data) {
  try {
    const key = `animetsu_stream_${animeId}_${episode}_${sourceType}`;
    sessionStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + STREAM_CACHE_TTL_MS }));
  } catch {}
}

// Fetches a stream URL from Animetsu Ã¢â‚¬â€ all servers race in PARALLEL, fastest wins.
async function fetchAnimetsuStream(animeId, episode, sourceType) {
  // Check session cache first Ã¢â‚¬â€ avoids re-fetching same episode within 25 min
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
    // Promise.any returns the FIRST fulfilled promise Ã¢â‚¬â€ fastest server wins
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
    const cleanTitle = title.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanTitle.split(' ').filter(w => w.length > 1);
    let searchQueries = [cleanTitle];
    if (words.length > 1) {
      searchQueries.push(words.slice(0, 3).join(' '));
      searchQueries.push(words.slice(0, 2).join(' '));
    }
    searchQueries.push(getLongestWord(title));
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

    best = results[0];
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

  const epItem = epsData.find(x => Number(x.ep_num) === Number(episode));
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

export async function getScraperEpisodeCount(anime) {
  if (!anime) return 0;
  const titles = [
    anime.title?.english,
    anime.title?.romaji,
  ].filter(Boolean);

  if (!titles.length) return 0;

  const title = titles[0];
  let clean = cleanAnimeTitle(title);

  const fetchCount = async (domain) => {
    const queries = [clean, clean.replace(/:\s*/g, ' '), title];
    let results = [];
    for (const query of queries) {
      try {
        const searchUrl = `${domain}/v2/api/anime/search/?query=${encodeURIComponent(query)}`;
        const searchHtml = await clientFetch(searchUrl, { referer: `${domain}/watch/`, timeout: 6000 });
        const data = JSON.parse(searchHtml);
        if (data && data.length) {
          results = data;
          break;
        }
      } catch {}
    }
    if (!results.length) return 0;
    
    let best = results[0];
    let maxScore = -1;
    for (const r of results) {
      const score = titleScore(r.title, title, anime.format === 'MOVIE');
      if (score > maxScore) { maxScore = score; best = r; }
    }
    if (!best || maxScore < 0.75) return 0;

    const epsUrl = `${domain}/v2/api/anime/eps/${best.id}`;
    const epsHtml = await clientFetch(epsUrl, { referer: `${domain}/watch/${best.id}`, timeout: 6000 });
    const epsData = JSON.parse(epsHtml);
    if (epsData && epsData.length) {
      const nums = epsData.map(x => Number(x.ep_num)).filter(n => !isNaN(n));
      return nums.length ? Math.max(...nums) : 0;
    }
    return 0;
  };

  const fetchAnikotoCount = async (domain) => {
    const queries = [clean, clean.replace(/:\s*/g, ' '), title];
    const searchPromises = queries.map(async (query) => {
      try {
        const searchUrl = `${domain}/ajax/anime/search?keyword=${encodeURIComponent(query)}`;
        const searchHtml = await clientFetch(searchUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
          referer: domain,
          timeout: 4000
        });
        const parsed = JSON.parse(searchHtml);
        if (parsed.status === 200 && parsed.result?.html) {
          const html = parsed.result.html;
          const itemRe = /href="([^"]*\/watch\/([^"\/]+))"[\s\S]*?class="name d-title"[^>]*>([^<]+)<\/div>/g;
          let m;
          const localResults = [];
          while ((m = itemRe.exec(html)) !== null) {
            localResults.push({ slug: m[2], title: m[3].trim(), fullUrl: m[1] });
          }
          if (localResults.length > 0) return localResults;
        }
      } catch {}
      throw new Error('No results');
    });

    let results = [];
    try {
      results = await Promise.any(searchPromises);
    } catch {}
    if (!results.length) return 0;
    
    let best = results[0];
    let maxScore = -1;
    for (const r of results) {
      const score = titleScore(r.title, title, anime.format === 'MOVIE');
      if (score > maxScore) { maxScore = score; best = r; }
    }
    if (!best || maxScore < 0.70) return 0;

    try {
      const watchPageUrl = best.fullUrl.startsWith('http') ? best.fullUrl : `${domain}/watch/${best.slug}`;
      const pageHtml = await clientFetch(watchPageUrl, { referer: domain, timeout: 6000 });
      let animeId = '';
      const idMatch = pageHtml.match(/data-id="(\d+)"/i) || pageHtml.match(/const mangaId = (\d+);/i);
      if (idMatch) {
        animeId = idMatch[1];
      } else {
        const getInfoM = pageHtml.match(/\/getinfo\/(\d+)/i);
        if (getInfoM) animeId = getInfoM[1];
      }
      if (!animeId) return 0;

      const epsUrl = `${domain}/ajax/episode/list/${animeId}`;
      const epsHtmlResponse = await clientFetch(epsUrl, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
        referer: watchPageUrl,
        timeout: 6000
      });
      const parsed = JSON.parse(epsHtmlResponse);
      if (parsed.status === 200 && parsed.result) {
        const epHtml = parsed.result;
        const epRe = /data-num="(\d+)"/g;
        let m;
        const nums = [];
        while ((m = epRe.exec(epHtml)) !== null) {
          nums.push(Number(m[1]));
        }
        return nums.length ? Math.max(...nums) : 0;
      }
    } catch {}
    return 0;
  };

  try {
    const counts = await Promise.allSettled([
      fetchAnikotoCount(AW),
      fetchCount(ANIMETSU)
    ]);
    const values = counts
      .filter(c => c.status === 'fulfilled')
      .map(c => c.value);
    return values.length ? Math.max(...values) : 0;
  } catch {
    return 0;
  }
}

