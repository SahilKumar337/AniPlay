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

export function setDynamicDomains(newDomains) {
  if (!newDomains) return;
  if (newDomains.neko) ANINEKO = newDomains.neko;
  if (newDomains.waves) AW = newDomains.waves;
  if (newDomains.animetsu) ANIMETSU = newDomains.animetsu;
  console.log('[Scrapers] Dynamic domains updated:', { ANINEKO, AW, ANIMETSU });
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

  // Match any trailing space followed by a number at the end of the clean title
  // e.g. "Oshi no Ko 2", "Oshi no Ko 2 (Dub)", "Oshi no Ko 2nd"
  const cleanTitle = s.replace(/\b(dub|sub|uncensored|uncut|tv|movie|ova|ona|special|recap|film|series|audio|multi)\b/g, '').trim();
  if ((m = cleanTitle.match(/\b(\d+)(?:nd|rd|th|st)?$/))) {
    return parseInt(m[1]);
  }

  return 1;
}

function titleScore(resultTitle, queryTitle, isMovie = false) {
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(queryTitle)) return 0.7;

  const rn = norm(resultTitle);
  const qn = norm(queryTitle);

  const rSeason = extractSeason(rn);
  const qSeason = extractSeason(qn);
  if (rSeason !== qSeason) return 0;

  // Gate spin-offs, summaries, recaps, previews, side-stories
  const resultHasRecap = /\b(recap|summary|preview|side\s*story|special|specials)\b/i.test(resultTitle);
  const queryHasRecap = /\b(recap|summary|preview|side\s*story|special|specials)\b/i.test(queryTitle);
  if (resultHasRecap && !queryHasRecap) return 0;

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

  const strip = t => t
    .replace(/\b(season|part|s)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
    .replace(/\b(sub|dub|uncensored|uncut|tv|movie|ova|ona|special|specials|multi|audio|recap|summary|preview|side\s*story)\b/gi, '')
    .trim();

  const qWords = strip(qn).split(/\s+/).filter(w => w.length > 1);
  const rWords = strip(rn).split(/\s+/).filter(w => w.length > 1);

  if (!qWords.length || !rWords.length) return 0;

  const intersection = qWords.filter(w => rWords.includes(w));
  if (intersection.length === 0) return 0;

  const score = (2 * intersection.length) / (qWords.length + rWords.length);

  // Penalize extra non-metadata words in the result title (gates different shows/spin-offs)
  const extraWords = rWords.filter(w => !qWords.includes(w));
  const nonMetaExtra = extraWords.filter(w => !/^(season|part|episode|ep|tv|movie|ova|ona|special|specials|dub|sub|uncensored|uncut|multi|audio)$/i.test(w));
  if (nonMetaExtra.length > 0) {
    return Math.max(0, score - 0.25 * nonMetaExtra.length);
  }

  return score;
}

function getLongestWord(title) {
  const cleaned = title.replace(/\b(?:season|part|s|ep|episode|recap|ova|ona|movie)\b/gi, '');
  const words = cleaned.split(/[^a-zA-Z0-9]/).filter(w => w.length > 2);
  if (!words.length) return title;
  return words.reduce((a, b) => a.length > b.length ? a : b);
}

// ── Helper matching and validation ──

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

// ── Generic Fetch Helper with Headers ──

