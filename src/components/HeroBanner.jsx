import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Plus, Check, AlertCircle } from 'lucide-react';
import { getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';

const AUTO_INTERVAL = 5000; // 5 seconds

export default function HeroBanner({ animes = [] }) {
  const navigate = useNavigate();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [current, setCurrent] = useState(0);
  const [nextIdx, setNextIdx] = useState(1);
  const [fading,  setFading]  = useState(false);
  const timerRef = useRef(null);
  const total    = Math.min(animes.length, 6);

  // ── Auto-advance logic ────────────────────────────────────────
  const advance = useCallback((to) => {
    if (fading || !total) return;
    setFading(true);
    const target = to !== undefined ? to : (current + 1) % total;
    setNextIdx(target);
    setTimeout(() => {
      setCurrent(target);
      setFading(false);
    }, 350);
  }, [fading, current, total]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (total > 1) timerRef.current = setInterval(() => advance(), AUTO_INTERVAL);
  }, [advance, total]);

  useEffect(() => {
    resetTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [resetTimer]);

  const goTo = (idx) => {
    if (idx === current || fading) return;
    advance(idx);
    resetTimer();
  };

  if (!animes.length) {
    return (
      <div style={{
        height: 440, background: 'linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const featured = animes[current];
  const title    = getTitle(featured);
  const cover    = getCover(featured);
  const inList   = isInWatchlist(featured.id);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: 380,
      overflow: 'hidden',
      background: '#0a0a0a',
    }}>

      {/* ── Background image with crossfade ──────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.35s ease-in-out',
        willChange: 'opacity',
      }}>
        {/* Blurred background */}
        <img
          src={cover}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(20px) brightness(0.35)', transform: 'scale(1.1)', display: 'block' }}
        />
        {/* Clean contained cover image on the right */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 16px 20px',
          zIndex: 1,
        }}>
          <img
            src={cover}
            alt={title}
            style={{
              maxHeight: '85%',
              maxWidth: '100%',
              borderRadius: 12,
              objectFit: 'contain',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
        </div>
      </div>

      {/* ── Pre-loaded next image (invisible, for smooth transition) ── */}
      {animes[nextIdx] && (
        <img
          src={getCover(animes[nextIdx])}
          alt=""
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}

      {/* ── Top fade (for navbar to read over) ───────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 120,
        background: 'linear-gradient(to bottom, rgba(15,15,15,0.6) 0%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* ── Bottom gradient overlay ───────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: '65%',
        background: 'linear-gradient(to top, rgba(15,15,15,1) 0%, rgba(15,15,15,0.85) 40%, rgba(15,15,15,0.4) 70%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* ── Content overlay ──────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0,
        width: '52%',
        padding: '0 0 20px 16px',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.25s ease',
        zIndex: 2,
      }}>

        {/* Genre tags */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, maxWidth: '100%' }}>
          {featured.genres?.slice(0, 3).map((g, i) => (
            <span key={g} style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
              {g}{i < Math.min((featured.genres?.length || 0), 3) - 1 ? ',' : ''}
            </span>
          ))}
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-brand)',
          color: '#fff', lineHeight: 1.2, marginBottom: 14,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          maxWidth: '100%',
        }}>
          {title}
        </h1>

        {/* Buttons row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {featured.status === 'NOT_YET_RELEASED' ? (
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '10px 18px',
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 50,
              color: 'rgba(255,255,255,0.6)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <AlertCircle size={14} /> Coming Soon
            </div>
          ) : (
            <button
              className="btn btn-primary"
              style={{ padding: '10px 22px', fontSize: 14, borderRadius: 50, gap: 6 }}
              onClick={() => navigate(`/watch/${featured.id}/1`)}
              id={`hero-play-${featured.id}`}
            >
              <Play size={15} fill="#fff" /> Play
            </button>
          )}

          <button
            className="btn btn-outline"
            style={{ padding: '10px 18px', fontSize: 14, borderRadius: 50, gap: 6 }}
            onClick={() => inList ? removeFromWatchlist(featured.id) : addToWatchlist(featured)}
            id={`hero-list-${featured.id}`}
          >
            {inList ? <Check size={15} /> : <Plus size={15} />}
            {inList ? 'In List' : 'My List'}
          </button>
        </div>

        {/* Dot indicators */}
        <div style={{ display: 'flex', gap: 5, marginTop: 14 }}>
          {animes.slice(0, total).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                height: 3,
                width: i === current ? 24 : 8,
                borderRadius: 3,
                background: i === current ? '#e50914' : 'rgba(255,255,255,0.35)',
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────────────────── */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.1)' }}>
        <div
          key={current}
          style={{
            height: '100%', background: 'var(--accent)',
            animation: `heroProgress ${AUTO_INTERVAL}ms linear forwards`,
          }}
        />
      </div>

      <style>{`
        @keyframes heroProgress {
          from { width: 0%; }
          to   { width: 100%; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
