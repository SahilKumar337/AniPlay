import os
import re
import time
import urllib.parse
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional

import httpx
from fastapi import FastAPI, Request, Query, Header, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from app.models import AnimeServersResponse, Server, Subtitle, ErrorResponse
from app.cache import search_cache, episode_cache, server_cache, stream_cache
from app.scraper import (
    scrape_animepahe,
    scrape_anineko,
    scrape_aniwaves,
    resolve_server_m3u8,
    resolve_kwik_mp4,
    UA,
    GLOBAL_COOKIES
)

logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

# Global async client for proxying connections efficiently
http_client: Optional[httpx.AsyncClient] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    # Limit connections to prevent memory issues on free tier
    limits = httpx.Limits(max_keepalive_connections=50, max_connections=100)
    http_client = httpx.AsyncClient(limits=limits, follow_redirects=True, timeout=30.0)
    yield
    await http_client.aclose()

app = FastAPI(title="Personal Anime API", lifespan=lifespan)

# Allow all CORS origins for mobile apps/web players
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Key Validation Helper
def verify_api_key(request: Request):
    env_key = os.environ.get("API_KEY")
    if not env_key:
        return
        
    # Check headers and query params
    request_key = request.headers.get("x-api-key") or request.query_params.get("api_key")
    if request_key != env_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid or missing API key"
        )


# ── Health Check ──

@app.get("/api/ping")
@app.get("/health")
async def health():
    return {"status": "ok", "ok": True}


# ── Cookie Management Endpoints ──

@app.get("/api/set-cookies")
@app.post("/api/set-cookies")
async def set_cookies(
    request: Request,
    domain: str = Query(...), # "animepahe", "aniwaves", or "anineko"
    cookies: str = Query(...)
):
    verify_api_key(request)
    if domain in GLOBAL_COOKIES:
        GLOBAL_COOKIES[domain] = cookies
        logger.info(f"[Cookie API] Dynamically set cookies for {domain}")
        return {"ok": True, "message": f"Successfully updated cookies for {domain}"}
    return JSONResponse(status_code=400, content={"ok": False, "error": f"Invalid domain: {domain}"})

@app.get("/api/get-cookies")
async def get_cookies(request: Request):
    verify_api_key(request)
    return {
        "ok": True,
        "cookies": {k: f"{v[:20]}... ({len(v)} chars)" if v else "" for k, v in GLOBAL_COOKIES.items()}
    }


# ── Standalone Stream Extractor Endpoint ──

@app.get("/api/extract-stream")
async def extract_stream(
    request: Request,
    url: str = Query(...)
):
    verify_api_key(request)
    try:
        proto = request.headers.get("x-forwarded-proto")
        if not proto:
            host_header = request.headers.get("host", "")
            is_local = any(x in host_header for x in ["localhost", "127.0.0.1", "192.168.", "10.", "172."])
            proto = "http" if is_local else "https"
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "my-anime-api.hf.space"
        self_base = f"{proto}://{host}"
        api_key_param = f"&api_key={urllib.parse.quote(os.environ.get('API_KEY'))}" if os.environ.get("API_KEY") else ""

        # Kwik direct MP4 extraction handler
        if "kwik" in url:
            mp4_url = await resolve_kwik_mp4(url)
            if mp4_url:
                proxied = f"{self_base}/api/stream/segment?url={urllib.parse.quote(mp4_url)}&referer={urllib.parse.quote('https://kwik.cx/')}{api_key_param}"
                return {"ok": True, "url": proxied, "rawUrl": mp4_url}
            else:
                return JSONResponse(status_code=502, content={"ok": False, "error": "No video stream found in kwik embed"})

        # Standard m3u8 extraction handler (e.g. Nekosama/AniNeko panels)
        m3u8_url = await resolve_server_m3u8(url)
        if m3u8_url:
            try:
                parsed_url = urllib.parse.urlparse(url)
                referer = f"{parsed_url.scheme}://{parsed_url.netloc}"
            except Exception:
                referer = ""
            proxied = f"{self_base}/api/stream/hls?url={urllib.parse.quote(m3u8_url)}&referer={urllib.parse.quote(referer)}{api_key_param}"
            return {"ok": True, "url": proxied, "rawUrl": m3u8_url}
        else:
            return JSONResponse(status_code=502, content={"ok": False, "error": "No m3u8 stream found in iframe content"})
    except Exception as e:
        logger.error(f"[Extract Stream Error] {str(e)}")
        return JSONResponse(status_code=502, content={"ok": False, "error": str(e)})


