import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Heart, Play, X, CheckCircle2, Clock, Eye, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';
import { registerBackButtonHandler } from '../utils/backButton';

/* ── Status config ──────────────────────────────────────────────────────── */
const STATUS_CONFIG = {
  watching: { label: 'Watching', icon: Eye, color: '#22c55e', dot: '#22c55e' },
  plan_to_watch: { label: 'Plan to Watch', icon: Clock, color: '#a78bfa', dot: '#a78bfa' },
  completed: { label: 'Completed', icon: CheckCircle2, color: '#38bdf8', dot: '#38bdf8' },
  dropped: { label: 'Dropped', icon: X, color: '#94a3b8', dot: '#94a3b8' },
};

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'watching', label: 'Watching' },
  { id: 'plan_to_watch', label: 'Plan' },
  { id: 'completed', label: 'Done' },
  { id: 'dropped', label: 'Dropped' },
];

/* ── Card animation keyframes ───────────────────────────────────────────── */
const ANIM_STYLE = `
@keyframes _mylist_pop_in {
  from { opacity:0; transform: translate3d(0, 12px, 0) scale(0.92); }
  to   { opacity:1; transform: translate3d(0, 0, 0)   scale(1); }
}
@keyframes _mylist_delete_out {
  0%   { opacity:1; transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
  100% { opacity:0; transform: translate3d(0, 18px, 0) scale(0.78) rotate(-4deg); }
}
@keyframes _mylist_header_in {
  from { opacity:0; transform: translate3d(0, -8px, 0); }
  to   { opacity:1; transform: translate3d(0, 0, 0); }
}
.mylist-card-enter  {
  animation: _mylist_pop_in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: transform, opacity;
  backface-visibility: hidden;
}
.mylist-card-remove {
  animation: _mylist_delete_out 0.38s cubic-bezier(0.36, 0, 0.66, -0.56) forwards;
  will-change: transform, opacity;
}
.mylist-header-in {
  animation: _mylist_header_in 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: transform, opacity;
}
`;

