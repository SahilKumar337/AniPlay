import { useNavigate } from 'react-router-dom';
import { getTitle, getCover, getColor } from '../api/anilist';
import { Play } from 'lucide-react';
import { useState, memo } from 'react';
import { motion } from 'motion/react';
import { useApp } from '../context/AppContext';

// Global memory cache of loaded image URLs
export const imageCache = new Set();

export function preloadAnimeCardImages(urls) {
  if (!Array.isArray(urls)) return;
  urls.forEach(url => {
    if (url && !imageCache.has(url)) {
      const img = new Image();
      img.src = url;
      img.onload = () => imageCache.add(url);
    }
  });
}

function AnimeCard({
  anime,
  width  = null,
  height = null,
  rank   = null,
  epLabel = null,
  showBadges = true,
  showTitle  = false,   // show title label below card
  className  = '',
  index = 0,
}) {
  const navigate = useNavigate();
  const title  = getTitle(anime);
  const cover  = getCover(anime);
  const color  = getColor(anime);

  const isCached = cover ? imageCache.has(cover) : false;
  const [imgError, setImgError]   = useState(false);
  const [imgLoaded, setImgLoaded] = useState(isCached);
  const { settings } = useApp();

  const compact   = settings?.compactCards;
  const cardWidth  = width  ?? (compact ? 90  : 120);
  const cardHeight = height ?? (compact ? 125 : 165);

  const handleClick = (e) => {
    e?.stopPropagation?.();
    const targetId = anime?.id || anime?.mediaId || anime?.animeId;
    if (targetId) {
      navigate(`/anime/${targetId}`, { viewTransition: true });
    }
  };

  const handleLoad = () => {
    if (cover) imageCache.add(cover);
    setImgLoaded(true);
  };

  const hasRank = rank !== null;
  const isDoubleDigit = hasRank && Number(rank) >= 10;
  // Netflix-style: dynamic width and margin so numbers 1-9 and 10+ never get clipped or hidden
  const rankOffset = hasRank ? (isDoubleDigit ? 52 : 32) : 0;
  const wrapWidth = cardWidth + rankOffset;

  return (
    <div
      className={`anime-card-wrap ${className}`}
      style={{
        width: wrapWidth,
        animationDelay: `${index * 35}ms`,
        position: hasRank ? 'relative' : undefined,
      }}
    >
      {/* ── Netflix-style large rank number ── */}
      {hasRank && (
        <span className={`rank-number ${isDoubleDigit ? 'rank-double-digit' : ''}`}>{rank}</span>
      )}

      <motion.div
        className="anime-card"
        style={{
          width: cardWidth,
          height: cardHeight,
          marginLeft: rankOffset,
        }}
        onClick={handleClick}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        id={`anime-card-${anime.id}`}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleClick()}
        aria-label={title}
      >
        {/* Shimmer skeleton while image loads */}
        {!imgLoaded && !imgError && (
          <div
            className="skeleton"
            style={{ position: 'absolute', inset: 0, zIndex: 1, borderRadius: 'inherit' }}
          />
        )}

        {/* Cover image */}
        {cover && !imgError ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.22s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
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
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>
              {title}
            </span>
          </div>
        )}

        {/* Episode label badge */}
        {epLabel && !hasRank && (
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

        {/* Badge: HD only — no fake PG-13 */}
        {showBadges && !hasRank && (
          <div className="card-badges">
            <span className="card-badge badge-hd">HD</span>
          </div>
        )}

        {/* Hover play overlay */}
        <div className="card-play-overlay">
          <div className="card-play-overlay-inner">
            <Play size={16} color="#fff" fill="#fff" />
          </div>
        </div>

        {/* Bottom gradient + title on press */}
        <div className="card-title-overlay" style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.80) 0%, transparent 65%)',
          padding: '28px 7px 7px',
          opacity: 0,
          transition: 'opacity 0.18s ease',
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', display: 'block', lineHeight: 1.3 }}>
            {title}
          </span>
        </div>
      </motion.div>

      {/* Title label below card */}
      {showTitle && (
        <p
          className="card-label"
          style={{
            width: cardWidth,
            marginLeft: hasRank ? 24 : 0,
          }}
        >
          {title}
        </p>
      )}
    </div>
  );
}

export default memo(AnimeCard);
