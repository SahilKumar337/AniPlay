/**
 * AniList GraphQL API
 * ─────────────────────────────────────────────────────────────────
 * Production-grade client with:
 *  • Two-tier cache: L1 in-memory (instant) + L2 sessionStorage (survives navigation)
 *  • Per-endpoint TTL (stable data like top-rated cached 30 min, live data 5 min)
 *  • Correct cache keys using full query hash (no collision)
 *  • Request deduplication: identical in-flight requests share one Promise
 *  • Rate-limit aware with exponential backoff & Retry-After support
 *  • Direct, authentic AniList GraphQL execution as primary data source
 */

import {
  kitsuTrending,
  kitsuAiring,
  kitsuTopRated,
  kitsuMovies,
  kitsuSearch,
  kitsuAnimeDetail
} from './kitsuFallback.js';
import { getCachedData, getDetailCache, saveDetailCache } from '../utils/cache.js';
import offlineCatalog from '../data/offlineCatalog.json' with { type: 'json' };

const ENDPOINT = 'https://graphql.anilist.co';
const SESSION_PREFIX = 'anilist_cache_';

// ── TTL constants (ms) ──────────────────────────────────────────
const TTL = {
  LIVE:   10 * 60_000,   // trending, airing, schedule: 10 min
  NORMAL: 30 * 60_000,   // search, seasonal, movies: 30 min
  STABLE: 60 * 60_000,   // top-rated, most popular, anime detail: 60 min
};

// ── L1: In-memory cache ───────────────────────────────────────────
const _mem = new Map();

// ── L2: sessionStorage cache ──────────────────────────────────────
function ssGet(key) {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    const { data, ts, ttl } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { sessionStorage.removeItem(SESSION_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}
function ssSet(key, data, ttl) {
  try { sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify({ data, ts: Date.now(), ttl })); }
  catch { /* storage full — silently skip */ }
}

// ── Simple hash for full query string (avoids 60-char slice collision) ──
function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Executes a GraphQL request to AniList via window.fetch.
 * The Chromium WebView fetch() passes Cloudflare transparently with full CORS.
 */
async function performAniListRequest(query, variables = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: variables || {} }),
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(tid);
  }
}

// ── In-flight deduplication: same query → share one fetch ─────────
const _inflight = new Map();

// ── Core GraphQL executor ─────────────────────────────────────────
async function gql(query, variables = {}, ttl = TTL.NORMAL) {
  const cacheKey = hashKey(query + JSON.stringify(variables));

  // L1 memory hit (zero overhead)
  const memHit = _mem.get(cacheKey);
  if (memHit && Date.now() - memHit.ts < memHit.ttl) return memHit.data;

  // L2 sessionStorage hit (survives page navigation)
  const ssHit = ssGet(cacheKey);
  if (ssHit) {
    _mem.set(cacheKey, { data: ssHit, ts: Date.now(), ttl }); // promote to L1
    return ssHit;
  }

  // Deduplication: if same request is already in-flight, wait for it
  if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);

  const fetchPromise = (async () => {
    let lastErr = new Error('Request failed after 3 attempts');
    for (let i = 0; i < 3; i++) {
      try {
        const res = await performAniListRequest(query, variables, 12000);

        if (res.status === 429) {
          // Respect Retry-After header if provided by AniList
          const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
          const waitMs = retryAfter > 0 ? retryAfter * 1000 : (i + 1) * 2000;
          lastErr = new Error('Rate limit exceeded (429). Retrying...');
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        let json;
        if (res.data && typeof res.data === 'object') {
          json = res.data;
        } else if (typeof res.json === 'function') {
          try {
            json = await res.json();
          } catch (parseErr) {
            if (typeof res.text === 'function') {
              const txt = await res.text().catch(() => '');
              try { json = JSON.parse(txt); } catch {}
            }
          }
        }

        if (json?.data) {
          // Write to both cache tiers
          _mem.set(cacheKey, { data: json.data, ts: Date.now(), ttl });
          ssSet(cacheKey, json.data, ttl);
          return json.data;
        }

        if (json?.errors && json.errors.length > 0) {
          const msg = json.errors.map(e => e?.message || 'AniList GraphQL Error').join('; ');
          throw new Error(msg);
        }

        throw new Error(res.statusText || 'Unknown AniList response');
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Request timed out — check your internet connection.');
        lastErr = err;
        if (i < 2) await new Promise(r => setTimeout(r, (i + 1) * 1000));
      }
    }
    throw lastErr;
  })();

  _inflight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    _inflight.delete(cacheKey);
  }
}

