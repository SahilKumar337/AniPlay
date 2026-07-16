import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { StatusBar } from '@capacitor/status-bar';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
const APKUpdater = registerPlugin('APKUpdater');
import WelcomeScreen from './components/WelcomeScreen';
import AuthModal from './components/AuthModal';
import { supabase } from './api/supabase';
import Home          from './pages/Home';
import Browse        from './pages/Browse';
import Schedule      from './pages/Schedule';
import AnimePage     from './pages/AnimePage';
import MyList        from './pages/MyList';
import { useParams } from 'react-router-dom';

function WatchRedirect() {
  const { id, ep } = useParams();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Replace redirect route with detail page, then push play parameters
    navigate(`/anime/${id}`, { replace: true });
    const timer = setTimeout(() => {
      navigate(`/anime/${id}?play=true&ep=${ep}`);
    }, 20);
    return () => clearTimeout(timer);
  }, [id, ep, navigate]);

  return null;
}
import DownloadPage  from './pages/DownloadPage';
import Profile       from './pages/Profile';
import FavoritesPage from './pages/FavoritesPage';
import WatchedPage   from './pages/WatchedPage';
import Navbar        from './components/Navbar';

// Inner component that has access to navigate (must be inside BrowserRouter)
function AppInner({ showWelcome, onEnter }) {
  const { user } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isNative = Capacitor.isNativePlatform();
  const [searchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showFirstTimeAuth, setShowFirstTimeAuth] = useState(false);

  // ── Deep Link Handler: Supabase email confirmation via aniplay:// ─
  useEffect(() => {
    if (!isNative) return;
    let subscription = null;

    const handleDeepLink = async ({ url }) => {
      if (!url || !url.startsWith('aniplay://')) return;
      try {
        // Supabase sends tokens as hash fragment: #access_token=...&type=signup
        // Or as query params: ?code=...  depending on PKCE vs implicit flow
        const urlObj = new URL(url.replace('aniplay://', 'https://aniplay.app/'));
        const code = urlObj.searchParams.get('code');
        const access_token = urlObj.searchParams.get('access_token') ||
          new URLSearchParams(urlObj.hash.slice(1)).get('access_token');
        const refresh_token = urlObj.searchParams.get('refresh_token') ||
          new URLSearchParams(urlObj.hash.slice(1)).get('refresh_token');

        if (code) {
          // PKCE flow
          await supabase.auth.exchangeCodeForSession(code);
        } else if (access_token && refresh_token) {
          // Implicit flow
          await supabase.auth.setSession({ access_token, refresh_token });
        }
      } catch (err) {
        console.error('[DeepLink] Auth token exchange failed:', err);
      }
    };

    const setupListener = async () => {
      subscription = await CapApp.addListener('appUrlOpen', handleDeepLink);
    };

    setupListener();

    return () => {
      subscription?.remove();
    };
  }, [isNative]);

  useEffect(() => {
    if (!showWelcome && !user) {
      const onboarded = localStorage.getItem('aniplay_onboarded');
      if (!onboarded) {
        const timer = setTimeout(() => {
          setShowFirstTimeAuth(true);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [showWelcome, user]);

  // Dismiss welcome onboarding automatically if user is logged in
  useEffect(() => {
    if (user && showWelcome) {
      onEnter();
    }
  }, [user, showWelcome, onEnter]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => {
      setIsOffline(true);
      navigate('/download');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!navigator.onLine && location.pathname !== '/download' && !location.pathname.startsWith('/anime/')) {
      navigate('/download');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [navigate, location.pathname]);

  // ── Capacitor Android back button handler ─────────────────────────
  // Keep path and search parameters in refs so listeners don't require registration cycles
  const currentPathRef = useRef(location.pathname);
  const currentSearchRef = useRef(location.search);
  
  useEffect(() => {
    currentPathRef.current = location.pathname;
    currentSearchRef.current = location.search;
  }, [location.pathname, location.search]);
 
  useEffect(() => {
    if (!isNative) return;
    
    const setupListener = async () => {
      const handle = await CapApp.addListener('backButton', ({ canGoBack }) => {
        const path = currentPathRef.current;
        const search = currentSearchRef.current;
        console.log('[BackButton] Clicked. Path:', path, 'search:', search, 'canGoBack:', canGoBack);
        

        const mainTabs = ['/browse', '/schedule', '/mylist', '/download', '/profile'];
        
        if (path === '/') {
          CapApp.exitApp();
        } else if (mainTabs.includes(path)) {
          navigate('/');
        } else {
          navigate(-1);
        }
      });
      return handle;
    };

    const handlePromise = setupListener();
    return () => {
      handlePromise.then(l => l.remove()).catch(() => {});
    };
  }, [navigate, isNative]);

  return (
    <div className={`app-container ${isNative ? 'app-container--native' : ''}`}>
      {showWelcome ? (
        <WelcomeScreen onEnter={onEnter} onSignIn={() => setShowFirstTimeAuth(true)} />
      ) : (
        <>
          <Routes>
            <Route path="/"            element={<Home />}         />
            <Route path="/browse"      element={<Browse />}       />
            <Route path="/schedule"    element={<Schedule />}     />
            <Route path="/anime/:id"   element={<AnimePage />}    />
            <Route path="/watch/:id/:ep" element={<WatchRedirect />}  />
            <Route path="/mylist"      element={<MyList />}       />
            <Route path="/favorites"   element={<FavoritesPage />} />
            <Route path="/watched"     element={<WatchedPage />}   />
            <Route path="/download"    element={<DownloadPage />} />
            <Route path="/profile"     element={<Profile />}      />
            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
          {!playParam && <Navbar />}
        </>
      )}
      <AuthModal isOpen={showFirstTimeAuth} onClose={() => { setShowFirstTimeAuth(false); localStorage.setItem('aniplay_onboarded', 'true'); }} />
    </div>
  );
}

import { setDynamicDomains, setDynamicMappings } from './api/scrapers';

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem('anilab_welcomed');
  });

  const [updateInfo, setUpdateInfo] = useState(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null); // null | 0-100 | 'ready'
  const [currentVersion, setCurrentVersion] = useState('1.0.0');
  const [cfModal, setCfModal] = useState({ visible: false, domain: '' });

  useEffect(() => {
    const handleCfEvent = (e) => {
      if (e.detail) {
        setCfModal({
          visible: e.detail.visible,
          domain: e.detail.domain || 'Website'
        });
      }
    };
    window.addEventListener('show-cf-modal', handleCfEvent);
    return () => window.removeEventListener('show-cf-modal', handleCfEvent);
  }, []);

  useEffect(() => {
    const initDeviceSettings = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          // Hide the status bar completely (time, battery, signal)
          await StatusBar.hide();
        } catch (e) {
          console.warn('[Capacitor] StatusBar settings error:', e);
        }
        // Read actual status bar height (works even if hide() fails on some phones)
        // and expose it as a CSS variable so the player overlay can use it as safe padding.
        try {
          const info = await StatusBar.getInfo();
          // height is in pixels (already DPR-scaled on Capacitor Android)
          const sbPx = info?.height ?? 0;
          document.documentElement.style.setProperty('--sb-height', `${sbPx}px`);
          console.log('[StatusBar] height:', sbPx, 'px | visible:', info?.visible);
        } catch (e2) {
          // Fallback: assume 0 (hidden successfully)
          document.documentElement.style.setProperty('--sb-height', '0px');
        }
      } else {
        document.documentElement.style.setProperty('--sb-height', '0px');
      }
    };
    initDeviceSettings();
  }, []);

  // ── One-time cache purge: clear stale AniKoto search matches ──
  // The old confidence threshold (0.65) was too loose and cached wrong-anime matches.
  // This purges all anisearch_koto_* entries once so the stricter 0.88 threshold takes effect.
  useEffect(() => {
    const PURGE_KEY = 'anilab_koto_cache_purge_v2';
    if (!localStorage.getItem(PURGE_KEY)) {
      let purged = 0;
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('anisearch_koto_')) {
          localStorage.removeItem(k);
          purged++;
        }
      });
      localStorage.setItem(PURGE_KEY, '1');
      if (purged > 0) console.log(`[CachePurge] Cleared ${purged} stale AniKoto search entries`);
    }
  }, []);

  // ── Remote Update & Configuration Checker ──────────────────────
  useEffect(() => {
    async function checkUpdates() {
      let isTestBuild = localStorage.getItem('anilab_test_updates') === 'true';
      let appVer = '1.0.0';

      if (Capacitor.isNativePlatform()) {
        try {
          const versionInfo = await APKUpdater.getAppVersion();
          appVer = versionInfo.versionName;
          if (versionInfo.packageName && versionInfo.packageName.endsWith('.beta')) {
            isTestBuild = true;
          }
        } catch (e) {
          console.warn('[APKUpdater] Failed to get native version, fallback to CapApp:', e);
          try {
            const info = await CapApp.getInfo();
            appVer = info.version;
          } catch (err) {
            console.warn('[CapApp] Failed to get app info:', err);
          }
        }
      }
      setCurrentVersion(appVer);

      const urls = isTestBuild
        ? ['https://raw.githubusercontent.com/SahilKumar337/AniPlay/refs/heads/main/update-test.json']
        : [
            'https://raw.githubusercontent.com/SahilKumar337/AniPlay/refs/heads/main/update.json',
            'https://raw.githubusercontent.com/SahilKumar337/AniPlay/main/update.json'
          ];
      let data = null;
      for (const url of urls) {
        try {
          const res = await fetch(`${url}?t=${Date.now()}`);
          if (res.ok) {
            data = await res.json();
            break;
          }
        } catch (e) {
          console.warn(`[Updater] Failed to fetch from ${url}:`, e);
        }
      }

      if (!data) return;

      // 1. Load dynamic domains and mappings
      if (data.domains) {
        setDynamicDomains(data.domains);
      }
      if (data.mappings) {
        setDynamicMappings(data.mappings);
      }

      // 2. Check maintenance message
      if (data.maintenanceMessage) {
        setMaintenanceMsg(data.maintenanceMessage);
        return;
      }

      // 4. Compare version
      const isNewerVersion = (latest, current) => {
        const parse = v => String(v || '').split('.').map(x => parseInt(x, 10) || 0);
        const a = parse(latest);
        const b = parse(current);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          const va = a[i] || 0;
          const vb = b[i] || 0;
          if (va > vb) return true;
          if (va < vb) return false;
        }
        return false;
      };

      if (data.latestVersion && isNewerVersion(data.latestVersion, appVer)) {
        setUpdateInfo(data);
      }
    }
    checkUpdates();
  }, []);

  const handleEnter = () => {
    localStorage.setItem('anilab_welcomed', '1');
    setShowWelcome(false);
  };


  // ── In-app Native APK update via APKUpdater ──────────────
  const handleUpdateNow = async () => {
    const isNativeApp = Capacitor.isNativePlatform();
    if (!isNativeApp) {
      // Fallback for web browser — open APK download link
      window.open(updateInfo.apkUrl, '_blank');
      return;
    }

    try {
      // Check install permission first (on Android 8+)
      const permInfo = await APKUpdater.checkInstallPermission();
      if (permInfo && !permInfo.granted) {
        showToast('Please enable "Install unknown apps" permission to update AniPlay');
        await APKUpdater.requestInstallPermission();
        return; // Pause here so user can toggle and click update again
      }

      setUpdateProgress(0);

      // Listen for download progress events
      const progressListener = await APKUpdater.addListener('downloadProgress', ({ progress }) => {
        setUpdateProgress(Math.round(progress));
      });

      const completeListener = await APKUpdater.addListener('downloadComplete', () => {
        setUpdateProgress('ready');
      });

      const errorListener = await APKUpdater.addListener('downloadError', ({ error }) => {
        console.error('[APKUpdater] Download failed:', error);
        setUpdateProgress(null);
      });

      // Start the native APK download and install
      await APKUpdater.downloadAndInstall({ url: updateInfo.apkUrl });

      // Clean up listeners
      setTimeout(() => {
        progressListener.remove();
        completeListener.remove();
        errorListener.remove();
      }, 6000);
    } catch (err) {
      console.error('[APKUpdater] Failed to download/install update:', err);
      setUpdateProgress(null);
      // Fallback: open system browser to download APK
      if (updateInfo.apkUrl) window.open(updateInfo.apkUrl, '_system');
    }
  };

  return (
    <AppProvider>
      <BrowserRouter>
        <AppInner showWelcome={showWelcome} onEnter={handleEnter} />
      </BrowserRouter>

      {/* ── Maintenance Mode Lock Screen ─────────────────────────── */}
      {maintenanceMsg && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'var(--bg-app)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 24, textAlign: 'center',
        }}>
          <div style={{
            fontSize: 48, marginBottom: 16,
            background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            fontWeight: 900
          }}>⚠</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 12, fontFamily: 'var(--font-brand)' }}>
            System Notice
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 320, marginBottom: 24 }}>
            {maintenanceMsg}
          </p>
        </div>
      )}

      {/* ── Update Dialog Modal ──────────────────────────────────── */}
      {updateInfo && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99998,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            width: '100%', maxWidth: 360,
            background: 'var(--bg-card)',
            borderRadius: 20,
            padding: 24,
            border: '1px solid var(--border)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            textAlign: 'center'
          }}>
            <div style={{
              width: 50, height: 50, borderRadius: '50%',
              background: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, margin: '0 auto 16px'
            }}>⬆</div>
            
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 8, fontFamily: 'var(--font-brand)' }}>
              Update Available
            </h2>
             <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Version {updateInfo.latestVersion} (Current: {currentVersion})
            </div>

            {(updateInfo.changelogItems || updateInfo.changelog) && (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 12px',
                textAlign: 'left',
                maxHeight: 160,
                overflowY: 'auto',
                marginBottom: 20
              }}>
                <div style={{ fontWeight: 700, color: '#fff', marginBottom: 8, fontSize: 12 }}>✨ What's New:</div>
                {Array.isArray(updateInfo.changelogItems)
                  ? updateInfo.changelogItems.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 7,
                      fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
                      marginBottom: i < updateInfo.changelogItems.length - 1 ? 6 : 0
                    }}>
                      <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>•</span>
                      <span>{item}</span>
                    </div>
                  ))
                  : <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{updateInfo.changelog}</div>
                }
              </div>
            )}


            {/* Download progress bar */}
            {updateProgress !== null && (
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  background: 'rgba(255,255,255,0.08)',
                  borderRadius: 8, height: 8, overflow: 'hidden', marginBottom: 6
                }}>
                  <div style={{
                    height: '100%',
                    width: (updateProgress === 'installing' || updateProgress === 'ready') ? '100%' : `${updateProgress}%`,
                    background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
                    borderRadius: 8,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {updateProgress === 'installing' && '✅ Installing… app will restart'}
                  {updateProgress === 'ready' && '🎉 Download complete! Ready to install.'}
                  {typeof updateProgress === 'number' && `Downloading ${updateProgress}%`}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              {!updateInfo.forceUpdate && updateProgress === null && (
                <button
                  onClick={() => setUpdateInfo(null)}
                  style={{
                    flex: 1, padding: '12px 0', borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Later
                </button>
              )}
              <button
                onClick={handleUpdateNow}
                disabled={typeof updateProgress === 'number' || updateProgress === 'installing'}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 10,
                  border: 'none',
                  background: (typeof updateProgress === 'number' || updateProgress === 'installing')
                    ? 'rgba(99,102,241,0.4)'
                    : 'linear-gradient(135deg, #6366f1, #a78bfa)',
                  color: '#fff',
                  fontSize: 13, fontWeight: 700,
                  cursor: (typeof updateProgress === 'number' || updateProgress === 'installing') ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {updateProgress === 'installing' && '⏳ Installing…'}
                {updateProgress === 'ready' && '⚡ Install & Restart'}
                {typeof updateProgress === 'number' && '⏳ Downloading…'}
                {updateProgress === null && '🚀 Update Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cloudflare Captcha Verification Overlay ──────────────── */}
      {cfModal.visible && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 999999,
          pointerEvents: 'none',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          <style>{`
            @keyframes cf-pulse {
              0% { transform: scale(0.95); opacity: 0.8; }
              50% { transform: scale(1.05); opacity: 1; }
              100% { transform: scale(0.95); opacity: 0.8; }
            }
            @keyframes cf-spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
          <div style={{
            width: '90%',
            maxWidth: '380px',
            marginTop: '10vh',
            padding: '24px',
            background: 'rgba(24, 24, 24, 0.98)',
            backdropFilter: 'blur(12px)',
            borderRadius: '20px',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
            textAlign: 'center',
            pointerEvents: 'auto',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              marginBottom: '16px',
              animation: 'cf-pulse 2s infinite ease-in-out',
            }}>
              <span style={{ fontSize: '26px' }}>🛡️</span>
            </div>
            <h3 style={{ 
              margin: '0 0 8px 0', 
              color: '#fff', 
              fontFamily: 'var(--font-brand), sans-serif',
              fontSize: '18px',
              fontWeight: 800
            }}>
              Verifying Security Clearance
            </h3>
            <p style={{ 
              margin: '0 0 20px 0', 
              color: 'var(--text-secondary)', 
              fontSize: '13px',
              lineHeight: '1.5',
              fontFamily: 'var(--font-main), sans-serif'
            }}>
              Completing verification for <strong>{cfModal.domain}</strong>. If prompted, please check the box in the area below.
            </p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: 'var(--accent)',
              fontSize: '12px',
              fontWeight: 600,
              fontFamily: 'var(--font-main), sans-serif'
            }}>
              <span style={{
                width: '14px',
                height: '14px',
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'cf-spin 1s linear infinite'
              }}></span>
              Verifying… will close automatically
            </div>
          </div>
        </div>
      )}
    </AppProvider>
  );
}

