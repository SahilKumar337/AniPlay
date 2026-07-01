import { CapacitorHttp } from '@capacitor/core';

const isCapacitorApp = typeof window !== 'undefined' && window.Capacitor && (
  window.Capacitor.isNativePlatform() || 
  (!window.location.port && window.location.hostname === 'localhost')
);

const ANINEKO = 'https://anineko.to';
const AW = 'https://aniwaves.ru';
const ANIMETSU = 'https://animetsu.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const STREAM_PROXY = import.meta.env.VITE_STREAM_PROXY_URL || '';
const PROXY = import.meta.env.VITE_PROXY_URL || '';

function formatProxyUrl(targetUrl, referer) {
  if (!STREAM_PROXY) return targetUrl;
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
  return `${PROXY}/api/iframe-proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}`;
}

const wavesSearchCache = new Map();
const nekoSearchCache = new Map();
const animetsuSearchCache = new Map();

// ── Helper Matching Functions ──

function norm(s) {
  return s.toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/[^a-z0-9\s']/g, ' ')
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
  return 1;
}

function titleScore(resultTitle, queryTitle) {
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(queryTitle)) return 0.7;

  const rn = norm(resultTitle);
  const qn = norm(queryTitle);

  const rSeason = extractSeason(rn);
  const qSeason = extractSeason(qn);
  if (rSeason !== qSeason) return 0;

  const strip = t => t
    .replace(/\b(season|part|s)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
    .replace(/\b(sub|dub|uncensored|uncut|tv|movie|ova|ona|special|specials|multi|audio)\b/gi, '')
    .trim();

  const qWords = strip(qn).split(/\s+/).filter(w => w.length > 1);
  const rWords = strip(rn).split(/\s+/).filter(w => w.length > 1);

  if (!qWords.length || !rWords.length) return 0;

  const intersection = qWords.filter(w => rWords.includes(w));
  if (intersection.length === 0) return 0;

  return (2 * intersection.length) / (qWords.length + rWords.length);
}

function getLongestWord(title) {
  const cleaned = title.replace(/\b(?:season|part|s|ep|episode|recap|ova|ona|movie)\b/gi, '');
  const words = cleaned.split(/[^a-zA-Z0-9]/).filter(w => w.length > 2);
  if (!words.length) return title;
  return words.reduce((a, b) => a.length > b.length ? a : b);
}

// ── Generic Fetch Helper with Headers ──

async function clientFetch(url, opts = {}) {
  if (isCapacitorApp) {
    try {
      console.log(`[CapacitorHttp] Fetching: ${url} (referer: ${opts.referer || 'none'})`);
      const response = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: {
          'User-Agent': UA,
          ...(opts.referer ? { 'Referer': opts.referer } : {}),
          ...(opts.headers || {}),
        },
        connectTimeout: opts.timeout || 15000,
        readTimeout: opts.timeout || 15000
      });
      
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      if (response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }
      return text;
    } catch (e) {
      console.error(`[CapacitorHttp] Request failed for ${url}:`, e.message);
      throw e;
    }
  }

  // If running in local desktop browser dev environment, proxy through the local backend proxy to bypass CORS!
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    try {
      const proxyUrl = `/api/stream/segment?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(opts.referer || new URL(url).origin)}`;
      console.log(`[LocalProxy] Scraping via backend proxy: ${url}`);
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(opts.timeout || 25000),
        headers: opts.headers
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from proxy`);
      return res.text();
    } catch (e) {
      console.warn(`[LocalProxy] Fetch failed for ${url} via proxy:`, e.message);
      // Fallback to direct fetch in case proxy is down
    }
  }

  // Fallback for production/direct fetches (subject to CORS in browser, but works inside phone WebView)
  const headers = { ...opts.headers };
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 15000),
    headers
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── AniWaves Scraper ──

async function awSearch(title) {
  const cleaned = title.replace(/\b(season|part|s)\s*\d+\b/gi, '').trim();
  const engWords = cleaned.split(/[^a-zA-Z0-9]/).filter(w =>
    w.length > 3 && !/^(the|and|with|from|that|this|into|over|under|behind|you)$/i.test(w)
  );
  const longestWord = engWords.length ? engWords.reduce((a, b) => a.length >= b.length ? a : b) : null;
  const firstTwo = cleaned.split(' ').slice(0, 2).join(' ');
  const firstThree = cleaned.split(' ').slice(0, 3).join(' ');

  const strategies = [cleaned, firstThree, firstTwo, longestWord].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
  let results = [];

  for (const keyword of strategies) {
    try {
      const rawText = await clientFetch(`${AW}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
        referer: AW,
        timeout: 20000,
      });
      const parsed = JSON.parse(rawText);
      if (parsed.status === 404 || !parsed.result?.html) continue;

      const html = parsed.result.html;
      const itemRe = /href="\/watch\/([\w%-]+-(\d+))"[\s\S]*?class="name d-title"[^>]*>([^<]+)<\/div>/g;
      let m;
      while ((m = itemRe.exec(html)) !== null) {
        results.push({ slug: m[1], animeId: m[2], animeTitle: m[3].trim() });
      }
      if (results.length === 0) {
        const slugRe = /href="\/watch\/([\w-]+-(\d+))"/g;
        while ((m = slugRe.exec(html)) !== null) {
          results.push({ slug: m[1], animeId: m[2], animeTitle: m[1].replace(/-\d+$/, '').replace(/-/g, ' ') });
        }
      }
      if (results.length) break;
    } catch {}
  }

  if (results.length === 0) throw new Error(`Anime "${title}" not found on AniWaves`);

  let best = results[0], maxScore = -1;
  for (const r of results) {
    let score = titleScore(r.animeTitle, title);
    const slugText = r.slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    score = Math.max(score, titleScore(slugText, title));
    if (score > maxScore) { maxScore = score; best = r; }
  }

  if (!best || maxScore < 0.4) {
    throw new Error(`No match on AniWaves for "${title}"`);
  }
  return best;
}

