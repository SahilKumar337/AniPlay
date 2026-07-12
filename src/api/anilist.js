/**
 * AniList GraphQL API
 * ─────────────────────────────────────────────────────────────────
 * Production-grade client with:
 *  • Two-tier cache: L1 in-memory (instant) + L2 sessionStorage (survives navigation)
 *  • Per-endpoint TTL (stable data like top-rated cached 30 min, live data 5 min)
 *  • Correct cache keys using full query hash (no collision)
 *  • Request deduplication: identical in-flight requests share one Promise
 *  • Rate-limit aware with exponential backoff
 */

const ENDPOINT = 'https://graphql.anilist.co';
const SESSION_PREFIX = 'anilist_cache_';

// ── TTL constants (ms) ────────────────────────────────────────────
const TTL = {
  LIVE:   5  * 60_000,   // trending, airing, schedule: 5 min
  NORMAL: 15 * 60_000,   // search, seasonal, movies: 15 min
  STABLE: 30 * 60_000,   // top-rated, most popular: 30 min
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
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 12000);
        const res  = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: ctrl.signal,
        });
        clearTimeout(tid);

        if (res.status === 429) {
          lastErr = new Error('Rate limit exceeded (429). Please try again in a few seconds.');
          await new Promise(r => setTimeout(r, (i + 1) * 2000));
          continue;
        }

        const json = await res.json();
        if (json.data) {
          // Write to both cache tiers
          _mem.set(cacheKey, { data: json.data, ts: Date.now(), ttl });
          ssSet(cacheKey, json.data, ttl);
          return json.data;
        }
        throw new Error((json.errors || []).map(e => e?.message || 'Unknown error').join('; ') || 'Unknown error');
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Request timed out — check your internet.');
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
  startDate { year }
  nextAiringEpisode { episode airingAt }
  tags { name isMediaSpoiler rank }
`;

/* ── Trending ──────────────────────────────────────────────────────── */
export async function getTrending(page = 1, perPage = 15) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:TRENDING_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage }, TTL.LIVE);
  return d?.Page?.media || [];
}

/* ── Seasonal ──────────────────────────────────────────────────────── */
export async function getSeasonal(season, year, page = 1, perPage = 12) {
  const q = `query($s:MediaSeason,$y:Int,$p:Int,$n:Int){Page(page:$p,perPage:$n){media(season:$s,seasonYear:$y,sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { s: season, y: year, p: page, n: perPage }, TTL.NORMAL);
  return d?.Page?.media || [];
}

/* ── Top Rated ─────────────────────────────────────────────────────── */
export async function getTopRated(page = 1, perPage = 12) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:SCORE_DESC,type:ANIME,status:FINISHED,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage }, TTL.STABLE);
  return d?.Page?.media || [];
}

/* ── Movies ────────────────────────────────────────────────────────── */
export async function getMovies(page = 1, perPage = 10) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,format:MOVIE,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage }, TTL.STABLE);
  return d?.Page?.media || [];
}

/* ── Top Airing ────────────────────────────────────────────────────── */
export async function getAiring(page = 1, perPage = 15) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(status:RELEASING,sort:TRENDING_DESC,type:ANIME,isAdult:false,format_in:[TV,TV_SHORT,ONA]){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage }, TTL.LIVE);
  return (d?.Page?.media || []).filter(a => getCover(a));
}

/* ── New Episode Releases ──────────────────────────────────────────── */
export async function getNewReleases(page = 1, perPage = 20) {
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
  return unique;
}

/* ── Most Popular ──────────────────────────────────────────────────── */
export async function getMostPopular(page = 1, perPage = 12) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage }, TTL.STABLE);
  return d?.Page?.media || [];
}

