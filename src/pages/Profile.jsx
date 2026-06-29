import { User, Settings, Info, Shield, LogOut, ChevronRight, Heart, Bookmark, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';


export default function Profile() {
  const { watchlist, favorites, progress } = useApp();
  const navigate = useNavigate();

  const watchlistCount = Object.keys(watchlist).length;
  const favCount       = favorites.size;
  const progressCount  = Object.keys(progress).length;

  const MENU_ITEMS = [
    { icon: Settings,  label: 'Settings',     action: () => {} },
    { icon: Info,      label: 'About AniLab', action: () => {} },
    { icon: Shield,    label: 'Privacy Policy', action: () => {} },
    { icon: LogOut,    label: 'Sign Out',     action: () => {}, color: 'var(--accent)' },
  ];

  return (
    <div className="page fade-in-up">
      <div style={{ padding: '24px 16px 16px' }}>
        {/* Avatar + Name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent), #ff6b35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '3px solid rgba(229,9,20,0.3)',
          }}>
            <User size={36} color="#fff" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-brand)' }}>Anime Fan</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>AniLab Member</div>
          </div>
        </div>

        {/* Stats */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12, marginBottom: 28,
        }}>
          {[
            { icon: Bookmark, label: 'My List',   value: watchlistCount, action: () => navigate('/mylist') },
            { icon: Heart,    label: 'Favorites',  value: favCount,       action: () => navigate('/mylist') },
            { icon: Clock,    label: 'Watched',    value: progressCount,  action: () => navigate('/mylist') },
          ].map(stat => (
            <div
              key={stat.label}
              onClick={stat.action}
              id={`profile-stat-${stat.label.toLowerCase()}`}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 12,
                padding: '14px 8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                transition: 'all 0.2s',
              }}
            >
              <stat.icon size={20} color="var(--accent)" />
              <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-brand)' }}>{stat.value}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stat.label}</span>
            </div>
          ))}
        </div>

        {/* Menu */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {MENU_ITEMS.map(item => (
            <button
              key={item.label}
              onClick={item.action}
              id={`profile-menu-${item.label.toLowerCase().replace(/\s/g, '-')}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px',
                background: 'var(--bg-card)',
                borderRadius: 12,
                border: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
              }}
            >
              <item.icon size={20} color={item.color || 'var(--text-secondary)'} />
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: item.color || 'var(--text-primary)' }}>
                {item.label}
              </span>
              <ChevronRight size={16} color="var(--text-muted)" />
            </button>
          ))}
        </div>

        {/* App version */}
        <div style={{ textAlign: 'center', marginTop: 28, color: 'var(--text-muted)', fontSize: 12 }}>
          AniLab v1.0.0 · Made with ❤ for anime fans
        </div>
      </div>
    </div>
  );
}
