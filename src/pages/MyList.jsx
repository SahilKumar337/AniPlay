import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Heart, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';


const TABS = [
  { id: 'all',           label: 'All',          icon: Bookmark   },
  { id: 'watching',      label: 'Watching',      icon: Clock      },
  { id: 'plan_to_watch', label: 'Plan to Watch', icon: Heart      },
  { id: 'completed',     label: 'Completed',     icon: CheckCircle },
  { id: 'dropped',       label: 'Dropped',       icon: XCircle    },
];

export default function MyList() {
  const navigate = useNavigate();
  const { watchlist, removeFromWatchlist, updateWatchlistStatus, progress } = useApp();
  const [activeTab, setActiveTab] = useState('all');

  const items = Object.values(watchlist);
  const filtered = activeTab === 'all'
    ? items
    : items.filter(item => item.status === activeTab);

  return (
    <div className="page">
      {/* Sticky Header Container */}
      <div className="sticky-header">
        {/* Header */}
        <div className="mylist-header" style={{ paddingBottom: 8 }}>
          <h1 className="mylist-title">My List</h1>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {items.length} anime
          </span>
        </div>

        {/* Tabs */}
        <div className="mylist-tabs" style={{ paddingBottom: 10 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`mylist-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
              id={`mylist-tab-${t.id}`}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Content Wrapper with Entrance Animation */}
      <div className="fade-in-up">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <Bookmark size={48} className="empty-icon" />
            <p className="empty-title">No anime here</p>
            <p className="empty-sub">Add anime to your list from the home or browse page</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => navigate('/')}
              id="mylist-browse"
            >Browse Anime</button>
          </div>
        ) : (
          <div className="mylist-grid">
            {filtered.map(({ anime, status }) => {
              const title   = getTitle(anime);
              const cover   = getCover(anime);
              const ep      = progress[anime.id];
              return (
                <div
                  key={anime.id}
                  className="mylist-card"
                  id={`mylist-card-${anime.id}`}
                  onClick={() => navigate(`/anime/${anime.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/anime/${anime.id}`)}
                  aria-label={title}
                >
                  <img src={cover} alt={title} loading="lazy" />

                  {/* Status badge */}
                  <div style={{
                    position: 'absolute', top: 6, left: 6,
                    background: statusColor(status),
                    padding: '2px 6px', borderRadius: 4,
                    fontSize: 9, fontWeight: 700, color: '#fff',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    {statusLabel(status)}
                  </div>

                  {/* Progress bar */}
                  {ep && anime.episodes && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                      background: 'rgba(255,255,255,0.1)',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(ep.episode / anime.episodes) * 100}%`,
                        background: 'var(--accent)',
                      }} />
                    </div>
                  )}

                  <div className="mylist-card-overlay">
                    <div className="mylist-card-title">{title}</div>
                    {ep && (
                      <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>
                        Ep {ep.episode}
                      </div>
                    )}
                  </div>

                  {/* Long-press context: quick actions */}
                  <div style={{
                    position: 'absolute', top: 6, right: 6,
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <button
                      onClick={e => { e.stopPropagation(); removeFromWatchlist(anime.id); }}
                      id={`remove-${anime.id}`}
                      aria-label="Remove from list"
                      style={{
                        width: 24, height: 24,
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      <XCircle size={14} color="#fff" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

function statusColor(status) {
  switch(status) {
    case 'watching':      return '#4caf50';
    case 'completed':     return '#2196f3';
    case 'dropped':       return '#9e9e9e';
    case 'plan_to_watch': return 'var(--accent)';
    default:              return 'var(--accent)';
  }
}
function statusLabel(status) {
  switch(status) {
    case 'watching':      return 'Watching';
    case 'completed':     return 'Done';
    case 'dropped':       return 'Dropped';
    case 'plan_to_watch': return 'Plan';
    default:              return 'List';
  }
}
