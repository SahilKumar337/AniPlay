import { useState, useEffect } from 'react';
import { getTrending, getCover } from '../api/anilist';

const SLIDES = [
  { tagline: 'Watch Anime Online,', sub: 'Stream Thousands of Episodes' },
  { tagline: 'HD Quality Subtitles,', sub: 'Multi-Language Support' },
  { tagline: 'Track Your Progress,', sub: 'Build Your Watchlist' },
];

export default function WelcomeScreen({ onEnter, onSignIn }) {
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

  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
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
        </div>
      </div>

      <div className="welcome-actions">
        <button
          className="btn btn-outline"
          onClick={onSignIn}
          id="btn-signin"
        >Sign in</button>
        <button
          className="btn btn-primary"
          onClick={onEnter}
          id="btn-watch-now"
        >Watch now</button>
      </div>

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