/* ── Shared media fields ──────────────────────────────────────────── */
const MEDIA_FIELDS = `
  id idMal
  title { romaji english native }
  synonyms
  description
  coverImage { large extraLarge color }
  bannerImage
  genres averageScore episodes status format
  isAdult
  startDate { year }
  nextAiringEpisode { episode airingAt }
  tags { name isMediaSpoiler rank }
`;

/* ── Lightweight fields for card-only queries (no description) ────── */
const CARD_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { large extraLarge color }
  genres averageScore episodes status format
  isAdult
  startDate { year }
  nextAiringEpisode { episode airingAt }
  tags { name isMediaSpoiler rank }
`;

/* ── Trending ──────────────────────────────────────────────────────── */
export async function getTrending(page = 1, perPage = 15) {
  try {
    const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:TRENDING_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { p: page, n: perPage }, TTL.LIVE);
    const media = d?.Page?.media || [];
    if (media.length > 0) return media;
    throw new Error('Empty trending media');
  } catch (err) {
    console.warn('[AniList] getTrending failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuTrending(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('trending') || offlineCatalog?.trending || [];
  }
}

/* ── Seasonal ──────────────────────────────────────────────────────── */
export async function getSeasonal(season, year, page = 1, perPage = 12) {
  try {
    const q = `query($s:MediaSeason,$y:Int,$p:Int,$n:Int){Page(page:$p,perPage:$n){media(season:$s,seasonYear:$y,sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { s: season, y: year, p: page, n: perPage }, TTL.NORMAL);
    const media = d?.Page?.media || [];
    if (media.length > 0) return media;
    throw new Error('Empty seasonal media');
  } catch (err) {
    console.warn('[AniList] getSeasonal failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuAiring(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('popularSeason') || offlineCatalog?.popularSeason || [];
  }
}

/* ── Top Rated ─────────────────────────────────────────────────────── */
export async function getTopRated(page = 1, perPage = 12) {
  try {
    const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:SCORE_DESC,type:ANIME,status:FINISHED,isAdult:false){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { p: page, n: perPage }, TTL.STABLE);
    const media = d?.Page?.media || [];
    if (media.length > 0) return media;
    throw new Error('Empty topRated media');
  } catch (err) {
    console.warn('[AniList] getTopRated failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuTopRated(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('topRated') || offlineCatalog?.topRated || [];
  }
}

/* ── Movies ────────────────────────────────────────────────────────── */
export async function getMovies(page = 1, perPage = 10) {
  try {
    const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,format:MOVIE,isAdult:false){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { p: page, n: perPage }, TTL.STABLE);
    const media = d?.Page?.media || [];
    if (media.length > 0) return media;
    throw new Error('Empty movies media');
  } catch (err) {
    console.warn('[AniList] getMovies failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuMovies(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('movies') || offlineCatalog?.movies || [];
  }
}

/* ── Top Airing ────────────────────────────────────────────────────── */
export async function getAiring(page = 1, perPage = 15) {
  try {
    const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(status:RELEASING,sort:TRENDING_DESC,type:ANIME,isAdult:false,format_in:[TV,TV_SHORT,ONA]){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { p: page, n: perPage }, TTL.LIVE);
    const media = (d?.Page?.media || []).filter(a => getCover(a));
    if (media.length > 0) return media;
    throw new Error('Empty airing media');
  } catch (err) {
    console.warn('[AniList] getAiring failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuAiring(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('airing') || offlineCatalog?.airing || [];
  }
}

/* ── New Episode Releases ──────────────────────────────────── */
export async function getNewReleases(page = 1, perPage = 20) {
  try {
    const now      = Math.floor(Date.now() / 1000);
    const twoWeeks = now - 14 * 86400;
    const q = `query($p:Int,$n:Int,$from:Int,$to:Int){
      Page(page:$p,perPage:$n){
        airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME_DESC){
          airingAt episode
          media{ ${CARD_FIELDS} isAdult status }
        }
      }
    }`;
    const d = await gql(q, { p: page, n: perPage, from: twoWeeks, to: now }, TTL.LIVE);
    const schedules = (d?.Page?.airingSchedules || [])
      .filter(s =>
        !s.media?.isAdult &&
        getCover(s.media) &&
        s.media?.status !== 'NOT_YET_RELEASED' &&
        s.airingAt <= now
      );
    const seen = new Set();
    const unique = [];
    for (const s of schedules) {
      if (!s.media?.id || seen.has(s.media.id)) continue;
      seen.add(s.media.id);
      unique.push({ ...s.media, _latestEp: s.episode, _airedAt: s.airingAt });
    }
    if (unique.length > 0) return unique;
    throw new Error('Empty schedules');
  } catch (err) {
    console.warn('[AniList] getNewReleases failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuAiring(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('newReleases') || offlineCatalog?.newReleases || [];
  }
}

/* ── Batch Fetch by IDs ────────────────────────────────────────────── */
export async function getAnimesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const validIds = ids.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
  if (validIds.length === 0) return [];

  try {
    const q = `query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { ids: validIds }, TTL.STABLE);
    return d?.Page?.media || [];
  } catch (err) {
    console.warn('[AniList] getAnimesByIds failed, searching local detail cache:', err.message);
    const recovered = [];
    for (const id of validIds) {
      const item = getDetailCache(id);
      if (item) recovered.push(item);
    }
    return recovered;
  }
}

/* ── Most Popular ──────────────────────────────────────────────────── */
export async function getMostPopular(page = 1, perPage = 12) {
  try {
    const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { p: page, n: perPage }, TTL.STABLE);
    const media = d?.Page?.media || [];
    if (media.length > 0) return media;
    throw new Error('Empty popular media');
  } catch (err) {
    console.warn('[AniList] getMostPopular failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuTrending(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('trending') || offlineCatalog?.trending || [];
  }
}

/* ── Popular This Season ───────────────────────────────────────────── */
export async function getPopularThisSeason(page = 1, perPage = 15) {
  try {
    const { season, year } = getCurrentSeason();
    const q = `query($s:MediaSeason,$y:Int,$p:Int,$n:Int){Page(page:$p,perPage:$n){media(season:$s,seasonYear:$y,sort:TRENDING_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
    const d = await gql(q, { s: season, y: year, p: page, n: perPage }, TTL.LIVE);
    const media = (d?.Page?.media || []).filter(a => getCover(a));
    if (media.length > 0) return media;
    throw new Error('Empty seasonal media');
  } catch (err) {
    console.warn('[AniList] getPopularThisSeason failed, trying Kitsu fallback:', err.message);
    try {
      const fallback = await kitsuAiring(page, perPage);
      if (fallback && fallback.length > 0) return fallback;
    } catch (_) {}
    return getCachedData('popularSeason') || offlineCatalog?.popularSeason || [];
  }
}

/* ── Search ────────────────────────────────────────────────────────── */
export async function searchAnime(search, page = 1, perPage = 20, genres = null, format = null, status = null, sort = 'POPULARITY_DESC') {
  const vars = { p: page, n: perPage };
  const queryParams = ['$p:Int', '$n:Int'];
  const mediaParams = ['type:ANIME', `sort:${sort}`];

  if (search) {
    queryParams.push('$s:String');
    mediaParams.push('search:$s');
    vars.s = search;
  }
  if (format) {
    queryParams.push('$f:MediaFormat');
    mediaParams.push('format:$f');
    vars.f = format;
  }
  if (status) {
    queryParams.push('$st:MediaStatus');
    mediaParams.push('status:$st');
    vars.st = status;
  }

  const selectedGenres = Array.isArray(genres) ? genres : (genres ? [genres] : []);

  const ANILIST_GENRES = new Set([
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy',
    'Hentai', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery',
    'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
    'Sports', 'Supernatural', 'Thriller'
  ]);

  const TAG_NAME_MAP = {
    'Cars':         'Racing',
    'Dementia':     'Psychological',
    'Demons':       'Demons',
    'Game':         'Video Games',
    'Harem':        'Harem',
    'Haram':        'Harem',
    'haram':        'Harem',
    'Historical':   'Historical',
    'Isekai':       'Isekai',
    'Josei':        'Josei',
    'Kids':         'Kids',
    'Magic':        'Magic',
    'Martial Arts': 'Martial Arts',
    'Military':     'Military',
    'Parody':       'Parody',
    'Police':       'Police',
    'Samurai':      'Samurai',
    'School':       'School',
    'Seinen':       'Seinen',
    'Shoujo':       'Shoujo',
    'Shoujo Ai':    'Shoujo Ai',
    'Shounen':      'Shounen',
    'Shounen Ai':   'Shounen Ai',
    'Space':        'Space',
    'Super Power':  'Super Power',
    'Vampire':      'Vampire',
  };

  const gList = selectedGenres.filter(g => ANILIST_GENRES.has(g));
  const tList = [];
  for (const g of selectedGenres) {
    if (ANILIST_GENRES.has(g)) continue;
    const mapped = TAG_NAME_MAP[g] || g;
    if (mapped === 'Harem') {
      tList.push('Female Harem', 'Male Harem');
    } else {
      tList.push(mapped);
    }
  }

  if (gList.length) {
    queryParams.push('$g:[String]');
    mediaParams.push('genre_in:$g');
    vars.g = gList;
  }
  const hasHarem = tList.includes('Female Harem') && tList.includes('Male Harem');

  let q = '';
  if (hasHarem) {
    const tList1 = tList.filter(t => t !== 'Male Harem');
    const tList2 = tList.filter(t => t !== 'Female Harem');

    queryParams.push('$t1:[String]', '$t2:[String]');
    vars.t1 = tList1;
    vars.t2 = tList2;

    q = `query(${queryParams.join(',')}){
      female: Page(page:$p,perPage:$n){
        pageInfo { hasNextPage }
        media(tag_in:$t1,${mediaParams.join(',')}){${MEDIA_FIELDS}}
      }
      male: Page(page:$p,perPage:$n){
        pageInfo { hasNextPage }
        media(tag_in:$t2,${mediaParams.join(',')}){${MEDIA_FIELDS}}
      }
    }`;
  } else {
    if (tList.length) {
      queryParams.push('$t:[String]');
      mediaParams.push('tag_in:$t');
      vars.t = tList;
    }
    q = `query(${queryParams.join(',')}){
      Page(page:$p,perPage:$n){
        pageInfo { hasNextPage }
        media(${mediaParams.join(',')}){${MEDIA_FIELDS}}
      }
    }`;
  }

  // Use LIVE TTL for text searches (user expects fresh results), NORMAL for filters-only
  const ttl = search ? TTL.NORMAL : TTL.STABLE;
  try {
    const d = await gql(q, vars, ttl);

    if (hasHarem) {
      const femaleMedia = d?.female?.media || [];
      const maleMedia = d?.male?.media || [];
      const merged = [...femaleMedia, ...maleMedia];
      const seen = new Set();
      const unique = [];
      for (const m of merged) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          unique.push(m);
        }
      }
      const hasNextPage = !!(d?.female?.pageInfo?.hasNextPage || d?.male?.pageInfo?.hasNextPage);
      return { rows: unique, hasNextPage };
    } else {
      const rows = d?.Page?.media || [];
      const hasNextPage = d?.Page?.pageInfo?.hasNextPage ?? (rows.length >= perPage);
      return { rows, hasNextPage };
    }
  } catch (err) {
    console.warn('[AniList] searchAnime failed, falling back to Kitsu search:', err.message);
    try {
      return await kitsuSearch(search, page, perPage);
    } catch (_) {
      return { rows: [], hasNextPage: false };
    }
  }
}

/* ── Anime Detail ──────────────────────────────────────────────────── */
export async function getAnimeDetail(id) {
  const numId = parseInt(id, 10);
  if (!numId || isNaN(numId)) throw new Error('Invalid anime ID');

  try {
    const q = `query($id:Int){
      Media(id:$id,type:ANIME){
        id idMal
        title { romaji english native }
        coverImage { large extraLarge color }
        bannerImage
        description(asHtml:false)
        genres averageScore popularity episodes duration status format
        startDate { year month day }
        endDate { year month day }
        studios(isMain:true){ nodes{ name } }
        nextAiringEpisode{ episode airingAt }
        characters(sort:ROLE,perPage:10){
          edges{
            node{ id name{full} image{large} }
            voiceActors(language:JAPANESE, sort:LANGUAGE){ name{full} image{large} }
          }
        }
        recommendations(perPage:8,sort:RATING_DESC){
          nodes{
            mediaRecommendation{
              id title{romaji english}
              coverImage{large extraLarge color}
              averageScore episodes format status
            }
          }
        }
      }
    }`;
    const d = await gql(q, { id: numId }, TTL.STABLE);
    if (d?.Media) {
      saveDetailCache(numId, d.Media);
      return d.Media;
    }
    throw new Error('Anime not found on AniList');
  } catch (err) {
    console.warn(`[AniList] getAnimeDetail(${numId}) network fetch failed, trying fallbacks:`, err.message);
    
    // 1. Check local detail cache first
    const cached = getDetailCache(numId);
    if (cached) return cached;

    // 2. Check offline catalog details
    if (offlineCatalog?.details && offlineCatalog.details[numId]) {
      return offlineCatalog.details[numId];
    }

    // 3. Try Kitsu fallback with real AniList ID bridge
    try {
      const fallback = await kitsuAnimeDetail(numId);
      if (fallback) {
        saveDetailCache(numId, fallback);
        return fallback;
      }
    } catch (_) {}

    // 4. Check all lists in offlineCatalog
    const fromCatalogLists = [
      ...(offlineCatalog?.trending || []),
      ...(offlineCatalog?.airing || []),
      ...(offlineCatalog?.popularSeason || []),
      ...(offlineCatalog?.topRated || []),
      ...(offlineCatalog?.movies || []),
    ].find(m => String(m.id) === String(numId));
    if (fromCatalogLists) {
      return {
        ...fromCatalogLists,
        characters: { edges: [] },
        recommendations: { nodes: [] },
      };
    }

    // 5. Minimal resilient shell so player & progress never completely crash offline
    return {
      id: numId,
      title: { romaji: `Anime #${numId}`, english: `Anime #${numId}`, userPreferred: `Anime #${numId}` },
      episodes: 12,
      format: 'TV',
      status: 'FINISHED',
      genres: [],
      characters: { edges: [] },
      recommendations: { nodes: [] },
    };
  }
}

/* ── Schedule ──────────────────────────────────────────────────────── */
export async function getSchedule(page = 1, perPage = 50) {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const week = now + 7 * 86400;
    const q = `query($p:Int,$n:Int,$from:Int,$to:Int){
      Page(page:$p,perPage:$n){
        airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){
          id airingAt episode
          media{ id idMal title{romaji english} coverImage{large extraLarge color} format averageScore isAdult }
        }
      }
    }`;
    // Round 'now' to nearest 5 minutes so schedule queries can be cached properly
    const roundedNow = Math.floor(now / 300) * 300;
    const d = await gql(q, { p: page, n: perPage, from: roundedNow - 86400, to: week }, TTL.LIVE);
    const schedules = (d?.Page?.airingSchedules || []).filter(s => !s.media?.isAdult);
    if (schedules.length > 0) return schedules;
    throw new Error('Empty schedule');
  } catch (err) {
    console.warn('[AniList] getSchedule failed, synthesizing from airing catalog:', err.message);
    const airingList = getCachedData('airing') || offlineCatalog?.airing || [];
    const now = Math.floor(Date.now() / 1000);
    return airingList.map((a, i) => ({
      id: a.id * 1000 + i,
      airingAt: now + (i % 7) * 86400 + (i * 3600),
      episode: (a.nextAiringEpisode?.episode || 1),
      media: a
    }));
  }
}

export async function getScheduleWeek2(page = 1, perPage = 50) {
  try {
    const now   = Math.floor(Date.now() / 1000);
    const from  = now + 7 * 86400;
    const to    = now + 14 * 86400;
    const q = `query($p:Int,$n:Int,$from:Int,$to:Int){
      Page(page:$p,perPage:$n){
        airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){
          id airingAt episode
          media{ id idMal title{romaji english} coverImage{large extraLarge color} format averageScore isAdult }
        }
      }
    }`;
    const d = await gql(q, { p: page, n: perPage, from, to }, TTL.LIVE);
    const schedules = (d?.Page?.airingSchedules || []).filter(s => !s.media?.isAdult);
    if (schedules.length > 0) return schedules;
    throw new Error('Empty schedule week 2');
  } catch (err) {
    console.warn('[AniList] getScheduleWeek2 failed, synthesizing:', err.message);
    const airingList = getCachedData('airing') || offlineCatalog?.airing || [];
    const now = Math.floor(Date.now() / 1000);
    return airingList.map((a, i) => ({
      id: a.id * 2000 + i,
      airingAt: now + 7 * 86400 + (i % 7) * 86400 + (i * 3600),
      episode: (a.nextAiringEpisode?.episode || 1) + 1,
      media: a
    }));
  }
}

/** Batch-fetch full AniList metadata for a list of anime IDs */
export async function getAnimeByIds(ids = []) {
  if (!ids || ids.length === 0) return [];
  const cleanIds = Array.from(new Set(ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0)));
  if (cleanIds.length === 0) return [];

  // Split into chunks of 50 (AniList perPage max is 50)
  const chunks = [];
  for (let i = 0; i < cleanIds.length; i += 50) {
    chunks.push(cleanIds.slice(i, i + 50));
  }

  const q = `query($ids:[Int]){
    Page(page:1, perPage:50){
      media(id_in:$ids){
        id idMal title{romaji english native}
        coverImage{extraLarge large color}
        bannerImage description season seasonYear format
        episodes duration status averageScore genres
        tags{name rank isMediaSpoiler}
      }
    }
  }`;

  try {
    const results = await Promise.all(
      chunks.map(chunk => gql(q, { ids: chunk }, TTL.NORMAL))
    );
    const allMedia = [];
    results.forEach(d => {
      if (d?.Page?.media) allMedia.push(...d.Page.media);
    });
    return allMedia;
  } catch (e) {
    console.warn('[AniList] getAnimeByIds failed:', e.message);
    return [];
  }
}

/* ── Helpers ───────────────────────────────────────────────────────── */
export function getCurrentSeason() {
  const m    = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  const season = m <= 3 ? 'WINTER' : m <= 6 ? 'SPRING' : m <= 9 ? 'SUMMER' : 'FALL';
  return { season, year };
}

export const getTitle = a => {
  if (!a) return 'Unknown';
  if (typeof a === 'string') return a;
  let t = 'Unknown';
  if (typeof a.title === 'string') {
    t = a.title;
  } else if (a.title && typeof a.title === 'object') {
    t = a.title.userPreferred || a.title.english || a.title.romaji || a.title.native || 'Unknown';
  } else if (a.name) {
    t = a.name;
  }
  if (a.format && !['TV', 'MOVIE'].includes(a.format)) {
    const cleanFormat = String(a.format).replace('_', ' ').toUpperCase();
    return `${t} (${cleanFormat})`;
  }
  return t;
};

export const getCover = a => {
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (typeof a.coverImage === 'string') return a.coverImage;
  return a.coverImage?.extraLarge || a.coverImage?.large || a.coverImage?.medium || a.image || '';
};

export const getColor = a => a?.coverImage?.color || '#e50914';

// pinnedTags: array of tag/genre names that MUST appear in the result
// regardless of rank (used when user has filtered by those tags)
// Or limit (number) if called as getDisplayGenresOrTags(anime, limit)
export const getDisplayGenresOrTags = (a, pinnedTags = [], limit = 7) => {
  if (!a) return [];
  const genres = [...(Array.isArray(a.genres) ? a.genres : [])];
  
  let actualPinned = [];
  let actualLimit = typeof limit === 'number' ? limit : 7;

  if (typeof pinnedTags === 'number') {
    actualLimit = pinnedTags;
    actualPinned = [];
  } else if (Array.isArray(pinnedTags)) {
    actualPinned = pinnedTags;
  } else if (typeof pinnedTags === 'string') {
    actualPinned = [pinnedTags];
  }
  
  // Rank >= 70: AniList's own standard for confident tags (70% of voters agree)
  // Anything below 70 is too uncertain to display to users
  let tags = (Array.isArray(a.tags) ? a.tags : [])
    .filter(t => t && !t.isMediaSpoiler && (t.rank || 0) >= 70)
    .map(t => {
      const name = t.name;
      if (name === 'Female Harem' || name === 'Male Harem') return 'Harem';
      return name;
    });

  const blocklist = new Set(['Nudity', 'Heterosexual', 'Male Protagonist', 'Female Protagonist', 'Primarily Female Cast', 'Primarily Male Cast', 'Kuudere', 'Tsundere', 'Yandere']);
  tags = tags.filter(t => !blocklist.has(t));

  // Ensure pinned filter tags always appear — but only if the anime GENUINELY
  // has that tag at rank >= 50 (prevents low-confidence tags from being forced on)
  const pinnedNormalized = actualPinned.map(p =>
    (p === 'Female Harem' || p === 'Male Harem') ? 'Harem' : p
  );
  for (const p of pinnedNormalized) {
    if (!genres.includes(p) && !tags.includes(p)) {
      // Only pin if the tag exists at rank >= 50 (confident enough to surface)
      const hasTag = (Array.isArray(a.tags) ? a.tags : []).some(t =>
        t && (t.rank || 0) >= 50 && (
          t.name === p ||
          (p === 'Harem' && (t.name === 'Female Harem' || t.name === 'Male Harem'))
        )
      );
      if (hasTag) tags.unshift(p);
    }
  }

  const combined = [...genres, ...tags];
  const unique = combined.filter((item, index) => combined.indexOf(item) === index);
  
  if (unique.includes('Harem')) {
    const withoutHarem = unique.filter(x => x !== 'Harem');
    const insertIdx = Math.min(genres.length, 3);
    withoutHarem.splice(insertIdx, 0, 'Harem');
    return withoutHarem.slice(0, actualLimit);
  }

  return unique.slice(0, actualLimit);
};

/**
 * Safe AniList health probe helper
 */
export async function probeAniList() {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: '{ Page(page: 1, perPage: 1) { media(type: ANIME) { id } } }' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
