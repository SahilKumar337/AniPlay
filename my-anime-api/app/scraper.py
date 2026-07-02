import asyncio
import re
import urllib.parse
import json
import logging
from typing import List, Dict, Any, Optional
import cloudscraper
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("scraper")
logging.basicConfig(level=logging.INFO)

# Initialize cloudscraper
scraper = cloudscraper.create_scraper(delay=2)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

# Support domains (can be overridden via ENV if necessary)
ANIWAVES_DOMAIN = "https://aniwaves.ru"
ANINEKO_DOMAIN = "https://anineko.to"
ANIMEPAHE_DOMAIN = "https://animepahe.pw"

# Global cookies map to store Cloudflare bypass cookies (cf_clearance, __cf_bm, etc.)
# Can be pre-seeded from environment variables or dynamically updated via API / capture.
import os
GLOBAL_COOKIES = {
    "animepahe": os.environ.get("ANIMEPAHE_COOKIE", ""),
    "aniwaves": os.environ.get("ANIWAVES_COOKIE", ""),
    "anineko": os.environ.get("ANINEKO_COOKIE", "")
}

# Embed providers supported for Puppeteer/iframe proxies
KNOWN_WORKING_PROVIDERS = [
    'play.echovideo.ru',
    'megacloud.club',
    'megacloud.tv',
    'rapid-cloud.co',
    'rabbitstream.net',
    'myvidplay.com',
    'sb1254w9megshle.org',
    'vidplay.online',
    'mcloud.to',
    'filemoon.sx',
    'streamwish.to',
    'vidmoly.to'
]

# Thread-safe async wrapper for cloudscraper calls
async def xfetch(url: str, referer: str = None, headers: dict = None, timeout: int = 25) -> str:
    def _fetch():
        h = {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
        }
        
        # Attach cookie if available for the specific domain
        domain_key = None
        if "animepahe" in url:
            domain_key = "animepahe"
        elif "aniwaves" in url:
            domain_key = "aniwaves"
        elif "anineko" in url:
            domain_key = "anineko"

        if domain_key and GLOBAL_COOKIES.get(domain_key):
            h['Cookie'] = GLOBAL_COOKIES[domain_key]

        if referer:
            h['Referer'] = referer
            try:
                parsed_ref = urllib.parse.urlparse(referer)
                h['Origin'] = f"{parsed_ref.scheme}://{parsed_ref.netloc}"
            except Exception:
                pass
        if headers:
            h.update(headers)
            
        r = scraper.get(url, headers=h, timeout=timeout)
        r.raise_for_status()
        return r.text

    return await asyncio.to_thread(_fetch)


# ── Title Normalisation & Scoring ──

