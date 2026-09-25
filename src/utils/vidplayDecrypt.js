/**
 * VidPlay / VidTube Stream Decryptor
 *
 * VidPlay (vidplay.online / vidtube.site) uses a 2-step authentication protocol:
 *
 * STEP 1: Fetch the /futoken — a rotating string key that changes periodically.
 * STEP 2: Encode the video file ID using the futoken via a character-mapping
 *         algorithm. The encoded value is passed as the `h=` parameter to getSources.
 * STEP 3: Call /getSources?id=<fileId>&h=<encoded>.
 *         Response is plain JSON: { result: { sources: [{file, type}], tracks: [] } }
 *         No AES encryption — protection is in request signing (like MegaPlay HMAC).
 */

import { CapacitorHttp, Capacitor } from '@capacitor/core';

export const VIDPLAY_DOMAINS = [
  'vidplay.online', 'vidplay.site', 'vidtube.site', 'vidtube.online',
  'vidsrc.nl', 'vidsrc.pm', 'vidsrc.me', 'filemoon.sx',
];

const futokenCache = new Map(); // domain -> { token, ts }
const FUTOKEN_TTL = 10 * 60 * 1000;

export function isVidPlayEmbed(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return VIDPLAY_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

async function vidplayFetch(url, headers = {}, timeoutMs = 5000) {
  const isNative = typeof window !== 'undefined' && Capacitor?.isNativePlatform?.();
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    ...headers,
  };

  if (isNative) {
    const resp = await CapacitorHttp.request({
      url, method: 'GET', headers: defaultHeaders,
      responseType: 'text', connectTimeout: timeoutMs, readTimeout: timeoutMs,
    });
    if (resp.status >= 200 && resp.status < 300)
      return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    throw new Error(`HTTP ${resp.status}`);
  }

  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const fetchUrl = isLocal
    ? `/api/scrape?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(headers['Referer'] || '')}`
    : url;
  const res = await fetch(fetchUrl, { headers: defaultHeaders, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchFutoken(origin, referer) {
  const cached = futokenCache.get(origin);
  if (cached && Date.now() - cached.ts < FUTOKEN_TTL) return cached.token;

  // Method 1: /futoken endpoint
  try {
    const text = await vidplayFetch(`${origin}/futoken`, { 'Referer': referer }, 4000);
    const match = text.match(/k='([^']+)'/);
    if (match?.[1]) {
      futokenCache.set(origin, { token: match[1], ts: Date.now() });
      console.log(`[VidPlay] futoken via /futoken: ${match[1].slice(0, 20)}...`);
      return match[1];
    }
    const clean = text.trim();
    if (clean && clean.length > 4 && clean.length < 200 && /^[\w,]+$/.test(clean)) {
      futokenCache.set(origin, { token: clean, ts: Date.now() });
      return clean;
    }
  } catch (e) { console.warn(`[VidPlay] /futoken fetch failed:`, e.message); }

  // Method 2: Extract from embed page JS
  try {
    const html = await vidplayFetch(`${origin}/`, { 'Referer': referer }, 4000);
    const match = html.match(/k\s*=\s*'([^']{8,})'/) ||
                  html.match(/futoken\s*=\s*"([^"]{8,})"/) ||
                  html.match(/var\s+k\s*=\s*'([^']+)'/);
    if (match?.[1]) {
      futokenCache.set(origin, { token: match[1], ts: Date.now() });
      return match[1];
    }
  } catch (_) {}

  console.warn(`[VidPlay] Could not fetch futoken for ${origin}`);
  return null;
}

/**
 * Primary VidPlay ID encoding (reverse-engineered from obfuscated player JS).
 * Each char in fileId is shifted by (sum of futoken charCodes % 256) if the
 * char appears in the futoken, else kept as-is. Result: comma-separated integers.
 */
function encodeVidPlayId(fileId, futoken) {
  if (!fileId || !futoken) return fileId;
  const futokenChars = new Set(futoken);
  let shift = 0;
  for (const ch of futoken) shift += ch.charCodeAt(0);
  shift = shift % 256;
  const result = [];
  for (const ch of fileId) {
    result.push(futokenChars.has(ch) ? (ch.charCodeAt(0) + shift) % 256 : ch.charCodeAt(0));
  }
  return result.join(',');
}

/**
 * Alternative encoding used by some VidPlay forks:
 * futoken parts are prepended, then each id char is added to the matching futoken part.
 */
function encodeVidPlayIdAlt(fileId, futoken) {
  const parts = futoken.split(',');
  const idCodes = [];
  for (let i = 0; i < fileId.length; i++) {
    const futCode = parseInt(parts[i % parts.length], 10) || 0;
    idCodes.push(futCode + fileId.charCodeAt(i));
  }
  return [...parts, ...idCodes].join(',');
}

