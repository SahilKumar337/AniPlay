import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams, useLocation, useParams } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { StatusBar } from '@capacitor/status-bar';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { supabase } from './api/supabase';
import { dispatchBackButton } from './utils/backButton';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import WelcomeScreen from './components/WelcomeScreen';
import NewPasswordModal from './components/NewPasswordModal';
import Navbar from './components/Navbar';
import { requestInitialPermissions } from './api/permissions';
import { initPushNotifications } from './api/notifications';
import { setDynamicDomains, setDynamicMappings } from './api/scrapers';
import adEngine from './services/adEngine';

// Eagerly loaded for instantaneous 0ms cold-start
import Home from './pages/Home';

// Route code-splitting: loaded on demand to reduce initial JS payload
const Browse = lazy(() => import('./pages/Browse'));
const Schedule = lazy(() => import('./pages/Schedule'));
const AnimePage = lazy(() => import('./pages/AnimePage'));
const MyList = lazy(() => import('./pages/MyList'));
const DownloadPage = lazy(() => import('./pages/DownloadPage'));
const Profile = lazy(() => import('./pages/Profile'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
const WatchedPage = lazy(() => import('./pages/WatchedPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const Notifications = lazy(() => import('./pages/Notifications'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const Landing = lazy(() => import('./pages/Landing'));

function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '50vh',
      width: '100%',
    }}>
      <div style={{
        width: 28,
        height: 28,
        border: '2.5px solid rgba(255, 255, 255, 0.08)',
        borderTopColor: 'var(--accent, #6366f1)',
        borderRadius: '50%',
        animation: 'anip-spin 0.75s linear infinite',
        willChange: 'transform',
      }} />
      <style>{`@keyframes anip-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// registerPlugin must run after all imports are resolved
const APKUpdater = registerPlugin('APKUpdater');

function WatchRedirect() {
  const { id, ep } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    navigate(`/anime/${id}?play=true&ep=${ep}&direct=true`, {
      replace: true,
      state: { ...location.state, directPlay: true }
    });
  }, [id, ep, navigate, location.state]);

  return null;
}


// Inner component that has access to navigate (must be inside BrowserRouter)
function AppInner({ showWelcome, onEnter }) {
  const { user, showToast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isNative = Capacitor.isNativePlatform();
  const [searchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showNewPasswordModal, setShowNewPasswordModal] = useState(false);
  const hasShownAuthRef = useRef(false);

  // ── Deep Link Handler: Supabase email confirmation & password recovery via aniplay:// ─
  useEffect(() => {
    let subscription = null;

    const handleDeepLink = async ({ url }) => {
      if (!url) return;
      console.log('[DeepLink] Received URL:', url);
      try {
        // Supabase sends tokens as hash fragment: #access_token=...&type=recovery
        // Or as query params: ?code=... depending on PKCE vs implicit flow
        const cleanUrl = url.startsWith('aniplay://')
          ? url.replace('aniplay://', 'https://aniplay.app/')
          : url;
        const urlObj = new URL(cleanUrl);
        const hashParams = new URLSearchParams(urlObj.hash.slice(1));
        const code = urlObj.searchParams.get('code');
        const access_token = urlObj.searchParams.get('access_token') || hashParams.get('access_token');
        const refresh_token = urlObj.searchParams.get('refresh_token') || hashParams.get('refresh_token');
        const type = urlObj.searchParams.get('type') || hashParams.get('type');
        const errorDesc = urlObj.searchParams.get('error_description') || hashParams.get('error_description');

        // Edge Case: Supabase returned an error in the redirect URL
        if (errorDesc) {
          console.warn('[DeepLink] Supabase redirect reported error:', errorDesc);
          showToast('This auth link has expired or is invalid. Please request a new one.');
          return;
        }

        if (code) {
          // PKCE flow — exchange code for session first
          await supabase.auth.exchangeCodeForSession(code);
        } else if (access_token && refresh_token) {
          // Implicit flow — set session directly
          await supabase.auth.setSession({ access_token, refresh_token });
        }

        const isRecovery = type === 'recovery' || url.includes('type=recovery') || url.includes('reset-password');
        if (isRecovery) {
          showToast('Link verified. Please enter your new password.');
          setTimeout(() => setShowNewPasswordModal(true), 150);
        } else if (code || (access_token && refresh_token)) {
          // Delay briefly so onAuthStateChange has time to register PASSWORD_RECOVERY if applicable
          setTimeout(() => {
            setShowNewPasswordModal(curr => {
              if (!curr) {
                showToast('Email confirmed! Welcome to AniPlay 🎉');
              }
              return curr;
            });
          }, 350);
        }

        // Clean up URL parameters if in browser mode to avoid keeping tokens in browser history
        if (!isNative && typeof window !== 'undefined' && window.history?.replaceState) {
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (_) {}
        }
      } catch (err) {
        console.error('[DeepLink] Auth token exchange failed:', err);
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('expired') || msg.includes('token') || msg.includes('verifier') || msg.includes('code')) {
          showToast('This auth link has expired. Please request a new one.');
        } else {
          showToast('Authentication error. Please log in with your credentials.');
        }
      }
    };

    if (isNative) {
      CapApp.addListener('appUrlOpen', handleDeepLink).then(sub => {
        subscription = sub;
      });

      // Handle cold start when app is opened directly by clicking email link
      CapApp.getLaunchUrl().then(launchUrl => {
        if (launchUrl?.url) {
          handleDeepLink({ url: launchUrl.url });
        }
      }).catch(() => {});
    } else {
      // Web / Browser mode check for auth callbacks in URL hash or search params
      const currentUrl = window.location.href;
      if (currentUrl.includes('access_token=') || currentUrl.includes('code=') || currentUrl.includes('type=recovery')) {
        handleDeepLink({ url: currentUrl });
      }
    }

    // Also listen to Supabase auth state change for PASSWORD_RECOVERY
    // This fires after exchangeCodeForSession() / setSession() resolves.
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(() => setShowNewPasswordModal(true), 120);
      }
    });

    return () => {
      subscription?.remove();
      authSub?.unsubscribe();
    };
  }, [isNative]);

  // Request storage & notification permissions ONCE on first app launch
  useEffect(() => {
    if (!isNative) return;
    requestInitialPermissions().catch(() => {});
  }, [isNative]);

  // Initialize Push & Local Notifications (channel setup, FCM token sync, foreground & tap listeners)
  useEffect(() => {
    if (!isNative) return;
    initPushNotifications(user?.id, navigate).catch(err => {
      console.warn('[PushNotifications] Init warning:', err);
    });
  }, [isNative, user?.id, navigate]);


  // First-time onboarding: navigate to auth page after 1.5s if not logged in
  useEffect(() => {
    if (!showWelcome && !user && !hasShownAuthRef.current) {
      const onboarded = localStorage.getItem('aniplay_onboarded');
      if (!onboarded) {
        hasShownAuthRef.current = true;
        const timer = setTimeout(() => {
          navigate('/auth', { state: { mode: 'login' } });
          localStorage.setItem('aniplay_onboarded', 'true');
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [showWelcome, user, navigate]);

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

        // First: let any open popup/modal/sheet consume the back event
        if (dispatchBackButton()) return;

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
      handlePromise.then(l => l.remove()).catch(() => { });
    };
  }, [navigate, isNative]);

  const path = location.pathname;
  const isMainTab = path === '/' || path === '/schedule' || path === '/mylist' || path === '/download' || path === '/profile';
  let currentTab = 'home';
  if (path.startsWith('/schedule')) currentTab = 'schedule';
  else if (path.startsWith('/mylist')) currentTab = 'mylist';
  else if (path.startsWith('/download')) currentTab = 'download';
  else if (path.startsWith('/profile')) currentTab = 'profile';

  const [visitedTabs, setVisitedTabs] = useState(() => new Set([currentTab]));
  const scrollPositions = useRef({});
  const prevTabRef = useRef(currentTab);
  const wasMainTabRef = useRef(isMainTab);

  useEffect(() => {
    if (isMainTab) {
      setVisitedTabs(prev => {
        if (prev.has(currentTab)) return prev;
        const next = new Set(prev);
        next.add(currentTab);
        return next;
      });

      const prevTab = prevTabRef.current;
      if (prevTab !== currentTab || !wasMainTabRef.current) {
        if (prevTab !== currentTab && wasMainTabRef.current) {
          scrollPositions.current[prevTab] = window.scrollY || document.documentElement.scrollTop || 0;
        }
        prevTabRef.current = currentTab;
        const targetY = scrollPositions.current[currentTab] || 0;
        window.scrollTo({ top: targetY, behavior: 'instant' });
      }
      wasMainTabRef.current = true;
    } else {
      if (wasMainTabRef.current) {
        scrollPositions.current[currentTab] = window.scrollY || document.documentElement.scrollTop || 0;
      }
      wasMainTabRef.current = false;
    }
  }, [isMainTab, currentTab]);

  return (
    <div className={`app-container ${isNative ? 'app-container--native' : ''}`}>
      {showWelcome && location.pathname === '/' ? (
        <WelcomeScreen
          onEnter={onEnter}
          onSignIn={() => {
            onEnter();
            localStorage.setItem('aniplay_onboarded', 'true');
            hasShownAuthRef.current = true;
            navigate('/auth', { state: { mode: 'login' } });
          }}
        />
      ) : (
        <>
          {/* Main Tab Stage — Persistent Mounting (Instant Launch + 120 FPS Kept-Alive Tabs) */}
          <div className="tab-stage" style={{ display: isMainTab ? 'block' : 'none', flex: 1, position: 'relative' }}>
            <div className={`tab-panel ${currentTab === 'home' ? 'tab-panel-active' : 'tab-panel-hidden'}`}>
              {visitedTabs.has('home') && <Home />}
            </div>
            <div className={`tab-panel ${currentTab === 'schedule' ? 'tab-panel-active' : 'tab-panel-hidden'}`}>
              {visitedTabs.has('schedule') && (
                <Suspense fallback={<PageLoader />}>
                  <Schedule />
                </Suspense>
              )}
            </div>
            <div className={`tab-panel ${currentTab === 'mylist' ? 'tab-panel-active' : 'tab-panel-hidden'}`}>
              {visitedTabs.has('mylist') && (
                <Suspense fallback={<PageLoader />}>
                  <MyList />
                </Suspense>
              )}
            </div>
            <div className={`tab-panel ${currentTab === 'download' ? 'tab-panel-active' : 'tab-panel-hidden'}`}>
              {visitedTabs.has('download') && (
                <Suspense fallback={<PageLoader />}>
                  <DownloadPage />
                </Suspense>
              )}
            </div>
            <div className={`tab-panel ${currentTab === 'profile' ? 'tab-panel-active' : 'tab-panel-hidden'}`}>
              {visitedTabs.has('profile') && (
                <Suspense fallback={<PageLoader />}>
                  <Profile />
                </Suspense>
              )}
            </div>
          </div>

          {/* Sub-routes (Anime detail, Search, Notifications, History, etc.) */}
          {!isMainTab && (
            <div style={{ position: 'relative', flex: 1 }}>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/browse" element={<Browse />} />
                  <Route path="/anime/:id" element={<AnimePage />} />
                  <Route path="/watch/:id/:ep" element={<WatchRedirect />} />
                  <Route path="/favorites" element={<FavoritesPage />} />
                  <Route path="/watched" element={<WatchedPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/landing" element={<Landing />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </div>
          )}
          {isMainTab ? <Navbar /> : (!playParam && <div className="app-bottom-bezel" aria-hidden="true" />)}
        </>
      )}
      {showNewPasswordModal && (
        <NewPasswordModal isOpen={showNewPasswordModal} onClose={() => setShowNewPasswordModal(false)} />
      )}
    </div>
  );
}

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem('anilab_welcomed');
  });

  const [updateInfo, setUpdateInfo] = useState(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null); // null | 0-100 | 'ready'
  const [currentVersion, setCurrentVersion] = useState('1.0.0');
  const [cfModal, setCfModal] = useState({ visible: false, domain: '' });

  // ── Boot Shell Dismissal ─────────────────────────────────────
  // Runs once on first mount. Adds the CSS `.boot-out` class which triggers
  // the opacity transition defined in index.html, then removes the element
  // from the DOM after the transition so it takes zero memory/paint resources.
  useEffect(() => {
    const bootShell = document.getElementById('boot-shell');
    if (!bootShell) return;
    // rAF ensures React has flushed its first paint before we start fading
    const raf = requestAnimationFrame(() => {
      bootShell.classList.add('boot-out');
      const onEnd = () => {
        if (bootShell.parentNode) bootShell.parentNode.removeChild(bootShell);
      };
      bootShell.addEventListener('transitionend', onEnd, { once: true });
      // Fallback: remove after 600ms even if transitionend doesn't fire
      setTimeout(onEnd, 600);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

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
        // Read actual status bar height and expose as CSS variable for the player overlay.
        try {
          const info = await StatusBar.getInfo();
          const sbCssPx = info?.height ?? 0;
          document.documentElement.style.setProperty('--sb-height', `${sbCssPx}px`);
          console.log('[StatusBar] height:', sbCssPx, 'px | visible:', info?.visible);
        } catch (e2) {
          document.documentElement.style.setProperty('--sb-height', '0px');
        }
        // NOTE: --android-safe-bottom is set by MainActivity.java's WindowInsetsCompat listener
        // (reading real navigationBars() inset height). Do NOT measure it in JS — the
        // JS viewport calculation fires on keyboard open/close and gives wrong values.
      } else {
        document.documentElement.style.setProperty('--sb-height', '0px');
        document.documentElement.style.setProperty('--android-safe-bottom', '0px');
      }
    };
    initDeviceSettings();
  }, []);

  // ── Software keyboard detection — hide navbar when keyboard opens ──────
  // visualViewport.height shrinks when Android keyboard opens. Compare to
  // screen.height (physical screen, never changes) to detect keyboard.
  // This is the industry-standard approach used by Twitter/X, YouTube, etc.
  // NOTE: We deliberately do NOT update CSS safe-area vars here — only toggle
  // a class. The comment about "JS viewport giving wrong values" refers only
  // to --android-safe-bottom measurement, not keyboard open/close detection.
  useEffect(() => {
    if (!window.visualViewport) return;

    const onViewportResize = () => {
      // If visual viewport is less than 70% of screen height → keyboard is open
      const isKeyboardOpen = window.visualViewport.height < window.screen.height * 0.70;
      document.body.classList.toggle('keyboard-open', isKeyboardOpen);
    };

    window.visualViewport.addEventListener('resize', onViewportResize);
    return () => window.visualViewport.removeEventListener('resize', onViewportResize);
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
        if (data.domains.neko && data.domains.neko.includes('anineko.to')) {
          data.domains.neko = 'https://anineko.es';
        }
        setDynamicDomains(data.domains);
      }
      if (data.mappings) {
        setDynamicMappings(data.mappings);
      }

      // 1b. Initialize Scraper-Safe Ad Engine
      if (data.ads) {
        adEngine.init(data.ads);
      }

      // 1c. Cache latest APK release URL for in-app share feature
      if (data.apkUrl) {
        localStorage.setItem('aniplay_latest_release_url', data.apkUrl);
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

      if (Capacitor.isNativePlatform() && data.latestVersion && isNewerVersion(data.latestVersion, appVer)) {
        setUpdateInfo(data);
      }
    }
    checkUpdates();
  }, []);

  const handleEnter = () => {
    localStorage.setItem('anilab_welcomed', '1');
    setShowWelcome(false);
  };


  // ── In-app Update: open APK in system browser (same as CloudStream/Aniyomi) ──
  const handleUpdateNow = async () => {
    if (!updateInfo?.apkUrl) return;

    try {
      if (Capacitor.isNativePlatform()) {
        // Native APKUpdater plugin: fires Android ACTION_VIEW Intent directly to system browser
        await APKUpdater.openExternalUrl({ url: updateInfo.apkUrl });
        return;
      }
    } catch (err) {
      console.warn('[Updater] Failed to open via APKUpdater:', err);
    }

    // Web fallback
    try {
      window.location.href = updateInfo.apkUrl;
    } catch (_) {
      window.open(updateInfo.apkUrl, '_blank');
    }
  };

  return (
    <GlobalErrorBoundary>
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
                onClick={handleUpdateNow}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
                  color: '#fff',
                  fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  transition: 'background-color 0.2s ease, opacity 0.2s ease, transform 0.15s ease',
                }}
              >
                🚀 Update Now
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
    </GlobalErrorBoundary>
  );
}

