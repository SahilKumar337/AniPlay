/**
 * Kitsu Fallback Adapter with AniList ID Cross-Reference Bridge
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-maintenance, 100% free, client-side metadata failover.
 * Used automatically ONLY when graphql.anilist.co experiences an outage or 503/network failure.
 */

import offlineCatalog from '../data/offlineCatalog.json' with { type: 'json' };

const BASE = 'https://kitsu.io/api/edge';

// Local cache index of known titles -> AniList IDs for instant cross-referencing
const titleToAniListMap = new Map();
const anilistToTitleMap = new Map();

try {
  const allPool = [
    ...(offlineCatalog?.trending || []),
    ...(offlineCatalog?.airing || []),
    ...(offlineCatalog?.popularSeason || []),
    ...(offlineCatalog?.topRated || []),
    ...(offlineCatalog?.movies || []),
    ...(offlineCatalog?.newReleases || []),
  ];
  allPool.forEach(a => {
    if (a?.id) {
      if (a.title?.romaji) {
        titleToAniListMap.set(a.title.romaji.toLowerCase(), a.id);
        anilistToTitleMap.set(a.id, a.title.romaji);
      }
      if (a.title?.english) {
        titleToAniListMap.set(a.title.english.toLowerCase(), a.id);
        if (!anilistToTitleMap.has(a.id)) anilistToTitleMap.set(a.id, a.title.english);
      }
      if (a.title?.userPreferred) {
        titleToAniListMap.set(a.title.userPreferred.toLowerCase(), a.id);
      }
      (a.synonyms || []).forEach(s => titleToAniListMap.set(s.toLowerCase(), a.id));
    }
  });
} catch (_) {}

function parseKitsuMedia(item, mapDict = new Map()) {
  if (!item) return null;

  // 1. Extract genuine AniList ID from external mappings
  const rels = item.relationships?.mappings?.data || [];
  let anilistId = null;
  let malId = null;

  for (const r of rels) {
    const attr = mapDict.get(r.id);
    if (!attr) continue;
    if (attr.externalSite === 'anilist/anime') anilistId = parseInt(attr.externalId, 10);
    if (attr.externalSite === 'myanimelist/anime') malId = parseInt(attr.externalId, 10);
  }

  // 2. Titles
  const attrs = item.attributes || {};
  const titles = attrs.titles || {};
  const canonical = attrs.canonicalTitle || '';
  const romaji = titles.en_jp || canonical;
  const english = titles.en || titles.en_us || canonical;
  const native = titles.ja_jp || null;

  // Cross-reference with offline catalog for authentic AniList ID if available
  if (!anilistId) {
    const matchedId = titleToAniListMap.get((english || '').toLowerCase()) ||
                      titleToAniListMap.get((romaji || '').toLowerCase()) ||
                      titleToAniListMap.get((canonical || '').toLowerCase());
    if (matchedId) anilistId = matchedId;
  }

  // If no AniList mapping exists in Kitsu or catalog, use MAL ID or Kitsu ID
  const finalId = anilistId || malId || parseInt(item.id, 10);

  // 3. Covers & Banners
  const poster = attrs.posterImage || {};
  const cover = attrs.coverImage || {};
  const largeCover = poster.large || poster.medium || poster.small || poster.original || '';
  const extraLargeCover = poster.large || poster.original || largeCover;
  const banner = cover.large || cover.original || cover.small || largeCover || null;

  // 4. Format & Status
  const subtype = (attrs.subtype || 'tv').toUpperCase();
  const rawStatus = attrs.status || '';
  const status = rawStatus === 'current' ? 'RELEASING' :
                 rawStatus === 'finished' ? 'FINISHED' :
                 rawStatus === 'unreleased' ? 'NOT_YET_RELEASED' : 'FINISHED';

  // 5. Episodes & Ratings
  const episodes = attrs.episodeCount || (status === 'RELEASING' ? 24 : 12);
  const rating = parseFloat(attrs.averageRating || '0');
  const averageScore = Math.round(rating);

  return {
    id: finalId,
    idMal: malId || finalId,
    title: {
      romaji: romaji || english,
      english: english || romaji,
      native: native,
      userPreferred: english || romaji
    },
    synonyms: attrs.abbreviatedTitles || [],
    description: attrs.synopsis || attrs.description || '',
    coverImage: {
      large: largeCover,
      extraLarge: extraLargeCover,
      color: '#6366f1'
    },
    bannerImage: banner,
    genres: [],
    averageScore: averageScore > 0 ? averageScore : 80,
    episodes: episodes,
    status: status,
    format: subtype === 'MOVIE' ? 'MOVIE' : 'TV',
    startDate: {
      year: attrs.startDate ? parseInt(attrs.startDate.split('-')[0], 10) : 2024
    },
    nextAiringEpisode: status === 'RELEASING' ? { episode: 1, airingAt: Math.floor(Date.now() / 1000) + 86400 } : null,
    tags: []
  };
}

async function fetchKitsu(path, params = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set('include', 'mappings');
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      if (k === 'page[limit]' && Number(v) > 20) {
        url.searchParams.set(k, '20');
      } else {
        url.searchParams.set(k, v);
      }
    }
  });

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);

  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      }
    });
    clearTimeout(tid);

    if (!res.ok) throw new Error(`Kitsu API HTTP ${res.status}`);
    const json = await res.json();

    const mapDict = new Map();
    (json.included || []).forEach(i => {
      if (i.type === 'mappings') mapDict.set(i.id, i.attributes);
    });

    if (Array.isArray(json.data)) {
      return json.data.map(item => parseKitsuMedia(item, mapDict)).filter(Boolean);
    } else if (json.data) {
      return parseKitsuMedia(json.data, mapDict);
    }
    return [];
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

