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

  let lastErr;
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
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
        continue;
      }

      const json = await res.json();
      if (json.data) { toCache(key, json.data); return json.data; }
      throw new Error((json.errors || []).map(e => e.message).join('; ') || 'Unknown error');
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
  title { romaji english }
  coverImage { large extraLarge color }
  bannerImage
  genres averageScore episodes status format
  startDate { year }
  nextAiringEpisode { episode airingAt }
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

/* ── Airing Now ───────────────────────────────────────────────── */
export async function getAiring(page = 1, perPage = 15) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(status:RELEASING,sort:UPDATED_AT_DESC,type:ANIME,isAdult:false,format_in:[TV,TV_SHORT,ONA]){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return (d?.Page?.media || []).filter(a => getCover(a));
}

/* ── Most Popular ─────────────────────────────────────────────── */
export async function getMostPopular(page = 1, perPage = 12) {
  const q = `query($p:Int,$n:Int){Page(page:$p,perPage:$n){media(sort:POPULARITY_DESC,type:ANIME,isAdult:false){${MEDIA_FIELDS}}}}`;
  const d = await gql(q, { p: page, n: perPage });
  return d?.Page?.media || [];
}

/* ── Search ───────────────────────────────────────────────────── */
export async function searchAnime(search, page = 1, perPage = 20, genre = null, format = null, status = null) {
  const q = `query($s:String,$p:Int,$n:Int,$g:String,$f:MediaFormat,$st:MediaStatus){
    Page(page:$p,perPage:$n){
      media(search:$s,type:ANIME,genre:$g,format:$f,status:$st,isAdult:false,sort:POPULARITY_DESC){${MEDIA_FIELDS}}
    }
  }`;
  const vars = { p: page, n: perPage };
  if (search) vars.s  = search;
  if (genre)  vars.g  = genre;
  if (format) vars.f  = format;
  if (status) vars.st = status;
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
export const getTitle = a => a?.title?.english || a?.title?.romaji || 'Unknown';
export const getCover = a => a?.coverImage?.extraLarge || a?.coverImage?.large || '';
export const getColor = a => a?.coverImage?.color || '#e50914';
