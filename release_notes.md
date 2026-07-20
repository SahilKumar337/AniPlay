# AniPlay v1.5.1 Patch Release: Servers & Matching Update 🚀

We are proud to present **AniPlay version 1.5.1**, which fixes title-matching, extends server coverage, and improves playback recovery.

---

## 🎮 1. IMMERSIVE NATIVE PLAYING & HLS ENGINE
* **Smart CDN Token Recovery**: Tapping "Retry" now fully re-instantiates the video stream player, resolving expired CDN tokens to fix mid-playback freeze crashes.
* **Standardized Servers**: Labeling standardized to AniHD and AniVid servers for stream slots.
* **Custom HLS integration**: Custom cookie and referrer loader to fetch and play protected media streams.
* **Subtitle track options**: Built-in English subtitle file parser with adjustable sub-sync controls.
* **Playback controls**: Full gesture support, speed adjustment settings, and automatic orientation lock.

## 📡 2. REDESIGNED SEARCH & SMART TITLE MATCH
* **Deep Search Filter**: Upgraded scraping engine to fetch up to 30 search results per query, ensuring main titles are never missed.
* **High-Accuracy Title Matching**: Added strict title validation and reverse-word check. If a result is missing unique words from your query, it is automatically rejected—completely preventing spinoff or movie mismatches.
* **Multi-Filter Browser**: Sort and filter titles by Genre, Season, Release Year, Dub/Sub formats, Rating, and Episode Counts.

## 📥 3. FAST SEGMENTED DOWNLOADER
* **Multi-Quality download picker**: Choose between Best, 1080p, 720p, 480p, etc. before starting downloads.
* **Parallel HLS downloader**: Segmented download engine that is up to 3x faster than traditional single-thread downloaders.
* **Custom storage locations**: Set your own download path (save files to internal memory, custom folders, or SD Cards).

## ⚡ 4. CORE APP FEATURES
* **100% Ad-Free**: Zero popups, zero redirects, and zero banner ads.
* **Automatic Self-Updater**: Built-in APK updater that checks for updates on launch and downloads/installs new releases directly inside the app.
* **Modern Dark Mode UI**: Elegant, optimized design utilizing custom glassmorphism and modern typography.

---

# AniPlay v1.4 Major Release: The Immersive Performance Update 🚀

We are proud to present **AniPlay version 1.4**, our largest and most comprehensive update yet. This release represents a complete architectural overhaul of our core database syncing mechanisms, streaming resolvers, and user-interface render paths. 

Our focus for v1.4 was to eliminate streaming downtime, make navigation feel incredibly smooth on mobile displays, and deliver high-quality customization options for your personal viewing profile.

---

## 🚀 1. DATABASE & CLOUD SYNC ARCHITECTURE

### ☁️ Supabase Offline-First Sync Engine (Core Rewrite)
* **Real-time Account Synchronization**: Your personal database rows (Watchlist, Favorites, and Watch progress) are saved locally and synced to Supabase instantly when you are online, keeping multiple devices in absolute sync.
* **Conflict-Free Replication & `favoritedAt` Logs**: Resolved the "ghost favorite" bug. The sync manager now writes precise microsecond Unix timestamps (`addedAt`, `timestamp`, and `favoritedAt`) to all local state objects. On application startup, the client runs an conflict-resolution algorithm to compare local edits against Supabase database logs:
  - If you add or remove an anime and immediately close the app before the network request finishes, the local timestamp remains newer than the database. On next startup, the client recognizes your offline change and pushes the correction upstream.
  - If cloud updates are newer, they merge into the local state.
* **Resilient Schema Mappings**: Watchlists and progress cards automatically recover on-the-fly using fallbacks (such as auto-building placeholder rows containing the Anime ID) if database records are missing title or image properties.

---

## 📡 2. STREAMING SCRAPERS & CUSTOM RESOLUTION PIPELINE

