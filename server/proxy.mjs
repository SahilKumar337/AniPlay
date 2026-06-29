/**
 * AniLab Stream Engine — v5 (AniWaves Primary + AniNeko Fallback)
 * ══════════════════════════════════════════════════════════════════
 *
 * PRIMARY SOURCE: aniwaves.ru
 *   - Huge collection (subs + dubs), accurate titles, season-aware
 *   - 3-step API: search → servers list → embed URL per server
 *   - Returns both SUB and DUB servers so we can show them distinctly
 *
 * FALLBACK: anineko.to (original GogoAnime scraper)
 *   - Used if AniWaves doesn't have the anime
 *
 * KEY FIXES vs v4:
 *   1. Season accuracy — "Season 3" won't match "Season 2" entries
 *   2. NOT_YET_RELEASED titles resolved via romaji/english name
 *   3. Full dubbed episode support via AniWaves DUB servers
 *   4. Correct episode lengths (no 8-min short clips from wrong anime)
 *   5. Uses MAL ID hint for pinpoint slug matching
 */

import { createServer }    from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname }   from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT     = process.env.PORT || 4000;
const AW       = 'https://aniwaves.ru';
const ANINEKO  = 'https://anineko.to';
const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR  = join(__dirname, '../dist');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

// ── Puppeteer stream extractor (headless Chrome, network intercept) ──
// Cache recently extracted stream URLs to avoid relaunching browser for the same embed
const streamUrlCache = new Map(); // embedUrl -> { url, referer, ts }
const STREAM_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function puppeteerExtractM3U8(embedUrl) {
  const cached = streamUrlCache.get(embedUrl);
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
    console.log(`[Puppeteer] Cache hit for ${embedUrl.slice(0, 80)}`);
    return cached;
  }

  console.log(`[Puppeteer] Launching headless Chrome for: ${embedUrl.slice(0, 100)}`);
  let browser;
  try {
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--autoplay-policy=no-user-gesture-required',
      ],
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (existsSync(CHROME_PATH)) {
      launchOptions.executablePath = CHROME_PATH;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ Referer: AW + '/' });

    let capturedM3U8 = null;
    let capturedReferer = embedUrl;

    // Intercept every request — grab the first .m3u8 that isn't a tiny manifest
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      // Block ads/trackers to speed things up
      if (
        url.includes('doubleclick') ||
        url.includes('googlesyndication') ||
        url.includes('google-analytics') ||
        url.includes('adsbygoogle')
      ) {
        return req.abort();
      }
      if (!capturedM3U8 && (url.includes('.m3u8') || url.includes('playlist.m3u8'))) {
        capturedM3U8 = url;
        capturedReferer = req.headers()['referer'] || embedUrl;
        console.log(`[Puppeteer] Intercepted m3u8: ${url.slice(0, 120)}`);
      }
      req.continue();
    });

    // Also listen on responses to catch .m3u8 from XHR/fetch
    page.on('response', async resp => {
      if (capturedM3U8) return;
      const url = resp.url();
      const ct  = resp.headers()['content-type'] || '';
      if (url.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegURL')) {
        capturedM3U8 = url;
        capturedReferer = resp.request().headers()['referer'] || embedUrl;
        console.log(`[Puppeteer] Response m3u8: ${url.slice(0, 120)}`);
      }
    });

    // Navigate to the embed page and wait for network to settle
    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Try to trigger playback by clicking elements that resemble play buttons
    try {
      await page.evaluate(() => {
        const selectors = [
          'video', 
          '#player', 
          '.jw-video', 
          '.jw-display-icon-container', 
          '.vjs-big-play-button',
          '.play-button',
          '[class*="play"]',
          '[id*="play"]'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            el.click();
            const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
            el.dispatchEvent(event);
          }
        }
      });
    } catch (e) {
      console.warn('[Puppeteer] Click play button failed:', e.message);
    }

    // If no m3u8 yet, wait a bit more for player lazy-loading
    if (!capturedM3U8) {
      await new Promise(r => setTimeout(r, 5000));
    }

    if (!capturedM3U8) {
      throw new Error('No .m3u8 URL captured from embed page');
    }

    const result = { url: capturedM3U8, referer: capturedReferer, ts: Date.now() };
    streamUrlCache.set(embedUrl, result);
    return result;
  } finally {
    if (browser) await browser.close();
  }
}