async function awGetServers(animeId, episode, slug) {
  const url = `${AW}/ajax/server/list?servers=${animeId}&eps=${episode}`;
  const referer = slug ? `${AW}/watch/${slug}` : AW;
  const text = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': referer },
    timeout: 20000,
  });
  const parsed = JSON.parse(text);
  if (parsed.status !== 200 || !parsed.result) {
    throw new Error(`No servers for ep ${episode}`);
  }

  const html = parsed.result;
  const servers = [];
  const sectionRe = /<div class="type" data-type="(sub|dub)">([\s\S]+?)<\/div>/g;
  let secMatch;
  while ((secMatch = sectionRe.exec(html)) !== null) {
    const type = secMatch[1];
    const listHtml = secMatch[2];
    const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([^<]+)<\/li>/g;
    let liMatch;
    while ((liMatch = liRe.exec(listHtml)) !== null) {
      servers.push({ type, linkId: liMatch[1], serverName: liMatch[2].trim() });
    }
  }
  return servers;
}

async function awGetEmbedUrl(linkId, watchPageSlug) {
  const url = `${AW}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`;
  const text = await clientFetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': `${AW}/watch/${watchPageSlug}` },
    timeout: 20000,
  });
  const parsed = JSON.parse(text);
  if (parsed.status !== 200 || !parsed.result?.url) throw new Error(`No embed URL`);
  return parsed.result.url;
}

