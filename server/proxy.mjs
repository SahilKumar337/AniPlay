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
import { Readable }        from 'node:stream';
import puppeteer from 'puppeteer-core';
import { chromium } from 'playwright';

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

let globalBrowser = null;
async function getBrowser() {
  if (globalBrowser) {
    try {
      await globalBrowser.version();
      return globalBrowser;
    } catch (e) {
      console.log('[Puppeteer] Global browser crashed or disconnected. Re-launching...');
      try { await globalBrowser.close(); } catch (err) {}
      globalBrowser = null;
    }
  }

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
    ],
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else if (existsSync(CHROME_PATH)) {
    launchOptions.executablePath = CHROME_PATH;
  }

  globalBrowser = await puppeteer.launch(launchOptions);
  return globalBrowser;
}

let playwrightBrowser = null;
let isPlaywrightAvailable = true;

async function getPlaywrightBrowser() {
  if (playwrightBrowser) {
    try {
      if (playwrightBrowser.isConnected()) {
        return playwrightBrowser;
      }
    } catch (e) {
      playwrightBrowser = null;
    }
  }

  try {
    console.log('[Playwright] Launching shared browser instance...');
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || null;
    playwrightBrowser = await chromium.launch({
      headless: true,
      ...(execPath ? { executablePath: execPath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ]
    });
    isPlaywrightAvailable = true;
    return playwrightBrowser;
  } catch (e) {
    console.warn('[Playwright] Failed to launch browser:', e.message);
    playwrightBrowser = null;
    isPlaywrightAvailable = false;
    return null;
  }
}

// Perform an immediate async startup check to verify if browser launches
getPlaywrightBrowser().then(browser => {
  if (browser) {
    console.log('[Playwright] Startup check: Browser launched successfully.');
    isPlaywrightAvailable = true;
  } else {
    console.log('[Playwright] Startup check: Browser failed to launch. Disabling Playwright scrapers.');
    isPlaywrightAvailable = false;
  }
}).catch(err => {
  console.warn('[Playwright] Startup check error:', err.message);
  isPlaywrightAvailable = false;
});

let playwrightContext = null;
async function getPlaywrightContext() {
  const browser = await getPlaywrightBrowser();
  if (!browser) return null;
  
  if (!playwrightContext) {
    playwrightContext = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      hasTouch: false,
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });

    // Add robust stealth script before any page loads
    await playwrightContext.addInitScript(() => {
      // Hide webdriver automation signature
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Mock User Agent Client Hints to look like official Chrome
      const userAgentData = {
        brands: [
          { brand: 'Google Chrome', version: '125' },
          { brand: 'Chromium', version: '125' },
          { brand: 'Not.A/Brand', version: '24' }
        ],
        mobile: false,
        platform: 'Windows'
      };
      Object.defineProperty(navigator, 'userAgentData', { get: () => userAgentData });

      // Mimic Chrome runtime environment
      window.chrome = {
        app: { isInstalled: false },
        runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {} }
      };

      // Override permissions query
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      // Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // Mock WebGL Parameters to prevent headless detection
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Open Source Technology Center'; // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)'; // UNMASKED_RENDERER_WEBGL
        return getParameter.apply(this, arguments);
      };
      if (window.WebGL2RenderingContext) {
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) return 'Intel Open Source Technology Center';
          if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)';
          return getParameter2.apply(this, arguments);
        };
      }

      // Mock hardware specifications
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

      // Mock Plugins (Headless has 0, real has PDF viewers, etc.)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
        ]
      });
    });

    console.log('[Playwright] Priming shared context with AniWaves homepage...');
    const page = await playwrightContext.newPage();
    try {
      await page.goto(AW, { waitUntil: 'domcontentloaded', timeout: 20000 });
      
      // Let passive challenge load/run
      await page.waitForTimeout(3000);
      
      // Check for Cloudflare Turnstile challenge page
      let title = await page.title();
      if (title.includes('Cloudflare') || title.includes('Just a moment') || title.includes('Attention Required!')) {
        console.log('[Playwright] Cloudflare verification page detected on homepage. Waiting for Turnstile container...');
        
        // Wait for Turnstile container to render on screen
        const container = page.locator('#naeL5, div[style*="display: grid"]').first();
        const box = await container.boundingBox().catch(() => null);
        if (box) {
          console.log('[Playwright] Found Turnstile container bounding box:', JSON.stringify(box));
          // Click exactly in the center of the checkbox (x+16, y+34 relative to container)
          const clickX = box.x + 16;
          const clickY = box.y + 34;
          console.log(`[Playwright] Clicking Turnstile checkbox at X: ${clickX}, Y: ${clickY}...`);
          await page.mouse.click(clickX, clickY);
          
          // Wait for verification and reload/redirect
          console.log('[Playwright] Verification clicked. Waiting 10 seconds for redirect/reload...');
          await page.waitForTimeout(10000);
        } else {
          console.warn('[Playwright] Turnstile container bounding box not found.');
          await page.waitForTimeout(3000);
        }
      }
      console.log(`[Playwright] Homepage loaded successfully. Title: "${await page.title()}"`);
    } catch (e) {
      console.warn('[Playwright] Context priming failed:', e.message);
    } finally {
      await page.close();
    }
  }
  return playwrightContext;
}

