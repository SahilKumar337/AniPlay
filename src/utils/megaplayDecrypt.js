/**
 * MegaPlay / MegaCloud / Norami / Shiora / Mikora Stream Decryptor & CDN Token Signer
 * 
 * Sources returned by /stream/getSources?id=... may contain an encrypted payload:
 * { "enc": "base64url_string..." }
 * This is encrypted with AES-256-CBC using keys embedded in the MegaPlay player.
 * 
 * Once decrypted, the stream URL (e.g. master.m3u8) on CDNs like nexabloom.top requires
 * an HMAC-SHA256 signed token parameter (?token=...) to authenticate against Cloudflare.
 * 
 * Both operations use the standard native Web Crypto API (crypto.subtle) available in
 * modern browsers, Android WebView, and Node.js.
 */

function base64urlEncode(u8) {
  let str = '';
  for (let i = 0; i < u8.length; i++) str += String.fromCharCode(u8[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToUint8Array(b64url) {
  let b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

function padBytes(str, len) {
  const enc = new TextEncoder().encode(String(str));
  const u8 = new Uint8Array(len);
  u8.set(enc.subarray(0, Math.min(len, enc.length)));
  return u8;
}

function getSubtleCrypto() {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

/**
 * Decrypts the "enc" string from MegaPlay getSources response using AES-256-CBC.
 * Returns parsed JSON object: { file: "https://..." }
 */
export async function decryptMegaPlayEnc(encStr) {
  if (!encStr || typeof encStr !== 'string') return null;

  try {
    const keyStr = "i?LMTAx0Q6,:}50U";
    const ivStr = "W0;27ToaUpl_P%'c";

    const keyBytes = padBytes(keyStr, 32);
    const ivBytes = padBytes(ivStr, 16);
    const cipherBytes = base64urlToUint8Array(encStr);

    const subtle = getSubtleCrypto();
    if (!subtle) {
      console.warn('[MegaPlayDecrypt] crypto.subtle not available');
      return null;
    }

    const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const decryptedBuf = await subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, cipherBytes);
    const decryptedText = new TextDecoder().decode(decryptedBuf);
    return JSON.parse(decryptedText);
  } catch (err) {
    console.warn('[MegaPlayDecrypt] Decryption failed:', err.message);
    return null;
  }
}

/**
 * Generates an HMAC-SHA256 CDN token and appends it to the m3u8 URL.
 * Required by CDNs like fetch.nexabloom.top to allow access to master playlists and segments.
 */
export async function signMegaPlayCdnToken(m3u8Url) {
  if (!m3u8Url || typeof m3u8Url !== 'string') return m3u8Url;
  if (/[?&]token=/.test(m3u8Url)) return m3u8Url;

  const match = m3u8Url.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if (!match) return m3u8Url;

  try {
    const cdnSecret = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
    const pathKey = match[1].toLowerCase() + '/' + match[2].toLowerCase();
    const expiry = Math.floor(Date.now() / 1000) + 7200; // 2 hours validity
    const payloadStr = `${expiry}|${pathKey}`;
    const payloadBytes = new TextEncoder().encode(payloadStr);

    const subtle = getSubtleCrypto();
    if (!subtle) return m3u8Url;

    const secretBytes = new TextEncoder().encode(cdnSecret);
    const key = await subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await subtle.sign('HMAC', key, payloadBytes);

    const token = `${base64urlEncode(payloadBytes)}.${base64urlEncode(new Uint8Array(sigBuf))}`;
    const sep = m3u8Url.includes('?') ? '&' : '?';
    return `${m3u8Url}${sep}token=${encodeURIComponent(token)}`;
  } catch (err) {
    console.warn('[MegaPlayDecrypt] Token generation failed:', err.message);
    return m3u8Url;
  }
}

/**
 * Universal resolver: takes any /stream/getSources JSON response,
 * extracts and decrypts the stream file if needed, and signs the CDN token.
 */
export async function resolveMegaPlayStream(sourcesJson) {
  if (!sourcesJson || typeof sourcesJson !== 'object') return null;

  let rawFile = sourcesJson.sources?.file ||
    (Array.isArray(sourcesJson.sources) ? sourcesJson.sources[0]?.file : null);

  // If sources.file is missing, check if encrypted payload 'enc' is present
  if (!rawFile && sourcesJson.enc) {
    const decrypted = await decryptMegaPlayEnc(sourcesJson.enc);
    if (decrypted?.file) {
      rawFile = decrypted.file;
    }
  }

  if (rawFile && typeof rawFile === 'string' && (rawFile.includes('.m3u8') || rawFile.includes('.mp4'))) {
    const signedUrl = await signMegaPlayCdnToken(rawFile);
    return signedUrl;
  }

  return null;
}
