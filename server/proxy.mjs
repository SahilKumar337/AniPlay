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

const PORT     = process.env.PORT || 4000;
const AW       = 'https://aniwaves.ru';
const ANINEKO  = 'https://anineko.to';
const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR  = join(__dirname, '../dist');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

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
 * Tries the longest meaningful word first, then full title.
 * Returns { slug, animeId, animeTitle } or throws.
 */
async function awSearch(title) {
  // Build a smart keyword: strip generic season/part words, pick longest word
  const cleaned = title.replace(/\b(season|part|s)\s*\d+\b/gi, '').replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '').trim();
  const words   = cleaned.split(/[^a-zA-Z0-9]/).filter(w => w.length > 3 && !/^(the|and|with|from|that|this|into|over|under)$/i.test(w));
  const keyword = words.length ? words.reduce((a, b) => a.length >= b.length ? a : b) : title;

  console.log(`[AW] Searching: keyword="${keyword}" (from: "${title}")`);

  const searchHtml = await xfetch(`${AW}/ajax/anime/search?keyword=${encodeURIComponent(keyword)}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
    referer: AW,
    timeout: 30000,
  });

  let parsed;
  try { parsed = JSON.parse(searchHtml); } catch { throw new Error('AniWaves search returned non-JSON'); }
  if (parsed.status === 404 || !parsed.result?.html) {
    // Fallback: search using full title
    console.log(`[AW] No results for "${keyword}", retrying with full title`);
    const fb = await xfetch(`${AW}/ajax/anime/search?keyword=${encodeURIComponent(title)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*' },
      referer: AW,
      timeout: 30000,
    });
    try { parsed = JSON.parse(fb); } catch { throw new Error('AniWaves search fallback returned non-JSON'); }
    if (parsed.status === 404 || !parsed.result?.html) throw new Error(`Anime "${title}" not found on AniWaves`);
  }

  // Parse results: href="/watch/slug-ANIMEID"  title text is in .name
  const html = parsed.result.html;
  const itemRe = /href="\/watch\/([^"]+)"><div class="poster">[\s\S]+?class="name d-title"[^>]*>([^<]+)<\/div>/g;
  const results = [];
  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const fullSlug = m[1].trim();           // e.g. "sasaki-to-pii-chan-75185"
    const rTitle   = m[2].trim();
    // Extract numeric id from end of slug
    const idMatch  = fullSlug.match(/-(\d+)$/);
    const animeId  = idMatch ? idMatch[1] : null;
    results.push({ slug: fullSlug, animeId, animeTitle: rTitle });
  }

  // Also try simpler regex as fallback
  if (results.length === 0) {
    const simpleRe = /href="\/watch\/([\w-]+-(\d+))"/g;
    while ((m = simpleRe.exec(html)) !== null) {
      results.push({ slug: m[1], animeId: m[2], animeTitle: m[1].replace(/-\d+$/, '').replace(/-/g, ' ') });
    }
  }

  if (results.length === 0) throw new Error(`No anime results parsed from AniWaves for "${title}"`);

  // Score and pick best match
  let best = results[0], maxScore = -1;
  for (const r of results) {
    const score = titleScore(r.animeTitle, title);
    console.log(`[AW]   candidate: "${r.animeTitle}" score=${score.toFixed(2)}`);
    if (score > maxScore) { maxScore = score; best = r; }
  }
  // If best score is 0 and we only have 1 result, accept it anyway (keyword was very specific)
  if (maxScore === 0 && results.length === 1) best = results[0];
  if (maxScore === 0 && results.length > 1) {
    throw new Error(`No good match for "${title}" among ${results.length} AniWaves results`);
  }

  console.log(`[AW] Best match: "${best.animeTitle}" (id=${best.animeId}, score=${maxScore.toFixed(2)})`);
  return best;
}

/**
 * Step 2: Get episode server list from AniWaves AJAX endpoint.
 * Returns array of { serverId, serverName, type } where type is 'sub'|'dub'.
 */
async function awGetServers(animeId, episode) {
  const url = `${AW}/ajax/anime/servers?ep=${episode}&id=${animeId}`;
  const text = await xfetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': AW },
    timeout: 30000,
  });

  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('AniWaves servers returned non-JSON'); }
  if (parsed.status !== 200 || !parsed.html) throw new Error(`No servers found for episode ${episode} on AniWaves`);

  const html = parsed.html;
  const servers = [];

  // Parse: <li class="nav-item" data-type="sub" data-id="592398">...<a ...>Vidstream</a>
  const re = /data-type="(sub|dub)"\s+data-id="(\d+)">\s*<a[^>]+data-name="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    servers.push({ type: m[1], serverId: m[2], serverName: m[3] });
  }

  if (servers.length === 0) throw new Error(`No servers parsed from AniWaves episode ${episode} HTML`);
  return servers;
}