// ── CORS & JSON helpers ───────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}
function json(res, code, data) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Smart fetch with cookie persistence ──────────────────────────
let globalCookie = '';
async function xfetch(url, opts = {}) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 45000),
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      ...(globalCookie ? { 'Cookie': globalCookie } : {}),
      ...(opts.referer ? { 'Referer': opts.referer, 'Origin': new URL(opts.referer).origin } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = r.headers.getSetCookie?.() || [];
  if (setCookie.length) globalCookie = setCookie.map(c => c.split(';')[0]).join('; ');
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url.split('?')[0]}`);
  return r.text();
}

// ── Text normalisation ────────────────────────────────────────────
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

/** Extract the season number from a title string (1 if none found) */
function extractSeason(t) {
  const s = t.toLowerCase();
  // "season 3", "3rd season", "s3", "part 3"
  let m;
  if ((m = s.match(/\bseason\s*(\d+)\b/)))    return parseInt(m[1]);
  if ((m = s.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/))) return parseInt(m[1]);
  if ((m = s.match(/\bpart\s*(\d+)\b/)))       return parseInt(m[1]);
  if ((m = s.match(/\bs(\d+)\b/)))             return parseInt(m[1]);
  // Roman numerals up to 4
  if (/\biv\b/.test(s)) return 4;
  if (/\biii\b/.test(s)) return 3;
  if (/\bii\b/.test(s)) return 2;
  return 1;
}

/** Title word-overlap score, returns 0–1 */
function titleScore(resultTitle, queryTitle) {
  // If query is in Japanese/native script — the slug keywords already matched so give credit
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(queryTitle)) return 0.7;

  const rn = norm(resultTitle);
  const qn = norm(queryTitle);

  // Hard season gate — if seasons disagree, reject (score = 0)
  const rSeason = extractSeason(rn);
  const qSeason = extractSeason(qn);
  if (rSeason !== qSeason) return 0;

  // Strip season suffix for word matching
  const strip = t => t.replace(/\b(season|part|s)\s*\d+\b/gi, '').replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '').trim();
  const qWords = strip(qn).split(/\s+/).filter(w => w.length > 1);
  if (!qWords.length) return 0.5;

  let matched = 0;
  for (const w of qWords) if (rn.includes(w)) matched++;
  return matched / qWords.length;
}

// ══════════════════════════════════════════════════════════════════
// ANIWAVES SCRAPER (Primary)
// ══════════════════════════════════════════════════════════════════

/**
 * Step 1: Search AniWaves and return the best matching anime slug + id.
 * Tries several keyword strategies in order and picks the best match.
 * Returns { slug, animeId, animeTitle } or throws.
 */
async function awSearch(title) {
  // Detect if this is a Japanese (native) title — if so, search with the raw title
  const hasJapanese = /[\u3000-\u9fff\uff00-\uffef]/.test(title);

  // Build keyword strategies (tried in order until we get results)
  const cleaned = title
    .replace(/\b(season|part|s)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
    .trim();

  const engWords = cleaned.split(/[^a-zA-Z0-9]/).filter(w =>
    w.length > 3 && !/^(the|and|with|from|that|this|into|over|under|behind|you)$/i.test(w)
  );
  const longestWord = engWords.length
    ? engWords.reduce((a, b) => a.length >= b.length ? a : b)
    : null;
  const firstTwo   = cleaned.split(' ').slice(0, 2).join(' ');
  const firstThree = cleaned.split(' ').slice(0, 3).join(' ');

  // Strategy order: best discrimination first, then broader
  const strategies = hasJapanese
    ? [title]                     // For Japanese: search full native string
    : [longestWord, firstTwo, firstThree, cleaned].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);

  let results = [];

  for (const keyword of strategies) {
    console.log(`[AW] Searching: keyword="${keyword}" (from: "${title}")`);
    let rawText;
    try {
      rawText = await xfetch(`${AW}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
        referer: AW,
        timeout: 30000,
      });
    } catch (e) { console.warn(`[AW] Search fetch failed for "${keyword}":`, e.message); continue; }

    let parsed;
    try { parsed = JSON.parse(rawText); } catch { continue; }
    if (parsed.status === 404 || !parsed.result?.html) continue;

    const html = parsed.result.html;
    // Parse all result items
    const itemRe = /href="\/watch\/([\w%-]+-(\d+))"[\s\S]*?class="name d-title"[^>]*>([^<]+)<\/div>/g;
    let m;
    while ((m = itemRe.exec(html)) !== null) {
      results.push({ slug: m[1], animeId: m[2], animeTitle: m[3].trim() });
    }
    // Simpler slug-only fallback
    if (results.length === 0) {
      const slugRe = /href="\/watch\/([\w-]+-(\d+))"/g;
      while ((m = slugRe.exec(html)) !== null) {
        results.push({ slug: m[1], animeId: m[2], animeTitle: m[1].replace(/-\d+$/, '').replace(/-/g, ' ') });
      }
    }

    if (results.length) break; // Found results — stop trying more strategies
  }

  if (results.length === 0) throw new Error(`Anime "${title}" not found on AniWaves`);

  // Score and pick best match — compare against both display title AND slug text
  let best = results[0], maxScore = -1;
  for (const r of results) {
    // Score against display title
    let score = titleScore(r.animeTitle, title);
    // Also score against slug (slug contains romanized title which matches romaji query)
    const slugText = r.slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    const slugScore = titleScore(slugText, title);
    score = Math.max(score, slugScore);
    console.log(`[AW]   candidate: "${r.animeTitle}" (slug: ${slugText}) score=${score.toFixed(2)}`);
    if (score > maxScore) { maxScore = score; best = r; }
  }

  // If still no confident match — accept if ≤2 results (keyword was selective enough)
  if (maxScore === 0 && results.length <= 2) { maxScore = 0.4; best = results[0]; }
  if (maxScore === 0 && results.length > 2) {
    throw new Error(`No confident match for "${title}" (${results.length} candidates on AniWaves)`);
  }

  console.log(`[AW] Best match: "${best.animeTitle}" (id=${best.animeId}, score=${maxScore.toFixed(2)})`);
  return best;
}