async function playwrightFetch(url, referer = '') {
  console.log(`[Playwright Fetch] Navigating to: ${url}`);
  const context = await getPlaywrightContext();
  if (!context) {
    throw new Error('Playwright context is not initialized');
  }

  const page = await context.newPage();
  try {
    if (referer) {
      await page.setExtraHTTPHeaders({ 'Referer': referer });
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Check if we hit a Cloudflare challenge on the API/Target URL
    let title = await page.title();
    let isChallenge = title.includes('Cloudflare') || title.includes('Just a moment') || title.includes('Attention Required!');

    if (isChallenge) {
      console.log(`[Playwright Fetch] Cloudflare challenge detected for ${url}. Waiting...`);
      let solved = false;
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(100);
        title = await page.title();
        if (!title.includes('Cloudflare') && !title.includes('Just a moment') && !title.includes('Attention Required!')) {
          solved = true;
          break;
        }
      }
      if (solved) {
        console.log(`[Playwright Fetch] Cloudflare solved! New title: "${title}"`);
      } else {
        console.warn(`[Playwright Fetch] Cloudflare challenge timed out.`);
      }
    }

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    let content;
    if (bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
      content = bodyText;
    } else {
      content = await page.content();
    }

    await page.close();
    return content;
  } catch (e) {
    await page.close();
    throw e;
  }
}




async function playwrightExtractM3U8(embedUrl) {
  const cached = streamUrlCache.get(embedUrl);
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
    console.log(`[Playwright] Cache hit for ${embedUrl.slice(0, 80)}`);
    return cached;
  }

  const browser = await getPlaywrightBrowser();
  if (!browser) {
    throw new Error('Playwright browser is not initialized');
  }

  console.log(`[Playwright] Launching isolated page context for: ${embedUrl.slice(0, 100)}`);
  
  // Create isolated context with user agent and referer
  const context = await browser.newContext({
    userAgent: UA,
    extraHTTPHeaders: { 'Referer': AW + '/' }
  });

  return new Promise(async (resolve, reject) => {
    let page = null;
    let resolved = false;

    const cleanup = async () => {
      if (page) {
        try { await page.close(); } catch (e) {}
      }
      try { await context.close(); } catch (e) {}
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      streamUrlCache.set(embedUrl, result);
      cleanup().catch(() => {});
      resolve(result);
    };

    const fail = (err) => {
      if (resolved) return;
      resolved = true;
      cleanup().catch(() => {});
      reject(err);
    };

    try {
      page = await context.newPage();

      // Intercept and block unnecessary resources for high performance
      await page.route('**/*', (route) => {
        const url = route.request().url();
        const type = route.request().resourceType();

        if (
          url.includes('doubleclick') ||
          url.includes('googlesyndication') ||
          url.includes('google-analytics') ||
          url.includes('adsbygoogle') ||
          url.includes('adnxs') ||
          url.includes('adsystem') ||
          url.includes('popads') ||
          url.includes('onclickads') ||
          url.includes('exoclick') ||
          ['image', 'stylesheet', 'font', 'media'].includes(type)
        ) {
          return route.abort().catch(() => {});
        }

        // Intercept m3u8 requests
        if (url.includes('.m3u8') || url.includes('playlist.m3u8')) {
          const reqHeaders = route.request().headers();
          const capturedReferer = reqHeaders['referer'] || embedUrl;
          console.log(`[Playwright] Captured request m3u8: ${url.slice(0, 120)}`);
          finish({ url, referer: capturedReferer, ts: Date.now() });
          return;
        }

        route.continue().catch(() => {});
      });

      // Response-level monitoring
      page.on('response', (response) => {
        const url = response.url();
        const headers = response.headers();
        const ct = headers['content-type'] || '';
        if (url.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegURL')) {
          const reqHeaders = response.request().headers();
          const capturedReferer = reqHeaders['referer'] || embedUrl;
          console.log(`[Playwright] Captured response m3u8: ${url.slice(0, 120)}`);
          finish({ url, referer: capturedReferer, ts: Date.now() });
        }
      });

      // Open page
      try {
        await page.goto(embedUrl, { waitUntil: 'commit', timeout: 30000 });
      } catch (navErr) {
        if (!navErr.message.includes('timeout')) throw navErr;
        console.warn('[Playwright] Page navigation timeout - continuing extraction');
      }

      if (resolved) return;

      // Click playback buttons to trigger load
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
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }
        });
      } catch (clickErr) {
        console.warn('[Playwright] Trigger click failed:', clickErr.message);
      }

      // Check loop for up to 12 seconds
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (resolved) return;
      }

      fail(new Error('No m3u8 URL captured by Playwright'));
    } catch (e) {
      fail(e);
    }
  });
}

