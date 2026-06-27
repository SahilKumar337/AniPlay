/**
 * AniLab Stream Engine — v4 (AniNeko Scraper & Proxy)
 * ══════════════════════════════════════════════════════════════════
 *
 * HOW WE ACHIEVED INSTANT, AD-FREE EMBEDS:
 * 1. GogoAnime has migrated to `anineko.to`.
 * 2. This domain is NOT SNI/IP-blocked in India.
 * 3. We scrape the watch page and extract the raw `data-video` URLs.
 * 4. We return these URLs to the frontend.
 * 5. The frontend displays the server inside an iframe sandbox
 *    WITHOUT "allow-popups" or "allow-popups-to-escape-sandbox".
 *    This completely blocks 100% of ads and popup redirects!
 */

import { createServer } from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PORT      = process.env.PORT || 4000;
const PROXY_URL = `http://localhost:${PORT}`;
const UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR  = join(__dirname, '../dist');

// Enable native TLS verification to prevent Cloudflare from detecting Node bot TLS signature
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}
function json(res, code, data) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

let globalCookie = '';

async function xfetch(url, opts = {}) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeout || 45000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      ...(globalCookie ? { 'Cookie': globalCookie } : {}),
      ...(opts.referer ? { 'Referer': opts.referer, 'Origin': new URL(opts.referer).origin } : {}),
      ...(opts.headers || {})
    }
  });

  // Persist session cookies for subsequent fetches (avoids re-solving Cloudflare challenges)
  const setCookie = r.headers.getSetCookie();
  if (setCookie && setCookie.length > 0) {
    const parsedCookies = setCookie.map(c => c.split(';')[0]).join('; ');
    globalCookie = parsedCookies;
  }

  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url.split('?')[0]}`);
  return r.text();
}

// ══════════════════════════════════════════════════════════════════
// ANINEKO SCRAPER
// ══════════════════════════════════════════════════════════════════
function cleanSearchQuery(title) {
  return title
    .replace(/[’’‘]/g, "'") // replace smart single quotes with standard single quote
    .replace(/[“”]/g, '"')   // replace smart double quotes with standard double quote
    .replace(/[^a-zA-Z0-9\s']/g, ' ') // replace punctuation (except standard quote) with spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSeasonSuffix(title) {
  return title.replace(/\s+(?:part|season|s)?\s*(?:[ivxldcm]+|\d+)(?:st|nd|rd|th)?$/i, '').trim();
}

function getNormalizedSeason(title) {
  const t = title.toLowerCase();
  if (t.includes('season 5') || t.includes('5th season') || t.includes('part 5') || t.includes('part v') || /\b5\b/.test(t)) return 5;
  if (t.includes('season 4') || t.includes('4th season') || t.includes('part 4') || t.includes('part iv') || /\b4\b/.test(t)) return 4;
  if (t.includes('season 3') || t.includes('3rd season') || t.includes('part 3') || t.includes('part iii') || /\b3\b/.test(t)) return 3;
  if (t.includes('season 2') || t.includes('2nd season') || t.includes('part 2') || t.includes('part ii') || /\b2\b/.test(t)) return 2;
  return 1;
}

function getLongestWord(title) {
  const cleaned = title.replace(/\b(?:season|part|s|ep|episode|recap|ova|ona|movie)\b/gi, '');
  const words = cleaned.split(/[^a-zA-Z0-9]/).filter(w => w.length > 2);
  if (words.length === 0) return title;
  return words.reduce((a, b) => a.length > b.length ? a : b);
}

function getMatchScore(resultTitle, queryTitle) {
  const rt = resultTitle.toLowerCase().replace(/&#039;/g, "'").replace(/&amp;/g, '&');
  const qt = queryTitle.toLowerCase();

  const querySeason = getNormalizedSeason(qt);
  const resultSeason = getNormalizedSeason(rt);

  if (querySeason !== resultSeason) return 0; // Season mismatch!

  const strippedQt = stripSeasonSuffix(qt);
  const qWords = strippedQt.split(/\s+/).filter(w => w.length > 2);
  if (qWords.length === 0) return 0.5;

  let matched = 0;
  for (const w of qWords) {
    if (rt.includes(w)) matched++;
  }
  return matched / qWords.length;
}

async function scrapeAniNeko(title, episode) {
  const domain = 'https://anineko.to';
  const keyword = getLongestWord(title);
  
  console.log(`[AniNeko] Searching for longest word: "${keyword}" (original: "${title}") on ${domain}`);
  let searchHtml = await xfetch(`${domain}/browser?keyword=${encodeURIComponent(keyword)}`, {
    referer: domain,
    timeout: 55000 // 55s timeout to allow Cloudflare check to clear
  });
  
  let results = [];
  const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(searchHtml)) !== null) {
    results.push({ slug: m[1], title: m[2].trim() });
  }

  // Fallback: search using full cleaned title if longest word returned nothing
  if (results.length === 0) {
    const cleaned = cleanSearchQuery(title);
    console.log(`[AniNeko] No results for "${keyword}". Retrying with full title: "${cleaned}"`);
    searchHtml = await xfetch(`${domain}/browser?keyword=${encodeURIComponent(cleaned)}`, {
      referer: domain,
      timeout: 55000
    });
    re.lastIndex = 0;
    while ((m = re.exec(searchHtml)) !== null) {
      results.push({ slug: m[1], title: m[2].trim() });
    }
  }

  if (results.length === 0) {
    throw new Error(`Anime "${title}" not found on ${domain}`);
  }

  // Find the best matching item based on scoring
  let best = results[0];
  let maxScore = -1;
  const cleanedQuery = cleanSearchQuery(title);
  for (const r of results) {
    const score = getMatchScore(r.title, cleanedQuery);
    if (score > maxScore) {
      maxScore = score;
      best = r;
    }
  }
  if (maxScore === 0) best = results[0];

  console.log(`[AniNeko] Matched: "${best.title}" (slug=${best.slug}, score=${maxScore}) on ${domain}`);

  const watchUrl = `${domain}/watch/${best.slug}/ep-${episode}`;
  console.log(`[AniNeko] Fetching watch page: ${watchUrl}`);
  const watchHtml = await xfetch(watchUrl, { referer: domain, timeout: 55000 });

  const servers = [];
  const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
  while ((m = btnRe.exec(watchHtml)) !== null) {
    let videoUrl = m[1];
    if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
    const innerText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    servers.push({ name: innerText, videoUrl });
  }

  if (servers.length === 0) {
    throw new Error(`No watch servers found on ${domain} for episode ${episode}`);
  }

  return {
    servers,
    animeTitle: best.title,
    slug: best.slug
  };
}

// ══════════════════════════════════════════════════════════════════
// HTTP SERVER
// ══════════════════════════════════════════════════════════════════
const server = createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname, searchParams } = parsed;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(200); return res.end(); }

  // API Routes
  if (pathname === '/api/ping') return json(res, 200, { ok: true });

  if (pathname === '/api/anineko-servers') {
    const title = searchParams.get('title');
    const ep    = searchParams.get('episode') || '1';
    if (!title) return json(res, 400, { error: 'title required' });
    try {
      const data = await scrapeAniNeko(title, ep);
      return json(res, 200, { ok: true, ...data });
    } catch (e) {
      console.error('[AniNeko Error]', e.message);
      return json(res, 503, { ok: false, error: e.message });
    }
  }

  // Static File Router (for production build)
  if (!pathname.startsWith('/api/')) {
    let filePath = join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
    
    // Fallback to index.html for Single Page App client-side routing
    if (!existsSync(filePath) || pathname.indexOf('.') === -1) {
      filePath = join(DIST_DIR, 'index.html');
    }

    try {
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.xml': 'application/xml',
      }[ext] || 'text/plain';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(content);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<h1>AniLab Proxy Server Active</h1><p>Run <code>npm run build</code> to compile the frontend static assets.</p>');
    }
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🚀 AniLab Stream Engine v4 (AniNeko integration)');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log('');
  console.log('  Serving direct ad-free embed servers via sandbox bypass.');
  console.log('');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} already in use — kill it with: npx kill-port 4000`);
  else console.error(e.message);
});