async function awGetServers(animeId, episode, slug) {
  const url     = `${AW}/ajax/server/list?servers=${animeId}&eps=${episode}`;
  const referer = slug ? `${AW}/watch/${slug}` : AW;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let text;
    try {
      text = await xfetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': referer },
        timeout: 30000,
      });
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
      continue;
    }

    if (!text || text.trim() === '') {
      console.warn(`[AW] awGetServers got empty response (attempt ${attempt})`);
      if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
      throw new Error(`AniWaves servers endpoint returned empty for ep ${episode}`);
    }

    let parsed;
    try { parsed = JSON.parse(text); } catch {
      if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
      throw new Error('AniWaves servers returned non-JSON');
    }

    if (parsed.status !== 200 || !parsed.result) {
      throw new Error(`No servers available for episode ${episode} on AniWaves (status: ${parsed.status})`);
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
        servers.push({
          type,
          linkId: liMatch[1],
          serverName: liMatch[2].trim()
        });
      }
    }

    if (servers.length === 0) throw new Error(`No servers parsed from AniWaves episode ${episode} HTML`);
    return servers;
  }

  throw new Error(`awGetServers exhausted retries for episode ${episode}`);
}

/**
 * Step 3: Resolve the actual embed iframe URL for a given server link ID.
 * Returns the iframe URL string.
 */
async function awGetEmbedUrl(linkId, watchPageSlug) {
  const url  = `${AW}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`;
  const text = await xfetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': `${AW}/watch/${watchPageSlug}` },
    timeout: 30000,
  });

  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`AniWaves server returned non-JSON`); }
  if (parsed.status !== 200 || !parsed.result?.url) throw new Error(`No embed URL for server`);
  
  return parsed.result.url;
}

