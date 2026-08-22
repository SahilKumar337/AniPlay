import { useState, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bookmark, Share2, Star, Play, Download, Heart, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { getTitle, getCover, getDisplayGenresOrTags } from '../../api/anilist';
import { useApp } from '../../context/AppContext';

function AnimeHeroSection({
  anime,
  resumeEp = 1,
  onPlay,
  onOpenDownloads,
  scrolled = false,
}) {
  const navigate = useNavigate();
  const { isInWatchlist, addToWatchlist, removeFromWatchlist, isFavorite, toggleFavorite, showToast } = useApp();
  const [synOpen, setSynOpen] = useState(false);

  if (!anime) return null;

  const title = getTitle(anime);
  const cover = getCover(anime);
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const totalEps = anime.episodes || 0;
  const studios = anime.studios?.nodes?.map(s => s.name).join(', ') || '';
  const desc = (anime.description || 'No description available.')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();

  const inList = isInWatchlist(anime.id);
  const fav = isFavorite(anime.id);
  const isNotReleased = anime.status === 'NOT_YET_RELEASED' || (totalEps === 0 && !anime.nextAiringEpisode);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: `Watch ${title} on AniPlay!`,
          url: window.location.href,
        });
      } catch (_) {}
    } else {
      navigator.clipboard?.writeText(window.location.href);
      showToast('Link copied to clipboard!');
    }
  };

  return (
    <>
      {/* ── Top Floating Header Bar ── */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 90,
          width: '100%',
          maxWidth: 480,
          padding: '12px 16px',
          paddingTop: 'var(--sat)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: scrolled ? 'rgba(15, 15, 15, 0.75)' : 'rgba(15, 15, 15, 0)',
          backdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
          WebkitBackdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
          borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
          transition: 'all 0.3s ease',
          pointerEvents: 'none',
        }}
      >
        <motion.button
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate('/', { replace: true });
            }
          }}
          id="detail-back"
          whileTap={{ scale: 0.90 }}
          className="floating-btn"
          style={{ pointerEvents: 'all' }}
          aria-label="Go back"
        >
          <ArrowLeft size={18} />
        </motion.button>

        {/* Title on scroll */}
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            padding: '0 12px',
            opacity: scrolled ? 1 : 0,
            transform: scrolled ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'all 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
            fontWeight: 800,
            fontSize: 15,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: 'var(--font-brand)',
          }}
        >
          {title}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'all' }}>
          <motion.button
            onClick={() => (inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime))}
            id={`fav-${anime.id}`}
            whileTap={{ scale: 0.90 }}
            aria-label="Bookmark"
            className="floating-btn"
          >
            <Bookmark size={18} color={inList ? 'var(--accent)' : '#fff'} fill={inList ? 'var(--accent)' : 'none'} />
          </motion.button>
          <motion.button
            onClick={handleShare}
            id="share-btn"
            whileTap={{ scale: 0.90 }}
            aria-label="Share"
            className="floating-btn"
          >
            <Share2 size={18} />
          </motion.button>
        </div>
      </div>

      {/* ── Hero Atmospheric Banner ── */}
      <div style={{ position: 'relative', width: '100%', height: 320, overflow: 'hidden', background: '#060610' }}>
        <img
          src={cover}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: '-10px',
            width: 'calc(100% + 20px)',
            height: 'calc(100% + 20px)',
            objectFit: 'cover',
            objectPosition: 'center top',
            filter: 'blur(36px) brightness(0.25) saturate(1.7)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '40%',
            zIndex: 2,
            pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(4,4,10,0.75) 0%, transparent 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '50%',
            zIndex: 2,
            pointerEvents: 'none',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(4,4,10,0.85) 70%, rgba(4,4,10,1) 100%)',
          }}
        />
        {/* Center Poster */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src={cover}
            alt={title}
            style={{
              height: '86%',
              width: 'auto',
              maxWidth: '58%',
              objectFit: 'cover',
              borderRadius: 18,
              boxShadow: '0 24px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08) inset',
            }}
          />
        </div>
      </div>

      {/* ── Title & Meta Badges ── */}
      <div style={{ padding: '12px 16px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-brand)', lineHeight: 1.2, color: '#fff' }}>
          {title}
        </h1>
      </div>

      <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {score && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, fontWeight: 700, color: '#f5c518' }}>
            <Star size={13} fill="#f5c518" color="#f5c518" />
            {score}
          </div>
        )}
        {score && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>}
        {anime.startDate?.year && (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{anime.startDate.year}</span>
        )}
        <span className="card-badge badge-pg">PG-13</span>
        <span className="card-badge badge-hd">HD</span>
        {anime.format && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
            {anime.format.replace('_', ' ')}
          </span>
        )}
        {totalEps > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{totalEps} eps</span>}
      </div>

      {/* ── Action Buttons ── */}
      <div style={{ padding: '12px 16px 0', display: 'flex', gap: 10 }}>
        {isNotReleased ? (
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '13px',
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 12,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} /> Not Yet Released
          </div>
        ) : (
          <>
            <motion.button
              className="btn btn-primary"
              id={`play-${anime.id}`}
              onClick={onPlay}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              style={{
                flex: 1,
                justifyContent: 'center',
                padding: '13px',
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 12,
                boxShadow: '0 4px 20px color-mix(in srgb, var(--accent) 40%, transparent)',
              }}
            >
              <Play size={17} fill="#fff" />
              {resumeEp > 1 ? `Resume Ep ${resumeEp}` : 'Play'}
            </motion.button>
            <motion.button
              className="btn btn-primary"
              id={`dl-${anime.id}`}
              onClick={onOpenDownloads}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              style={{
                flex: 1,
                justifyContent: 'center',
                padding: '13px',
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text-primary)',
              }}
            >
              <Download size={17} color="var(--accent)" fill="var(--accent)" />
              Downloads
            </motion.button>
          </>
        )}
      </div>

      {/* ── Genres & Synopsis with Heart Favorite ── */}
      <div style={{ padding: '14px 16px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Genre:</span>{' '}
            {getDisplayGenresOrTags(anime).join(', ')}
            {studios ? ` · Studio: ${studios}` : ''}
          </p>

          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.75,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: synOpen ? 'unset' : 4,
              overflow: 'hidden',
            }}
          >
            {desc}
          </p>
          <button
            onClick={() => setSynOpen(v => !v)}
            id="syn-toggle"
            style={{
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              border: 'none',
              background: 'none',
            }}
          >
            {synOpen ? (
              <>
                View Less <ChevronUp size={12} />
              </>
            ) : (
              <>
                ... View More <ChevronDown size={12} />
              </>
            )}
          </button>
        </div>

        {/* Favorite Heart button */}
        <motion.button
          onClick={() => toggleFavorite(anime.id, anime)}
          id={`fav-btn-syn-${anime.id}`}
          whileTap={{ scale: 0.88 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          style={{
            background: fav ? 'rgba(229,9,20,0.1)' : 'rgba(255,255,255,0.05)',
            border: `1.5px solid ${fav ? '#e50914' : 'var(--border)'}`,
            borderRadius: 14,
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          aria-label="Add to favorites"
        >
          <Heart size={20} color={fav ? '#e50914' : '#fff'} fill={fav ? '#e50914' : 'none'} />
        </motion.button>
      </div>
    </>
  );
}

export default memo(AnimeHeroSection);
