import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, CheckCircle2, Play, Trash2, Star, Filter } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getTitle, getCover } from '../api/anilist';
import { getAiredEpisodeCount } from '../utils/animeStreamUtils';

const TABS = [
  { id: 'all', label: 'All', icon: Star },
  { id: 'watching', label: 'Watching', icon: Clock },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
];

export default function HistoryPage() {
  const navigate = useNavigate();
  const { recentlyViewed, progress, watchlist, favorites, removeFromRecentlyViewed, removeFromHistory } = useApp();
  const [tab, setTab] = useState('all');
  const [scrolled, setScrolled] = useState(false);

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

  /* ── Build combined history list ─────────────────────────────────────── */
  const { watchingList, completedList } = useMemo(() => {
    const isValid = (a) => {
      if (!a) return false;
      const t = getTitle(a);
      return typeof t === 'string' && t.trim().length > 0 && t.toLowerCase() !== 'unknown';
    };

    /* Completed: from watchlist with status=completed */
    const completedList = Object.values(watchlist || {})
      .filter(i => i?.status === 'completed' && isValid(i?.anime))
      .map(i => ({ anime: i.anime, episode: progress[i.anime?.id]?.episode || i.anime?.episodes || 0, type: 'completed' }));

    const completedIds = new Set(completedList.map(i => String(i.anime?.id)));

    /* Watching: combine recentlyViewed + progress, exclude completed */
    const activeMap = new Map();
    (recentlyViewed || []).forEach(item => {
      if (item?.anime?.id && isValid(item.anime) && !completedIds.has(String(item.anime.id))) {
        activeMap.set(String(item.anime.id), {
          anime: item.anime,
          episode: item.episode || progress[item.anime.id]?.episode || 1,
          timestamp: item.timestamp || 0,
          type: 'watching',
        });
      }
    });
    Object.entries(progress || {}).forEach(([id, prog]) => {
      if (!completedIds.has(String(id)) && prog?.episode && !activeMap.has(String(id))) {
        const anime = watchlist?.[id]?.anime || favorites?.[id];
        if (isValid(anime)) {
          activeMap.set(String(id), { anime, episode: prog.episode, timestamp: prog.timestamp || 0, type: 'watching' });
        }
      }
    });
    const watchingList = Array.from(activeMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return { watchingList, completedList };
  }, [recentlyViewed, progress, watchlist, favorites]);

  const displayed = tab === 'all'
    ? [...watchingList, ...completedList]
    : tab === 'watching' ? watchingList : completedList;

  const totalCount = watchingList.length + completedList.length;

  return (
    <div className="page" style={{ paddingTop: 'calc(var(--sat, 0px) + 128px)', minHeight: '100vh', background: 'var(--bg-primary)' }}>

      {/* ── Floating Header — portaled to document.body so it stays fixed ─── */}
      {createPortal(
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
        {/* Title Row */}
        <div style={{
          padding: '12px 18px 8px',
          paddingTop: 'calc(var(--sat, 0px) + 12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #818cf8))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px -2px var(--accent)',
            }}>
              <Clock size={16} color="#fff" />
            </div>
            <span style={{
              fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
              color: '#fff', fontFamily: 'var(--font-brand)',
            }}>History</span>
          </div>
          <span style={{
            fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600,
            background: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: '3px 10px',
          }}>
            {totalCount} anime
          </span>
        </div>

        {/* Filter Tabs */}
        <div style={{
          display: 'flex', gap: 6, padding: '0 16px 12px',
          overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {TABS.map(t => {
            const count = t.id === 'all' ? totalCount : t.id === 'watching' ? watchingList.length : completedList.length;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 15px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: 'none',
                  background: 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  touchAction: 'manipulation',
                  outline: 'none',
                  transition: 'color 0.2s ease',
                }}
              >
                {active && (
                  <motion.div
                    layoutId="activeHistoryTabPill"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 20,
                      background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #818cf8))',
                      boxShadow: '0 4px 16px -2px var(--accent)',
                      zIndex: 0,
                    }}
                    transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                  />
                )}
                {!active && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 20,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      zIndex: 0,
                    }}
                  />
                )}
                <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <t.icon size={12} />
                  {t.label}
                  <span style={{
                    background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)',
                    borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 800,
                    transition: 'background 0.2s ease',
                  }}>{count}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>,
      document.body
      )}

      {/* ── Content with Smooth Animated Transition ─────────────────────── */}
      <div style={{ padding: '0 14px 100px' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
            transition={{ duration: 0.24, ease: [0.25, 1, 0.5, 1] }}
          >
            {displayed.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {displayed.map((item, idx) => (
                  <motion.div
                    key={item.anime?.id || idx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.18) }}
                  >
                    <HistoryCard
                      item={item}
                      progress={progress}
                      onPlay={() => navigate(`/anime/${item.anime.id}?play=true&ep=${item.episode}&direct=true`, { state: { anime: item.anime, directPlay: true } })}
                      onNavigate={() => navigate(`/anime/${item.anime.id}`, { state: { anime: item.anime } })}
                      onRemove={() => {
                        if (item.type === 'watching') removeFromRecentlyViewed(item.anime.id);
                        else removeFromHistory(item.anime.id);
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── History Card ───────────────────────────────────────────────────────── */
function HistoryCard({ item, progress, onPlay, onNavigate, onRemove }) {
  const { anime, episode, type } = item;
  const title = getTitle(anime);
  const cover = getCover(anime);
  const totalEps = getAiredEpisodeCount(anime) || anime?.episodes || 0;
  const prog = progress?.[anime?.id];
  const pct = (prog && totalEps) ? Math.min(100, (prog.episode / totalEps) * 100) : 0;
  const isCompleted = type === 'completed';
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleRemove = (e) => {
    e.stopPropagation();
    if (confirmDelete) {
      onRemove();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      onClick={onNavigate}
      style={{
        background: 'var(--bg-card)',
        border: confirmDelete ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
        display: 'flex', gap: 12,
        padding: 10, cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.2s',
        boxShadow: confirmDelete ? '0 2px 16px rgba(239,68,68,0.12)' : '0 2px 16px rgba(0,0,0,0.2)',
      }}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.985)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      {/* Poster thumbnail */}
      <div style={{
        width: 56, height: 78, borderRadius: 10, overflow: 'hidden',
        flexShrink: 0, position: 'relative', background: '#111',
      }}>
        <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* Play overlay */}
        {!isCompleted && (
          <div
            onClick={e => { e.stopPropagation(); onPlay(); }}
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px var(--accent)',
            }}>
              <Play size={11} color="#fff" fill="#fff" />
            </div>
          </div>
        )}
      </div>

      {/* Text + progress */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          paddingRight: 36,
        }}>{title}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
          {/* Status pill */}
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 6,
            background: isCompleted ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.15)',
            color: isCompleted ? '#10b981' : 'var(--accent)',
            border: isCompleted ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(139,92,246,0.3)',
          }}>
            {isCompleted ? 'Completed' : 'Watching'}
          </span>

          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
            {isCompleted
              ? (totalEps > 0 ? `${totalEps} eps` : 'All eps')
              : `Ep ${episode}${totalEps > 0 ? ` / ${totalEps}` : ''}`}
          </span>
        </div>

        {/* Progress bar (watching only) */}
        {!isCompleted && totalEps > 0 && pct > 0 && (
          <div style={{
            height: 3, background: 'rgba(255,255,255,0.08)',
            borderRadius: 2, marginTop: 8, overflow: 'hidden', maxWidth: 200,
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #818cf8))',
              borderRadius: 2, boxShadow: '0 0 6px var(--accent)',
            }} />
          </div>
        )}
      </div>

      {/* Remove button — tap once to arm, tap again to confirm delete */}
      {onRemove && (
        <button
          onClick={handleRemove}
          aria-label={confirmDelete ? 'Confirm remove' : 'Remove'}
          style={{
            position: 'absolute', top: 10, right: 10,
            background: confirmDelete ? 'rgba(239,68,68,0.15)' : 'none',
            border: confirmDelete ? '1px solid rgba(239,68,68,0.3)' : 'none',
            borderRadius: confirmDelete ? 8 : 0,
            cursor: 'pointer',
            color: confirmDelete ? '#ef4444' : 'rgba(255,255,255,0.25)',
            padding: confirmDelete ? '4px 8px' : 4,
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 700,
            transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {confirmDelete
            ? <><Trash2 size={12} /><span>Confirm</span></>
            : <Trash2 size={14} />
          }
        </button>
      )}
    </div>
  );
}

/* ── Empty State ────────────────────────────────────────────────────────── */
function EmptyState({ tab }) {
  const msgs = {
    all: { icon: Clock, title: 'No history yet', sub: 'Start watching anime to build your history' },
    watching: { icon: Play, title: 'Not watching anything', sub: 'Episodes you start will appear here' },
    completed: { icon: CheckCircle2, title: 'Nothing completed', sub: 'Mark anime as Completed in My List' },
  };
  const { icon: Icon, title, sub } = msgs[tab] || msgs.all;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '80px 32px', gap: 14, textAlign: 'center',
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 24,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={32} color="var(--text-muted)" style={{ opacity: 0.4 }} />
      </div>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{sub}</p>
    </div>
  );
}
