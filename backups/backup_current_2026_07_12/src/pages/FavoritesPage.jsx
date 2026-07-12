import { useNavigate } from 'react-router-dom';
import { Heart, ArrowLeft, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useApp();

  const items = Object.values(favorites);

  return (
    <div className="page fade-in-up">
      {/* Header */}
      <div className="sticky-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px 12px', paddingTop: 'max(32px, env(safe-area-inset-top))' }}>
        <button
          onClick={() => navigate(-1)}
          className="floating-btn"
          aria-label="Go back"
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="mylist-title" style={{ fontSize: 20, margin: 0 }}>Favorites</h1>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {items.length} anime
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px 16px 80px' }}>
        {items.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 60 }}>
            <Heart size={48} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <p className="empty-title" style={{ marginTop: 16 }}>No Favorites Yet</p>
            <p className="empty-sub">Tap the ❤️ heart icon beside the description on any anime details page to add it here</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 20 }}
              onClick={() => navigate('/')}
            >Browse Anime</button>
          </div>
        ) : (
          <div className="mylist-grid">
            {items.map((anime) => {
              const title = getTitle(anime);
              const cover = getCover(anime);
              return (
                <div
                  key={anime.id}
                  className="mylist-card"
                  onClick={() => navigate(`/anime/${anime.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/anime/${anime.id}`)}
                  aria-label={title}
                >
                  <img src={cover} alt={title} loading="lazy" />

                  <div className="mylist-card-overlay">
                    <div className="mylist-card-title">{title}</div>
                  </div>

                  {/* Quick Action: Delete/Remove Favorite */}
                  <div style={{ position: 'absolute', top: 6, right: 6 }}>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        toggleFavorite(anime.id);
                      }}
                      aria-label="Remove from favorites"
                      style={{
                        width: 28, height: 28,
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.65)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', cursor: 'pointer',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      <Trash2 size={13} color="#fff" />
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