export async function scrapeAniWaves(title, episode) {
  let searchResult = wavesSearchCache.get(title);
  if (!searchResult) {
    searchResult = await awSearch(title);
    wavesSearchCache.set(title, searchResult);
  }
  const { slug, animeId, animeTitle } = searchResult;
  const rawServers = await awGetServers(animeId, episode, slug);
  const subServers = rawServers.filter(s => s.type === 'sub');
  const dubServers = rawServers.filter(s => s.type === 'dub');
  const toResolve = [...subServers.slice(0, 2), ...dubServers.slice(0, 2)];

  const resolved = await Promise.allSettled(
    toResolve.map(async s => {
      const embedUrl = await awGetEmbedUrl(s.linkId, slug);
      const host = new URL(embedUrl).hostname;
      const isSupported = ['play.echovideo.ru', 'megacloud.club', 'megacloud.tv', 'myvidplay.com', 'sb1254w9megshle.org', 'vidplay.online'].some(p => host.includes(p));
      if (!isSupported) throw new Error('Unsupported provider');
      // Direct iframe proxy via Cloudflare Worker or direct load
      const videoUrl = formatIframeProxyUrl(embedUrl, `${AW}/watch/${slug}`);
      return { videoUrl, type: s.type, embedUrl };
    })
  );

  const working = resolved.filter(r => r.status === 'fulfilled').map(r => r.value);
  let subCount = 0, dubCount = 0;
  const servers = [];
  for (const s of working) {
    if (s.type === 'sub' && subCount < 1) {
      subCount++;
      servers.push({ name: `Waves HD${subCount}`, videoUrl: s.videoUrl, type: s.type, embedUrl: s.embedUrl, isHLS: false });
    } else if (s.type === 'dub' && dubCount < 1) {
      dubCount++;
      servers.push({ name: `Waves HD${dubCount} (DUB)`, videoUrl: s.videoUrl, type: s.type, embedUrl: s.embedUrl, isHLS: false });
    }
  }
  return { servers, animeTitle, slug };
}

// ── AniNeko Scraper ──

export async function scrapeAniNeko(title, episode) {
  let best, results;
  const cached = nekoSearchCache.get(title);
  if (cached) {
    best = cached.best;
    results = cached.results;
  } else {
    const cleanTitle = title.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleanTitle.split(' ').filter(w => w.length > 1);
    let searchQueries = [cleanTitle];
    if (words.length > 1) {
      searchQueries.push(words.slice(0, 3).join(' '));
      searchQueries.push(words.slice(0, 2).join(' '));
    }
    searchQueries.push(getLongestWord(title));
    searchQueries = [...new Set(searchQueries)].filter(Boolean);

    results = [];
    const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>/g;

    for (const keyword of searchQueries) {
      try {
        const searchHtml = await clientFetch(`${ANINEKO}/browser?keyword=${encodeURIComponent(keyword)}`, { referer: ANINEKO, timeout: 20000 });
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(searchHtml)) !== null) {
          results.push({ slug: m[1], title: m[2].trim() });
        }
        if (results.length > 0) break;
      } catch {}
    }

    if (!results.length) throw new Error(`Anime not found on AniNeko`);

    best = results[0];
    let maxScore = -1;
    for (const r of results) {
      const score = titleScore(r.title, title);
      if (score > maxScore) { maxScore = score; best = r; }
    }
    if (!best || maxScore < 0.4) throw new Error(`No match on AniNeko`);

    nekoSearchCache.set(title, { best, results });
  }

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
    const panelsRe = /<div[^>]+data-id="(sub|dub)"[\s\S]*?<\/div>\s*<\/div>/g;
    let pMatch;
    while ((pMatch = panelsRe.exec(html)) !== null) {
      const panelId = pMatch[1];
      const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
      let m;
      while ((m = btnRe.exec(pMatch[0])) !== null) {
        let videoUrl = m[1];
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (name.includes('HD-1')) {
          rawServers.push({ videoUrl, isDub: isDubPage || panelId === 'dub' || name.toLowerCase().includes('dub') });
        }
      }
    }
  }

  const seen = new Set();
  const servers = [];
  let subCount = 0, dubCount = 0;
  for (const s of rawServers) {
    if (seen.has(s.videoUrl)) continue;
    seen.add(s.videoUrl);

    let subtitleUrl = '';
    try {
      const urlObj = new URL(s.videoUrl);
      subtitleUrl = urlObj.searchParams.get('sub') || urlObj.searchParams.get('caption_1') || urlObj.searchParams.get('c1_file') || '';
    } catch {}

    const subtitles = subtitleUrl ? [{ id: 0, label: 'English', file: formatProxyUrl(subtitleUrl, s.videoUrl) }] : [];
    const proxiedUrl = formatIframeProxyUrl(s.videoUrl, ANINEKO);

    if (s.isDub && dubCount < 1) {
      dubCount++;
      servers.push({ name: `Neko HD1 (DUB)`, videoUrl: proxiedUrl, type: 'dub', subtitles, isHLS: false });
    } else if (!s.isDub && subCount < 1) {
      subCount++;
      servers.push({ name: `Neko HD1`, videoUrl: proxiedUrl, type: 'sub', subtitles, isHLS: false });
    }
  }

  return { servers, animeTitle: best.title, slug: best.slug };
}