# ── Anime Servers Aggregator Endpoint ──

@app.get("/api/anineko-servers", response_model=AnimeServersResponse)
@app.get("/api/servers", response_model=AnimeServersResponse)
async def get_anime_servers(
    request: Request,
    titles: Optional[str] = Query(None),
    title: Optional[str] = Query(None),
    episode: str = "1",
    nocache: bool = False,
    bypass: bool = False
):
    verify_api_key(request)
    
    raw_titles = titles or title
    if not raw_titles:
        raise HTTPException(status_code=400, detail="valid title or titles query parameter required")
        
    # Process title parameters (support pipe separation)
    title_list = [t.strip() for t in raw_titles.split("|||") if t.strip()]

    cache_key = f"{title_list[0]}-{episode}"
    no_cache_flag = nocache or bypass

    if no_cache_flag:
        if cache_key in server_cache:
            del server_cache[cache_key]
            logger.info(f"[Cache Bypass] Cleared server cache for: '{cache_key}'")

    # Check cache
    if not no_cache_flag and cache_key in server_cache:
        logger.info(f"[Cache Hit] Serving cached servers for: '{cache_key}'")
        return server_cache[cache_key]

    errors = []

    # Scraper task wrappers with specific timeouts
    async def run_neko():
        for t in title_list:
            # Skip Japanese characters for AniNeko search
            if any(ord(c) > 0x3000 for c in t):
                continue
            try:
                logger.info(f"[Engine] AniNeko trying: '{t}' ep {episode}")
                data = await scrape_anineko(t, int(episode))
                if data and data.get("servers"):
                    return data
            except Exception as e:
                logger.warning(f"[Engine] AniNeko failed for '{t}': {str(e)}")
                errors.append(f"AN[{t[:30]}]: {str(e)}")
        return None

    async def run_waves():
        for t in title_list:
            try:
                logger.info(f"[Engine] AniWaves trying: '{t}' ep {episode}")
                data = await scrape_aniwaves(t, int(episode))
                if data and data.get("servers"):
                    return data
            except Exception as e:
                logger.warning(f"[Engine] AniWaves failed for '{t}': {str(e)}")
                errors.append(f"AW[{t[:30]}]: {str(e)}")
        return None

    async def run_pahe():
        for t in title_list:
            if any(ord(c) > 0x3000 for c in t):
                continue
            try:
                logger.info(f"[Engine] AnimePahe trying: '{t}' ep {episode}")
                data = await scrape_animepahe(t, int(episode))
                if data and data.get("servers"):
                    return data
            except Exception as e:
                logger.warning(f"[Engine] AnimePahe failed for '{t}': {str(e)}")
                errors.append(f"AP[{t[:30]}]: {str(e)}")
        return None

    # Execute all scrapers concurrently
    # Neko timeout: 12s, Waves timeout: 20s, Pahe timeout: 35s
    try:
        neko_res, waves_res, pahe_res = await asyncio.gather(
            asyncio.wait_for(run_neko(), timeout=12.0),
            asyncio.wait_for(run_waves(), timeout=20.0),
            asyncio.wait_for(run_pahe(), timeout=35.0),
            return_exceptions=True
        )
    except Exception as e:
        logger.error(f"[Engine Error] Scraper run raised exception: {str(e)}")
        neko_res, waves_res, pahe_res = None, None, None

    # Extract successful results
    neko_data = neko_res if isinstance(neko_res, dict) else None
    waves_data = waves_res if isinstance(waves_res, dict) else None
    pahe_data = pahe_res if isinstance(pahe_res, dict) else None

    combined_servers = []

    # 1. AnimePahe servers
    if pahe_data and pahe_data.get("servers"):
        for s in pahe_data["servers"]:
            combined_servers.append(s)

    # 2. AniNeko servers
    if neko_data and neko_data.get("servers"):
        for s in neko_data["servers"]:
            combined_servers.append({
                "name": f"Neko {s['name']}",
                "videoUrl": s["videoUrl"],
                "type": s["type"],
                "subtitles": s.get("subtitles", [])
            })

    # 3. AniWaves servers
    if waves_data and waves_data.get("servers"):
        for s in waves_data["servers"]:
            combined_servers.append({
                "name": f"Waves {s['name']}",
                "videoUrl": s["videoUrl"],
                "type": s["type"],
                "subtitles": s.get("subtitles", [])
            })

    if not combined_servers:
        error_msg = " | ".join(errors) if errors else "No stream servers could be parsed from any providers"
        logger.error(f"[Engine Error] Combined search returned empty. Details: {error_msg}")
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": error_msg}
        )

    # Determine titles and slugs
    resolved_title = (
        (pahe_data and pahe_data.get("animeTitle")) or 
        (neko_data and neko_data.get("animeTitle")) or 
        (waves_data and waves_data.get("animeTitle")) or 
        title_list[0]
    )
    resolved_slug = (
        (pahe_data and pahe_data.get("slug")) or 
        (neko_data and neko_data.get("slug")) or 
        (waves_data and waves_data.get("slug")) or 
        ""
    )

    is_partial = not neko_data or not waves_data or not pahe_data

    # Dynamic stream resolver: scan embedded iframe pages for native .m3u8 urls
    logger.info(f"[Engine] Resolving HLS streams for {len(combined_servers)} servers...")
    
    # Re-calculate absolute base server URL
    proto = request.headers.get("x-forwarded-proto")
    if not proto:
        host_header = request.headers.get("host", "")
        is_local = any(x in host_header for x in ["localhost", "127.0.0.1", "192.168.", "10.", "172."])
        proto = "http" if is_local else "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "my-anime-api.hf.space"
    self_base = f"{proto}://{host}"
    api_key_param = f"&api_key={urllib.parse.quote(os.environ.get('API_KEY'))}" if os.environ.get("API_KEY") else ""

    async def resolve_m3u8_for_server(s):
        # Do not scan our own relative API paths, but prefix them with self_base
        if s["videoUrl"].startswith("/api/"):
            s_copy = dict(s)
            sep = "&" if "?" in s_copy["videoUrl"] else "?"
            s_copy["videoUrl"] = f"{self_base}{s_copy['videoUrl']}{sep}{api_key_param.lstrip('&')}" if api_key_param else f"{self_base}{s_copy['videoUrl']}"
            return s_copy
            
        m3u8_url = await resolve_server_m3u8(s["videoUrl"])
        if m3u8_url:
            try:
                parsed_video_url = urllib.parse.urlparse(s["videoUrl"])
                referer = f"{parsed_video_url.scheme}://{parsed_video_url.netloc}"
            except Exception:
                referer = ""
            # Wrap in our HLS playlist proxy
            proxied_url = f"{self_base}/api/stream/hls?url={urllib.parse.quote(m3u8_url)}&referer={urllib.parse.quote(referer)}{api_key_param}"
            return {
                "name": s["name"],
                "videoUrl": proxied_url,
                "type": s["type"],
                "subtitles": s.get("subtitles", []),
                "isHLS": True
            }
        return s

    resolved_servers = await asyncio.gather(*(resolve_m3u8_for_server(s) for s in combined_servers))

    result = {
        "ok": True,
        "servers": resolved_servers,
        "animeTitle": resolved_title,
        "slug": resolved_slug,
        "isPartial": is_partial
    }

    # Cache successful and complete resolved lists
    if not is_partial:
        server_cache[cache_key] = result
        logger.info(f"[Cache Store] Stored complete results for '{cache_key}'")
    else:
        logger.info(f"[Cache Control] Skipped caching incomplete results for '{cache_key}'")

    return result


