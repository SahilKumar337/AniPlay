import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import WelcomeScreen from './components/WelcomeScreen';
import Home          from './pages/Home';
import Browse        from './pages/Browse';
import Schedule      from './pages/Schedule';
import AnimePage     from './pages/AnimePage';
import WatchPage     from './pages/WatchPage';
import MyList        from './pages/MyList';
import DownloadPage  from './pages/DownloadPage';
import Profile       from './pages/Profile';
import Navbar        from './components/Navbar';

// Inner component that has access to navigate (must be inside BrowserRouter)
function AppInner({ showWelcome, onEnter }) {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

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
            <Route path="/watch/:id/:ep" element={<WatchPage />}  />
            <Route path="/mylist"      element={<MyList />}       />
            <Route path="/download"    element={<DownloadPage />} />
            <Route path="/profile"     element={<Profile />}      />
            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
          <Navbar />
        </>
      )}
    </div>
  );
}

import { setDynamicDomains } from './api/scrapers';

const CURRENT_VERSION = '1.0.0';

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    return !sessionStorage.getItem('anilab_welcomed');
  });

  const [updateInfo, setUpdateInfo] = useState(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState(null);

  useEffect(() => {
    const initDeviceSettings = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          await StatusBar.setStyle({ style: Style.Dark });
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
      const urls = [
        'https://raw.githubusercontent.com/SahilKumar337/AniPlay/main/update.json',
        'https://raw.githubusercontent.com/SahilKumar337/Anilab/main/update.json'
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

      // 3. Compare version
      if (data.latestVersion && data.latestVersion !== CURRENT_VERSION) {
        setUpdateInfo(data);
      }
    }
    checkUpdates();
  }, []);

  const handleEnter = () => {
    sessionStorage.setItem('anilab_welcomed', '1');
    setShowWelcome(false);
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
              Version {updateInfo.latestVersion} (Current: {CURRENT_VERSION})
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

            <div style={{ display: 'flex', gap: 10 }}>
              {!updateInfo.forceUpdate && (
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
                onClick={() => window.open(updateInfo.apkUrl, '_system')}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 10,
                  border: 'none',
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer'
                }}
              >
                Update Now
              </button>
            </div>
          </div>
        </div>
      )}
    </AppProvider>
  );
}

