import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
const APKUpdater = registerPlugin('APKUpdater');
import WelcomeScreen from './components/WelcomeScreen';
import Home          from './pages/Home';
import Browse        from './pages/Browse';
import Schedule      from './pages/Schedule';
import AnimePage     from './pages/AnimePage';
import MyList        from './pages/MyList';
import { useParams } from 'react-router-dom';

function WatchRedirect() {
  const { id, ep } = useParams();
  return <Navigate to={`/anime/${id}?play=true&ep=${ep}`} replace />;
}
import DownloadPage  from './pages/DownloadPage';
import Profile       from './pages/Profile';
import FavoritesPage from './pages/FavoritesPage';
import WatchedPage   from './pages/WatchedPage';
import Navbar        from './components/Navbar';

// Inner component that has access to navigate (must be inside BrowserRouter)
function AppInner({ showWelcome, onEnter }) {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();
  const [searchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';

  // ── Capacitor Android back button handler ─────────────────────────
  // This fires when the Android hardware/gesture back button is pressed.
  // We navigate(-1) within React Router; only exit if there's no history.
  useEffect(() => {
    if (!isNative) return;
    const listener = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        navigate(-1);
      } else {
        CapApp.exitApp();
      }
    });
    return () => { listener.then(l => l.remove()).catch(() => {}); };
  }, [navigate, isNative]);

  return (
    <div className={`app-container ${isNative ? 'app-container--native' : ''}`}>
      {showWelcome ? (
        <WelcomeScreen onEnter={onEnter} />
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
    </div>
  );
}

import { setDynamicDomains } from './api/scrapers';

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    return !sessionStorage.getItem('anilab_welcomed');
  });

  const [updateInfo, setUpdateInfo] = useState(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null); // null | 0-100 | 'ready'
  const [currentVersion, setCurrentVersion] = useState('1.0.0');

  useEffect(() => {
    const initDeviceSettings = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          await StatusBar.setOverlaysWebView({ overlay: false });
          await StatusBar.setBackgroundColor({ color: '#000000' });
          await StatusBar.setStyle({ style: Style.Light });
        } catch (e) {
          console.warn('[Capacitor] StatusBar settings error:', e);
        }
      }
    };
    initDeviceSettings();
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
          const res = await fetch(url);
          if (res.ok) {
            data = await res.json();
            break;
          }
        } catch (e) {
          console.warn(`[Updater] Failed to fetch from ${url}:`, e);
        }
      }

      if (!data) return;

      // 1. Load dynamic domains
      if (data.domains) {
        setDynamicDomains(data.domains);
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
    sessionStorage.setItem('anilab_welcomed', '1');
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

            {updateInfo.changelog && (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 12,
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                textAlign: 'left',
                maxHeight: 120,
                overflowY: 'auto',
                marginBottom: 20
              }}>
                <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>What's New:</div>
                {updateInfo.changelog}
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
    </AppProvider>
  );
}

