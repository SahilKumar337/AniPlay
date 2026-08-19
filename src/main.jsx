import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import App from './App.jsx'
import './index.css'

// Tell CapGo this bundle loaded successfully — prevents auto-rollback.
const withTimeout = (promise, ms = 3000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

withTimeout(CapacitorUpdater.notifyAppReady()).catch(() => {});

// Global safety guard for unhandled async promise rejections (e.g. transient network sync errors)
// Prevents fatal red-screen error overlays in production/native webview.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Unhandled Rejection Guard]', event.reason?.message || event.reason);
    event.preventDefault();
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