/* ── Fallback Methods ─────────────────────────────────────────────────────── */

export async function kitsuTrending(page = 1, perPage = 15) {
  const limit = Math.min(Math.max(1, perPage || 15), 20);
  const offset = (page - 1) * limit;
  try {
    const list = await fetchKitsu('/anime', {
      'sort': '-userCount',
      'page[limit]': limit,
      'page[offset]': offset,
    });
    if (list && list.length > 0) return list;
  } catch (e) {
    console.warn('[KitsuFallback] kitsuTrending failed:', e.message);
  }
  return offlineCatalog?.trending || [];
}

export async function kitsuAiring(page = 1, perPage = 15) {
  const limit = Math.min(Math.max(1, perPage || 15), 20);
  const offset = (page - 1) * limit;
  try {
    const list = await fetchKitsu('/anime', {
      'filter[status]': 'current',
      'sort': '-userCount',
      'page[limit]': limit,
      'page[offset]': offset,
    });
    if (list && list.length > 0) return list;
  } catch (e) {
    console.warn('[KitsuFallback] kitsuAiring failed:', e.message);
  }
  return offlineCatalog?.airing || [];
}

export async function kitsuTopRated(page = 1, perPage = 15) {
  const limit = Math.min(Math.max(1, perPage || 15), 20);
  const offset = (page - 1) * limit;
  try {
    const list = await fetchKitsu('/anime', {
      'sort': '-averageRating',
      'page[limit]': limit,
      'page[offset]': offset,
    });
    if (list && list.length > 0) return list;
  } catch (e) {
    console.warn('[KitsuFallback] kitsuTopRated failed:', e.message);
  }
  return offlineCatalog?.topRated || [];
}

export async function kitsuMovies(page = 1, perPage = 15) {
  const limit = Math.min(Math.max(1, perPage || 15), 20);
  const offset = (page - 1) * limit;
  try {
    const list = await fetchKitsu('/anime', {
      'filter[subtype]': 'movie',
      'sort': '-userCount',
      'page[limit]': limit,
      'page[offset]': offset,
    });
    if (list && list.length > 0) return list;
  } catch (e) {
    console.warn('[KitsuFallback] kitsuMovies failed:', e.message);
  }
  return offlineCatalog?.movies || [];
}

export async function kitsuSearch(query, page = 1, perPage = 20) {
  const limit = Math.min(Math.max(1, perPage || 20), 20);
  const offset = (page - 1) * limit;
  try {
    const params = {
      'page[limit]': limit,
      'page[offset]': offset,
    };
    if (query && query.trim()) {
      params['filter[text]'] = query.trim();
    } else {
      params['sort'] = '-userCount';
    }

    const rows = await fetchKitsu('/anime', params);
    if (rows && rows.length > 0) {
      return {
        rows,
        hasNextPage: rows.length >= limit
      };
    }
  } catch (e) {
    console.warn('[KitsuFallback] kitsuSearch network failed:', e.message);
  }

  // Fallback to searching in local offline catalog
  const q = (query || '').toLowerCase().trim();
  const allPool = [
    ...(offlineCatalog?.trending || []),
    ...(offlineCatalog?.airing || []),
    ...(offlineCatalog?.popularSeason || []),
    ...(offlineCatalog?.topRated || []),
    ...(offlineCatalog?.movies || []),
  ];
  const matched = allPool.filter(a => {
    const titleEn = (a.title?.english || '').toLowerCase();
    const titleRom = (a.title?.romaji || '').toLowerCase();
    return titleEn.includes(q) || titleRom.includes(q);
  });
  return { rows: matched.slice(offset, offset + limit), hasNextPage: false };
}

export async function kitsuAnimeDetail(id) {
  if (!id) return null;
  const numId = parseInt(id, 10);

  try {
    // 1. Direct AniList mapping lookup on Kitsu
    let res = await fetch(`${BASE}/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${numId}&include=item`, {
      headers: { 'Accept': 'application/vnd.api+json' }
    });
    let json = await res.json();
    let item = json.included?.[0];

    // 2. MAL mapping lookup on Kitsu
    if (!item) {
      res = await fetch(`${BASE}/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${numId}&include=item`, {
        headers: { 'Accept': 'application/vnd.api+json' }
      });
      json = await res.json();
      item = json.included?.[0];
    }

    // 3. Title-based lookup if mapped title known
    if (!item && anilistToTitleMap.has(numId)) {
      const title = anilistToTitleMap.get(numId);
      const searchList = await fetchKitsu('/anime', { 'filter[text]': title, 'page[limit]': 1 });
      if (searchList && searchList[0]) return searchList[0];
    }

    if (item) {
      const parsed = parseKitsuMedia(item);
      if (parsed) {
        parsed.id = numId; // preserve AniList ID
        return {
          ...parsed,
          characters: { edges: [] },
          recommendations: { nodes: [] }
        };
      }
    }
  } catch (e) {
    console.warn(`[KitsuFallback] kitsuAnimeDetail(${id}) failed:`, e.message);
  }

  return null;
}