/* ── Popular This Season ───────────────────────────────────────────── */
export async function getPopularThisSeason(page = 1, perPage = 15) {
  const { season, year } = getCurrentSeason();
  const q = `query($s:MediaSeason,$y:Int,$p:Int,$n:Int){Page(page:$p,perPage:$n){media(season:$s,seasonYear:$y,sort:TRENDING_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { s: season, y: year, p: page, n: perPage }, TTL.LIVE);
  return (d?.Page?.media || []).filter(a => getCover(a));
}

/* ── Search ────────────────────────────────────────────────────────── */
export async function searchAnime(search, page = 1, perPage = 20, genres = null, format = null, status = null, sort = 'POPULARITY_DESC') {
  const vars = { p: page, n: perPage };
  const queryParams = ['$p:Int', '$n:Int'];
  const mediaParams = ['type:ANIME', 'isAdult:false', `sort:${sort}`];

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
    'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery',
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
    'Female Harem': 'Female Harem',
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
  if (tList.length) {
    queryParams.push('$t:[String]');
    mediaParams.push('tag_in:$t');
    vars.t = tList;
  }

  const q = `query(${queryParams.join(',')}){
    Page(page:$p,perPage:$n){
      media(${mediaParams.join(',')}){${MEDIA_FIELDS}}
    }
  }`;

  // Use LIVE TTL for text searches (user expects fresh results), NORMAL for filters-only
  const ttl = search ? TTL.NORMAL : TTL.STABLE;
  const d = await gql(q, vars, ttl);
  return d?.Page?.media || [];
}

/* ── Anime Detail ──────────────────────────────────────────────────── */
export async function getAnimeDetail(id) {
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
  const d = await gql(q, { id }, TTL.STABLE);
  if (!d?.Media) throw new Error('Anime not found');
  return d.Media;
}

/* ── Schedule ──────────────────────────────────────────────────────── */
export async function getSchedule(page = 1, perPage = 50) {
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
  return (d?.Page?.airingSchedules || []).filter(s => !s.media?.isAdult);
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
  const mainTitle = a.title?.english || a.title?.romaji || 'Unknown';
  if (a.format && !['TV', 'MOVIE'].includes(a.format)) {
    const cleanFormat = a.format.replace('_', ' ').toUpperCase();
    return `${mainTitle} (${cleanFormat})`;
  }
  return mainTitle;
};
export const getCover = a => a?.coverImage?.extraLarge || a?.coverImage?.large || '';
export const getColor = a => a?.coverImage?.color || '#e50914';

// pinnedTags: array of tag/genre names that MUST appear in the result
// regardless of rank (used when user has filtered by those tags)
export const getDisplayGenresOrTags = (a, pinnedTags = []) => {
  if (!a) return [];
  const genres = [...(a.genres || [])];
  
  let tags = (a.tags || [])
    .filter(t => !t.isMediaSpoiler && t.rank >= 60)
    .map(t => {
      const name = t.name;
      if (name === 'Female Harem' || name === 'Male Harem') return 'Harem';
      return name;
    });

  const blocklist = new Set(['Nudity', 'Heterosexual', 'Male Protagonist', 'Primarily Female Cast', 'Kuudere', 'Tsundere']);
  tags = tags.filter(t => !blocklist.has(t));

  // Ensure pinned filter tags always appear even if rank < 60 or not in genres
  const pinnedNormalized = (pinnedTags || []).map(p =>
    (p === 'Female Harem' || p === 'Male Harem') ? 'Harem' : p
  );
  for (const p of pinnedNormalized) {
    if (!genres.includes(p) && !tags.includes(p)) {
      // Check if the anime actually has the tag at any rank
      const hasTag = (a.tags || []).some(t =>
        t.name === p || (p === 'Harem' && (t.name === 'Female Harem' || t.name === 'Male Harem'))
      );
      if (hasTag) tags.unshift(p); // Pin to front of tag list
    }
  }

  const combined = [...genres, ...tags];
  const unique = combined.filter((item, index) => combined.indexOf(item) === index);
  
  if (unique.includes('Harem')) {
    const withoutHarem = unique.filter(x => x !== 'Harem');
    const insertIdx = Math.min(genres.length, 3);
    withoutHarem.splice(insertIdx, 0, 'Harem');
    return withoutHarem.slice(0, 7);
  }

  return unique.slice(0, 7);
};
