import { Capacitor, CapacitorHttp } from '@capacitor/core';

const isCapacitorApp = typeof window !== 'undefined' && (
  Capacitor.isNativePlatform() || 
  (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
  (!window.location.port && window.location.hostname === 'localhost')
);

const UA = isCapacitorApp 
  ? 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const BASE_URL = 'https://hstream.moe';

async function adultHttp(url, opts = {}) {
  const method = opts.method || 'GET';
  const headers = {
    'User-Agent': UA,
    ...(opts.headers || {}),
  };

  if (isCapacitorApp) {
    try {
      const res = await CapacitorHttp.request({
        url,
        method,
        headers,
        data: opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : undefined,
        connectTimeout: opts.timeout || 12000,
        readTimeout: opts.timeout || 12000,
      });

      const setCookies = res.headers?.['Set-Cookie'] || res.headers?.['set-cookie'] || '';
      const cookieArray = Array.isArray(setCookies) ? setCookies : (setCookies ? [setCookies] : []);
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        text: async () => text,
        json: async () => (typeof res.data === 'object' ? res.data : JSON.parse(text)),
        cookies: cookieArray,
      };
    } catch (e) {
      console.warn(`[adultHttp:CapacitorHttp] Failed for ${url}:`, e.message);
      throw e;
    }
  }

  // Desktop web / Local dev fallback
  try {
    const fetchOpts = {
      method,
      headers,
      signal: AbortSignal.timeout(opts.timeout || 15000),
    };
    if (opts.body) fetchOpts.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);

    const res = await fetch(url, fetchOpts);
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    return {
      status: res.status,
      ok: res.ok,
      text: () => res.text(),
      json: () => res.json(),
      cookies: (setCookies || []).filter(Boolean),
    };
  } catch (e) {
    console.warn(`[adultHttp:fetch] Failed for ${url}:`, e.message);
    throw e;
  }
}

function cleanTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/\s*\(OVA\)\s*/gi, '')
    .replace(/\s*\(TV\)\s*/gi, '')
    .replace(/\s*\(Special\)\s*/gi, '')
    .replace(/\s*OVA\s*$/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAdultTitleVariants(rawTitles) {
  const titles = [];
  const seen = new Set();
  const add = (t) => {
    if (!t) return;
    const c = cleanTitle(t);
    if (c && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      titles.push(c);
    }
  };

  for (const t of (rawTitles || [])) {
    if (!t) continue;
    add(t);
    const noAnim = t.replace(/\bthe animation\b/gi, '').replace(/\banimation\b/gi, '').trim();
    if (noAnim && noAnim !== t) add(noAnim);
    const noThe = t.replace(/^the\s+/gi, '').trim();
    if (noThe && noThe !== t) add(noThe);
  }
  return titles;
}

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Scrapes HStream for dedicated 18+ adult / Hentai anime episodes.
 */
export async function scrapeHStream(primaryTitle, episode = 1, isMovie = false, animeId = null, allTitles = []) {
  console.log(`[scrapeHStream] Initiating adult stream search for "${primaryTitle}" ep ${episode}`);
  const epNum = Number(episode) || 1;
  const rawTitles = [primaryTitle, ...(allTitles || [])].filter(Boolean);
  const titles = getAdultTitleVariants(rawTitles);

  let targetUrl = null;
  let pageHtml = null;
  let cookiesHeader = '';
  let xsrfToken = '';

  // 1. Fast direct probe — test candidate URLs directly (instant ~150ms hit)
  for (const t of titles) {
    const slug = toSlug(t);
    const candidateUrls = [
      `${BASE_URL}/hentai/${slug}-${epNum}`,
      `${BASE_URL}/hentai/${slug}-episode-${epNum}`,
      epNum === 1 ? `${BASE_URL}/hentai/${slug}` : null
    ].filter(Boolean);

    for (const cand of candidateUrls) {
      try {
        const res = await adultHttp(cand, { timeout: 4000 });
        if (res.status === 200) {
          const text = await res.text();
          if (text.includes('id="e_id"') || text.includes('id=\'e_id\'')) {
            targetUrl = cand;
            pageHtml = text;
            cookiesHeader = res.cookies.map(c => c.split(';')[0]).join('; ');
            for (const c of res.cookies) {
              const m = c.match(/XSRF-TOKEN=([^;]+)/);
              if (m) { xsrfToken = decodeURIComponent(m[1]); break; }
            }
            console.log(`[scrapeHStream] Direct hit on candidate: ${cand}`);
            break;
          }
        }
      } catch (_) {}
    }
    if (targetUrl) break;
  }

  // 2. Search fallback if direct candidate probe missed
  if (!targetUrl) {
    for (const t of titles) {
      try {
        const searchUrl = `${BASE_URL}/search?search=${encodeURIComponent(t)}&page=1`;
        const sRes = await adultHttp(searchUrl, { timeout: 6000 });
        if (!sRes.ok) continue;
        const sHtml = await sRes.text();
        const matches = [...sHtml.matchAll(/href=["'](https:\/\/hstream\.moe\/hentai\/[^"']+|(?:\/hentai\/[^"']+))["']/gi)]
          .map(m => m[1].startsWith('http') ? m[1] : `${BASE_URL}${m[1]}`);

        if (matches.length > 0) {
          // Find matching episode link
          const epMatch = matches.find(u => {
            const slug = u.split('/').pop() || '';
            return new RegExp(`[-_]0?${epNum}(?:$|[\\?#])`, 'i').test(slug);
          }) || matches[0];

          if (epMatch) {
            const pRes = await adultHttp(epMatch, { timeout: 6000 });
            if (pRes.status === 200) {
              targetUrl = epMatch;
              pageHtml = await pRes.text();
              cookiesHeader = pRes.cookies.map(c => c.split(';')[0]).join('; ');
              for (const c of pRes.cookies) {
                const m = c.match(/XSRF-TOKEN=([^;]+)/);
                if (m) { xsrfToken = decodeURIComponent(m[1]); break; }
              }
              console.log(`[scrapeHStream] Found search match: ${epMatch}`);
              break;
            }
          }
        }
      } catch (err) {
        console.warn(`[scrapeHStream] Search probe error for "${t}":`, err.message);
      }
    }
  }

  if (!targetUrl || !pageHtml) {
    console.warn(`[scrapeHStream] No adult streaming source found for "${primaryTitle}" ep ${epNum}`);
    return { servers: [] };
  }

  // 3. Extract e_id
  const eidMatch = pageHtml.match(/id=["']e_id["'][^>]*value=["']([^"']+)["']/i) || pageHtml.match(/value=["']([^"']+)["'][^>]*id=["']e_id["']/i);
  if (!eidMatch) {
    console.warn(`[scrapeHStream] Missing episode ID on: ${targetUrl}`);
    return { servers: [] };
  }
  const episodeId = eidMatch[1];

  // 4. Resolve stream via /player/api
  const apiRes = await adultHttp(`${BASE_URL}/player/api`, {
    method: 'POST',
    headers: {
      'Referer': targetUrl,
      'Origin': BASE_URL,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrfToken,
      'Cookie': cookiesHeader
    },
    body: JSON.stringify({ episode_id: episodeId })
  });

  if (!apiRes.ok) {
    console.warn(`[scrapeHStream] Player API failed with HTTP ${apiRes.status}`);
    return { servers: [] };
  }

  const data = await apiRes.json();
  if (!data?.stream_domains?.length || !data?.stream_url) {
    console.warn('[scrapeHStream] Invalid player data received from upstream');
    return { servers: [] };
  }

  const primaryDomain = data.stream_domains[0];
  const streamBase = `${primaryDomain}/${data.stream_url}`;
  const video720p = `${streamBase}/x264.720p.mp4`;
  const subVtt = `${streamBase}/eng.vtt`;

  const servers = [
    {
      name: 'HStream-HD (720p)',
      type: 'sub',
      videoUrl: video720p,
      embedUrl: targetUrl,
      referer: BASE_URL,
      isHLS: true,
      format: 'mp4',
      subtitles: [
        {
          id: 0,
          lang: 'English',
          label: 'English',
          url: subVtt
        }
      ]
    },
    {
      name: 'HStream-HD (720p) (DUB)',
      type: 'dub',
      videoUrl: video720p,
      embedUrl: targetUrl,
      referer: BASE_URL,
      isHLS: true,
      format: 'mp4',
      subtitles: [
        {
          id: 0,
          lang: 'English',
          label: 'English',
          url: subVtt
        }
      ]
    }
  ];

  console.log(`[scrapeHStream] Successfully resolved HStream for ep ${epNum}:`, video720p);
  return {
    ok: true,
    servers,
    animeTitle: data.title || primaryTitle,
    slug: targetUrl.split('/').pop()
  };
}

const HENTAICITY_BASE = 'https://www.hentaicity.com';

// Curated mapping for classic adult OVAs with renamed SEO titles on HentaiCity
const KNOWN_ADULT_SERIES_MAP = {
  // AniList ID 2697: Donburi Kazoku / Like Mother, Like Daughter (OVA) (2 episodes)
  2697: [
    'https://www.hentaicity.com/video/horny-housewife-titty-fucks-a-local-guys-cock-till-he-shoots-on-her-face-bJ6m56ka2Y9.html',
    'https://www.hentaicity.com/video/masked-intruder-forces-a-big-titty-milf-to-suck-his-swollen-cock-lGr4NrMtyWI.html'
  ]
};

/**
 * Scrapes HentaiCity for adult/hentai video streams (1080p, 720p, 480p master HLS).
 */
export async function scrapeHentaiCity(primaryTitle, episode = 1, isMovie = false, animeId = null, allTitles = []) {
  console.log(`[scrapeHentaiCity] Initiating adult stream search for "${primaryTitle}" ep ${episode}`);
  const epNum = Number(episode) || 1;
  const rawTitles = [primaryTitle, ...(allTitles || [])].filter(Boolean);
  const titles = getAdultTitleVariants(rawTitles);

  let matchedPageUrl = null;

  // 1. Direct hit via KNOWN_ADULT_SERIES_MAP for classic titles with renamed SEO titles on HentaiCity
  const isDonburi = (animeId && String(animeId) === '2697') || 
                    titles.some(t => /donburi/i.test(t) || /like mother/i.test(t));
  if (isDonburi) {
    const eps = KNOWN_ADULT_SERIES_MAP[2697];
    if (epNum <= eps.length) {
      matchedPageUrl = eps[epNum - 1];
      console.log(`[scrapeHentaiCity] Mapped Donburi Kazoku / Like Mother, Like Daughter ep ${epNum}:`, matchedPageUrl);
    } else {
      console.warn(`[scrapeHentaiCity] Donburi Kazoku has only 2 episodes. Requested ep ${epNum}`);
      return { servers: [] };
    }
  }

  // 2. Dynamic catalog search
  if (!matchedPageUrl) {
    // Extract specific title keywords to prevent matching unrelated series
    const titleKeywords = titles.flatMap(t => 
      t.toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !['the', 'and', 'for', 'with', 'anime', 'hentai', 'animation', 'special', 'episode', 'series', 'mother', 'daughter', 'family'].includes(w))
    );

    const searchQueries = [...titles];
    for (const q of searchQueries) {
      try {
        const searchUrl = `${HENTAICITY_BASE}/search/video/${encodeURIComponent(q)}`;
        const res = await adultHttp(searchUrl, { timeout: 6000 });
        if (!res.ok) continue;
        const html = await res.text();
        const matches = [...html.matchAll(/<a[^>]+class=["'][^"']*video-title[^"']*["'][^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/gi)];
        if (matches.length === 0) continue;

        let chosen = null;
        for (const m of matches) {
          const href = m[1];
          const title = m[2].toLowerCase();
          const hrefLow = href.toLowerCase();

          // Must match at least one specific anime title keyword (prevents picking random unrelated titles)
          const hasKeyword = titleKeywords.length === 0 || titleKeywords.some(kw => title.includes(kw) || hrefLow.includes(kw));
          if (!hasKeyword) continue;

          const epRegex = new RegExp(`(?:ep|episode|\\s|-|_|part)0?${epNum}(?:\\b|[^0-9]|$)`, 'i');
          if (epRegex.test(title) || epRegex.test(hrefLow)) {
            chosen = href.startsWith('http') ? href : `${HENTAICITY_BASE}${href}`;
            break;
          }
        }

        if (chosen) {
          matchedPageUrl = chosen;
          break;
        }
      } catch (err) {
        console.warn(`[scrapeHentaiCity] Search probe failed for "${q}":`, err.message);
      }
    }
  }

  if (!matchedPageUrl) {
    console.warn(`[scrapeHentaiCity] No adult video found for "${primaryTitle}" ep ${epNum}`);
    return { servers: [] };
  }

  try {
    const pageRes = await adultHttp(matchedPageUrl, { timeout: 6000 });
    if (!pageRes.ok) return { servers: [] };
    const pageHtml = await pageRes.text();

    const m3u8Match = pageHtml.match(/source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) || pageHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    const videoMatch = pageHtml.match(/<video[^>]+src=["']([^"']+)["']/i) || pageHtml.match(/<source[^>]+src=["']([^"']+)["']/i);
    const ogVideo = pageHtml.match(/meta\s+property=["']og:video:url["']\s+content=["']([^"']+)["']/i);

    const videoUrl = m3u8Match?.[1] || videoMatch?.[1] || ogVideo?.[1];
    if (!videoUrl) {
      console.warn(`[scrapeHentaiCity] Could not extract media URL from ${matchedPageUrl}`);
      return { servers: [] };
    }

    const isHLS = videoUrl.includes('.m3u8');
    const baseName = isHLS ? 'HentaiCity (Multi-Res)' : 'HentaiCity-HD';
    const servers = [
      {
        name: baseName,
        type: 'sub',
        videoUrl,
        embedUrl: matchedPageUrl,
        referer: HENTAICITY_BASE,
        isHLS,
        format: isHLS ? 'hls' : 'mp4',
        subtitles: []
      },
      {
        name: `${baseName} (DUB)`,
        type: 'dub',
        videoUrl,
        embedUrl: matchedPageUrl,
        referer: HENTAICITY_BASE,
        isHLS,
        format: isHLS ? 'hls' : 'mp4',
        subtitles: []
      }
    ];

    console.log(`[scrapeHentaiCity] Successfully resolved stream for ep ${epNum}:`, videoUrl);
    return {
      ok: true,
      servers,
      animeTitle: primaryTitle,
      slug: matchedPageUrl.split('/').pop()
    };
  } catch (e) {
    console.warn(`[scrapeHentaiCity] Failed to load stream page:`, e.message);
    return { servers: [] };
  }
}

/**
 * Discovers the actual number of aired episodes for adult/hentai anime
 * by probing provider catalogs (e.g. HStream/HentaiCity) dynamically.
 */
export async function discoverAdultEpisodeCount(anime) {
  if (!anime) return 0;
  const animeId = anime.id;
  const cacheKey = `adult_ep_count_${animeId}`;

  // 1. Direct hit in curated series map (e.g. Donburi Kazoku / Like Mother, Like Daughter = 2 episodes)
  if (animeId && KNOWN_ADULT_SERIES_MAP[animeId]) {
    const knownCount = KNOWN_ADULT_SERIES_MAP[animeId].length;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(cacheKey, String(knownCount)); } catch (_) {}
    }
    return knownCount;
  }
  const isDonburi = (animeId && String(animeId) === '2697') || 
    [anime.title?.romaji, anime.title?.english, ...(anime.synonyms || [])].some(t => /donburi/i.test(t || '') || /like mother/i.test(t || ''));
  if (isDonburi) {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(cacheKey, '2'); } catch (_) {}
    }
    return 2;
  }

  // 2. If anime status is FINISHED and AniList specifies definitive episodes (> 1), trust AniList completely!
  if (anime.status === 'FINISHED' && anime.episodes && anime.episodes > 1) {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(cacheKey, String(anime.episodes)); } catch (_) {}
    }
    return anime.episodes;
  }

  // 3. Cache check (clean out corrupted caches that exceed finished anime count)
  if (typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = Number(cached);
        if (parsed > 0) {
          if (anime.status === 'FINISHED' && anime.episodes && anime.episodes > 1) {
            return anime.episodes;
          }
          return parsed;
        }
      }
    } catch (_) {}
  }

  const rawTitles = [
    anime.title?.romaji,
    anime.title?.english,
    ...(anime.synonyms || [])
  ].filter(Boolean);
  const titles = getAdultTitleVariants(rawTitles);

  let maxEp = 0;
  for (const clean of titles) {
    if (!clean) continue;
    try {
      const searchUrl = `${BASE_URL}/search?search=${encodeURIComponent(clean)}&page=1`;
      const res = await adultHttp(searchUrl, { timeout: 4500 });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = [...html.matchAll(/href=["'](https:\/\/hstream\.moe\/hentai\/[^"']+|(?:\/hentai\/[^"']+))["']/gi)]
        .map(m => m[1]);

      for (const m of matches) {
        const slug = m.split('/').pop() || '';
        const epMatch = slug.match(/[-_](\d+)(?:$|[\?#])/) || slug.match(/(?:ep|episode)[-_](\d+)/i);
        if (epMatch) {
          const num = parseInt(epMatch[1], 10);
          if (num > maxEp && num < 100) {
            maxEp = num;
          }
        }
      }
      if (maxEp > 0) break;
    } catch (_) {}
  }

  // Fallback to checking HentaiCity if HStream had no results
  if (maxEp === 0) {
    for (const clean of titles) {
      if (!clean) continue;
      try {
        const searchUrl = `${HENTAICITY_BASE}/search/video/${encodeURIComponent(clean)}`;
        const res = await adultHttp(searchUrl, { timeout: 4500 });
        if (!res.ok) continue;
        const html = await res.text();
        const matches = [...html.matchAll(/<a[^>]+class=["'][^"']*video-title[^"']*["'][^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/gi)];

        // Require at least one non-generic keyword match so unrelated search results are ignored
        const cleanWords = clean.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !['anime', 'hentai', 'animation'].includes(w));

        for (const m of matches) {
          const href = m[1];
          const title = m[2];
          
          if (cleanWords.length > 0) {
            const matchesWord = cleanWords.some(w => title.toLowerCase().includes(w) || href.toLowerCase().includes(w));
            if (!matchesWord) continue;
          }

          const epMatch = title.match(/(?:ep|episode|\s)(\d+)(?:\b|[^0-9]|$)/i) || href.match(/(?:ep|episode|\s|-|_|part)(\d+)(?:\b|[^0-9]|$)/i);
          if (epMatch) {
            const num = parseInt(epMatch[1], 10);
            if (num > maxEp && num < 100) {
              maxEp = num;
            }
          }
        }
        if (maxEp > 0) break;
      } catch (_) {}
    }
  }

  if (maxEp > 0) {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(cacheKey, String(maxEp));
      } catch (_) {}
    }
    return maxEp;
  }
  return 0;
}