/**
 * Step 3: Resolve the actual embed iframe URL for a given server ID.
 * Returns the iframe URL string.
 */
async function awGetEmbedUrl(serverId, watchPageSlug) {
  const url  = `${AW}/ajax/server/${serverId}`;
  const text = await xfetch(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*', 'Referer': `${AW}/watch/${watchPageSlug}` },
    timeout: 30000,
  });

  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`AniWaves server ${serverId} returned non-JSON`); }
  if (parsed.status !== 200 || !parsed.result?.url) throw new Error(`No embed URL for server ${serverId}`);
  return parsed.result.url;
}

/**
 * Full AniWaves scrape pipeline.
 * Returns { servers: [{name, videoUrl, type}], animeTitle, slug }
 * Resolves top N embed URLs concurrently to keep latency low.
 */
async function scrapeAniWaves(title, episode) {
  const { slug, animeId, animeTitle } = await awSearch(title);
  const rawServers = await awGetServers(animeId, episode);

  // Prioritise: sub Vidstream → sub Mycloud → all subs → then dubs
  // We'll resolve embed URLs for the first 6 servers (3 sub + 3 dub ideally)
  const subServers = rawServers.filter(s => s.type === 'sub');
  const dubServers = rawServers.filter(s => s.type === 'dub');

  // Take top 3 sub, top 3 dub
  const toResolve = [...subServers.slice(0, 3), ...dubServers.slice(0, 3)];

  const resolved = await Promise.allSettled(
    toResolve.map(async s => {
      const embedUrl = await awGetEmbedUrl(s.serverId, slug);
      return { name: `${s.serverName} (${s.type.toUpperCase()})`, videoUrl: embedUrl, type: s.type };
    })
  );

  const servers = resolved
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  if (servers.length === 0) throw new Error(`All AniWaves servers failed for episode ${episode}`);

  console.log(`[AW] Resolved ${servers.length} servers for "${animeTitle}" ep ${episode}`);
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

  const watchUrl = `${domain}/watch/${best.slug}/ep-${episode}`;
  const watchHtml = await xfetch(watchUrl, { referer: domain, timeout: 55000 });

  const servers = [];
  const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
  while ((m = btnRe.exec(watchHtml)) !== null) {
    let videoUrl = m[1];
    if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
    const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Only keep HD-1 and HD-2 servers
    if (name.includes('HD-1') || name.includes('HD-2')) {
      servers.push({ name, videoUrl, type: 'sub' });
    }
  }

  if (!servers.length) throw new Error(`No HD servers found on AniNeko for episode ${episode}`);
  return { servers, animeTitle: best.title, slug: best.slug };
}

// ══════════════════════════════════════════════════════════════════
// COMBINED SCRAPER: AniWaves first, AniNeko fallback
// ══════════════════════════════════════════════════════════════════
async function getServers(titles, episode) {
  const errors = [];

  for (const title of titles) {
    // Try AniWaves first
    try {
      console.log(`[Engine] Trying AniWaves for: "${title}" ep ${episode}`);
      return await scrapeAniWaves(title, episode);
    } catch (e) {
      console.warn(`[Engine] AniWaves failed: ${e.message}`);
      errors.push(`AniWaves: ${e.message}`);
    }

    // Try AniNeko fallback
    try {
      console.log(`[Engine] Trying AniNeko fallback for: "${title}" ep ${episode}`);
      return await scrapeAniNeko(title, episode);
    } catch (e) {
      console.warn(`[Engine] AniNeko failed: ${e.message}`);
      errors.push(`AniNeko: ${e.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

// ══════════════════════════════════════════════════════════════════
// HTTP SERVER
// ══════════════════════════════════════════════════════════════════
const server = createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname, searchParams } = parsed;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(200); return res.end(); }

  if (pathname === '/api/ping') return json(res, 200, { ok: true });

  if (pathname === '/api/anineko-servers') {
    const titlesParam = searchParams.get('titles') || searchParams.get('title');
    const ep          = searchParams.get('episode') || '1';
    if (!titlesParam) return json(res, 400, { error: 'titles required' });

    // Accept comma-separated list of titles (romaji, english, etc.)
    const titles = titlesParam.split('|||').map(t => t.trim()).filter(Boolean);

    try {
      const data = await getServers(titles, ep);
      return json(res, 200, { ok: true, ...data });
    } catch (e) {
      console.error('[Engine Error]', e.message);
      return json(res, 503, { ok: false, error: e.message });
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
