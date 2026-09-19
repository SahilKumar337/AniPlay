/**
 * AniPlay · Ad Engine v2 (industry-grade, future-update-ready)
 *
 * ARCHITECTURE
 * ────────────
 * All ad types are DISABLED BY DEFAULT (`enabled: false`).
 * Ads are enabled remotely via the `ads` key in update.json (GitHub CDN).
 * Zero code changes are needed to enable any ad type — just push a new
 * update.json with `enabled: true` and the appropriate sub-config.
 *
 * SUPPORTED AD TYPES
 * ──────────────────
 * 1. Video Pre-roll (VAST 2.0/3.0)  — shown before episode playback starts
 * 2. Custom Video Ad                 — MP4 from your own CDN as fallback
 * 3. Native Banner Card              — custom sponsor / Adsterra script
 * 4. Interstitial (fullscreen)       — every N episode navigations
 * 5. Direct Link (SmartLink)         — frequency-capped background click
 *
 * REMOTE CONFIG SCHEMA (update.json -> "ads" key)
 * ───────────────────────────────────────────────
 * {
 *   "ads": {
 *     "enabled": false,
 *     "consent": {
 *       "enabled": false,
 *       "message": "We show ads to keep AniPlay free.",
 *       "acceptText": "Got it"
 *     },
 *     "clickadu": {
 *       "enabled": false,
 *       "vastUrl": "",
 *       "directLinkUrl": ""
 *     },
 *     "directLink": {
 *       "enabled": false,
 *       "url": "",
 *       "frequencyMinutes": 15,
 *       "triggerOnEpisodePlay": false
 *     },
 *     "videoAds": {
 *       "enabled": false,
 *       "skipDelaySeconds": 15,
 *       "frequencyMinutes": 0,
 *       "vastUrl": "",
 *       "ads": []
 *     },
 *     "interstitial": {
 *       "enabled": false,
 *       "frequencyEpisodes": 3,
 *       "vastUrl": "",
 *       "ads": []
 *     },
 *     "banner": {
 *       "enabled": false,
 *       "network": "custom",
 *       "bannerHtml": "",
 *       "sponsors": []
 *     }
 *   }
 * }
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

const APKUpdater = registerPlugin('APKUpdater');

// Storage Keys
const KEY_LAST_AD        = 'aniplay_last_ad_timestamp';
const KEY_LAST_VIDEO_AD  = 'aniplay_last_video_ad_timestamp';
const KEY_AD_CONFIG      = 'aniplay_ad_config_cache';
const KEY_CONSENT_GIVEN  = 'aniplay_ad_consent_v1';
const KEY_SESSION_EP_CNT = 'aniplay_session_ep_count';

// Blocklist: CDN/URLs that must never appear in ad config (e.g., broken test videos or scraper embeds)
const AD_BLOCKLIST = [
  'gtv-videos-bucket', '/ads/sample_ad.mp4',
  'bibiemb', 'vivibebe', 'ibyteimg',
];

// Default config (all disabled — safe zero-ad baseline)
const DEFAULT_CONFIG = {
  enabled: false,
  consent: {
    enabled: false,
    message: 'AniPlay shows occasional ads to stay free. No data is sold.',
    acceptText: 'Got it',
  },
  clickadu: {
    enabled: false,
    vastUrl: '',
    directLinkUrl: '',
  },
  directLink: {
    enabled: false,
    url: '',
    frequencyMinutes: 15,
    triggerOnEpisodePlay: false,
  },
  videoAds: {
    enabled: false,
    skipDelaySeconds: 15,
    frequencyMinutes: 0,
    vastUrl: '',
    ads: [],
  },
  interstitial: {
    enabled: false,
    frequencyEpisodes: 3,
    vastUrl: '',
    ads: [],
  },
  banner: {
    enabled: false,
    network: 'custom',
    bannerHtml: '',
    sponsors: [],
  },
};

/** Deep merge two plain objects */
function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] !== null &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function isBlocked(str) {
  if (!str) return false;
  return AD_BLOCKLIST.some(b => str.includes(b));
}

