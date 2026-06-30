import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
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

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => {
    return !sessionStorage.getItem('anilab_welcomed');
  });

  useEffect(() => {
    const initDeviceSettings = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          // Style native status bar to match our theme and background
          await StatusBar.setBackgroundColor({ color: '#0f0f0f' });
          await StatusBar.setStyle({ style: Style.Dark });
        } catch (e) {
          console.warn('[Capacitor] StatusBar settings error:', e);
        }
      }
    };
    initDeviceSettings();
  }, []);

  const handleEnter = () => {
    sessionStorage.setItem('anilab_welcomed', '1');
    setShowWelcome(false);
  };

  return (
    <AppProvider>
      <BrowserRouter>
        <div className="app-container">
          {showWelcome ? (
            <WelcomeScreen onEnter={handleEnter} />
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
      </BrowserRouter>
    </AppProvider>
  );
}

