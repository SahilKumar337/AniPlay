import { useState, useEffect } from 'react';
import { getTrending, getCover } from '../api/anilist';

// Placeholder images for welcome collage using AniList
export default function WelcomeScreen({ onEnter }) {
  const [covers, setCovers] = useState([]);
  const [slide,  setSlide]  = useState(0);

  useEffect(() => {
    getTrending(1, 9).then(data => setCovers(data.map(a => getCover(a)))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => setSlide(v => (v + 1) % 3), 3000);
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
            <div className="welcome-logo-icon">A</div>
          </div>
          <div className="welcome-text">
            <h1>Welcome<br /><span>AniLab.</span></h1>
            <p>Watch Anime Online,<br />Streaming Online</p>
          </div>
          <div className="welcome-dots">
            {[0,1,2].map(i => (
              <div key={i} className={`welcome-dot ${slide === i ? 'active' : ''}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="welcome-actions">
        <button
          className="btn btn-outline"
          onClick={onEnter}
          id="btn-signin"
        >Sign in</button>
        <button
          className="btn btn-primary"
          onClick={onEnter}
          id="btn-watch-now"
        >Watch now</button>
      </div>
    </div>
  );
}