async function clientFetch(url, opts = {}) {
  if (isCapacitorApp) {
    if (opts.useWebView) {
      console.log(`[clientFetch] Executing fetch via WebView for: ${url}`);
      try {
        const origin = new URL(url).origin;
        const html = await fetchViaWebViewNative(url, opts.referer, origin);
        if (!html) throw new Error("fetchViaWebViewNative returned empty/null");
        
        if (isCloudflareChallenge(html)) {
          throw new Error('Cloudflare challenge detected inside WebView fetch');
        }
        return html;
      } catch (e) {
        console.error(`[clientFetch] WebView fetch failed for ${url}:`, e.message);
        throw e;
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

// ── AniWaves Scraper ──

async function awSearch(title, isMovie = false) {
  const cleaned = title.replace(/\b(season|part|s)\s*\d+\b/gi, '').trim();
  const engWords = cleaned.split(/[^a-zA-Z0-9]/).filter(w =>
    w.length > 3 && !/^(the|and|with|from|that|this|into|over|under|behind|you)$/i.test(w)
  );
  const longestWord = engWords.length ? engWords.reduce((a, b) => a.length >= b.length ? a : b) : null;
  const firstTwo = cleaned.split(' ').slice(0, 2).join(' ');
  const firstThree = cleaned.split(' ').slice(0, 3).join(' ');

  const strategies = [cleaned, firstThree, firstTwo, longestWord].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
  let results = [];

  const promises = strategies.map(async (keyword) => {
    try {
      const rawText = await clientFetch(`${AW}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
        referer: AW,
        timeout: 6000,
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
    } catch {
      return [];
    }
  });

  const settled = await Promise.allSettled(promises);
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value?.length > 0) {
      results.push(...res.value);
    }
  }

  if (results.length === 0) throw new Error(`Anime "${title}" not found on AniWaves`);

  let best = results[0], maxScore = -1;
  for (const r of results) {
    let score = titleScore(r.animeTitle, title, isMovie);
    const slugText = r.slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    score = Math.max(score, titleScore(slugText, title, isMovie));
    if (score > maxScore) { maxScore = score; best = r; }
  }

  if (!best || maxScore < 0.5) { // Strict score threshold
    throw new Error(`No match on AniWaves for "${title}"`);
  }
  return best;
}

// Session cache for Waves server lists: animeId/episode -> { servers, expires }
// TTL = 25 minutes (matching Animetsu cache — embed URLs typically expire in ~30 min)
const WAVES_CACHE_TTL_MS = 25 * 60 * 1000;

function getWavesServersCache(animeId, episode) {
  try {
    const key = `waves_servers_${animeId}_${episode}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    console.log(`[AniWaves] Cache HIT for servers ep${episode} — instant play`);
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

async function awGetServers(animeId, episode, slug) {
  const url = `${AW}/ajax/server/list?servers=${animeId}&eps=${episode}`;
  const referer = slug ? `${AW}/watch/${slug}` : AW;
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
  // Check embed cache first — same linkId always resolves to same URL within session
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


export async function scrapeAniWaves(title, episode, isMovie = false) {
  let searchResult = wavesSearchCache.get(title);
  if (!searchResult) {
    searchResult = await awSearch(title, isMovie);
    wavesSearchCache.set(title, searchResult);
  }
  const { slug, animeId, animeTitle } = searchResult;

  // Check session cache — skip all API calls if same episode was already fetched
  const cached = getWavesServersCache(animeId, episode);
  if (cached) return { servers: cached, animeTitle, slug };

  const rawServers = await awGetServers(animeId, episode, slug);
  // Only take first sub server (HD-1) and first dub server (HD-1)
  const subServers = rawServers.filter(s => s.type === 'sub').slice(0, 1);
  const dubServers = rawServers.filter(s => s.type === 'dub').slice(0, 1);
  const toResolve = [...subServers, ...dubServers];

  const resolved = await Promise.allSettled(
    toResolve.map(async s => {
      const embedUrl = await awGetEmbedUrl(s.linkId, slug);
      // Allow any embed provider through — IframePlayer HLS interceptor handles extraction
      const videoUrl = formatIframeProxyUrl(embedUrl, `${AW}/watch/${slug}`);
      return { videoUrl, type: s.type, embedUrl, serverName: s.serverName };
    })
  );

  const working = resolved.filter(r => r.status === 'fulfilled').map(r => r.value);
  const servers = [];
  for (const s of working) {
    if (s.type === 'sub') {
      servers.push({ name: 'WavesHD', videoUrl: s.videoUrl, type: s.type, embedUrl: s.embedUrl, referer: `${AW}/watch/${slug}`, isHLS: false });
    } else if (s.type === 'dub') {
      servers.push({ name: 'WavesHD (DUB)', videoUrl: s.videoUrl, type: s.type, embedUrl: s.embedUrl, referer: `${AW}/watch/${slug}`, isHLS: false });
    }
  }

  // Cache the resolved server list for this episode (avoids re-fetching on revisit)
  if (servers.length > 0) setWavesServersCache(animeId, episode, servers);

  return { servers, animeTitle, slug };
}

// ── AniNeko Scraper ──

// Session cache for Neko episode servers: slug+episode -> { servers, expires }
const NEKO_CACHE_TTL_MS = 25 * 60 * 1000;

function getNekoEpisodeCache(slug, episode) {
  try {
    const key = `neko_ep_${slug}_${episode}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(key); return null; }
    console.log(`[AniNeko] Cache HIT for ${slug} ep${episode} — instant play`);
    return data;
  } catch { return null; }
}

function setNekoEpisodeCache(slug, episode, servers) {
  try {
    const key = `neko_ep_${slug}_${episode}`;
    sessionStorage.setItem(key, JSON.stringify({ data: servers, expires: Date.now() + NEKO_CACHE_TTL_MS }));
  } catch {}
}

export async function scrapeAniNeko(title, episode, isMovie = false) {
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
      } catch (e) {
        console.error('[scrapeAniNeko] Search failed for ' + keyword + ':', e.message);
      }
    }

    if (!results.length) throw new Error(`Anime not found on AniNeko`);

    best = results[0];
    let maxScore = -1;
    for (const r of results) {
      const score = titleScore(r.title, title, isMovie);
      if (score > maxScore) { maxScore = score; best = r; }
    }
    const threshold = (maxScore >= 0.6 && results.length <= 3) ? 0.6 : 0.75;
    if (!best || maxScore < threshold) {
      throw new Error(`No match on AniNeko for "${title}" (score: ${maxScore.toFixed(2)})`);
    }

    nekoSearchCache.set(title, { best, results });
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
    servers.push({ name: 'Neko', videoUrl: proxiedUrl, embedUrl: bestSubServer.videoUrl, referer: ANINEKO + '/', type: 'sub', subtitles, isHLS: false });
  }
  if (bestDubServer) {
    const proxiedUrl = formatIframeProxyUrl(bestDubServer.videoUrl, ANINEKO);
    servers.push({ name: 'Neko (DUB)', videoUrl: proxiedUrl, embedUrl: bestDubServer.videoUrl, referer: ANINEKO + '/', type: 'dub', subtitles: [], isHLS: false });
  }

  // Cache the resolved servers for this episode
  if (servers.length > 0) setNekoEpisodeCache(best.slug, episode, servers);

  return { servers, animeTitle: best.title, slug: best.slug };
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
    console.log(`[Animetsu] Cache HIT for ${sourceType} ep${episode} — instant play`);
    return data;
  } catch { return null; }
}

function setStreamCache(animeId, episode, sourceType, data) {
  try {
    const key = `animetsu_stream_${animeId}_${episode}_${sourceType}`;
    sessionStorage.setItem(key, JSON.stringify({ data, expires: Date.now() + STREAM_CACHE_TTL_MS }));
  } catch {}
}

// Fetches a stream URL from Animetsu — all servers race in PARALLEL, fastest wins.
async function fetchAnimetsuStream(animeId, episode, sourceType) {
  // Check session cache first — avoids re-fetching same episode within 25 min
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
    // Promise.any returns the FIRST fulfilled promise — fastest server wins
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

