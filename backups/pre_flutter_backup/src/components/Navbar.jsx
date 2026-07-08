import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Calendar, Bookmark, Download, User } from 'lucide-react';

const NAV_ITEMS = [
  { icon: Home,     label: 'Home',      path: '/'         },
  { icon: Calendar, label: 'Schedule',  path: '/schedule' },
  { icon: Bookmark, label: 'My List',   path: '/mylist'   },
  { icon: Download, label: 'Download',  path: '/download' },
  { icon: User,     label: 'Profile',   path: '/profile'  },
];

export default function Navbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isOffline = typeof window !== 'undefined' && !window.navigator.onLine;

  return (
    <nav className="navbar">
      <div className="nav-items">
        {NAV_ITEMS.map(({ icon: Icon, label, path }) => {
          const active = pathname === path || (path !== '/' && pathname.startsWith(path));
          const isDisabledOffline = isOffline && path !== '/download';
          return (
            <button
              key={path}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => {
                if (!isDisabledOffline) navigate(path);
              }}
              style={{
                opacity: isDisabledOffline ? 0.35 : 1,
                cursor: isDisabledOffline ? 'not-allowed' : 'pointer'
              }}
              id={`nav-${label.toLowerCase().replace(' ', '-')}`}
              disabled={isDisabledOffline}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