# ── HLS Playlist Proxy ──

@app.get("/api/stream/hls")
async def stream_hls(
    request: Request,
    url: str = Query(...),
    referer: str = ""
):
    verify_api_key(request)
    
    if not referer:
        try:
            referer = f"{urllib.parse.urlparse(url).scheme}://{urllib.parse.urlparse(url).netloc}"
        except Exception:
            referer = ""

    headers = {"User-Agent": UA}
    needs_referer = any(x in url or x in referer for x in ["echovideo.ru", "aniwaves.ru", "play.echovideo.ru", "myvidplay.com", "vidplay.online", "sb1254w9megshle.org", "mcloud.to", "filemoon.sx", "streamwish.to", "vidmoly.to"])
    if needs_referer:
        headers["Referer"] = referer
        try:
            headers["Origin"] = f"{urllib.parse.urlparse(referer).scheme}://{urllib.parse.urlparse(referer).netloc}"
        except Exception:
            pass

    try:
        resp = await http_client.get(url, headers=headers, follow_redirects=True)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"HLS source returned HTTP {resp.status_code}")
        
        raw_m3u8 = resp.text
        base_url = url[:url.rfind("/") + 1]

        # Read host strings for absolute URLs
        proto = request.headers.get("x-forwarded-proto")
        if not proto:
            host_header = request.headers.get("host", "")
            is_local = any(x in host_header for x in ["localhost", "127.0.0.1", "192.168.", "10.", "172."])
            proto = "http" if is_local else "https"
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "my-anime-api.hf.space"
        self_base = f"{proto}://{host}"
        api_key_param = f"&api_key={urllib.parse.quote(os.environ.get('API_KEY'))}" if os.environ.get("API_KEY") else ""

        parsed_lines = []
        for line in raw_m3u8.splitlines():
            line = line.strip()
            if not line:
                continue
                
            if line.startswith("#"):
                if line.startswith("#EXT-X-KEY:"):
                    # Proxy the encryption key
                    match = re.search(r'URI="([^"]+)"', line)
                    if match:
                        key_url = match.group(1)
                        if not key_url.startswith("http"):
                            key_url = urllib.parse.urljoin(base_url, key_url)
                        proxied_key = f"{self_base}/api/stream/segment?url={urllib.parse.quote(key_url)}&referer={urllib.parse.quote(referer)}{api_key_param}"
                        line = line.replace(match.group(1), proxied_key)
                parsed_lines.append(line)
            else:
                # Resolve relative segment URLs
                absolute_url = line
                if not absolute_url.startswith("http"):
                    absolute_url = urllib.parse.urljoin(base_url, absolute_url)

                if ".m3u8" in absolute_url:
                    hls_url = f"{self_base}/api/stream/hls?url={urllib.parse.quote(absolute_url)}&referer={urllib.parse.quote(referer)}{api_key_param}"
                    parsed_lines.append(hls_url)
                else:
                    # Hybrid Proxying:
                    # Direct play for Neko CDN segments (saves bandwidth)
                    is_neko_segment = any(domain in absolute_url for domain in [
                        "ibyteimg.com", "vivibebe.site", "bibiemb.xyz", "anizara.store"
                    ])
                    if is_neko_segment:
                        parsed_lines.append(absolute_url)
                    else:
                        # Proxy Waves segments that require referrer keys
                        segment_url = f"{self_base}/api/stream/segment?url={urllib.parse.quote(absolute_url)}&referer={urllib.parse.quote(referer)}{api_key_param}"
                        parsed_lines.append(segment_url)

        return StreamingResponse(
            content=iter(["\n".join(parsed_lines)]),
            media_type="application/vnd.apple.mpegurl"
        )
    except Exception as e:
        logger.error(f"[HLS Proxy Error] Failed to stream HLS: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ── HLS Segment Proxy (Bandwidth-Optimized Byte Stream) ──

@app.get("/api/stream/segment")
async def stream_segment(
    request: Request,
    url: str = Query(...),
    referer: str = ""
):
    verify_api_key(request)
    
    if not referer:
        try:
            referer = f"{urllib.parse.urlparse(url).scheme}://{urllib.parse.urlparse(url).netloc}"
        except Exception:
            referer = ""

    headers = {
        "User-Agent": UA,
        "Referer": referer,
    }
    try:
        headers["Origin"] = f"{urllib.parse.urlparse(referer).scheme}://{urllib.parse.urlparse(referer).netloc}"
    except Exception:
        pass

    async def generate_chunks():
        try:
            async with http_client.stream("GET", url, headers=headers, timeout=15.0, follow_redirects=True) as resp:
                if resp.status_code >= 400:
                    yield b""
                    return
                async for chunk in resp.iter_bytes(chunk_size=65536):
                    yield chunk
        except Exception as e:
            logger.error(f"[Segment Chunks Error] Failed: {str(e)}")
            yield b""

    resp_headers = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400"
    }

    return StreamingResponse(
        generate_chunks(),
        media_type="video/mp2t",
        headers=resp_headers
    )


