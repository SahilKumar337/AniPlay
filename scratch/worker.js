/**
 * Cloudflare Worker HLS Proxy
 * Bypasses CORS and rewrites HLS manifests (.m3u8) so segments load with 
 * correct Referer/Origin headers.
 * To Deploy: Paste this code into a new Cloudflare Worker on your Cloudflare dashboard.
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight OPTIONS requests immediately
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return new Response('AniLab Stream Engine HLS Proxy Worker. Usage: /?url=TARGET_URL&referer=REFERER_URL', {
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const referer = url.searchParams.get('referer') || new URL(targetUrl).origin;
    
    // Check if we need to proxy headers
    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    
    const needsReferer = 
      targetUrl.includes('echovideo.ru') || 
      targetUrl.includes('aniwaves.ru') || 
      targetUrl.includes('play.echovideo.ru') ||
      targetUrl.includes('swiftstream.top') ||
      targetUrl.includes('animetsu.net') ||
      referer.includes('aniwaves.ru') ||
      referer.includes('echovideo.ru') ||
      referer.includes('swiftstream.top') ||
      referer.includes('animetsu.net');

    if (needsReferer) {
      headers.set('Referer', referer);
      try {
        headers.set('Origin', new URL(referer).origin);
      } catch {}
    }

    try {
      const response = await fetch(targetUrl, { headers });
      if (!response.ok) {
        return new Response(`Error: HLS source returned status ${response.status}`, { status: response.status });
      }

      // Check if it is a manifest playlist (.m3u8) to rewrite
      const contentType = response.headers.get('content-type') || '';
      const isM3U8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegurl');

      if (isM3U8) {
        const raw = await response.text();
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const selfBase = `${url.protocol}//${url.host}`;
        
        const rawLines = raw.split('\n');
        const processedLines = [];
        let lastTag = '';

        for (let i = 0; i < rawLines.length; i++) {
          let line = rawLines[i].trim();
          if (!line) {
            processedLines.push('');
            continue;
          }

          if (line.startsWith('#')) {
            lastTag = line;
            if (line.startsWith('#EXT-X-KEY:')) {
              const match = line.match(/URI="([^"]+)"/);
              if (match) {
                let keyUrl = match[1];
                if (!keyUrl.startsWith('http')) keyUrl = new URL(keyUrl, baseUrl).href;
                const proxiedKey = `${selfBase}/?url=${encodeURIComponent(keyUrl)}&referer=${encodeURIComponent(referer)}`;
                line = line.replace(match[1], proxiedKey);
              }
            }
            processedLines.push(line);
            continue;
          }

          let absoluteUrl = line;
          if (!absoluteUrl.startsWith('http')) {
            absoluteUrl = new URL(absoluteUrl, baseUrl).href;
          }

          const isSubPlaylist = lastTag.startsWith('#EXT-X-STREAM-INF') || absoluteUrl.includes('.m3u8');
          if (isSubPlaylist) {
            const hlsUrl = `${selfBase}/?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
            processedLines.push(hlsUrl);
          } else {
            // Direct CDN segments for Neko to save Cloudflare Worker bandwidth
            const isNekoSegment = 
              absoluteUrl.includes('ibyteimg.com') || 
              absoluteUrl.includes('vivibebe.site') || 
              absoluteUrl.includes('bibiemb.xyz') || 
              absoluteUrl.includes('anizara.store');

            if (isNekoSegment) {
              processedLines.push(absoluteUrl);
            } else {
              const segmentUrl = `${selfBase}/?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(referer)}`;
              processedLines.push(segmentUrl);
            }
          }
        }

        return new Response(processedLines.join('\n'), {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          }
        });
      }

      // If it is a segment/binary/key, return the body directly
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    } catch (e) {
      return new Response(`Proxy Error: ${e.message}`, { status: 500 });
    }
  }
};