### 🔗 Parallel Mirror Resolution Engine
* **Multithreaded Mirror Retrieval**: Rewrote the Waves resolver to retrieve up to 4 mirror streams (Vidplay, MyCloud, HD-1, HD-2) in parallel. The engine automatically filters out broken links, decrypts working streams, and loads the fastest mirror.
* **Unified Stream Buttons**: Cluttered mirror links are now grouped. The player presents a single clean, high-performance button labeled **`WavesHD`** (and **`WavesHD (DUB)`**), guaranteeing immediate playback.
* **Scraper Stabilization**: Renamed the primary default scraper to **`NekoHD`** to highlight its high-definition stream delivery.
* **CORS & Referer Headers Proxying**: Fully optimized header injection. All stream requests are routed with customized `Origin` and `Referer` headers matching the target host, preventing stream timeouts or 403 Forbidden errors.

---

## 📺 3. IMMERSIVE MEDIA PLAYER & VIEWPORT EXPERIENCE (AniPlayer)

### 🔄 Autoplay & Viewport State Persistence
* **Autoplay Next Episode**: The player automatically cues up and begins streaming the next chronological episode as soon as the active video ends.
* **Fullscreen Orientation Lock**: Fixed the bug where loading the next episode forced the player out of fullscreen mode. The player now remains fully mounted with a black backdrop loading wrapper, preserving your screen orientation and fullscreen view throughout episode transitions.

### 🎛️ Custom Media Controls
* **On-the-Fly Subtitle Sync**: Delay controls are now built directly into the video overlays, allowing you to shift subtitle timings forward or backward.
* **Playback Speed Selectors**: Choose video playback speeds from 0.5x (slow-motion) up to 2.0x (fast-forward) using a new player menu.
* **Cinematic Clean Mode**: Completely removed developer logs, warning banner overlays, and diagnostic prompts, giving you a clean, polished interface.

---

## ⚙️ 4. CUSTOM ACCENT COLORS & SYSTEM SETTINGS

### 🎨 HSL Color Variable Compiler
* **Accents Synchronization**: Toggling accent themes dynamically compiles all HSL color shades (`--accent`, `--accent-hover`, `--accent-dim`, `--shadow-glow`) to the root CSS document. This resolves sticky purple highlight remnants on mobile touchscreens when switching to Rose, RoseGold, or Red modes.
* **Enhanced Light Mode Readability**: Rewrote contrast CSS layouts. Text, descriptions, metadata items, and input placeholders dynamically swap to rich slate-black when switching from dark mode to light mode to ensure comfortable reading.
* **Live Transparency Preview**: Tweak overlay opacities with an interactive demo card preview rendering right behind the slider, showing you exactly how transparent your cards will look before saving.
* **Routing Priorities**: Select your preferred source (`NekoHD`, `AniHD`, `WavesHD`) to auto-load your favorite stream link first.

---

## 👤 5. PROFILE PERSONALIZATION & WATCH STATS ANALYTICS

### 📊 Dynamic Watch Statistics Dashboard
* **Dynamic Watch Metrics**: Track your progress with animated count badges showing:
  * **Watchlist Count**: Total anime series currently in your queue.
  * **Favorites Count**: Loved series.
  * **Completed Progress Meter**: Completed episode count.
* **Custom Profile Editor**: Change your account avatar and nickname at any time. The comments section syncs directly with your profile name, removing the redundant change name prompts.
* **JSON Import/Export Backup Tools**: Back up your library manually. Export your watchlist, progress history, and favorites into a backup file, or restore them instantly.

---

## ⚡ 6. PERFORMANCE & SEARCH OPTIMIZATIONS

* **GPU Hardware Acceleration**: Added `will-change: transform, background` and `translate3d(0, 0, 0)` rendering declarations to all grid layout elements. This bypasses CPU paint cycles and utilizes mobile GPU rendering, delivering butter-smooth search list scrolling.
* **Passive Momentum Scroll Listeners**: Configured scroll listeners to run in passive mode. Browsing pages scroll instantly without waiting for JavaScript calculation threads.
* **Infinite Browse listings**: Results load dynamically as you scroll, removing pagination controls.
* **Multi-Language Search Queries**: Search queries look up English titles, Romaji transliterations, and native Japanese characters in parallel across scrapers to maximize search coverage.
