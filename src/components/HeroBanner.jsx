import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Play, Plus, Check, Star, Info } from 'lucide-react';
import { getTitle } from '../api/anilist';
import { useApp } from '../context/AppContext';

const AUTO_INTERVAL = 7000;

export function getHeroBannerImage(anime) {
  return anime?.coverImage?.extraLarge || anime?.coverImage?.large || anime?.coverImage?.medium || '';
}

export default function HeroBanner({ animes = [] }) {
  const navigate = useNavigate();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef    = useRef(null);
  const touchRef    = useRef(0);
  const rafRef      = useRef(null);
  const total       = Math.min(animes.length, 8);

  // Persistent ambient img ref — never remounted, src updates in-place
  // so the blurred GPU layer is promoted once and never torn down
  const ambientRef = useRef(null);

  /* ── RAF-synced slide transition ────────────────────────────────
     Using requestAnimationFrame keeps the opacity crossfade locked
     to the display refresh cycle and avoids React re-renders during
     the animation itself. Only 2 setState calls total, not chained. */
  const goTo = useCallback((to) => {
    if (transitioning || !total) return;
    const target = ((to % total) + total) % total;
    if (target === current) return;

    setTransitioning(true);

    // Sync ambient src update to the NEXT frame so paint is batched
    rafRef.current = requestAnimationFrame(() => {
      const next = animes[target];
      const nextImg = getHeroBannerImage(next);
      if (ambientRef.current && nextImg) {
        ambientRef.current.src = nextImg;
      }

      // After 400ms CSS transition completes, commit new slide index
      setTimeout(() => {
        setCurrent(target);
        setTransitioning(false);
      }, 420);
    });
  }, [transitioning, current, total, animes]);

  const advance = useCallback(() => goTo(current + 1), [goTo, current]);

  const resetTimer = useCallback(() => {
    clearInterval(timerRef.current);
    if (total > 1) timerRef.current = setInterval(advance, AUTO_INTERVAL);
  }, [advance, total]);

  useEffect(() => { resetTimer(); return () => clearInterval(timerRef.current); }, [resetTimer]);

  // Cancel any pending RAF on unmount
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Preload all 8 slides into memory cache immediately on mount for 0ms instant display
  useEffect(() => {
    if (!animes?.length) return;
    animes.slice(0, 8).forEach(a => {
      const heroUrl = getHeroBannerImage(a);
      if (heroUrl) {
        const img = new Image();
        img.fetchPriority = 'high';
        img.decoding = 'async';
        img.src = heroUrl;
        img.decode?.().catch(() => {});
      }
      const xl = a?.coverImage?.extraLarge;
      if (xl && xl !== heroUrl) {
        const img2 = new Image();
        img2.decoding = 'async';
        img2.src = xl;
      }
    });
  }, [animes]);

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
  const inList  = isInWatchlist(anime.id);
  const score   = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const genres  = (anime.genres || []).slice(0, 2);
  const desc    = (anime.description || '').replace(/<[^>]*>/g, '').trim();
  const isNotReleased = anime?.status === 'NOT_YET_RELEASED' || (anime?.episodes === 0 && !anime?.nextAiringEpisode && anime?.status !== 'RELEASING');

  // Initial ambient src
  const initialAmbient = getHeroBannerImage(animes[0]);

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

        {/* ── Persistent ambient blurred backdrop ───────────────────────────
            Key is intentionally ABSENT — this element lives forever.
            GPU layer is promoted once via will-change:transform and never
            torn down. Src updates happen in-place via ambientRef.
            filter:blur is never animated — only src changes, which the
            browser composites cheaply. */}
        <img
          ref={ambientRef}
          src={initialAmbient}
          alt=""
          aria-hidden="true"
          decoding="async"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            filter: 'blur(35px) brightness(0.65)',
            transform: 'scale(1.2) translateZ(0)',
            willChange: 'transform',  // promoted once; filter never changes during animation
            zIndex: 1,
          }}
        />

        {/* ── High-Resolution Pre-Rendered Image Stack (0ms instant slide display) ── */}
        {animes.slice(0, 8).map((a, idx) => {
          const isCurrent = idx === current;
          const extraLarge = a?.coverImage?.extraLarge || '';
          const large = a?.coverImage?.large || a?.coverImage?.medium || '';
          const heroSrc = extraLarge || large;
          if (!heroSrc) return null;

          return (
            <img
              key={a.id || idx}
              src={heroSrc}
              alt={getTitle(a)}
              decoding="async"
              loading={idx === 0 ? 'eager' : 'lazy'}
              fetchPriority={idx === 0 ? 'high' : 'auto'}
              onError={(e) => {
                if (large && e.currentTarget.src !== large) {
                  e.currentTarget.src = large;
                }
              }}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: 'center 20%',
                opacity: isCurrent ? (transitioning ? 0 : 1) : 0,
                transition: 'opacity 0.42s cubic-bezier(0.4, 0, 0.2, 1)',
                willChange: 'opacity',
                pointerEvents: 'none',
                zIndex: isCurrent ? 3 : 2,
              }}
            />
          );
        })}

        {/* ── Gradient overlays ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '22%',
          zIndex: 4, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgba(4,4,10,0.5) 0%, transparent 100%)',
        }} />
        <div style={{
          position: 'absolute', bottom: -2, left: 0, right: 0, height: '58%',
          zIndex: 4, pointerEvents: 'none',
          background: `linear-gradient(to bottom,
            transparent 0%,
            rgba(4,4,10,0.15) 20%,
            rgba(4,4,10,0.45) 45%,
            rgba(4,4,10,0.85) 72%,
            rgba(4,4,10,1) 88%,
            rgba(4,4,10,1) 100%
          )`,
        }} />

        {/* ── TEXT CONTENT — opacity-only fade ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          zIndex: 5, padding: '0 16px 20px',
          opacity: transitioning ? 0 : 1,
          transition: 'opacity 0.38s cubic-bezier(0.4, 0, 0.2, 1)',
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
            <motion.button
              onClick={() => navigate(`/anime/${anime.id}`, { state: { anime }, viewTransition: true })}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: isNotReleased ? '10px 20px' : '10px 24px', borderRadius: 28,
                background: isNotReleased ? 'rgba(255, 255, 255, 0.14)' : 'var(--accent)',
                backdropFilter: isNotReleased ? 'blur(10px)' : undefined,
                color: '#fff', border: isNotReleased ? '1px solid rgba(255, 255, 255, 0.25)' : 'none', fontSize: 13, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: isNotReleased ? 'none' : '0 4px 20px color-mix(in srgb, var(--accent) 40%, transparent)',
              }}
            >
              {isNotReleased ? <Info size={15} /> : <Play size={15} fill="#fff" strokeWidth={0} />}
              {isNotReleased ? 'View Details' : 'Play'}
            </motion.button>
            <motion.button
              onClick={() => inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime)}
              whileTap={{ scale: 0.90 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              style={{
                width: 38, height: 38, borderRadius: 19, flexShrink: 0,
                background: inList ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.1)',
                border: `1.5px solid ${inList ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: inList ? 'var(--accent)' : '#fff', cursor: 'pointer',
                touchAction: 'manipulation',
                transition: 'background-color 0.28s ease, border-color 0.28s ease, color 0.28s ease',
              }}
            >
              {inList ? <Check size={17} /> : <Plus size={17} />}
            </motion.button>
          </div>
        </div>

        {/* ── Slide counter — solid bg, NO backdrop-filter blur ──
            backdrop-filter inside a scrolling/animated container forces
            the compositor to re-sample on every frame. Use solid instead. */}
        {total > 1 && (
          <div style={{
            position: 'absolute', bottom: 20, right: 16,
            zIndex: 6,
            fontSize: 11, fontWeight: 700,
            color: 'rgba(255,255,255,0.75)',
            background: 'rgba(0, 0, 0, 0.55)',   // ← solid, not blur
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
        <link rel="preload" as="image" href={getHeroBannerImage(animes[(current + 1) % total])} />
      )}
    </div>
  );
}
