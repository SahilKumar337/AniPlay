import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import App from './App.jsx'
import './index.css'

// Expose Capacitor globally on window so all isNativePlatform checks succeed reliably
if (typeof window !== 'undefined') {
  window.Capacitor = Capacitor;
}

// Tell CapGo this bundle loaded successfully — prevents auto-rollback.
const withTimeout = (promise, ms = 3000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

withTimeout(CapacitorUpdater.notifyAppReady()).catch(() => {});

import offlineCatalog from './data/offlineCatalog.json' with { type: 'json' };

// Global safety guard for unhandled async promise rejections (e.g. transient network sync errors)
// Prevents fatal red-screen error overlays in production/native webview.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Unhandled Rejection Guard]', event.reason?.message || event.reason);
    event.preventDefault();
  });

  // Pre-decode top 8 hero banner images for instant 0ms display on boot
  try {
    const items = offlineCatalog?.trending?.slice(0, 8) || [];
    items.forEach((a, i) => {
      const u = a?.bannerImage || a?.coverImage?.extraLarge || a?.coverImage?.large;
      if (u) {
        const img = new Image();
        img.fetchPriority = i === 0 ? 'high' : 'auto';
        img.decoding = 'async';
        img.src = u;
        img.decode && img.decode().catch(() => {});
      }
    });
  } catch (_) {}
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
