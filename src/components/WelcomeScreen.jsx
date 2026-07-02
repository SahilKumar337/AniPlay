import { useState, useEffect } from 'react';
import { getTrending, getCover } from '../api/anilist';

const SLIDES = [
  { tagline: 'Watch Anime Online,', sub: 'Stream Thousands of Episodes' },
  { tagline: 'HD Quality Subtitles,', sub: 'Multi-Language Support' },
  { tagline: 'Track Your Progress,', sub: 'Build Your Watchlist' },
];

export default function WelcomeScreen({ onEnter }) {
  const [covers, setCovers] = useState([]);
  const [slide,  setSlide]  = useState(0);

  useEffect(() => {
    getTrending(1, 9).then(data => setCovers(data.map(a => getCover(a)))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setSlide(v => (v + 1) % SLIDES.length), 3500);
    return () => clearInterval(t);
  }, []);

  const rows = [
    covers.slice(0, 3),
    covers.slice(3, 6),
    covers.slice(6, 9),
  ];

  const fallback = 'https://via.placeholder.com/120x160/1e1e1e/666?text=AniLab';

  const [showOfflineModal, setShowOfflineModal] = useState(false);

  return (
    <div className="welcome-screen">
      {/* Tapping the hero area also enters the app */}
      <div className="welcome-hero" onClick={onEnter} style={{ cursor: 'pointer' }}>
        {/* Collage */}
        <div className="welcome-collage">
          {rows.map((row, i) => (
            <div key={i} className="welcome-collage-row">
              {(row.length > 0 ? row : [fallback, fallback, fallback]).map((src, j) => (
                <img key={j} src={src || fallback} alt="" loading="lazy" />
              ))}
            </div>
          ))}
        </div>

        {/* Overlay */}
        <div className="welcome-overlay">
          <div className="welcome-logo">
            <div className="welcome-logo-icon" style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)', borderRadius: 12 }}>▶</div>
            <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-brand)', color: '#fff', letterSpacing: -0.5, marginLeft: 2 }}>AniPlay</span>
          </div>
          <div className="welcome-text">
            <h1>Welcome to<br /><span>AniPlay.</span></h1>
            {/* Animated tagline that changes per slide */}
            <p key={slide} style={{ animation: 'welcomeFade 0.4s ease' }}>
              {SLIDES[slide].tagline}<br />{SLIDES[slide].sub}
            </p>
          </div>
          {/* Dot indicators — now tied to real slides and tappable */}
          <div className="welcome-dots" onClick={e => e.stopPropagation()}>
            {SLIDES.map((_, i) => (
              <div
                key={i}
                className={`welcome-dot ${slide === i ? 'active' : ''}`}
                onClick={() => setSlide(i)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8, letterSpacing: '0.5px' }}>
            Tap anywhere to continue
          </div>
        </div>
      </div>

      <div className="welcome-actions">
        <button
          className="btn btn-outline"
          onClick={() => setShowOfflineModal(true)}
          id="btn-signin"
        >Sign in</button>
        <button
          className="btn btn-primary"
          onClick={onEnter}
          id="btn-watch-now"
        >Watch now</button>
      </div>

      {/* Premium Offline Mode Modal */}
      {showOfflineModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }} onClick={() => setShowOfflineModal(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 480,
              background: 'var(--bg-card)',
              borderRadius: '24px 24px 0 0',
              padding: '24px 24px 38px',
              border: '1px solid var(--border)',
              animation: 'welcomeSlideUp 0.3s cubic-bezier(0.34,1.2,0.64,1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
            </div>
            
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{
                width: 54, height: 54, borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.1)',
                color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, margin: '0 auto 16px'
              }}>✓</div>
              
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 12, fontFamily: 'var(--font-brand)' }}>
                Offline Mode Active
              </h2>
              
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24, padding: '0 8px' }}>
                AniPlay runs fully offline on your device! Your watchlist, favorites, and watch progress are saved securely using Android SharedPreferences. No sign-in or online account is needed to watch.
              </p>
              
              <button
                className="btn btn-primary"
                onClick={onEnter}
                style={{ width: '100%', padding: '12px 0', borderRadius: 12, fontWeight: 700, fontSize: 14 }}
              >
                Continue to App
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes welcomeFade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes welcomeSlideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