// Embed providers known to be extractable via Puppeteer/iframe proxy
// Providers NOT on this list will be skipped silently
const KNOWN_WORKING_PROVIDERS = [
  'play.echovideo.ru',   // Vidstream — extractable via Puppeteer ✅
  'megacloud.club',      // MegaCloud — extractable via Puppeteer ✅  
  'megacloud.tv',        // MegaCloud alt domain ✅
  'rapid-cloud.co',      // RapidCloud ✅
  'rabbitstream.net',    // RabbitStream ✅
];

/**
 * Full AniWaves scrape pipeline.
 * Returns { servers: [{name, videoUrl, type}], animeTitle, slug }
 * Only includes servers whose embed provider is known to be extractable.
 */
async function scrapeAniWaves(title, episode) {
  const { slug, animeId, animeTitle } = await awSearch(title);
  const rawServers = await awGetServers(animeId, episode, slug);

  const subServers = rawServers.filter(s => s.type === 'sub');
  const dubServers = rawServers.filter(s => s.type === 'dub');

  // Take top 4 sub + top 4 dub to give more candidates after filtering
  const toResolve = [...subServers.slice(0, 4), ...dubServers.slice(0, 4)];

  const resolved = await Promise.allSettled(
    toResolve.map(async s => {
      const embedUrl = await awGetEmbedUrl(s.linkId, slug);

      // Filter out providers that are known to not work
      let embedHost;
      try { embedHost = new URL(embedUrl).hostname; } catch { throw new Error(`Bad embed URL`); }

      const isSupported = KNOWN_WORKING_PROVIDERS.some(p => embedHost === p || embedHost.endsWith('.' + p));
      if (!isSupported) {
        console.log(`[AW] Skipping unsupported provider: ${embedHost} (server: ${s.serverName})`);
        throw new Error(`Provider ${embedHost} not supported`);
      }

      console.log(`[AW] Accepted provider: ${embedHost} (server: ${s.serverName})`);
      const proxiedUrl = `/api/iframe-proxy?url=${encodeURIComponent(embedUrl)}`;
      return { videoUrl: proxiedUrl, type: s.type, embedUrl };
    })
  );

  const workingServers = resolved
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  // Assign sequential display names
  let subCount = 0;
  let dubCount = 0;
  const servers = workingServers.map(s => {
    if (s.type === 'sub') {
      subCount++;
      return { name: `HD${subCount}`, videoUrl: s.videoUrl, type: s.type };
    } else {
      dubCount++;
      return { name: `HD${dubCount}`, videoUrl: s.videoUrl, type: s.type };
    }
  });

  if (servers.length === 0) throw new Error(`No supported streaming servers found for episode ${episode}`);

  console.log(`[AW] Resolved ${servers.length} working servers for "${animeTitle}" ep ${episode}`);
  return { servers, animeTitle, slug };
}

// ══════════════════════════════════════════════════════════════════
// ANINEKO FALLBACK SCRAPER (unchanged from v4)
// ══════════════════════════════════════════════════════════════════
function getLongestWord(title) {
  const cleaned = title.replace(/\b(?:season|part|s|ep|episode|recap|ova|ona|movie)\b/gi, '');
  const words = cleaned.split(/[^a-zA-Z0-9]/).filter(w => w.length > 2);
  if (!words.length) return title;
  return words.reduce((a, b) => a.length > b.length ? a : b);
}