def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[''`]", "'", s)
    s = re.sub(r'[""“”]', '"', s)
    s = s.replace('&amp;', '&').replace('&#039;', "'")
    s = re.sub(r"[^a-z0-9\s']", ' ', s)
    s = re.sub(r"\s+", ' ', s)
    return s.strip()

def extract_season(t: str) -> int:
    s = t.lower()
    m = re.search(r'\bseason\s*(\d+)\b', s)
    if m:
        return int(m.group(1))
    m = re.search(r'\b(\d+)(?:st|nd|rd|th)\s+season\b', s)
    if m:
        return int(m.group(1))
    m = re.search(r'\bpart\s*(\d+)\b', s)
    if m:
        return int(m.group(1))
    m = re.search(r'\bs(\d+)\b', s)
    if m:
        return int(m.group(1))
    
    if re.search(r'\biv\b', s): return 4
    if re.search(r'\biii\b', s): return 3
    if re.search(r'\bii\b', s): return 2
    return 1

def title_score(result_title: str, query_title: str) -> float:
    # If query is in Japanese/native script (kana/kanji), allow matching
    if any(ord(char) > 0x3000 for char in query_title):
        return 0.7

    rn = norm(result_title)
    qn = norm(query_title)

    # Hard season gate
    r_season = extract_season(rn)
    q_season = extract_season(qn)
    if r_season != q_season:
        return 0.0

    # Strip season suffix
    strip_pat = r'\b(season|part|s)\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b'
    rn_clean = re.sub(strip_pat, '', rn, flags=re.IGNORECASE).strip()
    qn_clean = re.sub(strip_pat, '', qn, flags=re.IGNORECASE).strip()

    if rn_clean == qn_clean:
        return 1.0

    q_words = [w for w in qn_clean.split() if len(w) > 1]
    r_words = [w for w in rn_clean.split() if len(w) > 1]
    if not q_words:
        return 0.5

    matched = 0
    for w in q_words:
        if w in rn_clean:
            matched += 1
            
    score = matched / len(q_words)

    # Length mismatch penalty to favor the closest length match
    if len(r_words) > len(q_words):
        score *= (len(q_words) / len(r_words))

    # Heavy penalty for unwanted tags in result title if not requested
    unwanted = ["mini", "special", "recap", "ova", "ona", "movie", "summary"]
    for tag in unwanted:
        if tag in r_words and tag not in q_words:
            score *= 0.15

    return score


# ── Helper for fallback keyword permutations ──

def get_longest_word(title: str) -> str:
    cleaned = re.sub(r'\b(?:season|part|s|ep|episode|recap|ova|ona|movie)\b', '', title, flags=re.IGNORECASE)
    words = [w for w in re.split(r'[^a-zA-Z0-9]', cleaned) if len(w) > 2]
    if not words:
        return title
    return max(words, key=len)

def get_search_queries(title: str) -> List[str]:
    # Clean the title and split into words for keyword permutations
    clean_title = re.sub(r'[^a-zA-Z0-9\s]', ' ', title)
    clean_title = re.sub(r'\s+', ' ', clean_title).strip()
    words = [w for w in clean_title.split() if len(w) > 1]

    queries = [clean_title]
    if len(words) > 1:
        queries.append(" ".join(words[:3]))
        queries.append(" ".join(words[:2]))
    queries.append(get_longest_word(title))

    # Remove duplicates preserving order
    seen = set()
    return [q for q in queries if q and not (q in seen or seen.add(q))]


# ══════════════════════════════════════════════════════════════════
# 1. ANIMEPAHE SCRAPER
# ══════════════════════════════════════════════════════════════════

async def scrape_animepahe(title: str, episode: int) -> Dict[str, Any]:
    domain = ANIMEPAHE_DOMAIN
    
    # Skip scraper immediately if no cookie is pre-seeded to prevent Cloudflare 403 blocks
    if not GLOBAL_COOKIES.get("animepahe"):
        logger.info("[AnimePahe] No cookie pre-seeded. Skipping scraper to prevent Cloudflare 403 timeouts.")
        return {"servers": [], "animeTitle": "", "slug": ""}

    search_queries = get_search_queries(title)
    results = []
    
    # 1. Search Anime
    for query in search_queries:
        logger.info(f"[AnimePahe] Searching: '{query}'")
        try:
            url = f"{domain}/api?m=search&q={urllib.parse.quote(query)}"
            resp_text = await xfetch(url, referer=domain)
            data = json.loads(resp_text)
            if data.get("data"):
                for r in data["data"]:
                    results.append({
                        "id": r.get("id"),
                        "title": r.get("title", "").strip(),
                        "session": r.get("session")
                    })
                break
        except Exception as e:
            logger.warning(f"[AnimePahe] Search failed for '{query}': {str(e)}")
            # Fail fast on Cloudflare 403 block
            if "403" in str(e) or "forbidden" in str(e).lower():
                raise e

    if not results:
        raise Exception(f"Anime '{title}' not found on AnimePahe")

    # Score candidates
    best = results[0]
    max_score = -1.0
    for r in results:
        score = title_score(r["title"], title)
        if score > max_score:
            max_score = score
            best = r

    logger.info(f"[AnimePahe] Best match: '{best['title']}' (session={best['session']})")

    # 2. Get Release List for episode
    # AnimePahe serves 30 episodes per API release page
    page = ((int(episode) - 1) // 30) + 1
    release_url = f"{domain}/api?m=release&id={best['session']}&sort=episode_asc&page={page}"
    
    try:
        release_text = await xfetch(release_url, referer=domain)
        release_data = json.loads(release_text)
    except Exception as e:
        raise Exception(f"Failed to fetch episodes for '{best['title']}': {str(e)}")

    if not release_data.get("data"):
        raise Exception(f"No episodes found for '{best['title']}' on page {page}")

    # Find exact episode
    ep_item = None
    for x in release_data["data"]:
        # episode can be float/str/int in API response (e.g. 1 or 1.5 or "1")
        try:
            if float(x.get("episode", 0)) == float(episode):
                ep_item = x
                break
        except Exception:
            continue

    if not ep_item:
        raise Exception(f"Episode {episode} not found for '{best['title']}' on page {page}")

    logger.info(f"[AnimePahe] Episode {episode} found! Session: {ep_item['session']}")

    # 3. Fetch Play HTML
    play_url = f"{domain}/play/{best['session']}/{ep_item['session']}"
    try:
        play_html = await xfetch(play_url, referer=domain)
    except Exception as e:
        raise Exception(f"Failed to fetch play page for episode {episode}: {str(e)}")

    # 4. Parse Kwik embeds
    raw_servers = []
    # Match Kwik embed pages in play page
    pattern = r'(?:href|data-src|data-video)="([^"]*kwik[^"]*)"[^>]*>([\s\S]*?)<\/(?:a|button)'
    matches = re.findall(pattern, play_html, re.IGNORECASE)
    
    for kwik_url, label_html in matches:
        # Strip HTML from label
        label = re.sub(r'<[^>]*>', '', label_html).strip()
        label = re.sub(r'\s+', ' ', label)
        raw_servers.append({"kwikUrl": kwik_url, "label": label})

    # Fallback regex if styled resolution tabs parse fails
    if not raw_servers:
        matches_fallback = re.findall(r'https://kwik\.cx/e/[a-zA-Z0-9]+', play_html)
        for link in matches_fallback:
            raw_servers.append({"kwikUrl": link, "label": "720p"})

    if not raw_servers:
        raise Exception(f"No video links resolved for episode {episode} on AnimePahe")

    # Deduplicate and proxy-format
    seen_urls = set()
    servers = []
    for s in raw_servers:
        kurl = s["kwikUrl"]
        if kurl in seen_urls:
            continue
        seen_urls.add(kurl)

        # Map to stream iframe proxy path
        proxied_iframe = f"/api/stream/iframe-proxy?url={urllib.parse.quote(kurl)}&referer={urllib.parse.quote('https://animepahe.pw/')}"
        servers.append({
            "name": f"AniHD ({s['label']})",
            "videoUrl": proxied_iframe,
            "type": "sub",
            "subtitles": []
        })

    return {"servers": servers, "animeTitle": best["title"], "slug": best["session"]}


# ══════════════════════════════════════════════════════════════════
# 2. ANINEKO SCRAPER
# ══════════════════════════════════════════════════════════════════

async def scrape_anineko(title: str, episode: int) -> Dict[str, Any]:
    domain = ANINEKO_DOMAIN
    search_queries = get_search_queries(title)
    
    results = []
    
    # 1. Search Neko
    for query in search_queries:
        if any(ord(char) > 0x3000 for char in query):
            continue # Skip Japanese titles for AniNeko
        logger.info(f"[AniNeko] Searching: '{query}'")
        try:
            search_url = f"{domain}/browser?keyword={urllib.parse.quote(query)}"
            search_html = await xfetch(search_url, referer=domain)
            
            pattern = r'<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a>'
            matches = re.findall(pattern, search_html)
            if matches:
                for slug, name in matches:
                    results.append({"slug": slug, "title": name.strip()})
                break
        except Exception as e:
            logger.warning(f"[AniNeko] Search failed for '{query}': {str(e)}")
            if "403" in str(e) or "forbidden" in str(e).lower():
                raise e

    if not results:
        raise Exception(f"Anime '{title}' not found on AniNeko")

    best = results[0]
    max_score = -1.0
    for r in results:
        score = title_score(r["title"], title)
        if score > max_score:
            max_score = score
            best = r

    logger.info(f"[AniNeko] Matched: '{best['title']}' (slug={best['slug']})")

    # 2. Collect Watch Pages (SUB + DUB fallback)
    sub_url = f"{domain}/watch/{best['slug']}/ep-{episode}"
    urls_to_fetch = [{"url": sub_url, "isDub": best["slug"].endswith("-dub")}]

    if not best["slug"].endswith("-dub"):
        dub_slug = f"{best['slug']}-dub"
        dub_url = f"{domain}/watch/{dub_slug}/ep-{episode}"
        urls_to_fetch.append({"url": dub_url, "isDub": True})

    # Concurrently fetch SUB and DUB pages
    async def fetch_page(item):
        try:
            html = await xfetch(item["url"], referer=domain)
            return {"html": html, "isDub": item["isDub"]}
        except Exception as e:
            logger.warning(f"[AniNeko] Watch page load failed for {item['url']}: {str(e)}")
            return None

    fetched_results = await asyncio.gather(*(fetch_page(x) for x in urls_to_fetch))
    fetched_results = [r for r in fetched_results if r]

    # 3. Parse Servers
    raw_servers = []
    for res_page in fetched_results:
        html = res_page["html"]
        is_dub_page = res_page["isDub"]

        # Parse panels matching sub/dub tabs
        panels = re.findall(r'<div[^>]+data-id="(sub|dub)"[\s\S]*?</div>\s*</div>', html)
        for panel_id in panels:
            # We search within panel html block
            btn_matches = re.findall(
                r'<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)</button>',
                html
            )
            for video_url, name_html in btn_matches:
                if video_url.startswith('//'):
                    video_url = 'https:' + video_url
                
                name = re.sub(r'<[^>]+>', ' ', name_html)
                name = re.sub(r'\s+', ' ', name).strip()
                
                # Check for HD-1 server
                if 'HD-1' in name:
                    is_dub = is_dub_page or panel_id == 'dub' or 'dub' in name.lower()
                    raw_servers.append({"videoUrl": video_url, "isDub": is_dub})

    # Deduplicate videoUrl
    seen_urls = set()
    unique_raw = []
    for s in raw_servers:
        if s["videoUrl"] in seen_urls:
            continue
        seen_urls.add(s["videoUrl"])
        unique_raw.append(s)

    # Construct final server objects
    servers = []
    sub_count = 0
    dub_count = 0
    for s in unique_raw:
        # Extract subtitles parameter from video URL if available
        parsed_url = urllib.parse.urlparse(s["videoUrl"])
        params = urllib.parse.parse_qs(parsed_url.query)
        
        subtitle_url = ""
        for param_key in ["sub", "caption_1", "c1_file"]:
            if param_key in params:
                subtitle_url = params[param_key][0]
                break

        subtitles = []
        if subtitle_url:
            subtitles.append({
                "id": 0,
                "label": "English",
                "file": f"/api/stream/subtitle?url={urllib.parse.quote(subtitle_url)}"
            })

        if s["isDub"]:
            if dub_count >= 1:
                continue
            dub_count += 1
            servers.append({
                "name": "HD1 (DUB)",
                "videoUrl": s["videoUrl"],
                "type": "dub",
                "subtitles": subtitles
            })
        else:
            if sub_count >= 1:
                continue
            sub_count += 1
            servers.append({
                "name": "HD1",
                "videoUrl": s["videoUrl"],
                "type": "sub",
                "subtitles": subtitles
            })

    if not servers:
        raise Exception(f"No HD servers found on AniNeko for episode {episode}")

    return {"servers": servers, "animeTitle": best["title"], "slug": best["slug"]}


# ══════════════════════════════════════════════════════════════════
# 3. ANIWAVES SCRAPER
# ══════════════════════════════════════════════════════════════════

async def aw_search(title: str) -> Dict[str, Any]:
    domain = ANIWAVES_DOMAIN
    has_japanese = any(ord(char) > 0x3000 for char in title)
    
    # Strip season patterns for keyword permutations
    cleaned = re.sub(r'\b(season|part|s)\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b', '', title, flags=re.IGNORECASE).strip()
    
    eng_words = [w for w in re.split(r'[^a-zA-Z0-9]', cleaned) if len(w) > 3 and not re.match(r'^(the|and|with|from|that|this|into|over|under|behind|you)$', w, re.IGNORECASE)]
    longest_word = max(eng_words, key=len) if eng_words else None
    
    first_two = " ".join(cleaned.split()[:2])
    first_three = " ".join(cleaned.split()[:3])

    if has_japanese:
        strategies = [title]
    else:
        strategies = [x for x in [cleaned, first_three, first_two, longest_word] if x]
        # Deduplicate preservation order
        seen = set()
        strategies = [x for x in strategies if not (x in seen or seen.add(x))]

    results = []

    for keyword in strategies:
        logger.info(f"[AW] Searching: keyword='{keyword}' (from query: '{title}')")
        try:
            url = f"{domain}/ajax/anime/search?keyword={urllib.parse.quote(keyword)}"
            raw_text = await xfetch(url, referer=domain, headers={"X-Requested-With": "XMLHttpRequest"})
            parsed = json.loads(raw_text)
            
            if parsed.get("status") == 404 or not parsed.get("result", {}).get("html"):
                continue
                
            html = parsed["result"]["html"]
            # Parse watch link list
            item_pattern = r'href="\/watch\/([\w%-]+-(\d+))"[\s\S]*?class="name d-title"[^>]*>([^<]+)<\/div>'
            items = re.findall(item_pattern, html)
            for slug, anime_id, anime_title in items:
                results.append({"slug": slug, "animeId": anime_id, "animeTitle": anime_title.strip()})
                
            # Fallback regex if display titles aren't matched
            if not results:
                slug_pattern = r'href="\/watch\/([\w-]+-(\d+))"'
                slug_matches = re.findall(slug_pattern, html)
                for slug, anime_id in slug_matches:
                    clean_slug_name = re.sub(r'-\d+$', '', slug).replace('-', ' ')
                    results.append({"slug": slug, "animeId": anime_id, "animeTitle": clean_slug_name})
                    
            if results:
                break
        except Exception as e:
            logger.warning(f"[AW] Search failed for keyword '{keyword}': {str(e)}")
            if "403" in str(e) or "forbidden" in str(e).lower():
                raise e

    if not results:
        raise Exception(f"Anime '{title}' not found on AniWaves")

    # Score and select best match
    best = results[0]
    max_score = -1.0
    for r in results:
        score = title_score(r["animeTitle"], title)
        
        # Romaji query matching using slug text
        slug_text = re.sub(r'-\d+$', '', r["slug"]).replace('-', ' ')
        slug_score = title_score(slug_text, title)
        score = max(score, slug_score)
        
        logger.info(f"[AW] Candidate: '{r['animeTitle']}' (slug: {r['slug']}) score={score:.2f}")
        if score > max_score:
            max_score = score
            best = r

    # Threshold gate fallback
    if max_score == 0.0 and len(results) <= 2:
        max_score = 0.4
        best = results[0]

    if max_score == 0.0:
        raise Exception(f"No confident match for '{title}' ({len(results)} candidates on AniWaves)")

    logger.info(f"[AW] Best match: '{best['animeTitle']}' (id={best['animeId']}, score={max_score:.2f})")
    return best

async def aw_get_servers(anime_id: str, episode: int, slug: str) -> List[Dict[str, Any]]:
    domain = ANIWAVES_DOMAIN
    url = f"{domain}/ajax/server/list?servers={anime_id}&eps={episode}"
    referer = f"{domain}/watch/{slug}" if slug else domain

    for attempt in range(1, 4):
        try:
            text = await xfetch(url, referer=referer, headers={"X-Requested-With": "XMLHttpRequest"})
            if not text or not text.strip():
                raise Exception("Empty servers response")
            parsed = json.loads(text)
            if parsed.get("status") != 200 or not parsed.get("result"):
                raise Exception(f"Server error status {parsed.get('status')}")
            
            html = parsed["result"]
            servers = []
            
            # Parse sections (sub vs dub)
            sections = re.findall(r'<div class="type" data-type="(sub|dub)">([\s\S]+?)<\/div>', html)
            for type_val, section_html in sections:
                li_matches = re.findall(r'<li[^>]+data-link-id="([^"]+)"[^>]*>([^<]+)</li>', section_html)
                for link_id, server_name in li_matches:
                    servers.append({
                        "type": type_val,
                        "linkId": link_id,
                        "serverName": server_name.strip()
                    })
            return servers
        except Exception as e:
            if attempt == 3:
                raise e
            await asyncio.sleep(attempt)
            
    return []

async def aw_get_embed_url(link_id: str, slug: str) -> str:
    domain = ANIWAVES_DOMAIN
    url = f"{domain}/ajax/sources?id={urllib.parse.quote(link_id)}&asi=0&autoPlay=0"
    text = await xfetch(url, referer=f"{domain}/watch/{slug}", headers={"X-Requested-With": "XMLHttpRequest"})
    parsed = json.loads(text)
    if parsed.get("status") != 200 or not parsed.get("result", {}).get("url"):
        raise Exception("Embed URL request failed")
    return parsed["result"]["url"]

async def scrape_aniwaves(title: str, episode: int) -> Dict[str, Any]:
    # 1. Search anime ID
    best_match = await aw_search(title)
    slug = best_match["slug"]
    anime_id = best_match["animeId"]
    anime_title = best_match["animeTitle"]

    # 2. Get server IDs
    raw_servers = await aw_get_servers(anime_id, episode, slug)
    sub_servers = [s for s in raw_servers if s["type"] == "sub"]
    dub_servers = [s for s in raw_servers if s["type"] == "dub"]

    # Slice top 4 of each
    to_resolve = sub_servers[:4] + dub_servers[:4]
    
    # 3. Concurrently retrieve embed URLs
    async def resolve_one(s):
        try:
            embed_url = await aw_get_embed_url(s["linkId"], slug)
            parsed_embed = urllib.parse.urlparse(embed_url)
            host = parsed_embed.hostname or ""

            # Check supported hosts
            is_supported = any(host == p or host.endswith("." + p) for p in KNOWN_WORKING_PROVIDERS)
            if not is_supported:
                logger.info(f"[AW] Skipping unsupported provider: {host} (server: {s['serverName']})")
                return None

            logger.info(f"[AW] Accepted provider: {host} (server: {s['serverName']})")
            proxied_iframe = f"/api/iframe-proxy?url={urllib.parse.quote(embed_url)}"
            return {"videoUrl": proxied_iframe, "type": s["type"]}
        except Exception as e:
            logger.warning(f"[AW] Failed to resolve server {s['serverName']}: {str(e)}")
            return None

    resolved = await asyncio.gather(*(resolve_one(s) for s in to_resolve))
    working = [w for w in resolved if w]

    # Map output sequential HD names
    servers = []
    sub_count = 0
    dub_count = 0
    for w in working:
        if w["type"] == "sub":
            if sub_count >= 1:
                continue
            sub_count += 1
            servers.append({
                "name": "Waves HD1",
                "videoUrl": w["videoUrl"],
                "type": "sub",
                "subtitles": []
            })
        else:
            if dub_count >= 1:
                continue
            dub_count += 1
            servers.append({
                "name": "Waves HD1 (DUB)",
                "videoUrl": w["videoUrl"],
                "type": "dub",
                "subtitles": []
            })

    if not servers:
        raise Exception(f"No supported streaming servers found for episode {episode} on AniWaves")

    return {"servers": servers, "animeTitle": anime_title, "slug": slug}


# ══════════════════════════════════════════════════════════════════
# 4. M3U8 STREAM RESOLVER
# ══════════════════════════════════════════════════════════════════

async def resolve_server_m3u8(video_url: str) -> Optional[str]:
    # Extract native m3u8 playlist if it is inside embed html (e.g. Nekosama pages)
    url_snippet = video_url[:70]
    try:
        parsed = urllib.parse.urlparse(video_url)
        referer = f"{parsed.scheme}://{parsed.netloc}"
        logger.info(f"[M3U8 Resolver] Resolving embed: {url_snippet}")
        
        html = await xfetch(video_url, referer=referer, timeout=5)
        
        # Regex scans for m3u8 playlists
        patterns = [
            r'const\s+src\s*=\s*[\'"]([^\'"]+\.m3u8[^\'"]*)[\'"]',
            r'var\s+src\s*=\s*[\'"]([^\'"]+\.m3u8[^\'"]*)[\'"]',
            r'[\'"]?file[\'"]?\s*:\s*[\'"]([^\'"]+\.m3u8[^\'"]*)[\'"]',
            r'sources\s*:\s*\[\s*[\'"]([^\'"]+\.m3u8[^\'"]*)[\'"]',
            r'(https?://[^\s"\'<> ]+\.m3u8(?:\?[^\s"\'<> ]*)?)'
        ]
        
        for pat in patterns:
            match = re.search(pat, html, re.IGNORECASE)
            if match:
                m3u8 = match.group(1)
                # Resolve relative URLs
                if not m3u8.startswith("http"):
                    m3u8 = urllib.parse.urljoin(video_url, m3u8)
                logger.info(f"[M3U8 Resolver] Found m3u8: {m3u8[:70]}...")
                return m3u8
                
        logger.info(f"[M3U8 Resolver] No m3u8 source found in iframe script contents.")
    except Exception as e:
        logger.warning(f"[M3U8 Resolver] Failed for {url_snippet}: {str(e)}")
    return None


# ── JS PACKER UNPACKER & KWIK MP4 RESOLVER ──

def unpack_js(packed_code: str) -> str:
    # Match the eval(function(p,a,c,k,e,d)...) block
    match = re.search(
        r"eval\(\s*function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{.*?\}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)",
        packed_code,
        re.DOTALL
    )
    if not match:
        # Try double quotes version
        match = re.search(
            r'eval\(\s*function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{.*?\}\s*\(\s*"(.*?)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"(.*?)"\.split\("\|"\)',
            packed_code,
            re.DOTALL
        )
    if not match:
        return ""
        
    p, a, c, k = match.groups()
    a = int(a)
    c = int(c)
    words = k.split('|')
    
    # We need to map base_n representations
    def base_n(num, base):
        chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if num == 0:
            return "0"
        res = []
        while num:
            res.append(chars[num % base])
            num //= base
        return "".join(reversed(res))
        
    for i in range(c - 1, -1, -1):
        if i < len(words) and words[i]:
            val = words[i]
            # Replace word token
            tok = base_n(i, a)
            p = re.sub(r'\b' + re.escape(tok) + r'\b', val, p)
            
    return p


async def resolve_kwik_mp4(kwik_url: str) -> Optional[str]:
    url_snippet = kwik_url[:70]
    try:
        logger.info(f"[Kwik Resolver] Resolving embed: {url_snippet}")
        # kwik requires Referer: https://animepahe.pw/ to access the page!
        html = await xfetch(kwik_url, referer="https://animepahe.pw/")
        
        # Unpack Javascript
        unpacked = unpack_js(html)
        if not unpacked:
            logger.warning("[Kwik Resolver] Failed to unpack JS packer from HTML.")
            # Fallback to direct regex if not packed
            unpacked = html
            
        # Extract direct mp4 link
        match = re.search(r'const\s+source\s*=\s*[\'"]([^\'"]+mp4[^\'"]*)[\'"]', unpacked, re.IGNORECASE)
        if not match:
            match = re.search(r'source\s*=\s*[\'"]([^\'"]+mp4[^\'"]*)[\'"]', unpacked, re.IGNORECASE)
        if not match:
            match = re.search(r'[\'"](https?://[^\s"\'<> ]+?\.mp4(?:\?[^\s"\'<> ]*)?)[\'"]', unpacked, re.IGNORECASE)
            
        if match:
            mp4_url = match.group(1)
            logger.info(f"[Kwik Resolver] Resolved direct MP4: {mp4_url[:70]}...")
            return mp4_url
            
        logger.warning("[Kwik Resolver] No MP4 link found in unpacked Javascript.")
    except Exception as e:
        logger.error(f"[Kwik Resolver] Failed for {url_snippet}: {str(e)}")
    return None

