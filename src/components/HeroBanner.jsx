import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Plus, Check, Star } from 'lucide-react';
import { getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';

const AUTO_INTERVAL = 7000;

export default function HeroBanner({ animes = [] }) {
  const navigate = useNavigate();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [current, setCurrent] = useState(0);
  const [prev, setPrev]       = useState(-1);
  const [phase, setPhase]     = useState('idle');
  const timerRef    = useRef(null);
  const touchRef    = useRef(0);
  const total       = Math.min(animes.length, 8);

  /* ── Slide transition state machine ────────────── */
  const goTo = useCallback((to) => {
    if (phase !== 'idle' || !total) return;
    const target = ((to % total) + total) % total;
    if (target === current) return;
    setPrev(current);
    setPhase('exit');
    setTimeout(() => {
      setCurrent(target);
      setPhase('enter');
      setTimeout(() => setPhase('idle'), 500);
    }, 420);
  }, [phase, current, total]);

  const advance = useCallback(() => goTo(current + 1), [goTo, current]);

  const resetTimer = useCallback(() => {
    clearInterval(timerRef.current);
    if (total > 1) timerRef.current = setInterval(advance, AUTO_INTERVAL);
  }, [advance, total]);

  useEffect(() => { resetTimer(); return () => clearInterval(timerRef.current); }, [resetTimer]);

  /* ── Touch swipe ── */
  const onTouchStart = (e) => { touchRef.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchRef.current;
    if (Math.abs(dx) > 50) { goTo(dx < 0 ? current + 1 : current - 1); resetTimer(); }
  };

  if (!animes.length) {
    return (
      <div style={{
        width: '100%', height: '55vh', maxHeight: 480, minHeight: 340,
        background: 'linear-gradient(180deg, #0a0a14 0%, #060610 100%)',
      }} />
    );
  }

  const anime   = animes[current];
  const title   = getTitle(anime);
  // Use cover image (poster art)
  const cover   = anime.coverImage?.extraLarge || anime.coverImage?.large || anime.coverImage?.medium || '';
  const inList  = isInWatchlist(anime.id);
  const score   = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const genres  = (anime.genres || []).slice(0, 2);
  const desc    = (anime.description || '').replace(/<[^>]*>/g, '').trim();

  return (
    <div
      style={{ position: 'relative', width: '100%', userSelect: 'none' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ── HERO CONTAINER ── */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '55vh',
        maxHeight: 480,
        minHeight: 340,
        overflow: 'hidden',
        background: '#04040a',
      }}>

        {/* ── Previous image (crossfade out) — FULL WIDTH ── */}
        {prev >= 0 && phase === 'exit' && (
          <img
            key={`prev-${prev}`}
            src={(() => {
              const p = animes[prev];
              return p?.coverImage?.extraLarge || p?.coverImage?.large || '';
            })()}
            alt="" aria-hidden="true"
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center top',
              opacity: 1,
              transition: 'opacity 0.5s ease-out',
              zIndex: 1,
            }}
          />
        )}

        {/* ── Current cover image — FULL WIDTH background ── */}
        <img
          key={`curr-${current}`}
          src={cover}
          alt={title}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center top',
            opacity: phase === 'exit' ? 0 : 1,
            transition: 'opacity 0.55s ease',
            willChange: 'opacity',
            zIndex: 2,
          }}
        />

        {/* ── Minimal gradient overlays — NO heavy black gradients ── */}
        {/* Top gradient — subtle, just for header readability */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '22%',
          zIndex: 3, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgba(4,4,10,0.5) 0%, transparent 100%)',
        }} />

        {/* Bottom gradient — seamless blend into content below, no flash line */}
        <div style={{
          position: 'absolute', bottom: -2, left: 0, right: 0, height: '58%',
          zIndex: 3, pointerEvents: 'none',
          background: `linear-gradient(to bottom,
            transparent 0%,
            rgba(4,4,10,0.15) 20%,
            rgba(4,4,10,0.45) 45%,
            rgba(4,4,10,0.85) 72%,
            rgba(4,4,10,1) 88%,
            rgba(4,4,10,1) 100%
          )`,
        }} />

        {/* ── LEFT SIDE TEXT CONTENT ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          zIndex: 4, padding: '0 16px 20px',
          opacity: phase === 'exit' ? 0 : 1,
          transform: phase === 'exit' ? 'translateY(8px)' : 'translateY(0)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}>

          {/* Genre + Score badges */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {genres.map(g => (
              <span key={g} style={{
                fontSize: 9, fontWeight: 800, color: '#fff',
                background: 'var(--accent)',
                padding: '3px 10px', borderRadius: 6,
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {g}
              </span>
            ))}
            {score && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 11, fontWeight: 800, color: '#FFD700',
                background: 'rgba(255,215,0,0.12)',
                padding: '3px 8px', borderRadius: 6,
              }}>
                <Star size={10} fill="#FFD700" strokeWidth={0} /> {score}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(20px, 5.5vw, 28px)',
            fontWeight: 900,
            fontFamily: 'var(--font-brand)',
            color: '#fff',
            lineHeight: 1.1,
            marginBottom: 6,
            letterSpacing: '-0.04em',
            textShadow: '0 2px 20px rgba(0,0,0,0.8), 0 1px 4px rgba(0,0,0,0.5)',
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {title}
          </h1>

          {/* Description — 2 lines */}
          {desc && (
            <p style={{
              fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5,
              marginBottom: 14, maxWidth: '60%',
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {desc}
            </p>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => navigate(`/anime/${anime.id}`)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '10px 24px', borderRadius: 28,
                background: 'var(--accent)',
                color: '#fff', border: 'none', fontSize: 13, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 4px 20px color-mix(in srgb, var(--accent) 40%, transparent)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              <Play size={15} fill="#fff" strokeWidth={0} />
              Play
            </button>
            <button
              onClick={() => inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime)}
              style={{
                width: 38, height: 38, borderRadius: 19, flexShrink: 0,
                background: inList ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.1)',
                border: `1.5px solid ${inList ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: inList ? 'var(--accent)' : '#fff', cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.25, 1, 0.3, 1)',
              }}
            >
              {inList ? <Check size={17} /> : <Plus size={17} />}
            </button>
          </div>
        </div>

        {/* ── Slide counter — BOTTOM RIGHT ── */}
        {total > 1 && (
          <div style={{
            position: 'absolute', bottom: 20, right: 16,
            zIndex: 5,
            fontSize: 11, fontWeight: 700,
            color: 'rgba(255,255,255,0.7)',
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            padding: '3px 10px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.1)',
            letterSpacing: '0.04em',
          }}>
            {current + 1} / {total}
          </div>
        )}
      </div>

      {/* Preload next slide */}
      {total > 1 && (
        <link rel="preload" as="image" href={(() => {
          const n = animes[(current + 1) % total];
          return n?.coverImage?.extraLarge || n?.coverImage?.large || '';
        })()} />
      )}
    </div>
  );
}
