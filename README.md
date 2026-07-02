# 🎬 AniPlay — Premium Mobile Anime Client

AniPlay is a premium, open-source mobile anime streaming client designed for Android devices. Built using a hybrid web-native architecture (React + Vite + Capacitor), it offers a fluid, glassmorphic UI, responsive controls, and high-performance video playback.

---

## 🌟 Key Features

* **🎭 Elegant UI & Fluid Animations**: Modern, dark-themed user interface utilizing curated indigo/violet accent gradients, responsive carousels, and micro-interactions.
* **💾 Native Device Storage (Capacitor Preferences)**: Save watchlist details, favorites, and track precise watch history directly to the native Android SharedPreferences database (cache-wipe proof).
* **📺 High-Performance HLS Player**: Custom HTML5 media player tailored for mobile touchscreens, featuring double-tap seek, automatic orientation locking/unlocking, gesture controls, and clean error states.
* **📡 Dynamic Server Aggregation**: Scrapes multiple public streams on-demand, parsing subtitle tracks, resolutions, and video hosts without storing credentials locally.
* **🔄 Serverless Live Updates**: Built-in background update checker that compares installed versions against GitHub releases, enabling remote updates and domain hot-swaps instantly.
* **📅 Adaptive Schedule Feed**: Fully integrated with the AniList GraphQL API to fetch upcoming episode releases, schedules, and metadata.

---

## 🛠️ Architecture

AniPlay is built on the **Capacitor WebView Bridge** standard:
* **UI Layer**: React Single Page Application (SPA) powered by Vite.
* **Styling**: Vanilla CSS utilizing custom properties and modern layout elements (Flexbox/CSS Grid).
* **Native Integration**: Capacitor plugins for hardware lifecycle hooks, status bar overlay, device orientation locks, and native SharedPreferences database access.

---

## 📲 Installation

To run AniPlay on your Android phone, download the latest build from the Releases tab:

1. Go to the [Releases](https://github.com/SahilKumar337/AniPlay/releases) page.
2. Download the **app-release.apk** file.
3. Open the downloaded file on your Android device.
4. Enable *"Install from Unknown Sources"* if prompted by your system.
5. Tap **Install** and launch **AniPlay**!

---

## 🔒 Privacy & Security

AniPlay values your privacy:
* All favorites, watch history, and playlists are stored **locally** on your device.
* No personal data or user accounts are sent to external databases.
* Streaming connections are requested directly to aggregation endpoints, keeping the user interface completely independent.