function parseVidPlaySources(json, embedOrigin) {
  if (!json || typeof json !== 'object') return null;
  const result = json.result || json;
  const sources = result.sources || [];
  let m3u8Url = null;

  if (typeof sources === 'string') {
    m3u8Url = sources;
  } else if (Array.isArray(sources) && sources.length > 0) {
    const hls = sources.find(s => (s.file || s.url || '').includes('.m3u8'));
    m3u8Url = (hls || sources[0])?.file || (hls || sources[0])?.url || null;
  }
  if (!m3u8Url) return null;

  const tracks = result.tracks || result.subtitles || [];
  const subtitles = (Array.isArray(tracks) ? tracks : [])
    .filter(t => t.kind === 'captions' || t.kind === 'subtitles' || t.file)
    .map((t, i) => ({
      id: i,
      label: t.label || t.lang || `Track ${i + 1}`,
      file: t.file || t.url || '',
      referer: embedOrigin + '/',
      default: !!t.default,
    }));

  return { m3u8Url, subtitles };
}

/**
 * Main resolver: given a VidPlay embed URL, returns { videoUrl, subtitles, isHLS, referer }.
 * Returns null on failure (caller falls back to iframe proxy / WebView).
 */
export async function resolveVidPlayStream(embedUrl, parentReferer) {
  if (!embedUrl || !isVidPlayEmbed(embedUrl)) return null;

  try {
    const urlObj = new URL(embedUrl);
    const origin = urlObj.origin;
    const referer = parentReferer || origin + '/';

    // Extract file ID from URL path (last meaningful segment)
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const fileId = pathParts.filter(p => p.length > 4 && !/^(e|embed|v|watch|stream)$/.test(p)).pop()
      || pathParts.pop()
      || urlObj.searchParams.get('id')
      || '';

    if (!fileId) {
      console.warn('[VidPlay] Could not extract file ID from:', embedUrl);
      return null;
    }
    console.log(`[VidPlay] Resolving — fileId: "${fileId}" from ${origin}`);

    const futoken = await fetchFutoken(origin, referer);
    const encodedH = futoken ? encodeVidPlayId(fileId, futoken) : fileId;

    const tParam = urlObj.searchParams.get('t') || '';
    const subInfo = urlObj.searchParams.get('sub.info') || '';
    let apiUrl = `${origin}/getSources?id=${encodeURIComponent(fileId)}&h=${encodeURIComponent(encodedH)}`;
    if (tParam) apiUrl += `&t=${encodeURIComponent(tParam)}`;
    if (subInfo) apiUrl += `&sub.info=${encodeURIComponent(subInfo)}`;

    const apiHeaders = {
      'Referer': embedUrl, 'Origin': origin,
      'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, */*',
    };

    let apiText = '';
    try { apiText = await vidplayFetch(apiUrl, apiHeaders, 5000); }
    catch (e) { console.warn(`[VidPlay] getSources primary call failed:`, e.message); }

    // Retry with alternative encoding if primary fails
    if ((!apiText || apiText.includes('"result":false') || apiText.includes('"sources":[]')) && futoken) {
      const altH = encodeVidPlayIdAlt(fileId, futoken);
      const altUrl = `${origin}/getSources?id=${encodeURIComponent(fileId)}&h=${encodeURIComponent(altH)}`;
      try {
        const altText = await vidplayFetch(altUrl, apiHeaders, 4000);
        if (altText && !altText.includes('"result":false')) {
          apiText = altText;
          console.log('[VidPlay] Alternative encoding succeeded');
        }
      } catch (_) {}
    }

    if (!apiText) return null;

    let json;
    try { json = JSON.parse(apiText); }
    catch { console.warn('[VidPlay] JSON parse failed:', apiText.slice(0, 100)); return null; }

    const parsed = parseVidPlaySources(json, origin);
    if (!parsed?.m3u8Url) {
      console.warn('[VidPlay] No stream URL in response:', JSON.stringify(json).slice(0, 200));
      return null;
    }

    console.log(`[VidPlay] ✅ ${parsed.m3u8Url.slice(0, 80)} (${parsed.subtitles.length} subs)`);
    return {
      videoUrl: parsed.m3u8Url,
      subtitles: parsed.subtitles,
      isHLS: parsed.m3u8Url.includes('.m3u8'),
      referer: embedUrl,
    };
  } catch (err) {
    console.warn(`[VidPlay] resolveVidPlayStream failed:`, err.message);
    return null;
  }
}