// ── Animetsu Scraper ──

export async function scrapeAnimetsu(title, episode) {
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
        const searchHtml = await clientFetch(searchUrl, { referer: `${ANIMETSU}/watch/`, timeout: 15000 });
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
      const score = titleScore(r.title, title);
      if (score > maxScore) { maxScore = score; best = r; }
    }
    if (!best || maxScore < 0.4) throw new Error(`No match on Animetsu`);

    animetsuSearchCache.set(title, best);
  }

  const epsUrl = `${ANIMETSU}/v2/api/anime/eps/${best.id}`;
  const epsHtml = await clientFetch(epsUrl, { referer: `${ANIMETSU}/watch/${best.id}`, timeout: 15000 });
  const epsData = JSON.parse(epsHtml);
  if (!epsData || !epsData.length) throw new Error(`No episodes found`);

  const epItem = epsData.find(x => Number(x.ep_num) === Number(episode));
  if (!epItem) throw new Error(`Episode not found`);

  const servers = [];
  const proxyBase = 'https://swiftstream.top/proxy';

  const [subRes, dubRes] = await Promise.allSettled([
    (async () => {
      const subUrl = `${ANIMETSU}/v2/api/anime/oppai/${best.id}/${episode}?server=pahe&source_type=sub`;
      const subHtml = await clientFetch(subUrl, { referer: `${ANIMETSU}/watch/${best.id}`, timeout: 15000 });
      const subData = JSON.parse(subHtml);
      if (subData.sources?.length > 0) {
        const source = subData.sources[0];
        const rawVideoUrl = source.url.startsWith('http') ? source.url : `${proxyBase}${source.url}`;
        const videoUrl = formatProxyUrl(rawVideoUrl, `${ANIMETSU}/`);
        const subtitles = (subData.subs || []).map((sub, i) => ({ id: i, label: sub.lang || 'English', file: formatProxyUrl(sub.url, `${ANIMETSU}/`) }));
        return { name: 'AniHD1', videoUrl, type: 'sub', embedUrl: rawVideoUrl, subtitles, isHLS: true };
      }
      return null;
    })(),
    (async () => {
      const dubUrl = `${ANIMETSU}/v2/api/anime/oppai/${best.id}/${episode}?server=pahe&source_type=dub`;
      const dubHtml = await clientFetch(dubUrl, { referer: `${ANIMETSU}/watch/${best.id}`, timeout: 15000 });
      const dubData = JSON.parse(dubHtml);
      if (dubData.sources?.length > 0) {
        const source = dubData.sources[0];
        const rawVideoUrl = source.url.startsWith('http') ? source.url : `${proxyBase}${source.url}`;
        const videoUrl = formatProxyUrl(rawVideoUrl, `${ANIMETSU}/`);
        return { name: 'AniHD1 (DUB)', videoUrl, type: 'dub', embedUrl: rawVideoUrl, subtitles: [], isHLS: true };
      }
      return null;
    })()
  ]);

  if (subRes.status === 'fulfilled' && subRes.value) servers.push(subRes.value);
  if (dubRes.status === 'fulfilled' && dubRes.value) servers.push(dubRes.value);

  return { servers, animeTitle: best.title, slug: best.id };
}
