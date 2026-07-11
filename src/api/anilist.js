/**
 * AniList GraphQL API
 * Free, no API key, returns rich anime data including MAL IDs
 */
const ENDPOINT = 'https://graphql.anilist.co';

// ── In-memory cache (5 min TTL) ──────────────────────────────────
const _cache = new Map();
function fromCache(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > 5 * 60_000) { _cache.delete(key); return null; }
  return hit.data;
}
function toCache(key, data) { _cache.set(key, { data, ts: Date.now() }); }

async function gql(query, variables = {}) {
  const key = query.slice(0, 60) + JSON.stringify(variables);
  const cached = fromCache(key);
  if (cached) return cached;

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
      if (json.data) { toCache(key, json.data); return json.data; }
      throw new Error((json.errors || []).map(e => e?.message || 'Unknown error').join('; ') || 'Unknown error');
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out — check your internet.');
      lastErr = err;
      if (i < 2) await new Promise(r => setTimeout(r, (i + 1) * 1000));
    }
  }
  throw lastErr;
}

/* ── Shared media fields ──────────────────────────────────────── */
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

/* ── Lightweight fields for card-only queries (no description) ─── */
const CARD_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { large extraLarge color }
  genres averageScore episodes status format
  startDate { year }
  nextAiringEpisode { episode airingAt }
  tags { name isMediaSpoiler rank }
`;

/* ── Trending ─────────────────────────────────────────────────── */
export async function getTrending(page = 1, perPage = 15) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:TRENDING_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return d?.Page?.media || [];
}

/* ── Seasonal ─────────────────────────────────────────────────── */
export async function getSeasonal(season, year, page = 1, perPage = 12) {
  const q = `query($s:MediaSeason,$y:Int,$p:Int,$n:Int){Page(page:$p,perPage:$n){media(season:$s,seasonYear:$y,sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { s: season, y: year, p: page, n: perPage });
  return d?.Page?.media || [];
}

/* ── Top Rated ────────────────────────────────────────────────── */
export async function getTopRated(page = 1, perPage = 12) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:SCORE_DESC,type:ANIME,status:FINISHED,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return d?.Page?.media || [];
}

/* ── Movies ───────────────────────────────────────────────────── */
export async function getMovies(page = 1, perPage = 10) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,format:MOVIE,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return d?.Page?.media || [];
}

/* ── Top Airing (currently releasing, sorted by trending score) ── */
export async function getAiring(page = 1, perPage = 15) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(status:RELEASING,sort:TRENDING_DESC,type:ANIME,isAdult:false,format_in:[TV,TV_SHORT,ONA]){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return (d?.Page?.media || []).filter(a => getCover(a));
}

/* ── New Episode Releases (aired in the past 2 weeks, NOT future) ── */
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
  const d = await gql(q, { p: page, n: perPage, from: twoWeeks, to: now });
  const schedules = (d?.Page?.airingSchedules || [])
    .filter(s =>
      !s.media?.isAdult &&
      getCover(s.media) &&
      s.media?.status !== 'NOT_YET_RELEASED' &&
      s.airingAt <= now  // ← only past airings, never future
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

/* ── Most Popular ─────────────────────────────────────────────── */
export async function getMostPopular(page = 1, perPage = 12) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return d?.Page?.media || [];
}

/* ── Popular This Season (current season, sorted by trending) ──── */
export async function getPopularThisSeason(page = 1, perPage = 15) {
  const { season, year } = getCurrentSeason();
  const q = `query($s:MediaSeason,$y:Int,$p:Int,$n:Int){Page(page:$p,perPage:$n){media(season:$s,seasonYear:$y,sort:TRENDING_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { s: season, y: year, p: page, n: perPage });
  return (d?.Page?.media || []).filter(a => getCover(a));
}

/* ── Search ───────────────────────────────────────────────────── */
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

  // Official AniList genres (these go in genre_in)
  const ANILIST_GENRES = new Set([
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy',
    'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery',
    'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
    'Sports', 'Supernatural', 'Thriller'
  ]);

  // Map display labels → exact AniList tag names for everything NOT a genre
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

  const d = await gql(q, vars);
  return d?.Page?.media || [];
}


/* ── Anime Detail ─────────────────────────────────────────────── */
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
  const d = await gql(q, { id });
  if (!d?.Media) throw new Error('Anime not found');
  return d.Media;
}

/* ── Schedule ─────────────────────────────────────────────────── */
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
  const d = await gql(q, { p: page, n: perPage, from: now - 86400, to: week });
  return (d?.Page?.airingSchedules || []).filter(s => !s.media?.isAdult);
}

/* ── Helpers ──────────────────────────────────────────────────── */
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

export const getDisplayGenresOrTags = a => {
  if (!a) return [];
  const genres = [...(a.genres || [])];
  
  // Extract and normalize tags
  let tags = (a.tags || [])
    .filter(t => !t.isMediaSpoiler && t.rank >= 60)
    .map(t => {
      const name = t.name;
      if (name === 'Female Harem' || name === 'Male Harem') {
        return 'Harem';
      }
      return name;
    });

  // Filter out low-value/redundant descriptive tags to keep badges clean
  const blocklist = new Set(['Nudity', 'Heterosexual', 'Male Protagonist', 'Primarily Female Cast', 'Kuudere', 'Tsundere']);
  tags = tags.filter(t => !blocklist.has(t));

  // Combine genres and tags
  const combined = [...genres, ...tags];
  const unique = combined.filter((item, index) => combined.indexOf(item) === index);
  
  // Prioritize showing 'Harem' near the front so it doesn't get sliced off
  if (unique.includes('Harem')) {
    const withoutHarem = unique.filter(x => x !== 'Harem');
    const insertIdx = Math.min(genres.length, 3);
    withoutHarem.splice(insertIdx, 0, 'Harem');
    return withoutHarem.slice(0, 6);
  }

  return unique.slice(0, 6);
};
