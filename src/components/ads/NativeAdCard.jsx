import React, { useState, useEffect } from 'react';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import adEngine from '../../services/adEngine';

export default function NativeAdCard({ placement = 'default', className = '' }) {
  const [dismissed, setDismissed] = useState(false);
  const [sponsor, setSponsor] = useState(null);
  const [bannerConfig, setBannerConfig] = useState(null);

  useEffect(() => {
    const updateConfig = () => {
      if (!adEngine.isAdsEnabled()) {
        setBannerConfig(null);
        setSponsor(null);
        return;
      }
      const config = adEngine.getBannerConfig();
      if (!config) {
        setBannerConfig(null);
        setSponsor(null);
        return;
      }
      setBannerConfig(config);
      setSponsor(adEngine.getRandomSponsor());
    };

    updateConfig();
    const unsubscribe = adEngine.subscribe(() => {
      updateConfig();
    });
    return () => unsubscribe();
  }, [placement]);

  if (dismissed || !bannerConfig || !adEngine.isAdsEnabled()) {
    return null;
  }

  // If raw HTML or script is provided (e.g. Adsterra banner script/iframe)
  if (bannerConfig.network === 'script' && bannerConfig.bannerHtml) {
    return (
      <div
        className={`native-ad-wrapper ${className}`}
        style={{
          margin: '16px auto',
          maxWidth: 728,
          display: 'flex',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 12,
        }}
        dangerouslySetInnerHTML={{ __html: bannerConfig.bannerHtml }}
      />
    );
  }

  if (!sponsor) return null;

  const accent = sponsor.accentColor || '#6366f1';

  const handleClick = () => {
    if (sponsor.targetUrl) {
      adEngine.openUrl(sponsor.targetUrl);
    }
  };

  return (
    <div
      className={`native-ad-card ${className}`}
      onClick={handleClick}
      style={{
        margin: '18px 0',
        position: 'relative',
        cursor: 'pointer',
        borderRadius: '16px',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(26, 27, 38, 0.85) 0%, rgba(15, 16, 24, 0.95) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)`,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
        e.currentTarget.style.boxShadow = `0 12px 36px rgba(0, 0, 0, 0.45), 0 0 24px ${accent}22`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)';
      }}
    >
      {/* Ambient gradient flare */}
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`,
          pointerEvents: 'none',
          filter: 'blur(20px)',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: '14px' }}>
        {/* Thumbnail banner image */}
        {sponsor.bannerImage && (
          <div
            style={{
              position: 'relative',
              width: 72,
              height: 72,
              minWidth: 72,
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#090a10',
            }}
          >
            <img
              src={sponsor.bannerImage}
              alt={sponsor.title}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
              loading="lazy"
            />
          </div>
        )}

        {/* Content details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 7px',
                borderRadius: '6px',
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: `${accent}22`,
                color: accent,
                border: `1px solid ${accent}44`,
              }}
            >
              <Sparkles size={10} />
              {sponsor.badge || 'Sponsored'}
            </span>
          </div>

          <h4
            style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sponsor.title}
          </h4>

          {sponsor.description && (
            <p
              style={{
                margin: '3px 0 0',
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.65)',
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {sponsor.description}
            </p>
          )}
        </div>

        {/* CTA Button & Dismiss */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            aria-label="Dismiss ad"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.35)',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)')}
          >
            <X size={14} />
          </button>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              background: accent,
              color: '#fff',
              boxShadow: `0 4px 12px ${accent}44`,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{sponsor.ctaText || 'Learn More'}</span>
            <ExternalLink size={11} />
          </div>
        </div>
      </div>
    </div>
  );
}
