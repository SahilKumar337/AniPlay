import { useNavigate } from 'react-router-dom';
import { getTitle, getCover, getColor } from '../api/anilist';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function AnimeCard({
  anime,
  width = null,   // null = auto from settings
  height = null,  // null = auto from settings
  rank = null,
  epLabel = null,
  showBadges = true,
  className = '',
}) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const { settings } = useApp();

  // Apply compact card sizing
  const compact = settings?.compactCards;
  const cardWidth  = width  ?? (compact ? 90 : 120);
  const cardHeight = height ?? (compact ? 125 : 165);

  const title  = getTitle(anime);
  const cover  = getCover(anime);
  const color  = getColor(anime);

  const handleClick = () => navigate(`/anime/${anime.id}`);

  return (
    <div
      className={`anime-card ${className}`}
      style={{ width: cardWidth, height: cardHeight }}
      onClick={handleClick}
      id={`anime-card-${anime.id}`}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
      aria-label={title}
    >
      {/* Cover image */}
      {cover && !imgError ? (
        <img
          src={cover}
          alt={title}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgError(true)}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          background: `linear-gradient(135deg, ${color}33, var(--bg-card))`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: 8,
        }}>
          <Play size={24} color={color} />
          <span style={{
            fontSize: 10, color: 'var(--text-secondary)',
            textAlign: 'center', lineHeight: 1.3,
          }}>{title}</span>
        </div>
      )}

      {/* Episode label badge (e.g. New Episode Releases) */}
      {epLabel && !rank && (
        <span style={{
          position: 'absolute', top: 6, left: 6,
          background: 'var(--accent)', color: '#fff',
          fontSize: 9, fontWeight: 700,
          padding: '2px 6px', borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 3,
          zIndex: 3,
        }}>
          ▶ {epLabel}
        </span>
      )}

      {/* Rank number */}
      {rank !== null && (
        <span className="card-rank">{rank}</span>
      )}

      {/* Badges */}
      {showBadges && (
        <div className="card-badges">
          {anime.averageScore && (
            <span className="card-badge badge-pg">PG-13</span>
          )}
          <span className="card-badge badge-hd">HD</span>
        </div>
      )}

      {/* Hover play overlay */}
      <div className="card-play-overlay">
        <div className="card-play-overlay-inner">
          <Play size={16} color="#fff" fill="#fff" />
        </div>
      </div>

      {/* Bottom gradient + title (on hover via CSS) */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)',
        padding: '24px 6px 6px',
        opacity: 0,
        transition: 'opacity 0.2s',
      }}
        className="card-title-overlay"
      >
        <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', display: 'block', lineHeight: 1.3 }}>
          {title}
        </span>
      </div>
    </div>
  );
}
