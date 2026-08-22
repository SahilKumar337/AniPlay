import { useState, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { getTrending, getCover } from '../api/anilist';

const TAGLINES = [
  { top: 'Stream Thousands of', bold: 'Anime Episodes' },
  { top: 'HD Quality with', bold: 'Multi-Language Support' },
  { top: 'Track Progress &', bold: 'Build Your Watchlist' },
];

// Curated anime poster images — used as static fallback while API loads
const FALLBACK_COVERS = [
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-PEn1CTc93blC.jpg',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx11061-NMJGaKZCmFMO.jpg',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20954-oMwCkbDaUxSl.jpg',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1535-lawCwhHMRMpf.jpg',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx5114-q5vHWZhPSr3y.jpg',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-C3H1hFBIobMb.jpg',
];

export default function WelcomeScreen({ onEnter, onSignIn }) {
  const [covers,  setCovers]  = useState(FALLBACK_COVERS);
  const [slide,   setSlide]   = useState(0);
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const onEnterRef  = useRef(onEnter);
  const onSignInRef = useRef(onSignIn);
  onEnterRef.current  = onEnter;
  onSignInRef.current = onSignIn;

  // Mount: trigger staggered entrance on next frame
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Slide rotation
  useEffect(() => {
    const t = setInterval(() => setSlide(v => (v + 1) % TAGLINES.length), 4000);
    return () => clearInterval(t);
  }, []);

  // Load fresh covers from API
  useEffect(() => {
    getTrending(1, 12).then(data => {
      const fresh = data.map(a => getCover(a)).filter(Boolean);
      if (fresh.length >= 6) setCovers(fresh);
    }).catch(() => {});
  }, []);

  // Watch Now — animate out then enter
  const handleEnter = () => {
    setExiting(true);
    setTimeout(() => onEnterRef.current?.(), 420);
  };

  // Sign In — open modal WITHOUT hiding the welcome screen
  const handleSignIn = () => {
    onSignInRef.current?.();
  };

  // 6 covers in one row for the left panel, 6 in right panel
  const leftCovers  = covers.slice(0, 3);
  const rightCovers = covers.slice(3, 6);

  return (
    <div
      className={`ws-root${mounted ? ' ws-mounted' : ''}${exiting ? ' ws-exiting' : ''}`}
    >
      {/* ── Background: Two elegant poster columns ───────────────── */}
      <div className="ws-bg">
        {/* Left column — scrolls upward */}
        <div className="ws-col ws-col--left">
          {[...leftCovers, ...leftCovers, ...leftCovers].map((src, i) => (
            <div key={i} className="ws-poster">
              {/* Placeholder color shown before image loads */}
              <img src={src} alt="" loading="eager" draggable={false}
                style={{ opacity: 0, transition: 'opacity 0.4s ease' }}
                onLoad={e => { e.currentTarget.style.opacity = '1'; }}
              />
            </div>
          ))}
        </div>
        {/* Right column — scrolls downward */}
        <div className="ws-col ws-col--right">
          {[...rightCovers, ...rightCovers, ...rightCovers].map((src, i) => (
            <div key={i} className="ws-poster">
              <img src={src} alt="" loading="eager" draggable={false}
                style={{ opacity: 0, transition: 'opacity 0.4s ease' }}
                onLoad={e => { e.currentTarget.style.opacity = '1'; }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Gradient overlays ────────────────────────────────────── */}
      <div className="ws-overlay" />
      {/* Ambient color glow */}
      <div className="ws-glow ws-glow-1" />
      <div className="ws-glow ws-glow-2" />

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="ws-content">

        {/* Logo */}
        <div className="ws-logo">
          <div className="ws-logo-icon">
            <Play size={20} color="#fff" fill="#fff" />
          </div>
          <span className="ws-logo-text">AniPlay</span>
        </div>

        {/* Headline */}
        <div className="ws-headline-wrap">
          <h1 className="ws-headline">
            Your Gateway<br />
            <span className="ws-headline-accent">to Anime.</span>
          </h1>
          <p key={slide} className="ws-tagline">
            {TAGLINES[slide].top}<br />
            <strong>{TAGLINES[slide].bold}</strong>
          </p>
        </div>

        {/* Slide dots */}
        <div className="ws-dots">
          {TAGLINES.map((_, i) => (
            <button
              key={i}
              className={`ws-dot${slide === i ? ' ws-dot--on' : ''}`}
              onClick={() => setSlide(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="ws-actions">
          <button className="ws-btn ws-btn--primary" onClick={handleEnter} id="btn-watch-now">
            <Play size={16} fill="#fff" color="#fff" />
            Watch Now
          </button>
          <button className="ws-btn ws-btn--ghost" onClick={handleSignIn} id="btn-signin">
            Sign In
          </button>
        </div>

        {/* Spacer replaces the removed fine print — keeps buttons in same position */}
        <div style={{ height: 14 + 12 + 16 }} />
      </div>

      <style>{`
        /* ─── Root ─────────────────────────────────────────────── */
        .ws-root {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: #080810;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          will-change: opacity, transform;
          /* Default: invisible, waiting for ws-mounted */
          opacity: 0;
        }
        /* Mounted: fade in root container */
        .ws-root.ws-mounted {
          opacity: 1;
          transition: opacity 0.35s ease;
        }
        /* Exiting: scale up + blur dissolve */
        .ws-root.ws-exiting {
          opacity: 0 !important;
          transform: scale(1.06);
          filter: blur(10px);
          transition: opacity 0.42s cubic-bezier(0.4,0,1,1),
                      transform 0.42s cubic-bezier(0.4,0,1,1),
                      filter 0.42s ease !important;
        }

        /* ─── Background columns ────────────────────────────────── */
        .ws-bg {
          position: absolute;
          inset: 0;
          display: flex;
          gap: 10px;
          padding: 0 10px;
          pointer-events: none;
          user-select: none;
          /* Only occupy the top ~55% visually — bottom is covered by overlay */
        }

        .ws-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* Upward scroll */
        .ws-col--left {
          animation: scrollUp 28s linear infinite;
          transform: translate3d(0, 0, 0);
          will-change: transform;
          backface-visibility: hidden;
        }

        /* Downward scroll */
        .ws-col--right {
          animation: scrollDown 34s linear infinite;
          margin-top: -80px; /* offset so they don't start at same position */
          transform: translate3d(0, 0, 0);
          will-change: transform;
          backface-visibility: hidden;
        }

        @keyframes scrollUp {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(0, -33.33%, 0); }
        }
        @keyframes scrollDown {
          from { transform: translate3d(0, -33.33%, 0); }
          to   { transform: translate3d(0, 0, 0); }
        }

        .ws-poster {
          border-radius: 14px;
          overflow: hidden;
          aspect-ratio: 2/3;
          flex-shrink: 0;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
          /* CSS gradient placeholder shown before image loads */
          background: linear-gradient(160deg, rgba(124,58,237,0.25) 0%, rgba(15,15,20,1) 100%);
          transform: translate3d(0, 0, 0);
        }
        .ws-poster img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          /* opacity managed via onLoad handler */
        }

        /* ─── Gradient overlay ──────────────────────────────────── */
        .ws-overlay {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(to bottom,
              rgba(8,8,16,0.15) 0%,
              rgba(8,8,16,0.25) 25%,
              rgba(8,8,16,0.70) 50%,
              rgba(8,8,16,0.95) 68%,
              rgba(8,8,16,1.00) 78%
            );
          pointer-events: none;
        }

        /* Subtle ambient color orbs — pure radial gradients without CPU blur filters */
        .ws-glow {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          animation: glowPulse 8s ease-in-out infinite alternate;
          transform: translate3d(0, 0, 0);
          will-change: transform, opacity;
        }
        .ws-glow-1 {
          width: 320px; height: 320px;
          background: radial-gradient(circle, rgba(124,58,237,0.45) 0%, rgba(124,58,237,0.15) 45%, transparent 70%);
          bottom: 30%; left: -80px;
        }
        .ws-glow-2 {
          width: 280px; height: 280px;
          background: radial-gradient(circle, rgba(10,132,255,0.35) 0%, rgba(10,132,255,0.10) 45%, transparent 70%);
          bottom: 20%; right: -60px;
          animation-duration: 11s;
          animation-direction: alternate-reverse;
        }
        @keyframes glowPulse {
          from { opacity: 0.35; transform: translate3d(0, 0, 0) scale(0.9); }
          to   { opacity: 0.65; transform: translate3d(0, 0, 0) scale(1.1); }
        }

        /* ─── Content ───────────────────────────────────────────── */
        .ws-content {
          position: relative;
          z-index: 10;
          margin-top: auto;
          padding: 0 22px;
          padding-bottom: max(28px, env(safe-area-inset-bottom));
          display: flex;
          flex-direction: column;
        }

        /* ─── Logo ──────────────────────────────────────────────── */
        .ws-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 22px;
          /* Staggered entrance: logo drops in from top */
          opacity: 0;
          transform: translateY(-24px);
          transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1) 0.12s,
                      transform 0.6s cubic-bezier(0.16,1,0.3,1) 0.12s;
        }
        .ws-mounted .ws-logo {
          opacity: 1;
          transform: translateY(0);
        }
        .ws-logo-icon {
          width: 44px; height: 44px;
          background: var(--accent, #7c3aed);
          border-radius: 13px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 20px rgba(124,58,237,0.5), 0 4px 12px rgba(0,0,0,0.4);
          /* Subtle pulse on the icon */
          animation: wsIconPulse 3s ease-in-out infinite;
        }
        @keyframes wsIconPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(124,58,237,0.5), 0 4px 12px rgba(0,0,0,0.4); }
          50% { box-shadow: 0 0 32px rgba(124,58,237,0.75), 0 4px 16px rgba(0,0,0,0.4); }
        }
        .ws-logo-text {
          font-size: 25px;
          font-weight: 900;
          color: #fff;
          letter-spacing: -0.8px;
          font-family: var(--font-brand, system-ui);
          text-shadow: 0 2px 12px rgba(0,0,0,0.5);
        }

        /* ─── Headline ──────────────────────────────────────────── */
        .ws-headline-wrap {
          margin-bottom: 18px;
          opacity: 0;
          transform: translateY(22px);
          transition: opacity 0.65s cubic-bezier(0.16,1,0.3,1) 0.22s,
                      transform 0.65s cubic-bezier(0.16,1,0.3,1) 0.22s;
        }
        .ws-mounted .ws-headline-wrap {
          opacity: 1;
          transform: translateY(0);
        }
        .ws-headline {
          font-size: 38px;
          font-weight: 800;
          letter-spacing: -1.2px;
          line-height: 1.08;
          color: #fff;
          margin-bottom: 10px;
          text-shadow: 0 2px 20px rgba(0,0,0,0.6);
        }
        .ws-headline-accent {
          background: linear-gradient(135deg, #a78bfa 0%, #60a5fa 60%, #34d399 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-weight: 900;
        }
        .ws-tagline {
          font-size: 15px;
          color: rgba(255,255,255,0.60);
          line-height: 1.5;
          letter-spacing: -0.1px;
          animation: fadeUp 0.4s cubic-bezier(0.16,1,0.3,1) both;
        }
        .ws-tagline strong {
          color: rgba(255,255,255,0.88);
          font-weight: 600;
        }

        /* ─── Dots ──────────────────────────────────────────────── */
        .ws-dots {
          display: flex;
          gap: 6px;
          margin-bottom: 22px;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1) 0.36s,
                      transform 0.6s cubic-bezier(0.16,1,0.3,1) 0.36s;
        }
        .ws-mounted .ws-dots {
          opacity: 1;
          transform: translateY(0);
        }
        .ws-dot {
          height: 4px;
          width: 18px;
          border-radius: 99px;
          background: rgba(255,255,255,0.25);
          border: none;
          cursor: pointer;
          padding: 0;
          transition: width 0.35s cubic-bezier(0.34,1.56,0.64,1), background 0.3s ease;
        }
        .ws-dot--on {
          width: 36px;
          background: #fff;
        }

        /* ─── Buttons ───────────────────────────────────────────── */
        .ws-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.65s cubic-bezier(0.16,1,0.3,1) 0.46s,
                      transform 0.65s cubic-bezier(0.16,1,0.3,1) 0.46s;
        }
        .ws-mounted .ws-actions {
          opacity: 1;
          transform: translateY(0);
        }
        .ws-btn {
          width: 100%;
          padding: 16px;
          border-radius: 14px;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.3px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: var(--font-main, system-ui);
          touch-action: manipulation;
          transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .ws-btn:active { transform: scale(0.95); opacity: 0.88; }
        .ws-btn--primary {
          background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
          color: #fff;
          box-shadow: 0 8px 28px rgba(124,58,237,0.45), 0 2px 8px rgba(0,0,0,0.3);
        }
        .ws-btn--ghost {
          background: rgba(255,255,255,0.09);
          color: rgba(255,255,255,0.90);
          border: 1px solid rgba(255,255,255,0.15);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        /* ─── Shared entrance animation ─────────────────────────── */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