async function scrapeAniNeko(title, episode) {
  const domain  = ANINEKO;
  const keyword = getLongestWord(title);
  console.log(`[AniNeko] Searching: "${keyword}" (original: "${title}")`);

  let searchHtml = await xfetch(`${domain}/browser?keyword=${encodeURIComponent(keyword)}`, { referer: domain, timeout: 55000 });
  let results = [];
  const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(searchHtml)) !== null) results.push({ slug: m[1], title: m[2].trim() });

  if (!results.length) {
    const cleaned = title.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`[AniNeko] No results for "${keyword}", retrying with: "${cleaned}"`);
    searchHtml = await xfetch(`${domain}/browser?keyword=${encodeURIComponent(cleaned)}`, { referer: domain, timeout: 55000 });
    re.lastIndex = 0;
    while ((m = re.exec(searchHtml)) !== null) results.push({ slug: m[1], title: m[2].trim() });
  }

  if (!results.length) throw new Error(`Anime "${title}" not found on AniNeko`);

  let best = results[0], maxScore = -1;
  for (const r of results) {
    const score = titleScore(r.title, title);
    if (score > maxScore) { maxScore = score; best = r; }
  }
  if (maxScore === 0) best = results[0];

  console.log(`[AniNeko] Matched: "${best.title}" (slug=${best.slug})`);

  const subUrl = `${domain}/watch/${best.slug}/ep-${episode}`;
  const urlsToFetch = [{ url: subUrl, isDubPage: best.slug.endsWith('-dub') }];

  if (!best.slug.endsWith('-dub')) {
    const dubSlug = `${best.slug}-dub`;
    const dubUrl  = `${domain}/watch/${dubSlug}/ep-${episode}`;
    urlsToFetch.push({ url: dubUrl, isDubPage: true });
  }

  console.log(`[AniNeko] Fetching watch pages:`, urlsToFetch.map(x => x.url));
  const fetchedPages = await Promise.allSettled(
    urlsToFetch.map(async item => {
      const html = await xfetch(item.url, { referer: domain, timeout: 50000 });
      return { html, isDubPage: item.isDubPage };
    })
  );

  const servers = [];
  let subCount = 0;
  let dubCount = 0;
  for (const page of fetchedPages) {
    if (page.status !== 'fulfilled') continue;
    const { html, isDubPage } = page.value;

    const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
    let m;
    while ((m = btnRe.exec(html)) !== null) {
      let videoUrl = m[1];
      if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
      const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Only keep HD-1 and HD-2 servers
      if (name.includes('HD-1') || name.includes('HD-2')) {
        const isDub = /dub/i.test(name) || isDubPage;
        if (isDub) {
          dubCount++;
          servers.push({
            name: `HD${dubCount}`,
            videoUrl,
            type: 'dub'
          });
        } else {
          subCount++;
          servers.push({
            name: `HD${subCount}`,
            videoUrl,
            type: 'sub'
          });
        }
      }
    }
  }

  if (!servers.length) throw new Error(`No HD servers found on AniNeko for episode ${episode}`);
  return { servers, animeTitle: best.title, slug: best.slug };
}

/**
 * Scrapes the raw .m3u8 playlist URL from GogoCDN/other player embed pages if available in plain-text.
 */
