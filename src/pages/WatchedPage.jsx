import { useNavigate } from 'react-router-dom';
import { Clock, ArrowLeft, Trash2, Play } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';

export default function WatchedPage() {
  const navigate = useNavigate();
  const { recentlyViewed, progress, removeFromRecentlyViewed, watchlist } = useApp();

  const completedItems = Object.values(watchlist).filter(item => item.status === 'completed');

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
          <h1 className="mylist-title" style={{ fontSize: 20, margin: 0 }}>Watch History</h1>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {recentlyViewed.length} active · {completedItems.length} completed
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        {/* SECTION 1: Continue Watching */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} color="var(--accent)" />
            Currently Watching
          </h2>

          {recentlyViewed.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13
            }}>
              No recently watched episodes. Start watching an episode to see it here!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentlyViewed.map(({ anime, episode }) => {
                const title = getTitle(anime);
                const cover = getCover(anime);
                const currentProg = progress[anime.id];
                const totalEps = anime.episodes || 0;
                const progressPct = (currentProg && totalEps) ? (currentProg.episode / totalEps) * 100 : 0;

                return (
                  <div
                    key={anime.id}
                    onClick={() => navigate(`/anime/${anime.id}?play=true&ep=${episode}`)}
                    style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
                      padding: 10, display: 'flex', gap: 12, cursor: 'pointer', position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Cover Art */}
                    <div style={{ width: 50, height: 70, borderRadius: 6, overflow: 'hidden', background: '#222', flexShrink: 0, position: 'relative' }}>
                      <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Play size={14} color="#fff" fill="#fff" />
                      </div>
                    </div>

                    {/* Progress details */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                        {title}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>
                        Episode {episode} {totalEps > 0 && `of ${totalEps}`}
                      </div>
                      {totalEps > 0 && (
                        <div style={{
                          background: 'rgba(255,255,255,0.06)', height: 3, borderRadius: 2,
                          width: '100%', maxWidth: 200, marginTop: 8, overflow: 'hidden'
                        }}>
                          <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--accent)' }} />
                        </div>
                      )}
                    </div>

                    {/* Remove Action */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        removeFromRecentlyViewed(anime.id);
                      }}
                      aria-label="Remove watch progress"
                      style={{
                        position: 'absolute', top: 12, right: 12,
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center'
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SECTION 2: Completed Anime */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Completed
          </h2>

          {completedItems.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13
            }}>
              No completed anime. Set status to "Completed" in My List when you finish an anime.
            </div>
          ) : (
            <div className="mylist-grid">
              {completedItems.map(({ anime }) => {
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
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
