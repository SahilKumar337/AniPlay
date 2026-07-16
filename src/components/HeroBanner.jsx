import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Plus, Check } from 'lucide-react';
import { getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';

const AUTO_INTERVAL = 5000;

export default function HeroBanner({ animes = [] }) {
  const navigate = useNavigate();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [current, setCurrent] = useState(0);
  const [nextIdx, setNextIdx] = useState(1);
  const [fading,  setFading]  = useState(false);
  const timerRef    = useRef(null);
  const touchStartX = useRef(0);
  const total       = Math.min(animes.length, 6);

  const advance = useCallback((to) => {
    if (fading || !total) return;
    setFading(true);
    const target = to !== undefined ? to : (current + 1) % total;
    setNextIdx(target);
    setTimeout(() => { setCurrent(target); setFading(false); }, 350);
  }, [fading, current, total]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (total > 1) timerRef.current = setInterval(() => advance(), AUTO_INTERVAL);
  }, [advance, total]);

  useEffect(() => {
    resetTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [resetTimer]);

  const goTo = (idx) => { if (idx === current || fading) return; advance(idx); resetTimer(); };

  if (!animes.length) {
    return (
      <div style={{ height: '42vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const featured = animes[current];
  const title    = getTitle(featured);
  const cover    = getCover(featured);
  const inList   = isInWatchlist(featured.id);

  const cleanDesc = featured.description
    ? featured.description.replace(/<[^>]*>/g, '').trim()
    : '';

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd   = (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) goTo((current + 1) % total);
      else        goTo((current - 1 + total) % total);
      resetTimer();
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '45vh',
        maxHeight: 440,
        minHeight: 280,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #121212 0%, #080808 100%)',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        boxSizing: 'border-box',
        gap: 16,
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Background Blurred Copy ─────────────────────────── */}
      <img
        key={`bg-${current}`}
        src={cover}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'blur(16px) brightness(0.28) saturate(1.2)',
          transform: 'scale(1.15) translate3d(0, 0, 0)',
          willChange: 'opacity',
          backfaceVisibility: 'hidden',
          display: 'block',
          opacity: fading ? 0 : 1,
          transition: 'opacity 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          zIndex: 1,
        }}
      />
      {/* ── Left Side: Text and Actions ─────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.3s ease',
        zIndex: 2,
        maxWidth: '58%',
      }}>
        {/* Genres */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          {featured.genres?.slice(0, 2).map((g, i) => (
            <span key={g} style={{
              fontSize: 10, color: 'var(--accent)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {i > 0 && <span style={{ marginRight: 4, color: 'rgba(255,255,255,0.3)' }}>•</span>}{g}
            </span>
          ))}
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 'clamp(16px, 4.5vw, 26px)',
          fontWeight: 800,
          fontFamily: 'var(--font-brand)',
          color: '#fff',
          lineHeight: 1.25,
          marginBottom: 4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {title}
        </h1>

        {/* Description */}
        {cleanDesc && (
          <p style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.4,
            marginBottom: 4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {cleanDesc}
          </p>
        )}
      </div>

      {/* ── Right Side: Full Uncropped Poster Image ─────────── */}
      <div style={{
        width: '38%',
        height: '80%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.35s ease',
        zIndex: 2,
        paddingBottom: 28, // Pushes the poster upward away from the dots
      }}>
        <img
          key={`fg-${current}`}
          src={cover}
          alt={title}
          style={{
            maxHeight: '100%',
            maxWidth: '100%',
            objectFit: 'contain',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            transform: 'translate3d(0, 0, 0)',
            willChange: 'opacity',
            backfaceVisibility: 'hidden',
            display: 'block',
          }}
        />
      </div>

      {/* ── Pre-load next slide ───────────────────────────────── */}
      {animes[nextIdx] && (
        <img
          src={getCover(animes[nextIdx])}
          alt=""
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}

      {/* ── Bottom Row: Actions (Left) and Indicators (Right) ── */}
      <div style={{
        position: 'absolute',
        bottom: 16, // Moved lower
        left: 20,
        right: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 3,
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.3s ease',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {featured.status === 'NOT_YET_RELEASED' ? (
            <div style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 50,
              color: 'rgba(255,255,255,0.6)',
            }}>
              Coming Soon
            </div>
          ) : (
            <button
              className="btn btn-primary"
              style={{ padding: '8px 22px', fontSize: 13, fontWeight: 700, borderRadius: 50, gap: 5, height: 36, display: 'flex', alignItems: 'center' }}
              onClick={() => navigate(`/watch/${featured.id}/1`)}
              id={`hero-play-${featured.id}`}
            >
              <Play size={14} fill="#fff" /> Play
            </button>
          )}

          <button
            className="btn btn-outline"
            style={{
              width: 36, height: 36, padding: 0, borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)',
              border: '1.5px solid rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
            }}
            onClick={() => inList ? removeFromWatchlist(featured.id) : addToWatchlist(featured)}
            id={`hero-list-${featured.id}`}
          >
            {inList ? <Check size={15} /> : <Plus size={15} />}
          </button>
        </div>

        {/* Slide dots */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {animes.slice(0, total).map((_, i) => (
            <button key={i} onClick={() => goTo(i)} aria-label={`Slide ${i + 1}`} style={{
              height: 3, width: i === current ? 18 : 6, borderRadius: 3,
              background: i === current ? 'var(--accent)' : 'rgba(255,255,255,0.25)',
              border: 'none', cursor: 'pointer', padding: 0,
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      </div>

      {/* ── Progress bar ──────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'rgba(255,255,255,0.05)',
        zIndex: 4,
        overflow: 'hidden',
      }}>
        <div
          key={current}
          style={{
            height: '100%',
            width: '100%',
            background: 'var(--accent)',
            transformOrigin: 'left center',
            transform: 'scaleX(0)',
            animation: `heroProgress ${AUTO_INTERVAL}ms linear forwards`,
            willChange: 'transform',
          }}
        />
      </div>

      <style>{`
        @keyframes heroProgress {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}
