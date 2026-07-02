---
title: AniLab Backend
emoji: 🚀
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Personal Anime API

FastAPI backend designed for deployment on Hugging Face Spaces (using the Docker SDK template) to replicate instant anime playback features.

## Core Features
1. **Multi-Source Scraping:** Concurrently searches and scrapes AnimePahe, AniNeko ("neko"), and AniWaves ("waves").
2. **HLS/m3u8 Resolving & Proxying:** Scrapes direct `.m3u8` video files and proxies them to bypass strict referrer checks and CORS.
3. **Smart Client-Side Embed Interception:** Bypasses Cloudflare blockages on embed servers (like Vidplay/MegaCloud) by serving iframe wrappers that inject a script. The browser (using the user's residential IP) performs the `getSources` calls directly and sends the stream back via `postMessage`.
4. **Aggressive In-Memory Caching:** Heavy caching on search results, episode listings, and resolved media stream links to ensure sub-second response times.

## Local Development
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the application:
   ```bash
   uvicorn app.main:app --reload --port 7860
   ```

## Deploying to Hugging Face Spaces
1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) and click **Create a new Space**.
2. Set Space SDK to **Docker** (choose the blank template).
3. Push these repository files to your Space's repository. Hugging Face will automatically build and start the container.
4. (Optional) Set the `API_KEY` environment variable in the Space Settings page to require credentials.
