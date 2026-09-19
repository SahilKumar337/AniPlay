import React from 'react';

/**
 * Premium Anime-Themed Glowing Loading Wheel
 * ─────────────────────────────────────────────────────────────────────────────
 * Features:
 *  - Iridescent multi-hue gradient arc (pink -> violet -> cyan)
 *  - Dynamic stroke dashing (harmonic speed curve)
 *  - Ambient glowing neon core that gently breathes
 *  - Hardware accelerated GPU compositing (120 FPS capable)
 */
export default function LoadingWheel({
  size = 28,
  text = '',
  color = null,
  className = '',
  style = {}
}) {
  const outerSize = size;
  const stroke = Math.max(2.5, Math.round(size * 0.09));

  return (
    <div
      className={`loading-wheel-container ${className}`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: text ? 8 : 0,
        ...style
      }}
      role="status"
      aria-label="Loading..."
    >
      <div
        className="loading-wheel"
        style={{
          width: outerSize,
          height: outerSize,
          position: 'relative',
        }}
      >
        <svg
          viewBox="0 0 50 50"
          style={{
            width: '100%',
            height: '100%',
            animation: 'loadingWheelRotate 1.2s linear infinite',
            filter: 'drop-shadow(0 0 7px rgba(139, 92, 246, 0.55))',
          }}
        >
          <defs>
            <linearGradient id="aniplayWheelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ec4899" />
              <stop offset="50%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          {/* Subtle background track */}
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={stroke}
          />
          {/* Glowing animated arc */}
          <circle
            className="loading-wheel-dash"
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke={color || 'url(#aniplayWheelGrad)'}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </svg>
        {/* Core neon pulse */}
        <div
          className="loading-wheel-glow"
          style={{
            position: 'absolute',
            inset: '30%',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.8) 0%, transparent 70%)',
            animation: 'loadingWheelPulse 1.4s ease-in-out infinite alternate',
            pointerEvents: 'none',
          }}
        />
      </div>
      {text && (
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
          {text}
        </span>
      )}
    </div>
  );
}