class AdEngine {
  constructor() {
    this._listeners         = new Set();
    this.config             = this._loadCachedConfig();
    this._prefetchedVastAd  = null;
    this._prefetchedInterAd = null;
    this._lastVideoAdId     = null;
    this._lastInterAdId     = null;

    if (this.isAdsEnabled()) {
      setTimeout(() => {
        this._prefetchVast('video');
        this._prefetchVast('interstitial');
      }, 1500);
    }
  }

  // Subscription
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    this._listeners.forEach(fn => {
      try { fn(this.config, this.isAdsEnabled()); }
      catch (e) { console.warn('[AdEngine] Listener error:', e); }
    });
  }

  // Config
  _loadCachedConfig() {
    try {
      const raw = localStorage.getItem(KEY_AD_CONFIG);
      if (!raw) return DEFAULT_CONFIG;
      if (isBlocked(raw)) {
        localStorage.removeItem(KEY_AD_CONFIG);
        return DEFAULT_CONFIG;
      }
      return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  _saveConfig() {
    try { localStorage.setItem(KEY_AD_CONFIG, JSON.stringify(this.config)); } catch {}
  }

  init(remote) {
    if (!remote || typeof remote !== 'object') return;
    if (isBlocked(JSON.stringify(remote))) {
      console.warn('[AdEngine] Remote config blocked — contains restricted domain.');
      return;
    }
    const merged = deepMerge(DEFAULT_CONFIG, remote);
    merged.enabled = remote.enabled === true;

    // Downloads never trigger ads — hard override
    if (merged.directLink) merged.directLink.triggerOnDownload = false;

    this.config = merged;
    this._saveConfig();

    if (this.isAdsEnabled()) {
      setTimeout(() => {
        this._prefetchVast('video');
        this._prefetchVast('interstitial');
      }, 800);
    }
    this._notify();
    console.log('[AdEngine] Ready. Ads enabled:', this.isAdsEnabled());
  }

  reset() {
    this.config             = DEFAULT_CONFIG;
    this._prefetchedVastAd  = null;
    this._prefetchedInterAd = null;
    localStorage.removeItem(KEY_AD_CONFIG);
    this._notify();
    console.log('[AdEngine] Reset — all ads disabled.');
  }

  // State Queries
  isAdsEnabled() { return this.config?.enabled === true; }

  hasConsent() {
    if (!this.config?.consent?.enabled) return true;
    try { return localStorage.getItem(KEY_CONSENT_GIVEN) === '1'; } catch { return true; }
  }

  acceptConsent() {
    try { localStorage.setItem(KEY_CONSENT_GIVEN, '1'); } catch {}
    this._notify();
  }

  getPendingConsent() {
    if (!this.isAdsEnabled() || !this.config?.consent?.enabled || this.hasConsent()) return null;
    return this.config.consent;
  }

  // Video Pre-roll
  getVideoAdConfig() {
    if (!this.isAdsEnabled() || !this.config?.videoAds?.enabled) return null;
    return this.config.videoAds;
  }

  shouldShowVideoAd() {
    if (!this.isAdsEnabled() || !this.hasConsent()) return false;
    const cfg = this.getVideoAdConfig();
    if (!cfg || (!cfg.vastUrl && !cfg.ads?.length)) return false;
    if (!cfg.frequencyMinutes || cfg.frequencyMinutes <= 0) return true;
    try {
      const last = parseInt(localStorage.getItem(KEY_LAST_VIDEO_AD) || '0', 10);
      return Date.now() - last > cfg.frequencyMinutes * 60_000;
    } catch { return true; }
  }

  markVideoAdShown() {
    try { localStorage.setItem(KEY_LAST_VIDEO_AD, String(Date.now())); } catch {}
  }

  getRandomVideoAd() {
    if (this._prefetchedVastAd) {
      const ad = this._prefetchedVastAd;
      this._prefetchedVastAd = null;
      setTimeout(() => this._prefetchVast('video'), 3000);
      return ad;
    }
    const cfg = this.getVideoAdConfig();
    if (!cfg) return null;
    if (cfg.vastUrl) setTimeout(() => this._prefetchVast('video'), 500);
    if (!cfg.ads?.length) return null;
    const pool = cfg.ads.filter(a => a.id !== this._lastVideoAdId);
    const ad = (pool.length ? pool : cfg.ads)[Math.floor(Math.random() * (pool.length || cfg.ads.length))];
    this._lastVideoAdId = ad.id;
    return { ...ad, skipDelaySeconds: cfg.skipDelaySeconds ?? 15 };
  }

  // Interstitial
  getInterstitialConfig() {
    if (!this.isAdsEnabled() || !this.config?.interstitial?.enabled) return null;
    return this.config.interstitial;
  }

  onEpisodeSwitch() {
    try {
      const n = parseInt(sessionStorage.getItem(KEY_SESSION_EP_CNT) || '0', 10) + 1;
      sessionStorage.setItem(KEY_SESSION_EP_CNT, String(n));
      if (!this.isAdsEnabled() || !this.hasConsent()) return null;
      const cfg = this.getInterstitialConfig();
      if (!cfg) return null;
      const freq = cfg.frequencyEpisodes || 3;
      if (n % freq !== 0) return null;
      return this._getInterstitialAd();
    } catch { return null; }
  }

  _getInterstitialAd() {
    if (this._prefetchedInterAd) {
      const ad = this._prefetchedInterAd;
      this._prefetchedInterAd = null;
      setTimeout(() => this._prefetchVast('interstitial'), 3000);
      return ad;
    }
    const cfg = this.getInterstitialConfig();
    if (!cfg) return null;
    if (cfg.vastUrl) setTimeout(() => this._prefetchVast('interstitial'), 500);
    if (!cfg.ads?.length) return null;
    const pool = cfg.ads.filter(a => a.id !== this._lastInterAdId);
    const ad = (pool.length ? pool : cfg.ads)[Math.floor(Math.random() * (pool.length || cfg.ads.length))];
    this._lastInterAdId = ad.id;
    return { ...ad, skipDelaySeconds: cfg.skipDelaySeconds ?? 5 };
  }

  // Direct Link
  shouldShowDirectLinkAd() {
    if (!this.isAdsEnabled() || !this.hasConsent()) return false;
    const cfg = this.config?.directLink;
    if (!cfg?.enabled || !cfg?.url) return false;
    try {
      const last = parseInt(localStorage.getItem(KEY_LAST_AD) || '0', 10);
      return Date.now() - last > (cfg.frequencyMinutes || 15) * 60_000;
    } catch { return false; }
  }

  async triggerDirectLinkAd(force = false) {
    if (!force && !this.shouldShowDirectLinkAd()) return false;
    const url = this.config?.clickadu?.directLinkUrl || this.config?.directLink?.url;
    if (!url) return false;
    try {
      localStorage.setItem(KEY_LAST_AD, String(Date.now()));
      return await this.openUrl(url);
    } catch { return false; }
  }

  triggerEpisodeAd() {
    if (!this.isAdsEnabled()) return false;
    if (this.config?.directLink?.triggerOnEpisodePlay) return this.triggerDirectLinkAd(false);
    return false;
  }

  triggerDownloadAd() { return false; }

  // Banner
  getBannerConfig() {
    if (!this.isAdsEnabled() || !this.config?.banner?.enabled) return null;
    return this.config.banner;
  }

  getRandomSponsor() {
    const b = this.getBannerConfig();
    if (!b?.sponsors?.length) return null;
    return b.sponsors[Math.floor(Math.random() * b.sponsors.length)];
  }

  // VAST Fetcher
  async _prefetchVast(type = 'video') {
    const cfg = type === 'interstitial' ? this.getInterstitialConfig() : this.getVideoAdConfig();
    const url = cfg?.vastUrl || this.config?.clickadu?.vastUrl;
    if (!url) return;
    try {
      const ad = await this._fetchVastAd(url);
      if (ad) {
        if (type === 'interstitial') this._prefetchedInterAd = ad;
        else this._prefetchedVastAd = ad;
        console.log(`[AdEngine] Pre-fetched VAST (${type}): "${ad.title}"`);
      }
    } catch {}
  }

  async _fetchVastAd(vastUrl, depth = 0) {
    if (!vastUrl || depth > 3) return null;
    try {
      const res = await fetch(vastUrl, { headers: { Accept: 'application/xml, text/xml, */*' } });
      if (!res.ok) return null;
      const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');

      const wrapperUri = xml.querySelector('VASTAdTagURI')?.textContent?.trim();
      const wrapperImpressions = Array.from(xml.querySelectorAll('Wrapper > Impression'))
        .map(el => el.textContent?.trim()).filter(Boolean);
      if (wrapperUri) {
        const nested = await this._fetchVastAd(wrapperUri, depth + 1);
        if (nested) {
          nested.impressionUrls = [...(nested.impressionUrls || []), ...wrapperImpressions];
          return nested;
        }
      }

      if (!xml.querySelector('InLine')) return null;
      const mediaFiles = Array.from(xml.querySelectorAll('MediaFile'));
      const mp4 = mediaFiles.filter(m => (m.getAttribute('type') || '').includes('mp4'));
      const chosen = mp4.find(m => ['640', '1280'].includes(m.getAttribute('width') || '')) || mp4[0] || mediaFiles[0];
      const videoUrl = chosen?.textContent?.trim();
      if (!videoUrl || isBlocked(videoUrl)) return null;

      const trackingEvents = {};
      Array.from(xml.querySelectorAll('Tracking')).forEach(t => {
        const evt = t.getAttribute('event');
        const url = t.textContent?.trim();
        if (evt && url) {
          trackingEvents[evt] = trackingEvents[evt] || [];
          trackingEvents[evt].push(url);
        }
      });

      return {
        id: `vast-${Date.now()}`,
        isVast: true,
        title: xml.querySelector('AdTitle')?.textContent?.trim() || 'Sponsored',
        brand: 'Sponsored',
        ctaText: 'Visit Sponsor',
        targetUrl: xml.querySelector('ClickThrough')?.textContent?.trim()
          || this.config?.clickadu?.directLinkUrl || this.config?.directLink?.url || '',
        videoUrl,
        skipDelaySeconds: this.getVideoAdConfig()?.skipDelaySeconds ?? 15,
        impressionUrls: Array.from(xml.querySelectorAll('InLine > Impression'))
          .map(el => el.textContent?.trim()).filter(Boolean),
        trackingEvents,
        clickTrackingUrls: Array.from(xml.querySelectorAll('ClickTracking'))
          .map(el => el.textContent?.trim()).filter(Boolean),
      };
    } catch (e) {
      console.warn('[AdEngine] VAST parse failed:', e.message);
      return null;
    }
  }

  // Tracking Beacon
  fireBeacon(url) {
    if (!url) return;
    try {
      if (navigator?.sendBeacon) { navigator.sendBeacon(url); return; }
      new Image().src = url;
    } catch {
      try { fetch(url, { mode: 'no-cors', keepalive: true }).catch(() => {}); } catch {}
    }
  }

  // URL Opener
  async openUrl(url) {
    if (!url) return false;
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          await APKUpdater.openExternalUrl({ url });
          return true;
        } catch (e) {
          console.warn('[AdEngine] Native openUrl failed, falling back:', e.message);
        }
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }

  // Clickadu Convenience Setters
  setClickaduVastUrl(url) {
    if (!url) return;
    this.config.clickadu = this.config.clickadu || {};
    this.config.clickadu.vastUrl = url;
    this.config.videoAds = this.config.videoAds || {};
    this.config.videoAds.vastUrl = url;
    this._saveConfig();
    this._prefetchVast('video');
  }

  setClickaduDirectLink(url) {
    if (!url) return;
    this.config.clickadu = this.config.clickadu || {};
    this.config.clickadu.directLinkUrl = url;
    this._saveConfig();
  }
}

// Singleton Export
export const adEngine = new AdEngine();
export default adEngine;