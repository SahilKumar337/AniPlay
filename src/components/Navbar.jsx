import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

// Premium SVG icons — filled for active, outlined for inactive
const IconHome = ({ filled }) => filled ? (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M20.42 10.18L12.71 2.47a1 1 0 00-1.42 0L3.58 10.18A2 2 0 003 11.59V20a2 2 0 002 2h4v-6h6v6h4a2 2 0 002-2v-8.41a2 2 0 00-.58-1.41z" fill="currentColor"/>
  </svg>
) : (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M20.42 10.18L12.71 2.47a1 1 0 00-1.42 0L3.58 10.18A2 2 0 003 11.59V20a2 2 0 002 2h5v-6h4v6h5a2 2 0 002-2v-8.41a2 2 0 00-.58-1.41z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
  </svg>
);

const IconSchedule = ({ filled }) => filled ? (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="18" rx="3" fill="currentColor" fillOpacity="0.15"/>
    <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="7" y="12" width="3" height="3" rx="1" fill="currentColor"/>
    <rect x="13" y="12" width="3" height="3" rx="1" fill="currentColor"/>
    <rect x="7" y="17" width="3" height="3" rx="1" fill="currentColor"/>
  </svg>
) : (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/>
    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="7" y="12" width="3" height="3" rx="1" fill="currentColor" fillOpacity="0.6"/>
    <rect x="13" y="12" width="3" height="3" rx="1" fill="currentColor" fillOpacity="0.6"/>
    <rect x="7" y="17" width="3" height="3" rx="1" fill="currentColor" fillOpacity="0.6"/>
  </svg>
);

const IconMyList = ({ filled }) => filled ? (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" fill="currentColor"/>
  </svg>
) : (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
  </svg>
);

const IconDownload = ({ filled }) => filled ? (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="4" y="17" width="16" height="4" rx="2" fill="currentColor"/>
  </svg>
) : (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

const IconProfile = ({ filled }) => filled ? (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" fill="currentColor"/>
    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" fill="currentColor" fillOpacity="0.85"/>
  </svg>
) : (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);

const NAV_ITEMS = [
  { Icon: IconHome,     label: 'Home',      path: '/'         },
  { Icon: IconSchedule, label: 'Schedule',  path: '/schedule' },
  { Icon: IconMyList,   label: 'My List',   path: '/mylist'   },
  { Icon: IconDownload, label: 'Download',  path: '/download' },
  { Icon: IconProfile,  label: 'Profile',   path: '/profile'  },
];

function useUnreadNotifCount() {
  const { unreadCount = 0 } = useApp();
  return unreadCount;
}

export default function Navbar() {
  const navigate     = useNavigate();
  const { pathname } = useLocation();
  const { user }     = useApp();
  const isOffline    = typeof window !== 'undefined' && !window.navigator.onLine;
  const unread       = useUnreadNotifCount();

  return (
    <nav className="navbar">
      <div className="nav-items">
        {NAV_ITEMS.map(({ Icon, label, path }) => {
          const isProfileActive = path === '/profile' &&
            (pathname === '/profile' || pathname === '/notifications');
          const active = isProfileActive ||
            (path === '/' ? pathname === '/' : pathname.startsWith(path));
          const isDisabledOffline = isOffline && path !== '/download';

          return (
            <button
              key={path}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => { if (!isDisabledOffline) navigate(path); }}
              style={{ opacity: isDisabledOffline ? 0.3 : 1, cursor: isDisabledOffline ? 'not-allowed' : 'pointer' }}
              id={`nav-${label.toLowerCase().replace(' ', '-')}`}
              disabled={isDisabledOffline}
              aria-label={label}
            >
              <span className="nav-icon-wrap">
                <Icon filled={active} />
                {path === '/profile' && unread > 0 && (
                  <span className="nav-badge" aria-label={`${unread} unread`} />
                )}
              </span>
              <span className="nav-label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
