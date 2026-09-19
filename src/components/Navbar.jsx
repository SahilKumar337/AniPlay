import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

// High-fidelity SVG icons — filled for active, clean stroke for inactive
const IconHome = ({ filled }) => filled ? (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M20.42 10.18L12.71 2.47a1 1 0 00-1.42 0L3.58 10.18A2 2 0 003 11.59V20a2 2 0 002 2h4v-6h6v6h4a2 2 0 002-2v-8.41a2 2 0 00-.58-1.41z" fill="currentColor"/>
  </svg>
) : (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M20.42 10.18L12.71 2.47a1 1 0 00-1.42 0L3.58 10.18A2 2 0 003 11.59V20a2 2 0 002 2h5v-6h4v6h5a2 2 0 002-2v-8.41a2 2 0 00-.58-1.41z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
  </svg>
);

const IconSchedule = ({ filled }) => filled ? (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="18" rx="3" fill="currentColor" fillOpacity="0.22"/>
    <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.6"/>
    <rect x="7" y="12" width="3" height="3" rx="1" fill="currentColor"/>
    <rect x="13" y="12" width="3" height="3" rx="1" fill="currentColor"/>
    <rect x="7" y="17" width="3" height="3" rx="1" fill="currentColor"/>
  </svg>
) : (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.6"/>
    <rect x="7" y="12" width="3" height="3" rx="1" fill="currentColor" fillOpacity="0.6"/>
    <rect x="13" y="12" width="3" height="3" rx="1" fill="currentColor" fillOpacity="0.6"/>
    <rect x="7" y="17" width="3" height="3" rx="1" fill="currentColor" fillOpacity="0.6"/>
  </svg>
);

const IconMyList = ({ filled }) => filled ? (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" fill="currentColor"/>
  </svg>
) : (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
  </svg>
);

const IconDownload = ({ filled }) => filled ? (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M12 3v11m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="4" y="17" width="16" height="4" rx="2" fill="currentColor"/>
  </svg>
) : (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
  </svg>
);

const IconProfile = ({ filled }) => filled ? (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" fill="currentColor"/>
    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" fill="currentColor" fillOpacity="0.9"/>
  </svg>
) : (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

const NAV_ITEMS = [
  { id: 'home',     Icon: IconHome,     label: 'Home',      path: '/'         },
  { id: 'schedule', Icon: IconSchedule, label: 'Schedule',  path: '/schedule' },
  { id: 'mylist',   Icon: IconMyList,   label: 'My List',   path: '/mylist'   },
  { id: 'download', Icon: IconDownload, label: 'Download',  path: '/download' },
  { id: 'profile',  Icon: IconProfile,  label: 'Profile',   path: '/profile'  },
];

export default function Navbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { unreadCount = 0 } = useApp();
  const isOffline = typeof window !== 'undefined' && !window.navigator.onLine;

  // Resolve active index from URL — returns -1 for sub-pages like /browse (Search)
  const getActiveIndexFromPath = (path) => {
    if (path === '/' || path === '') return 0;
    if (path.startsWith('/schedule')) return 1;
    if (path.startsWith('/mylist')) return 2;
    if (path.startsWith('/download')) return 3;
    if (path.startsWith('/profile') || path.startsWith('/notifications') || path.startsWith('/history') || path.startsWith('/watched') || path.startsWith('/favorites')) return 4;
    return -1; // No tab selected for Search (/browse), Anime details (/anime/...), etc.
  };

  const [activeIndex, setActiveIndex] = useState(() => getActiveIndexFromPath(pathname));

  // Sync state whenever route changes
  useEffect(() => {
    setActiveIndex(getActiveIndexFromPath(pathname));
  }, [pathname]);

  const handleTabClick = (index, path, isDisabled) => {
    if (isDisabled) return;
    if (activeIndex === index) {
      // Tapping active tab smoothly scrolls page to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setActiveIndex(index); // Instant 120 FPS GPU glide
    navigate(path);
  };

  return (
    <>
      {/* ── Background Liquid Blur Dock (Blurs content gliding under the capsule) ── */}
      <div className="navbar-dock-blur" aria-hidden="true" />

      {/* ── Permanent Bottom Black Bezel (Resting under system navigation keys) ── */}
      <div className="navbar-bottom-bezel" aria-hidden="true" />

      {/* ── Floating Capsule Navbar ── */}
      <nav className="navbar navbar-container" aria-label="Bottom Navigation">
        <div className="navbar-capsule">
          {/* ── Hardware-Accelerated Sliding Liquid Glass Pill Indicator ── */}
          {activeIndex >= 0 && (
            <div
              className="navbar-indicator-track"
              style={{
                transform: `translate3d(${activeIndex * 100}%, 0, 0)`,
              }}
              aria-hidden="true"
            >
              <div className="navbar-indicator-pill" />
            </div>
          )}

          {NAV_ITEMS.map(({ id, Icon, label, path }, idx) => {
            const active = activeIndex === idx;
            const isDisabledOffline = isOffline && path !== '/download';

            return (
              <button
                key={id}
                type="button"
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => handleTabClick(idx, path, isDisabledOffline)}
                id={`nav-${id}`}
                disabled={isDisabledOffline}
                aria-label={label}
              >
                <span className="nav-icon-wrap">
                  <Icon filled={active} />
                  {id === 'profile' && unreadCount > 0 && (
                    <span className="nav-badge" aria-label={`${unreadCount} unread`} />
                  )}
                </span>
                <span className="nav-label">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