async function extractStreamM3U8(embedUrl) {
  // 1. Try Playwright first
  try {
    const result = await playwrightExtractM3U8(embedUrl);
    if (result) return result;
  } catch (e) {
    console.warn(`[Stream Resolver] Playwright failed for ${embedUrl.slice(0, 60)}:`, e.message);
  }

  // 2. Fall back to Puppeteer
  console.log(`[Stream Resolver] Falling back to Puppeteer for ${embedUrl.slice(0, 60)}`);
  return await puppeteerExtractM3U8(embedUrl);
}


// ── Puppeteer stream extractor (headless Chrome, network intercept) ──
// Cache recently extracted stream URLs to avoid relaunching browser for the same embed
async function puppeteerExtractM3U8(embedUrl) {
  const cached = streamUrlCache.get(embedUrl);
  if (cached && Date.now() - cached.ts < STREAM_CACHE_TTL) {
    console.log(`[Puppeteer] Cache hit for ${embedUrl.slice(0, 80)}`);
    return cached;
  }

  console.log(`[Puppeteer] Opening new page for: ${embedUrl.slice(0, 100)}`);
  
  return new Promise(async (resolve, reject) => {
    let page;
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (page) {
        page.close().catch(() => {});
      }
      streamUrlCache.set(embedUrl, result);
      resolve(result);
    };

    const fail = (err) => {
      if (resolved) return;
      resolved = true;
      if (page) {
        page.close().catch(() => {});
      }
      reject(err);
    };

    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ Referer: AW + '/' });

      // Intercept requests and abort non-essential assets
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = req.url();
        const type = req.resourceType();

        // Block ads, tracking scripts, images, stylesheets, fonts and media to save CPU & RAM
        if (
          url.includes('doubleclick') ||
          url.includes('googlesyndication') ||
          url.includes('google-analytics') ||
          url.includes('adsbygoogle') ||
          url.includes('adnxs') ||
          url.includes('adsystem') ||
          url.includes('popads') ||
          url.includes('onclickads') ||
          url.includes('exoclick') ||
          ['image', 'stylesheet', 'font', 'media'].includes(type)
        ) {
          return req.abort();
        }

        if (url.includes('.m3u8') || url.includes('playlist.m3u8')) {
          const capturedReferer = req.headers()['referer'] || embedUrl;
          console.log(`[Puppeteer] Intercepted m3u8: ${url.slice(0, 120)}`);
          finish({ url, referer: capturedReferer, ts: Date.now() });
        }
        req.continue();
      });

      // Listen on responses to catch XHR/fetch m3u8 requests
      page.on('response', resp => {
        const url = resp.url();
        const ct  = resp.headers()['content-type'] || '';
        if (url.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegURL')) {
          const capturedReferer = resp.request().headers()['referer'] || embedUrl;
          console.log(`[Puppeteer] Response m3u8: ${url.slice(0, 120)}`);
          finish({ url, referer: capturedReferer, ts: Date.now() });
        }
      });

      // Navigate to embed page - wait for domcontentloaded first, then networkidle
      try {
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
      } catch (navErr) {
        // Timeout is OK — the page might still be loading assets
        if (!navErr.message.includes('timeout')) throw navErr;
        console.warn('[Puppeteer] Navigation timeout — continuing anyway');
      }

      if (resolved) return;

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
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }
        });
      } catch (e) {
        console.warn('[Puppeteer] Click play button failed:', e.message);
      }

      // Wait up to 12 seconds for any lazy player requests to load
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (resolved) return;
      }

      fail(new Error('No .m3u8 URL captured from embed page'));
    } catch (e) {
      fail(e);
    }
  });
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
  if (url.includes('aniwaves.ru') || url.includes('aniwave.')) {
    try {
      return await playwrightFetch(url, opts.referer);
    } catch (e) {
      console.warn(`[xfetch] Playwright fetch failed for ${url}, trying standard fetch fallback:`, e.message);
    }
  }
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
  
  // 1. Clean the title and split into words for keyword permutation fallbacks
  const cleanTitle = title.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleanTitle.split(' ').filter(w => w.length > 1);
  
  let searchQueries = [];
  if (words.length > 1) {
    searchQueries.push(words.slice(0, 3).join(' ')); // Try first 3 words (e.g. "Komi-san wa")
    searchQueries.push(words.slice(0, 2).join(' ')); // Try first 2 words
  }
  searchQueries.push(getLongestWord(title)); // Try longest word
  searchQueries.push(cleanTitle); // Try full clean title
  
  // Remove duplicates from queries list
  searchQueries = [...new Set(searchQueries)].filter(Boolean);
  
  let results = [];
  const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>/g;
  
  // Try search queries in sequence until we get results
  for (const keyword of searchQueries) {
    console.log(`[AniNeko] Searching: "${keyword}" (original: "${title}")`);
    try {
      const searchHtml = await xfetch(`${domain}/browser?keyword=${encodeURIComponent(keyword)}`, { referer: domain, timeout: 35000 });
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(searchHtml)) !== null) {
        results.push({ slug: m[1], title: m[2].trim() });
      }
      if (results.length > 0) break;
    } catch (e) {
      console.warn(`[AniNeko] Search failed for "${keyword}": ${e.message}`);
    }
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

  const rawServers = [];
  for (const page of fetchedPages) {
    if (page.status !== 'fulfilled') continue;
    const { html, isDubPage } = page.value;

    const panelsRe = /<div[^>]+data-id="(sub|dub)"[\s\S]*?<\/div>\s*<\/div>/g;
    let pMatch;
    while ((pMatch = panelsRe.exec(html)) !== null) {
      const panelId = pMatch[1]; // 'sub' or 'dub'
      const panelHtml = pMatch[0];

      const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
      let m;
      while ((m = btnRe.exec(panelHtml)) !== null) {
        let videoUrl = m[1];
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        
        // Restrict to HD-1 and HD-2 only, as requested by the user
        if (name.includes('HD-1') || name.includes('HD-2')) {
          const isDub = !!(isDubPage || panelId === 'dub' || name.toLowerCase().includes('dub'));
          rawServers.push({ videoUrl, isDub });
        }
      }
    }
  }

  // Deduplicate by videoUrl to prevent duplicate buttons
  const seenUrls = new Set();
  const uniqueRawServers = [];
  for (const s of rawServers) {
    if (seenUrls.has(s.videoUrl)) continue;
    seenUrls.add(s.videoUrl);
    uniqueRawServers.push(s);
  }

  const servers = [];
  let subCount = 0;
  let dubCount = 0;
  for (const s of uniqueRawServers) {
    // Extract subtitle track URL if present in videoUrl parameters (sub, caption_1, c1_file)
    let subtitleUrl = '';
    try {
      const urlObj = new URL(s.videoUrl);
      subtitleUrl = urlObj.searchParams.get('sub') || 
                    urlObj.searchParams.get('caption_1') || 
                    urlObj.searchParams.get('c1_file') || '';
    } catch {}

    const subtitles = subtitleUrl ? [{
      id: 0,
      label: 'English',
      file: `/api/stream/subtitle?url=${encodeURIComponent(subtitleUrl)}`
    }] : [];

    if (s.isDub) {
      if (dubCount >= 2) continue;
      dubCount++;
      servers.push({
        name: `HD${dubCount} (DUB)`,
        videoUrl: s.videoUrl,
        type: 'dub',
        subtitles
      });
    } else {
      if (subCount >= 2) continue;
      subCount++;
      servers.push({
        name: `HD${subCount}`,
        videoUrl: s.videoUrl,
        type: 'sub',
        subtitles
      });
    }
  }

  if (!servers.length) throw new Error(`No HD servers found on AniNeko for episode ${episode}`);
  return { servers, animeTitle: best.title, slug: best.slug };
}