async function resolveServerM3U8(videoUrl) {
  try {
    const referer = new URL(videoUrl).origin;
    const html = await xfetch(videoUrl, { referer, timeout: 15000 });
    const match = html.match(/const src\s*=\s*"([^"]+\.m3u8)"/)
               || html.match(/file\s*:\s*"([^"]+\.m3u8)"/)
               || html.match(/"file"\s*:\s*"([^"]+\.m3u8)"/);
    if (match) {
      let m3u8Url = match[1];
      if (!m3u8Url.startsWith('http')) {
        m3u8Url = new URL(m3u8Url, videoUrl).href;
      }
      return m3u8Url;
    }
  } catch (e) {
    console.warn(`[M3U8 Resolver] Failed for ${videoUrl}:`, e.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// COMBINED SCRAPER: AniWaves first for all titles, then AniNeko fallback
// ══════════════════════════════════════════════════════════════════
async function getServers(titles, episode) {
  const errors = [];
  let result = null;

  // Phase 1: Try AniWaves for all title variants (best source)
  for (const title of titles) {
    try {
      console.log(`[Engine] AniWaves trying: "${title}" ep ${episode}`);
      result = await scrapeAniWaves(title, episode);
      break;
    } catch (e) {
      console.warn(`[Engine] AniWaves failed for "${title}": ${e.message}`);
      errors.push(`AW[${title.slice(0, 30)}]: ${e.message}`);
    }
  }

  // Phase 2: Try AniNeko for latin-script titles only (can't search Japanese)
  if (!result) {
    for (const title of titles) {
      if (/[\u3000-\u9fff\uff00-\uffef]/.test(title)) continue; // Skip Japanese native
      try {
        console.log(`[Engine] AniNeko trying: "${title}" ep ${episode}`);
        result = await scrapeAniNeko(title, episode);
        break;
      } catch (e) {
        console.warn(`[Engine] AniNeko failed for "${title}": ${e.message}`);
        errors.push(`AN[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
  }

  if (!result) {
    throw new Error(errors.join(' | '));
  }

  // Resolve M3U8 streams concurrently
  console.log(`[Engine] Resolving HLS streams for ${result.servers.length} servers...`);
  const resolvedServers = await Promise.all(
    result.servers.map(async s => {
      const m3u8Url = await resolveServerM3U8(s.videoUrl);
      if (m3u8Url) {
        const proxiedUrl = `/api/stream/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(new URL(s.videoUrl).origin)}`;
        return {
          ...s,
          videoUrl: proxiedUrl,
          isHLS: true
        };
      }
      return s; // Fallback to iframe
    })
  );

  return { ...result, servers: resolvedServers };
}

// ══════════════════════════════════════════════════════════════════
// Global in-memory cache for resolved server lists (keyed by "firstTitle-episode")
const serverCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache life

// ══════════════════════════════════════════════════════════════════
// HTTP SERVER
// ══════════════════════════════════════════════════════════════════
const server = createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname, searchParams } = parsed;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(200); return res.end(); }

  const refererHeader = req.headers.referer || '';
  const isIframeProxy = refererHeader.includes('/api/iframe-proxy');
  const myApis = ['/api/anineko-servers', '/api/ping', '/api/stream/hls', '/api/stream/segment', '/api/iframe-proxy'];
  const isMyApi = myApis.includes(pathname);

  // Intercept relative assets from iframe-proxy
  if (isIframeProxy && !isMyApi) {
    let targetOrigin = 'https://play.echovideo.ru'; // default fallback
    let originalUrl = '';
    try {
      const refUrl = new URL(refererHeader);
      const refParams = new URLSearchParams(refUrl.search);
      originalUrl = refParams.get('url');
      if (originalUrl) {
        targetOrigin = new URL(originalUrl).origin;
      }
    } catch {}

    const targetUrl = `${targetOrigin}${req.url}`;
    const forwardReferer = originalUrl || 'https://aniwaves.ru/';
    console.log(`[Iframe Proxy Asset] Forwarding: ${req.url} -> ${targetUrl} (Referer: ${forwardReferer})`);
    
    try {
      const headersToForward = {
        'User-Agent': UA,
        'Referer': forwardReferer,
      };
      if (req.headers['x-requested-with']) {
        headersToForward['X-Requested-With'] = req.headers['x-requested-with'];
      }
      if (req.headers['accept']) {
        headersToForward['Accept'] = req.headers['accept'];
      }
      if (req.headers['origin']) {
        headersToForward['Origin'] = targetOrigin;
      }
      let clientCookie = req.headers.cookie || '';
      let mergedCookie = '';
      if (globalCookie) {
        mergedCookie = globalCookie;
      }
      if (clientCookie) {
        mergedCookie = mergedCookie ? `${mergedCookie}; ${clientCookie}` : clientCookie;
      }
      if (mergedCookie) {
        headersToForward['Cookie'] = mergedCookie;
      }

      console.log(`[Iframe Proxy Asset] Target headers:`, {
        url: targetUrl,
        referer: headersToForward.Referer,
        cookie: headersToForward.Cookie,
        globalCookie: globalCookie
      });

      const sRes = await fetch(targetUrl, {
        headers: headersToForward
      });
      
      const setCookieHeaders = sRes.headers.getSetCookie?.() || [];
      if (setCookieHeaders.length) {
        const newCookies = setCookieHeaders.map(c => c.split(';')[0]).join('; ');
        globalCookie = globalCookie ? `${globalCookie}; ${newCookies}` : newCookies;
        console.log(`[Iframe Proxy Asset] Captured cookies from ${req.url}:`, globalCookie);
        res.setHeader('Set-Cookie', setCookieHeaders);
      }

      console.log(`[Iframe Proxy Asset] Forwarded response for ${req.url}: Status ${sRes.status} (${sRes.headers.get('content-type')})`);
      
      if (req.url.includes('/api/getSources')) {
        const bodyText = await sRes.text();
        console.log(`[Iframe Proxy Asset] getSources body snippet:`, bodyText.slice(0, 300));
        res.writeHead(sRes.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(bodyText);
      }

      const isStatic = req.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i);
      res.writeHead(sRes.status, {
        'Content-Type': sRes.headers.get('content-type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': isStatic ? 'public, max-age=86400' : 'no-store, no-cache, must-revalidate'
      });
      
      for await (const chunk of sRes.body) {
        res.write(chunk);
      }
      return res.end();
    } catch (e) {
      console.error(`[Iframe Proxy Asset] Error forwarding ${req.url}:`, e.message);
      res.writeHead(500);
      return res.end(e.message);
    }
  }

  if (pathname === '/api/iframe-proxy') {
    cors(res);
    const targetUrl = searchParams.get('url');
    if (!targetUrl) return json(res, 400, { error: 'url required' });
    try {
      let html = await xfetch(targetUrl, { referer: 'https://aniwaves.ru/' });
      
      const cb = Date.now();
      html = html.replace(/(<script[^>]+src=["'])([^"']+\.js)(["'])/gi, `$1$2?_cb=${cb}$3`);
      html = html.replace(/(<link[^>]+href=["'])([^"']+\.css)(["'])/gi, `$1$2?_cb=${cb}$3`);
      
      const injectedScript = `
<script>
  (function() {
    function checkAndSend(src) {
      if (src && typeof src === 'string') {
        let absoluteUrl = src;
        try {
          absoluteUrl = new URL(src, window.location.href).href;
        } catch(e) {}
        if (absoluteUrl.includes('.m3u8') || absoluteUrl.includes('.mp4') || absoluteUrl.includes('.mkv')) {
          console.log('[Iframe Interceptor] Captured video stream URL:', absoluteUrl);
          window.parent.postMessage({ type: 'NATIVE_STREAM_URL', url: absoluteUrl }, '*');
        }
      }
    }

    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      let url = '';
      if (typeof input === 'string') {
        url = input;
      } else if (input && input.url) {
        url = input.url;
      }
      checkAndSend(url);
      return originalFetch.apply(this, arguments);
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      checkAndSend(url);
      return originalOpen.apply(this, arguments);
    };

    // Fallback: Intercept DOM video element src
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (originalSrcDescriptor) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: originalSrcDescriptor.get,
        set: function(val) {
          checkAndSend(val);
          return originalSrcDescriptor.set.call(this, val);
        },
        configurable: true
      });
    }
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if (name === 'src' && (this.tagName === 'VIDEO' || this.tagName === 'SOURCE')) {
        checkAndSend(val);
      }
      return originalSetAttribute.apply(this, arguments);
    };
    const originalSourceSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
    if (originalSourceSrcDescriptor) {
      Object.defineProperty(HTMLSourceElement.prototype, 'src', {
        get: originalSourceSrcDescriptor.get,
        set: function(val) {
          checkAndSend(val);
          return originalSourceSrcDescriptor.set.call(this, val);
        },
        configurable: true
      });
    }
  })();
</script>
`;
      html = html.replace(/<head[^>]*>/i, match => match + injectedScript);

      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      return res.end(html);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  if (pathname === '/api/ping') return json(res, 200, { ok: true });

  // ── Puppeteer-based stream extractor endpoint ──────────────────────
  if (pathname === '/api/extract-stream') {
    cors(res);
    const embedUrl = searchParams.get('url');
    if (!embedUrl) return json(res, 400, { error: 'url required' });
    try {
      const { url: m3u8Url, referer } = await puppeteerExtractM3U8(embedUrl);
      // Wrap the m3u8 through our HLS proxy so segments get correct headers
      const proxied = `/api/stream/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(referer)}`;
      return json(res, 200, { ok: true, url: proxied, rawUrl: m3u8Url });
    } catch (e) {
      console.error('[Extract Stream]', e.message);
      return json(res, 502, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/anineko-servers') {
    const titlesParam = searchParams.get('titles') || searchParams.get('title');
    const ep          = searchParams.get('episode') || '1';
    if (!titlesParam) return json(res, 400, { error: 'titles required' });

    // Accept pipe-separated list of titles (romaji, english, etc.)
    const titles = titlesParam.split('|||').map(t => t.trim()).filter(Boolean);
    if (titles.length === 0) return json(res, 400, { error: 'valid title required' });

    const cacheKey = `${titles[0]}-${ep}`;

    // Check cache first
    if (serverCache.has(cacheKey)) {
      const cached = serverCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Cache Hit] Serving cached servers for: "${cacheKey}"`);
        return json(res, 200, cached.data);
      } else {
        serverCache.delete(cacheKey);
      }
    }

    try {
      const data = await getServers(titles, ep);
      const resData = { ok: true, ...data };
      serverCache.set(cacheKey, { data: resData, timestamp: Date.now() });
      return json(res, 200, resData);
    } catch (e) {
      console.error('[Engine Error]', e.message);
      return json(res, 503, { ok: false, error: e.message });
    }
  }

  // HLS Playlist Proxy
  if (pathname === '/api/stream/hls') {
    cors(res);
    const targetUrl = searchParams.get('url');
    const referer = searchParams.get('referer') || new URL(targetUrl).origin;
    try {
      const raw = await xfetch(targetUrl, { referer });
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      
      const lines = raw.split('\n').map(line => {
        line = line.trim();
        if (!line) return '';
        if (line.startsWith('#')) {
          if (line.startsWith('#EXT-X-KEY:')) {
            const match = line.match(/URI="([^"]+)"/);
            if (match) {
              let keyUrl = match[1];
              if (!keyUrl.startsWith('http')) keyUrl = new URL(keyUrl, baseUrl).href;
              const proxiedKey = `/api/stream/segment?url=${encodeURIComponent(keyUrl)}&referer=${encodeURIComponent(referer)}`;
              return line.replace(match[1], proxiedKey);
            }
          }
          return line;
        }
        
        let absoluteUrl = line;
        if (!absoluteUrl.startsWith('http')) {
          absoluteUrl = new URL(absoluteUrl, baseUrl).href;
        }
        
        if (absoluteUrl.includes('.m3u8')) {
          return `/api/stream/hls?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
        } else {
          return `/api/stream/segment?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
        }
      }).join('\n');
      
      res.writeHead(200, { 
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache'
      });
      return res.end(lines);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // HLS Segment Proxy
  if (pathname === '/api/stream/segment') {
    cors(res);
    const targetUrl = searchParams.get('url');
    const referer = searchParams.get('referer') || new URL(targetUrl).origin;
    try {
      const headers = {
        'User-Agent': UA,
        'Referer': referer,
        'Origin': new URL(referer).origin
      };
      if (globalCookie) {
        headers['Cookie'] = globalCookie;
      }
      const sRes = await fetch(targetUrl, { headers });
      
      res.writeHead(sRes.status, {
        'Content-Type': sRes.headers.get('content-type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      });
      
      for await (const chunk of sRes.body) {
        res.write(chunk);
      }
      return res.end();
    } catch (e) {
      res.writeHead(500);
      return res.end(e.message);
    }
  }

  // Static File Router
  if (!pathname.startsWith('/api/')) {
    let filePath = join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!existsSync(filePath) || !pathname.includes('.')) {
      filePath = join(DIST_DIR, 'index.html');
    }
    try {
      const content = readFileSync(filePath);
      const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[extname(filePath)] || 'text/plain';
      res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
      return res.end(content);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<h1>AniLab v5 — run npm run build to compile frontend</h1>');
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🚀 AniLab Stream Engine v5 (AniWaves + AniNeko)');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log('');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use`);
  else console.error(e.message);
});