# ── Subtitle WebVTT to JSON Parser Proxy ──

@app.get("/api/stream/subtitle")
async def stream_subtitle(
    request: Request,
    url: str = Query(...)
):
    verify_api_key(request)
    
    try:
        resp = await http_client.get(url, headers={"User-Agent": UA}, follow_redirects=True)
        resp.raise_for_status()
        text = resp.text
        
        # Parse WebVTT content to JSON cues
        cues = []
        lines = text.replace("\r\n", "\n").split("\n")
        
        current_cue = None
        time_regex = re.compile(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})')
        short_time_regex = re.compile(r'(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})')

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            match = time_regex.match(line_str)
            is_short = False
            if not match:
                match = short_time_regex.match(line_str)
                is_short = True

            if match:
                if current_cue:
                    cues.append(current_cue)

                if is_short:
                    start_mins = int(match.group(1))
                    start_sec = int(match.group(2))
                    start_ms = int(match.group(3))
                    start_secs = start_mins * 60 + start_sec + (start_ms / 1000.0)

                    end_mins = int(match.group(4))
                    end_sec = int(match.group(5))
                    end_ms = int(match.group(6))
                    end_secs = end_mins * 60 + end_sec + (end_ms / 1000.0)
                else:
                    start_hrs = int(match.group(1))
                    start_mins = int(match.group(2))
                    start_sec = int(match.group(3))
                    start_ms = int(match.group(4))
                    start_secs = start_hrs * 3600 + start_mins * 60 + start_sec + (start_ms / 1000.0)

                    end_hrs = int(match.group(5))
                    end_mins = int(match.group(6))
                    end_sec = int(match.group(7))
                    end_ms = int(match.group(8))
                    end_secs = end_hrs * 3600 + end_mins * 60 + end_sec + (end_ms / 1000.0)

                current_cue = {
                    "startTime": start_secs,
                    "endTime": end_secs,
                    "text": ""
                }
            elif current_cue and not line_str.startswith("WEBVTT") and not line_str.isdigit():
                current_cue["text"] += ("\n" if current_cue["text"] else "") + line_str

        if current_cue:
            cues.append(current_cue)

        return JSONResponse(content=cues, headers={"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        logger.error(f"[Subtitle Proxy Error] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Embed / Iframe Proxy with Injection ──

@app.get("/api/iframe-proxy")
@app.get("/api/stream/iframe-proxy")
async def iframe_proxy(
    request: Request,
    url: str = Query(...),
    referer: str = "https://aniwaves.ru/"
):
    verify_api_key(request)
    
    try:
        # Determine cookies to send
        domain_key = "animepahe" if "animepahe" in url else ("aniwaves" if "aniwaves" in url else "anineko")
        req_headers = {"User-Agent": UA, "Referer": referer}
        if GLOBAL_COOKIES.get(domain_key):
            req_headers["Cookie"] = GLOBAL_COOKIES[domain_key]

        resp = await http_client.get(url, headers=req_headers, follow_redirects=True)
        
        # Capture and update dynamic cookies
        set_cookies = resp.headers.get_list("set-cookie")
        if set_cookies:
            cookie_pairs = [c.split(";")[0].strip() for c in set_cookies if c.split(";")[0].strip()]
            if cookie_pairs:
                new_cookies = "; ".join(cookie_pairs)
                if GLOBAL_COOKIES.get(domain_key):
                    GLOBAL_COOKIES[domain_key] = f"{GLOBAL_COOKIES[domain_key]}; {new_cookies}"
                else:
                    GLOBAL_COOKIES[domain_key] = new_cookies
                logger.info(f"[Cookie Capture Iframe] Updated {domain_key} cookies.")
        
        html = resp.text
        
        # Append cache buster to scripts & styles to force refresh
        cb = int(time.time() * 1000)
        html = re.sub(r'(<script[^>]+src=["\'])([^"\']+\.js)(["\'])', rf'\1\2?_cb={cb}\3', html, flags=re.IGNORECASE)
        html = re.sub(r'(<link[^>]+href=["\'])([^"\']+\.css)(["\'])', rf'\1\2?_cb={cb}\3', html, flags=re.IGNORECASE)

        parsed_url = urllib.parse.urlparse(url)
        embed_origin = f"{parsed_url.scheme}://{parsed_url.netloc}"

        # Script that intercepts fetch / XMLHttpRequests / Media src attributes in the browser frame
        # and emits NATIVE_STREAM_URL to the parent window
        injected_script = f"""
<script>
  (function() {{
    var EMBED_ORIGIN = '{embed_origin}';

    var _sentUrls = new Set();
    function checkAndSend(src) {{
      if (!src || typeof src !== 'string' || _sentUrls.has(src)) return;
      var absoluteUrl = src;
      try {{ absoluteUrl = new URL(src, EMBED_ORIGIN + '/').href; }} catch(e) {{}}
      if (absoluteUrl.includes('.m3u8') || absoluteUrl.includes('.mp4')) {{
        _sentUrls.add(src);
        console.log('[Iframe Interceptor] Stream URL:', absoluteUrl.slice(0, 120));
        window.parent.postMessage({{ type: 'NATIVE_STREAM_URL', url: absoluteUrl }}, '*');
      }}
    }}

    function rewriteApiUrl(url) {{
      if (!url || typeof url !== 'string') return url;
      if (url.startsWith('/api/getSources') || url.startsWith('/ajax/getSources') ||
          url.startsWith('/api/getApiKey')  || url.startsWith('/ajax/getApiKey') ||
          url.startsWith('/api/encrypt-ajax') || url.startsWith('/encrypt-ajax')) {{
        return EMBED_ORIGIN + url;
      }}
      return url;
    }}

    var originalFetch = window.fetch;
    window.fetch = function(input, init) {{
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      url = rewriteApiUrl(url);
      checkAndSend(url);
      if (typeof input === 'string') input = url;
      return originalFetch.call(this, input, init);
    }};

    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {{
      url = rewriteApiUrl(url) || url;
      checkAndSend(url);
      return originalOpen.call(this, method, url, arguments[2], arguments[3], arguments[4]);
    }};

    var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDesc) {{
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {{
        get: srcDesc.get,
        set: function(val) {{ checkAndSend(val); return srcDesc.set.call(this, val); }},
        configurable: true
      }});
    }}

    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {{
      if (name === 'src' && (this.tagName === 'VIDEO' || this.tagName === 'SOURCE')) checkAndSend(val);
      return origSetAttr.apply(this, arguments);
    }};

    var srcDescSE = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
    if (srcDescSE) {{
      Object.defineProperty(HTMLSourceElement.prototype, 'src', {{
        get: srcDescSE.get,
        set: function(val) {{ checkAndSend(val); return srcDescSE.set.call(this, val); }},
        configurable: true
      }});
    }}

    function patchJWPlayer(jwp) {{
      if (!jwp || jwp.__anilab_patched) return;
      jwp.__anilab_patched = true;
      var origCall = jwp;
      window.jwplayer = function() {{
        var instance = origCall.apply(this, arguments);
        if (instance && instance.setup && !instance.__anilab_patched) {{
          instance.__anilab_patched = true;
          var origSetup = instance.setup.bind(instance);
          instance.setup = function(config) {{
            if (config) {{
              var sources = config.sources || (config.playlist && config.playlist[0] && config.playlist[0].sources);
              if (sources) {{
                for (var i = 0; i < sources.length; i++) {{
                  if (sources[i].file) checkAndSend(sources[i].file);
                }}
              }}
            }}
            return origSetup(config);
          }};
        }}
        return instance;
      }};
      window.jwplayer.__anilab_patched = true;
    }}

    var jwInterval = setInterval(function() {{
      if (window.jwplayer && !window.jwplayer.__anilab_patched) {{
        patchJWPlayer(window.jwplayer);
        clearInterval(jwInterval);
      }}
    }}, 100);
    setTimeout(function() {{ clearInterval(jwInterval); }}, 15000);

  }})();
</script>
"""
        html = re.sub(r'(<head[^>]*>)', r'\1' + injected_script, html, flags=re.IGNORECASE)

        return HTMLResponse(
            content=html,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store, no-cache, must-revalidate"
            }
        )
    except Exception as e:
        logger.error(f"[Iframe Proxy Error] Redirecting directly to {url} due to failure: {str(e)}")
        # Redirect client browser directly as fallback
        return HTMLResponse(
            status_code=302,
            headers={"Location": url, "Access-Control-Allow-Origin": "*"}
        )


# ── Catch-All Router to Intercept Relative Asset Requests from Iframe Proxy ──

@app.get("/{path_path:path}")
async def catch_all_relative_assets(request: Request, path_path: str):
    referer = request.headers.get("referer", "")
    
    is_iframe_ref = "/api/iframe-proxy" in referer or "/api/stream/iframe-proxy" in referer
    
    # Do not intercept registered APIs
    is_registered_api = any(
        path_path.startswith(x) for x in ["api/", "health", "docs", "openapi.json"]
    )

    if is_iframe_ref and not is_registered_api:
        # Resolve target origin from referer URL query param
        target_origin = "https://play.echovideo.ru" # default
        original_url = ""
        try:
            ref_parsed = urllib.parse.urlparse(referer)
            ref_params = urllib.parse.parse_qs(ref_parsed.query)
            if "url" in ref_params:
                original_url = ref_params["url"][0]
                parsed_orig = urllib.parse.urlparse(original_url)
                target_origin = f"{parsed_orig.scheme}://{parsed_orig.netloc}"
        except Exception:
            pass

        full_url = f"{target_origin}/{path_path}"
        if request.query_params:
            full_url += f"?{request.query_params}"

        forward_ref = original_url or "https://aniwaves.ru/"
        
        logger.info(f"[Iframe Relative Asset] Forwarding: /{path_path} -> {full_url} (Referer: {forward_ref})")

        domain_key = "animepahe" if "animepahe" in full_url else ("aniwaves" if "aniwaves" in full_url else "anineko")
        headers = {
            "User-Agent": UA,
            "Referer": forward_ref,
        }
        if GLOBAL_COOKIES.get(domain_key):
            headers["Cookie"] = GLOBAL_COOKIES[domain_key]
        if request.headers.get("accept"):
            headers["Accept"] = request.headers.get("accept")

        try:
            # Proxies resource file directly
            async def generate_chunks():
                try:
                    async with http_client.stream("GET", full_url, headers=headers) as stream_resp:
                        # Capture cookies on stream response too
                        set_cookies = stream_resp.headers.getlist("set-cookie")
                        if set_cookies:
                            cookie_pairs = [c.split(";")[0].strip() for c in set_cookies if c.split(";")[0].strip()]
                            if cookie_pairs:
                                new_cookies = "; ".join(cookie_pairs)
                                if GLOBAL_COOKIES.get(domain_key):
                                    GLOBAL_COOKIES[domain_key] = f"{GLOBAL_COOKIES[domain_key]}; {new_cookies}"
                                else:
                                    GLOBAL_COOKIES[domain_key] = new_cookies
                                logger.info(f"[Cookie Capture Asset] Updated {domain_key} cookies.")
                                
                        async for chunk in stream_resp.iter_bytes(chunk_size=65536):
                            yield chunk
                except Exception as stream_err:
                    logger.error(f"[Asset Chunks Error] {str(stream_err)}")
                    yield b""

            async with http_client.stream("GET", full_url, headers=headers) as resp:
                content_type = resp.headers.get("content-type", "application/octet-stream")
                content_length = resp.headers.get("content-length")

            resp_headers = {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=86400"
            }
            if content_length:
                resp_headers["Content-Length"] = content_length

            return StreamingResponse(
                generate_chunks(),
                media_type=content_type,
                headers=resp_headers
            )
        except Exception as e:
            logger.error(f"[Iframe Asset Error] Failed to proxy relative asset {path_path}: {str(e)}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    # Real 404
    raise HTTPException(status_code=404, detail="Not Found")