/**
 * Scrapes the raw .m3u8 playlist URL from GogoCDN/other player embed pages if available in plain-text.
 */
async function resolveServerM3U8(videoUrl) {
  const urlSnippet = videoUrl.slice(0, 70);
  try {
    const referer = new URL(videoUrl).origin;
    console.log(`[M3U8 Resolver] Resolving: ${urlSnippet}`);
    const html = await xfetch(videoUrl, { referer, timeout: 3500 });
    const match =
      // Direct string assignment
      html.match(/const\s+src\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
      || html.match(/var\s+src\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
      // JWPlayer file property
      || html.match(/['"]?file['"]?\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
      // GogoAnime sources array
      || html.match(/sources\s*:\s*\[\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i)
      // Any absolute HTTPS m3u8 URL in the HTML (most permissive)
      || html.match(/(https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?)/);
    if (match) {
      let m3u8Url = match[1];
      if (!m3u8Url.startsWith('http')) {
        m3u8Url = new URL(m3u8Url, videoUrl).href;
      }
      console.log(`[M3U8 Resolver] Found m3u8 for: ${urlSnippet}`);
      return m3u8Url;
    }
    console.log(`[M3U8 Resolver] No m3u8 pattern in: ${urlSnippet}`);
  } catch (e) {
    console.warn(`[M3U8 Resolver] Failed for ${urlSnippet}:`, e.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
async function runWithTimeout(promise, ms, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

async function getServers(titles, episode) {
  const errors = [];
  
  // 1. Define AniNeko scraper execution
  const nekoPromise = (async () => {
    for (const title of titles) {
      if (/[\u3000-\u9fff\uff00-\uffef]/.test(title)) continue; // Skip Japanese native
      try {
        console.log(`[Engine] AniNeko trying: "${title}" ep ${episode}`);
        const data = await scrapeAniNeko(title, episode);
        if (data?.servers?.length) return data;
      } catch (e) {
        console.warn(`[Engine] AniNeko failed for "${title}": ${e.message}`);
        errors.push(`AN[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
    return null;
  })();

  // 2. Define AniWaves scraper execution (uses Playwright-backed xfetch)
  const wavesPromise = (async () => {
    // If playwright failed to initialize (e.g. on Render free tier), skip AniWaves immediately to prevent loading delays
    if (!isPlaywrightAvailable) {
      console.log('[Engine] Playwright is unavailable on this server. Skipping AniWaves.');
      return null;
    }
    for (const title of titles) {
      try {
        console.log(`[Engine] AniWaves trying: "${title}" ep ${episode}`);
        const data = await scrapeAniWaves(title, episode);
        if (data?.servers?.length) return data;
      } catch (e) {
        console.warn(`[Engine] AniWaves failed for "${title}": ${e.message}`);
        errors.push(`AW[${title.slice(0, 30)}]: ${e.message}`);
      }
    }
    return null;
  })();

  // 3. Execute both scrapers concurrently. Limit AniWaves to 6.5s to prevent stalling.
  const [aniNekoData, aniWavesData] = await Promise.all([
    runWithTimeout(nekoPromise, 12000, 'AniNeko').catch(e => { console.warn(e.message); return null; }),
    runWithTimeout(wavesPromise, 6500, 'AniWaves').catch(e => { console.warn(e.message); return null; })
  ]);


  // 3. Combine servers from both scrapers
  const combinedServers = [];
  if (aniNekoData?.servers?.length) {
    aniNekoData.servers.forEach(s => {
      combinedServers.push({
        ...s,
        name: `Neko ${s.name}`
      });
    });
  }
  if (aniWavesData?.servers?.length) {
    aniWavesData.servers.forEach(s => {
      combinedServers.push({
        ...s,
        name: `Waves ${s.name}`
      });
    });
  }

  if (combinedServers.length === 0) {
    throw new Error(errors.join(' | '));
  }

  const result = {
    servers: combinedServers,
    animeTitle: aniNekoData?.animeTitle || aniWavesData?.animeTitle || titles[0],
    slug: aniNekoData?.slug || aniWavesData?.slug || ''
  };

  // Resolve M3U8 streams concurrently
  console.log(`[Engine] Resolving HLS streams for ${result.servers.length} servers...`);
  const resolvedServers = await Promise.all(
    result.servers.map(async s => {
      // Skip iframe-proxy URLs for resolveServerM3U8 (they're relative paths, not real URLs)
      if (s.videoUrl.startsWith('/api/')) return s;

      const m3u8Url = await resolveServerM3U8(s.videoUrl);
      if (m3u8Url) {
        let referer;
        try { referer = new URL(s.videoUrl).origin; } catch { referer = ''; }
        const proxiedUrl = `/api/stream/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(referer)}`;
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
export async function handleRequest(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const { pathname, searchParams } = parsed;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(200); return res.end(); }

  // API Key Validation: If API_KEY is set in environment, require X-API-Key header or api_key query param (except for /api/ping)
  const envApiKey = process.env.API_KEY;
  if (envApiKey && pathname.startsWith('/api/') && pathname !== '/api/ping') {
    const requestKey = req.headers['x-api-key'] || searchParams.get('api_key');
    if (requestKey !== envApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }));
    }
  }

  const refererHeader = req.headers.referer || '';
  const isIframeProxy = refererHeader.includes('/api/iframe-proxy');
  const myApis = ['/api/anineko-servers', '/api/ping', '/api/stream/hls', '/api/stream/segment', '/api/stream/subtitle', '/api/iframe-proxy'];
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
      
      if (req.url.includes('/api/getSources') || req.url.includes('/ajax/getSources')) {
        // The injected script should rewrite these to go direct, but if they still come through
        // our proxy, redirect the browser directly to the embed server so Cloudflare sees a real browser IP
        const directUrl = `${targetOrigin}${req.url}`;
        console.log(`[Iframe Proxy Asset] getSources: redirecting browser direct to ${directUrl}`);
        cors(res);
        res.writeHead(307, { 'Location': directUrl, 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      const isStatic = req.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i);
      res.writeHead(sRes.status, {
        'Content-Type': sRes.headers.get('content-type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': isStatic ? 'public, max-age=86400' : 'no-store, no-cache, must-revalidate'
      });
      
      const nodeStream = Readable.fromWeb(sRes.body);
      nodeStream.pipe(res);
      req.on('close', () => {
        nodeStream.destroy();
      });
      return;
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
      
      // Detect the actual origin of the embed server from the targetUrl
      const embedOrigin = new URL(targetUrl).origin;

      const injectedScript = `
<script>
  (function() {
    // The REAL embed server origin — getSources calls will go here directly from browser
    var EMBED_ORIGIN = '${embedOrigin}';

    // ── Send stream URL to parent page ──────────────────────────
    var _sentUrls = new Set();
    function checkAndSend(src) {
      if (!src || typeof src !== 'string' || _sentUrls.has(src)) return;
      var absoluteUrl = src;
      try { absoluteUrl = new URL(src, EMBED_ORIGIN + '/').href; } catch(e) {}
      if (absoluteUrl.includes('.m3u8') || absoluteUrl.includes('.mp4')) {
        _sentUrls.add(src);
        console.log('[Iframe Interceptor] Stream URL:', absoluteUrl.slice(0, 120));
        window.parent.postMessage({ type: 'NATIVE_STREAM_URL', url: absoluteUrl }, '*');
      }
    }

    // ── Helper: rewrite API URLs to go direct (bypass proxy) ────
    // play.echovideo.ru (and Vidplay/Vidstream) blocks server-side proxy IPs via Cloudflare.
    // Solution: have the BROWSER make getSources directly using the user's residential IP.
    function rewriteApiUrl(url) {
      if (!url || typeof url !== 'string') return url;
      // Rewrite relative API paths to absolute embed-origin URLs
      if (url.startsWith('/api/getSources') || url.startsWith('/ajax/getSources') ||
          url.startsWith('/api/getApiKey')  || url.startsWith('/ajax/getApiKey') ||
          url.startsWith('/api/encrypt-ajax') || url.startsWith('/encrypt-ajax')) {
        return EMBED_ORIGIN + url;
      }
      return url;
    }

    // ── Intercept fetch ──────────────────────────────────────────
    var originalFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      url = rewriteApiUrl(url);
      checkAndSend(url);
      if (typeof input === 'string') input = url;
      return originalFetch.call(this, input, init);
    };

    // ── Intercept XMLHttpRequest.open ────────────────────────────
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      url = rewriteApiUrl(url) || url;
      checkAndSend(url);
      return originalOpen.call(this, method, url, arguments[2], arguments[3], arguments[4]);
    };

    // ── Intercept HTMLMediaElement.src ───────────────────────────
    var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDesc) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: srcDesc.get,
        set: function(val) { checkAndSend(val); return srcDesc.set.call(this, val); },
        configurable: true
      });
    }

    // ── Intercept setAttribute src ───────────────────────────────
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if (name === 'src' && (this.tagName === 'VIDEO' || this.tagName === 'SOURCE')) checkAndSend(val);
      return origSetAttr.apply(this, arguments);
    };

    // ── Intercept HTMLSourceElement.src ─────────────────────────
    var srcDescSE = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
    if (srcDescSE) {
      Object.defineProperty(HTMLSourceElement.prototype, 'src', {
        get: srcDescSE.get,
        set: function(val) { checkAndSend(val); return srcDescSE.set.call(this, val); },
        configurable: true
      });
    }

    // ── Intercept jwplayer setup (belt-and-suspenders) ───────────
    // JWPlayer gets the m3u8 from getSources JSON and configures itself.
    // Intercept jwplayer() to catch the .setup({sources:[{file:"...m3u8"}]}) call.
    function patchJWPlayer(jwp) {
      if (!jwp || jwp.__anilab_patched) return;
      jwp.__anilab_patched = true;
      var origCall = jwp;
      window.jwplayer = function() {
        var instance = origCall.apply(this, arguments);
        if (instance && instance.setup && !instance.__anilab_patched) {
          instance.__anilab_patched = true;
          var origSetup = instance.setup.bind(instance);
          instance.setup = function(config) {
            if (config) {
              // Check sources directly
              var sources = config.sources || (config.playlist && config.playlist[0] && config.playlist[0].sources);
              if (sources) {
                for (var i = 0; i < sources.length; i++) {
                  if (sources[i].file) checkAndSend(sources[i].file);
                }
              }
            }
            return origSetup(config);
          };
        }
        return instance;
      };
      window.jwplayer.__anilab_patched = true;
    }

    // Watch for jwplayer to be defined (it loads async)
    var jwInterval = setInterval(function() {
      if (window.jwplayer && !window.jwplayer.__anilab_patched) {
        patchJWPlayer(window.jwplayer);
        clearInterval(jwInterval);
      }
    }, 100);
    setTimeout(function() { clearInterval(jwInterval); }, 15000);

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
      console.warn(`[Iframe Proxy] Failed to fetch embed page: ${e.message}. Redirecting directly to target URL as fallback.`);
      res.writeHead(302, { 
        'Location': targetUrl,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end();
    }
  }

  if (pathname === '/api/ping') return json(res, 200, { ok: true });

  // ── Puppeteer-based stream extractor endpoint ──────────────────────
  if (pathname === '/api/extract-stream') {
    cors(res);
    const embedUrl = searchParams.get('url');
    if (!embedUrl) return json(res, 400, { error: 'url required' });
    try {
      const { url: m3u8Url, referer } = await extractStreamM3U8(embedUrl);
      // Return ABSOLUTE URL so Capacitor WebView (which runs at http://localhost)
      // can correctly resolve the playlist — relative paths would hit localhost, not Render.
      let proto = req.headers['x-forwarded-proto'];
      if (!proto) {
        const hostHeader = req.headers['host'] || '';
        const isLocalHost = 
          hostHeader.includes('localhost') || 
          hostHeader.includes('127.0.0.1') || 
          hostHeader.includes('192.168.') || 
          hostHeader.includes('10.') || 
          hostHeader.includes('172.');
        proto = isLocalHost ? 'http' : 'https';
      }
      const host  = req.headers['x-forwarded-host'] || req.headers['host'] || 'anilab-backend.onrender.com';
      const selfBase = `${proto}://${host}`;
      const apiKeyParam = searchParams.get('api_key') ? `&api_key=${encodeURIComponent(searchParams.get('api_key'))}` : '';
      const proxied = `${selfBase}/api/stream/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(referer)}${apiKeyParam}`;
      return json(res, 200, { ok: true, url: proxied, rawUrl: m3u8Url });
    } catch (e) {
      console.error('[Extract Stream]', e.message);
      return json(res, 502, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/test-fetch') {
    cors(res);
    const targetUrl = searchParams.get('url');
    try {
      console.log(`[Diagnostic Fetch] Fetching ${targetUrl}...`);
      const r = await fetch(targetUrl, {
        headers: {
          'User-Agent': UA
        }
      });
      return json(res, 200, {
        ok: r.ok,
        status: r.status,
        headers: Object.fromEntries(r.headers),
        text: (await r.text()).slice(0, 500)
      });
    } catch (e) {
      console.error(`[Diagnostic Fetch] Failed:`, e);
      return json(res, 500, {
        ok: false,
        error: e.message,
        stack: e.stack
      });
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
    const noCache = searchParams.get('nocache') === 'true' || searchParams.get('bypass') === 'true';

    if (noCache) {
      serverCache.delete(cacheKey);
      console.log(`[Cache Bypass] Cleared cache for: "${cacheKey}"`);
    }

    // Check cache first
    if (!noCache && serverCache.has(cacheKey)) {
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
    const apiKeyParam = searchParams.get('api_key') || '';
    try {
      const raw = await xfetch(targetUrl, { referer });
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      // Build absolute base so HLS.js in Capacitor WebView resolves correctly.
      // When running in APK, the page origin is http://localhost — so relative
      // paths like /api/stream/... would go to localhost, not the backend.
      // We must emit fully-qualified URLs so HLS.js always hits the Render server.
      let proto = req.headers['x-forwarded-proto'];
      if (!proto) {
        const hostHeader = req.headers['host'] || '';
        const isLocalHost = 
          hostHeader.includes('localhost') || 
          hostHeader.includes('127.0.0.1') || 
          hostHeader.includes('192.168.') || 
          hostHeader.includes('10.') || 
          hostHeader.includes('172.');
        proto = isLocalHost ? 'http' : 'https';
      }
      const host  = req.headers['x-forwarded-host'] || req.headers['host'] || 'anilab-backend.onrender.com';
      const selfBase = `${proto}://${host}`;

      const lines = raw.split('\n').map(line => {
        line = line.trim();
        if (!line) return '';
        if (line.startsWith('#')) {
          if (line.startsWith('#EXT-X-KEY:')) {
            const match = line.match(/URI="([^"]+)"/);
            if (match) {
              let keyUrl = match[1];
              if (!keyUrl.startsWith('http')) keyUrl = new URL(keyUrl, baseUrl).href;
              let proxiedKey = `${selfBase}/api/stream/segment?url=${encodeURIComponent(keyUrl)}&referer=${encodeURIComponent(referer)}`;
              if (apiKeyParam) proxiedKey += `&api_key=${encodeURIComponent(apiKeyParam)}`;
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
          let hlsUrl = `${selfBase}/api/stream/hls?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
          if (apiKeyParam) hlsUrl += `&api_key=${encodeURIComponent(apiKeyParam)}`;
          return hlsUrl;
        } else {
          // Hybrid Stream: Direct Play for Neko CDN segments (saves 99.9% bandwidth),
          // but proxy for Waves segments that require strict Referer headers to play.
          const isNekoSegment = 
            absoluteUrl.includes('ibyteimg.com') || 
            absoluteUrl.includes('vivibebe.site') || 
            absoluteUrl.includes('bibiemb.xyz') || 
            absoluteUrl.includes('workers.dev') || 
            absoluteUrl.includes('anizara.store');

          if (isNekoSegment) {
            return absoluteUrl;
          } else {
            let segmentUrl = `${selfBase}/api/stream/segment?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
            if (apiKeyParam) segmentUrl += `&api_key=${encodeURIComponent(apiKeyParam)}`;
            return segmentUrl;
          }
        }
      }).join('\n');

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(lines);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // HLS Segment Proxy — streams bytes directly to client without buffering
  if (pathname === '/api/stream/segment') {
    cors(res);
    const targetUrl = searchParams.get('url');
    if (!targetUrl) { res.writeHead(400); return res.end('missing url'); }
    const referer = searchParams.get('referer') || new URL(targetUrl).origin;
    
    const controller = new AbortController();
    const { signal } = controller;
    
    const cleanup = () => {
      controller.abort();
    };
    req.on('close', cleanup);

    try {
      const headers = {
        'User-Agent': UA,
        'Referer': referer,
        'Origin': new URL(referer).origin
      };
      if (globalCookie) headers['Cookie'] = globalCookie;

      // Add an 8-second request timeout to prevent hanging forever
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 8000);

      const sRes = await fetch(targetUrl, { headers, signal });
      clearTimeout(timeoutId);

      if (!sRes.ok) { 
        req.removeListener('close', cleanup);
        res.writeHead(sRes.status); 
        return res.end(); 
      }

      res.writeHead(sRes.status, {
        'Content-Type': sRes.headers.get('content-type') || 'video/mp2t',
        'Content-Length': sRes.headers.get('content-length') || '',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      });

      const nodeStream = Readable.fromWeb(sRes.body);
      nodeStream.pipe(res);
      
      req.on('close', () => {
        nodeStream.destroy();
      });
      req.removeListener('close', cleanup);
      return;
    } catch (e) {
      req.removeListener('close', cleanup);
      if (!res.headersSent) { 
        if (e.name === 'AbortError') {
          res.writeHead(499); // Client Closed Request
        } else {
          res.writeHead(500);
        }
        res.end(e.message); 
      }
      return;
    }
  }

  // Subtitle File Proxy — fetches third-party WebVTT files, parses them, and returns JSON to bypass CORS and rendering limitations
  if (pathname === '/api/stream/subtitle') {
    cors(res);
    const targetUrl = searchParams.get('url');
    if (!targetUrl) { res.writeHead(400); return res.end('missing url'); }
    try {
      const text = await xfetch(targetUrl);
      
      // Parse WebVTT text into JSON cues
      const cues = [];
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      
      let currentCue = null;
      const timeRegex = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
      const shortTimeRegex = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        let match = line.match(timeRegex);
        let isShort = false;
        if (!match) {
          match = line.match(shortTimeRegex);
          isShort = true;
        }

        if (match) {
          if (currentCue) {
            cues.push(currentCue);
          }
          
          let startSecs, endSecs;
          if (isShort) {
            const startMins = parseInt(match[1]);
            const startSec = parseInt(match[2]);
            const startMs = parseInt(match[3]);
            startSecs = startMins * 60 + startSec + startMs / 1000;

            const endMins = parseInt(match[4]);
            const endSec = parseInt(match[5]);
            const endMs = parseInt(match[6]);
            endSecs = endMins * 60 + endSec + endMs / 1000;
          } else {
            const startHrs = parseInt(match[1]);
            const startMins = parseInt(match[2]);
            const startSec = parseInt(match[3]);
            const startMs = parseInt(match[4]);
            startSecs = startHrs * 3600 + startMins * 60 + startSec + startMs / 1000;

            const endHrs = parseInt(match[5]);
            const endMins = parseInt(match[6]);
            const endSec = parseInt(match[7]);
            const endMs = parseInt(match[8]);
            endSecs = endHrs * 3600 + endMins * 60 + endSec + endMs / 1000;
          }

          currentCue = {
            startTime: startSecs,
            endTime: endSecs,
            text: ''
          };
        } else if (currentCue && !line.startsWith('WEBVTT') && isNaN(line)) {
          currentCue.text += (currentCue.text ? '\n' : '') + line;
        }
      }

      if (currentCue) {
        cues.push(currentCue);
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(cues));
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500); res.end(e.message); }
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
}

export const server = createServer(handleRequest);

if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
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
}