/* ── Single Card component ──────────────────────────────────────────────── */
function AnimeCard({ anime, status, progress, isFav, onRemove, onStatusChange, onOpenMenu, index }) {
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.plan_to_watch;
  const ep = progress?.[anime.id];
  const title = getTitle(anime);
  const cover = getCover(anime);
  const pct = ep && anime.episodes ? Math.min(100, (ep.episode / anime.episodes) * 100) : 0;

  const handleRemove = (e) => {
    e.stopPropagation();
    setRemoving(true);
    setTimeout(() => onRemove(anime.id), 400);
  };

  return (
    <div
      id={`mylist-card-${anime.id}`}
      className={`mylist-card-enter ${removing ? 'mylist-card-remove' : ''}`}
      style={{
        cursor: 'pointer',
        animationDelay: `${Math.min(index * 0.03, 0.3)}s`,
        position: 'relative',
        transition: 'transform 0.42s cubic-bezier(0.34, 1.25, 0.64, 1), opacity 0.42s ease',
        opacity: removing ? 0 : 1,
        transform: removing ? 'scale(0.8) translateY(18px) rotate(-3deg)' : 'none',
      }}
    >
      {/* ── Poster ─────────────────────────────────────────────────────── */}
      <div
        onClick={() => navigate(`/anime/${anime.id}`)}
        style={{
          position: 'relative', borderRadius: 12, overflow: 'hidden',
          aspectRatio: '2/3', background: '#111',
          boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
          transition: 'transform 0.25s cubic-bezier(0.2,1,0.3,1), box-shadow 0.25s ease',
        }}
        onTouchStart={e => e.currentTarget.style.transform = 'scale(0.96)'}
        onTouchEnd={e => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <img
          src={cover} alt={title} loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />

        {/* Gradient scrim */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)',
          pointerEvents: 'none',
        }} />

        {/* ── Remove button — top-right ────────────────────────────────── */}
        <button
          onClick={handleRemove}
          id={`remove-${anime.id}`}
          aria-label="Remove from list"
          style={{
            position: 'absolute', top: 6, right: 6, zIndex: 10,
            width: 24, height: 24, borderRadius: '50%',
            background: 'rgba(12,12,16,0.65)',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.16)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2,1,0.3,1)',
          }}
          onTouchStart={e => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.85)';
            e.currentTarget.style.transform = 'scale(1.15)';
          }}
          onTouchEnd={e => {
            e.currentTarget.style.background = 'rgba(12,12,16,0.65)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <X size={11} color="rgba(255,255,255,0.95)" strokeWidth={2.5} />
        </button>

        {/* ── Favorite dot — top-left ───────────────────────────────────── */}
        {isFav && (
          <div style={{
            position: 'absolute', top: 6, left: 6, zIndex: 10,
            width: 20, height: 20, borderRadius: '50%',
            background: 'rgba(12,12,16,0.65)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.16)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Heart size={9} color="#e50914" fill="#e50914" />
          </div>
        )}

        {/* ── Progress bar ──────────────────────────────────────────────── */}
        {pct > 0 && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 3, background: 'rgba(0,0,0,0.4)',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: `linear-gradient(90deg, ${cfg.color}, ${cfg.color}cc)`,
              boxShadow: `0 0 6px ${cfg.color}aa`,
              borderRadius: '0 2px 2px 0',
              transition: 'width 0.5s ease',
            }} />
          </div>
        )}
      </div>

      {/* ── Meta below poster ─────────────────────────────────────────────── */}
      <div style={{ padding: '8px 2px 0', position: 'relative' }}>
        {/* Title — compact, 2-line clamp */}
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-primary)',
          lineHeight: 1.3, letterSpacing: '-0.1px',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
          marginBottom: 6,
        }}>{title}</div>

        {/* Status pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <button
            onClick={e => { e.stopPropagation(); onOpenMenu(anime, status); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: `${cfg.color}16`,
              border: `1px solid ${cfg.color}38`,
              borderRadius: 6, padding: '3px 7px',
              cursor: 'pointer', transition: 'all 0.2s ease',
            }}
          >
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {cfg.label === 'Plan to Watch' ? 'PLAN' : cfg.label.toUpperCase()}
            </span>
            <ChevronDown size={8} color={cfg.color} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────── */
export default function MyList() {
  const navigate = useNavigate();
  const { watchlist, removeFromWatchlist, updateWatchlistStatus, progress, isFavorite } = useApp();
  const [activeTab, setActiveTab] = useState('all');

  const items = Object.values(watchlist || {});
  const filtered = activeTab === 'all' ? items : items.filter(i => i.status === activeTab);
  const countFor = (id) => id === 'all' ? items.length : items.filter(i => i.status === id).length;

  const [tabStyle, setTabStyle] = useState({ left: 0, width: 0, opacity: 0 });
  const tabsRef = useRef({});
  const [sheetState, setSheetState] = useState(null); // { anime, currentStatus }

  useEffect(() => {
    // Small timeout ensures fonts & layouts are fully painted before measuring
    const timer = setTimeout(() => {
      const el = tabsRef.current[activeTab];
      if (el) {
        setTabStyle({
          left: el.offsetLeft,
          width: el.offsetWidth,
          opacity: 1
        });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTab, items.length]); // Re-measure if counts change width

  const activeCfg = STATUS_CONFIG[activeTab];
  const activeColor = activeCfg ? activeCfg.color : '#818cf8';

  const handleStatusSelect = (newStatus) => {
    if (sheetState) {
      updateWatchlistStatus(sheetState.anime.id, newStatus);
      setSheetState(null);
    }
  };

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--sat) + 148px)', minHeight: '100vh' }}>
      <style>{ANIM_STYLE}</style>

      {/* ── Fixed Header — Premium Glass ─────────────────────────────── */}
      <div style={{
        position: 'fixed', top: 0, left: '50%',
        transform: 'translateX(-50%) translateZ(0)',
        WebkitTransform: 'translateX(-50%) translateZ(0)',
        zIndex: 90, width: '100%', maxWidth: 480,
        background: 'rgba(6, 6, 10, 0.88)',
        backdropFilter: 'blur(32px) saturate(200%) brightness(0.7)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%) brightness(0.7)',
        borderBottom: '0.5px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.6)',
        willChange: 'transform', isolation: 'isolate',
      }}>
        {/* ── Hero Title Row ───────────────────────────────────────────── */}
        <div
          className="mylist-header-in"
          style={{
            padding: '12px 18px 10px',
            paddingTop: 'var(--sat)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            {/* Premium glowing icon — uses app theme accent color */}
            <div style={{
              width: 42, height: 42, borderRadius: 13, flexShrink: 0,
              background: 'linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #818cf8))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.12), 0 6px 20px -4px var(--accent)',
            }}>
              <Bookmark size={20} color="#fff" fill="#fff" />
            </div>
            {/* Title + subtitle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{
                fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em',
                color: '#fff', fontFamily: 'var(--font-brand)', lineHeight: 1,
              }}>My List</span>
              <span style={{
                fontSize: 11.5, fontWeight: 600, letterSpacing: '0.01em',
                color: 'rgba(255,255,255,0.38)',
              }}>Your personal anime collection</span>
            </div>
          </div>

          {/* Premium count badge — uses app theme accent color */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--accent-dim)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 24, padding: '5px 12px 5px 10px',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)',
            }} />
            <span style={{
              fontSize: 13, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.01em',
            }}>{items.length}</span>
            <span style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
            }}>anime</span>
          </div>
        </div>

        {/* ── Filter Tabs ─────────────────────────────────────────────── */}
        <div style={{
          width: '100%', overflowX: 'auto', scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch', padding: '2px 0 12px',
        }}>
          <div style={{
            position: 'relative', display: 'inline-flex', gap: 6,
            padding: '2px 18px', minWidth: 'max-content',
          }}>
            {/* GPU-composited sliding pill */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 0, width: tabStyle.width, opacity: tabStyle.opacity,
              background: `${activeColor}20`,
              border: `1px solid ${activeColor}50`,
              boxShadow: `0 0 16px -4px ${activeColor}, inset 0 1px 0 rgba(255,255,255,0.1)`,
              borderRadius: 22,
              transform: `translate3d(${tabStyle.left}px, 0, 0)`,
              transition: 'transform 0.34s cubic-bezier(0.2, 0.9, 0.28, 1), width 0.34s cubic-bezier(0.2, 0.9, 0.28, 1), opacity 0.2s ease',
              pointerEvents: 'none', zIndex: 0,
              willChange: 'transform, width',
            }} />

            {TABS.map(t => {
              const count = countFor(t.id);
              const active = activeTab === t.id;
              const cfg = STATUS_CONFIG[t.id];
              const tabColor = cfg ? cfg.color : '#818cf8';

              return (
                <button
                  key={t.id}
                  ref={el => tabsRef.current[t.id] = el}
                  onClick={() => setActiveTab(t.id)}
                  id={`mylist-tab-${t.id}`}
                  style={{
                    position: 'relative', zIndex: 1,
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 14px', borderRadius: 22,
                    fontSize: 13, fontWeight: 700,
                    background: 'transparent',
                    border: '1px solid transparent',
                    color: active ? tabColor : 'rgba(255,255,255,0.36)',
                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'color 0.25s ease',
                    transform: 'translateZ(0)',
                  }}
                >
                  {t.label}
                  {count > 0 && (
                    <span style={{
                      background: active ? `${tabColor}30` : 'rgba(255,255,255,0.07)',
                      borderRadius: 10, padding: '1.5px 7px',
                      fontSize: 10.5, fontWeight: 800,
                      color: active ? tabColor : 'rgba(255,255,255,0.36)',
                      transition: 'background 0.25s ease, color 0.25s ease',
                    }}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Grid Content ─────────────────────────────────────────────────── */}
      <div className="fade-in-up" style={{ padding: '4px 12px 100px' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <Bookmark size={48} className="empty-icon" />
            <p className="empty-title">No anime here</p>
            <p className="empty-sub">Tap the bookmark icon on any anime page to add it here</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/')} id="mylist-browse">
              Browse Anime
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '14px 8px',
          }}>
            {filtered.map(({ anime, status }, index) => (
              <AnimeCard
                key={anime.id}
                anime={anime}
                status={status}
                progress={progress}
                isFav={isFavorite(anime.id)}
                onRemove={removeFromWatchlist}
                onOpenMenu={(a, s) => setSheetState({ anime: a, currentStatus: s })}
                index={index}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Fixed Bottom Sheet for Status Selection ──────────────────────── */}
      {sheetState && (
        <BottomSheet
          anime={sheetState.anime}
          currentStatus={sheetState.currentStatus}
          onClose={() => setSheetState(null)}
          onSelect={handleStatusSelect}
        />
      )}
    </div>
  );
}

/* ── Bottom Sheet Component ──────────────────────────────────────────────── */
function BottomSheet({ anime, currentStatus, onSelect, onClose }) {
  const [offsetY, setOffsetY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const startY = useRef(null);
  const currentY = useRef(null);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 280);
  }, [onClose]);

  // Native Android Hardware Back Button listener -> closes bottom sheet smoothly instead of navigating
  useEffect(() => {
    return registerBackButtonHandler(() => {
      handleClose();
      return true; // consumed!
    });
  }, [handleClose]);

  const handleTouchStart = (e) => {
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
  };

  const handleTouchMove = (e) => {
    if (startY.current === null) return;
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;
    if (diff > 0) {
      setOffsetY(diff);
    } else {
      // Slight resistance for upward drag
      setOffsetY(diff * 0.15);
    }
  };

  const handleTouchEnd = () => {
    if (startY.current === null) return;
    const diff = currentY.current - startY.current;
    if (diff > 60) {
      handleClose();
    } else {
      setOffsetY(0);
    }
    startY.current = null;
    currentY.current = null;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: isClosing ? 'fadeOut 0.28s ease forwards' : 'fadeIn 0.22s ease forwards',
        }}
      />

      {/* Sheet */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'relative', zIndex: 1001,
          background: 'rgba(16, 18, 26, 0.98)',
          backdropFilter: 'blur(30px) saturate(200%)',
          WebkitBackdropFilter: 'blur(30px) saturate(200%)',
          borderTop: '1px solid rgba(255,255,255,0.12)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '14px 16px calc(max(28px, env(safe-area-inset-bottom)) + 105px)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.7)',
          transform: isClosing ? 'translateY(100%)' : `translateY(${offsetY}px)`,
          transition: isClosing || offsetY === 0 ? 'transform 0.28s cubic-bezier(0.2, 1, 0.3, 1)' : 'none',
          animation: isClosing ? 'none' : 'slideUpSheet 0.3s cubic-bezier(0.2, 1, 0.3, 1) forwards',
        }}
      >
        <style>{`
          @keyframes slideUpSheet {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
          }
        `}</style>

        {/* Drag Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,0.25)',
          margin: '0 auto 14px',
        }} />

        <div style={{ marginBottom: 14, textAlign: 'center' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#fff', letterSpacing: '-0.2px' }}>
            {getTitle(anime)}
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>Select List Status</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(STATUS_CONFIG).map(([val, c]) => (
            <button
              key={val}
              onClick={() => {
                onSelect(val);
                handleClose();
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 14px',
                background: val === currentStatus ? `${c.color}20` : 'rgba(255,255,255,0.03)',
                border: val === currentStatus ? `1px solid ${c.color}50` : '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12, cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onTouchStart={e => e.currentTarget.style.transform = 'scale(0.98)'}
              onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: `${c.color}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <c.icon size={16} color={c.color} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: val === currentStatus ? c.color : '#eee' }}>
                {c.label}
              </span>
              {val === currentStatus && (
                <CheckCircle2 size={18} color={c.color} style={{ marginLeft: 'auto' }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
