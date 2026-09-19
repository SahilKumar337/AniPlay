import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Heart, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';

/**
 * ── Floating Header rendered via Portal ─────────────────────────
 * position:fixed breaks inside .page because the .page element has
 * a CSS animation (pageEnter), and in Chromium/Android-WebView ANY
 * CSS animation on an ancestor creates a new containing block that
 * makes position:fixed behave like position:absolute.
 *
 * Solution: use ReactDOM.createPortal to render the header directly
 * into document.body, escaping the entire .app-container → .page
 * ancestor chain.
 */
function FloatingHeader({ children }) {
  return createPortal(children, document.body);
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useApp();
  const [scrolled, setScrolled] = useState(false);

  const items = Object.values(favorites);

  useEffect(() => {
    const getScrollY = () =>
      Math.max(document.documentElement.scrollTop, document.body.scrollTop, window.scrollY || 0);
    const onScroll = () => setScrolled(getScrollY() > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div
      className="page fade-in-up"
      style={{
        paddingTop: 'calc(var(--sat, 0px) + 76px)',
        minHeight: '100vh',
        background: 'var(--bg-primary)',
      }}
    >
      {/* ── Floating Header — portaled to document.body to escape .page animation containment ── */}
      <FloatingHeader>
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          maxWidth: 480,
          marginLeft: 'auto',
          marginRight: 'auto',
          /* ── Glassmorphism ── */
          background: scrolled
            ? 'rgba(16,16,20,0.65)'
            : 'rgba(16,16,20,0.45)',
          backdropFilter: 'blur(48px) saturate(200%)',
          WebkitBackdropFilter: 'blur(48px) saturate(200%)',
          borderBottom: scrolled
            ? '1px solid rgba(255,255,255,0.1)'
            : '1px solid rgba(255,255,255,0.05)',
          boxShadow: scrolled
            ? 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)'
            : 'inset 0 1px 0 rgba(255,255,255,0.03)',
          transition: 'background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
        }}>
          <div style={{
            padding: '12px 18px 14px',
            paddingTop: 'calc(var(--sat, 0px) + 12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 12,
                background: 'linear-gradient(135deg, #e11d48, #be123c)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px -2px rgba(225,29,72,0.45)',
                flexShrink: 0,
              }}>
                <Heart size={17} color="#fff" fill="#fff" />
              </div>
              <span style={{
                fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
                color: '#fff', fontFamily: 'var(--font-brand)',
              }}>Favorites</span>
            </div>
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600,
              background: 'rgba(255,255,255,0.07)', borderRadius: 20, padding: '4px 12px',
            }}>
              {items.length} anime
            </span>
          </div>
        </div>
      </FloatingHeader>

      {/* ── Content ── */}
      <div style={{ padding: '0 14px 100px' }}>
        {items.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '80px 32px', gap: 14, textAlign: 'center',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: 24,
              background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Heart size={32} color="#e11d48" style={{ opacity: 0.5 }} />
            </div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>
              No Favorites Yet
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              Tap the ❤️ heart on any anime page to add it here
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              onClick={() => navigate('/')}
            >
              Browse Anime
            </button>
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
                  onClick={() => navigate(`/anime/${anime.id}`, { state: { anime } })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate(`/anime/${anime.id}`, { state: { anime } })}
                  aria-label={title}
                >
                  <div className="mylist-card-poster">
                    <img src={cover} alt={title} loading="eager" decoding="async" />
                    <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 10 }}>
                      <button
                        className="mylist-action-btn"
                        onClick={e => { e.stopPropagation(); toggleFavorite(anime.id); }}
                        aria-label="Remove from favorites"
                      >
                        <Trash2 size={13} color="#fff" />
                      </button>
                    </div>
                    <div style={{
                      position: 'absolute', bottom: 6, left: 6,
                      background: 'rgba(225,29,72,0.85)',
                      borderRadius: 6, padding: '2px 5px',
                      display: 'flex', alignItems: 'center',
                    }}>
                      <Heart size={9} color="#fff" fill="#fff" />
                    </div>
                  </div>
                  <div className="mylist-card-info">
                    <div className="mylist-card-title">{title}</div>
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
