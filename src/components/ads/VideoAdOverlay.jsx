import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, ExternalLink, FastForward } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import adEngine from '../../services/adEngine';

export default function VideoAdOverlay({ ad, onComplete, style: customStyle }) {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(false);
  const skipDelay = ad?.skipDelaySeconds ?? 15;
  const [countdown, setCountdown] = useState(skipDelay);
  const [canSkip, setCanSkip] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(skipDelay);
  const [videoSrc, setVideoSrc] = useState(ad?.videoUrl || 'https://filesamples.com/samples/video/mp4/sample_960x400_ocean_with_audio.mp4');

  useEffect(() => {
    if (ad?.videoUrl) {
      setVideoSrc(ad.videoUrl);
    }
  }, [ad]);

  const trackedQuartiles = useRef({
    impression: false,
    firstQuartile: false,
    midpoint: false,
    thirdQuartile: false,
    complete: false,
    skip: false,
  });

  const handleAdStart = () => {
    if (!trackedQuartiles.current.impression) {
      trackedQuartiles.current.impression = true;
      ad?.impressionUrls?.forEach(url => adEngine.fireBeacon(url));
      ad?.trackingEvents?.start?.forEach(url => adEngine.fireBeacon(url));
    }
  };



  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let isMounted = true;
    let objectUrl = null;

    const tryPlayVideo = () => {
      v.play().catch((e) => {
        console.warn('[VideoAdOverlay] Autoplay failed, trying muted fallback:', e);
        v.muted = true;
        setMuted(true);
        v.play().catch(() => {});
      });
    };

    if (videoSrc.startsWith('/ads/') || videoSrc.startsWith('ads/')) {
      fetch(videoSrc)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          if (!isMounted || !videoRef.current) return;
          objectUrl = URL.createObjectURL(blob);
          videoRef.current.src = objectUrl;
          videoRef.current.load();
          tryPlayVideo();
        })
        .catch((err) => {
          console.warn('[VideoAdOverlay] Local blob fetch error, using direct path:', err);
          if (isMounted && videoRef.current) {
            videoRef.current.src = videoSrc;
            videoRef.current.load();
            tryPlayVideo();
          }
        });
    } else {
      v.src = videoSrc;
      v.load();
      tryPlayVideo();
    }

    const handleLoadedMetadata = () => {
      if (v.duration && !isNaN(v.duration) && v.duration > 0) {
        setDuration(Math.round(v.duration));
      }
      handleAdStart();
    };

    const handleTimeUpdate = () => {
      if (!v) return;
      const cur = Math.floor(v.currentTime || 0);
      const dur = Math.round(v.duration || duration || 0);
      setCurrentTime(cur);

      if (dur > 0) {
        setDuration(dur);
        setProgress(Math.min(100, (v.currentTime / dur) * 100));

        // Fire VAST quartile tracking beacons based on actual playback
        const pct = (v.currentTime / dur) * 100;
        if (pct >= 25 && !trackedQuartiles.current.firstQuartile) {
          trackedQuartiles.current.firstQuartile = true;
          ad?.trackingEvents?.firstQuartile?.forEach(u => adEngine.fireBeacon(u));
        }
        if (pct >= 50 && !trackedQuartiles.current.midpoint) {
          trackedQuartiles.current.midpoint = true;
          ad?.trackingEvents?.midpoint?.forEach(u => adEngine.fireBeacon(u));
        }
        if (pct >= 75 && !trackedQuartiles.current.thirdQuartile) {
          trackedQuartiles.current.thirdQuartile = true;
          ad?.trackingEvents?.thirdQuartile?.forEach(u => adEngine.fireBeacon(u));
        }
      }

      // Synchronize 15-second skip countdown with actual video playback
      const remaining = Math.max(0, Math.ceil(skipDelay - cur));
      setCountdown(remaining);
      if (remaining === 0) {
        setCanSkip(true);
      }
    };

    const handleError = (e) => {
      console.warn('[VideoAdOverlay] Ad video error, checking fallback stream:', e);
      if (ad?.fallbackUrl && videoSrc !== ad.fallbackUrl) {
        setVideoSrc(ad.fallbackUrl);
      } else if (videoSrc !== '/ads/sample_ad.mp4') {
        setVideoSrc('/ads/sample_ad.mp4');
      } else {
        console.warn('[VideoAdOverlay] All fallback video streams failed, auto-completing ad');
        setTimeout(() => onComplete?.(), 1200);
      }
    };

    const handleEnded = () => {
      console.log('[VideoAdOverlay] Full ad video ended naturally.');
      if (!trackedQuartiles.current.complete) {
        trackedQuartiles.current.complete = true;
        ad?.trackingEvents?.complete?.forEach(u => adEngine.fireBeacon(u));
      }
      onComplete?.();
    };

    v.addEventListener('loadedmetadata', handleLoadedMetadata);
    v.addEventListener('durationchange', handleLoadedMetadata);
    v.addEventListener('timeupdate', handleTimeUpdate);
    v.addEventListener('playing', handleAdStart);
    v.addEventListener('ended', handleEnded);
    v.addEventListener('error', handleError);

    return () => {
      isMounted = false;
      v.removeEventListener('loadedmetadata', handleLoadedMetadata);
      v.removeEventListener('durationchange', handleLoadedMetadata);
      v.removeEventListener('timeupdate', handleTimeUpdate);
      v.removeEventListener('playing', handleAdStart);
      v.removeEventListener('ended', handleEnded);
      v.removeEventListener('error', handleError);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoSrc, skipDelay, onComplete, ad]);

  const handleSponsorClick = (e) => {
    e?.stopPropagation();
    ad?.clickTrackingUrls?.forEach(url => adEngine.fireBeacon(url));
    if (ad?.targetUrl) {
      adEngine.openUrl(ad.targetUrl);
    }
  };

  const handleSkipClick = (e) => {
    e?.stopPropagation();
    if (canSkip) {
      if (!trackedQuartiles.current.skip) {
        trackedQuartiles.current.skip = true;
        ad?.trackingEvents?.skip?.forEach(url => adEngine.fireBeacon(url));
      }
      onComplete?.();
    }
  };

  const toggleMute = (e) => {
    e?.stopPropagation();
    if (videoRef.current) {
      const nextMuted = !videoRef.current.muted;
      videoRef.current.muted = nextMuted;
      setMuted(nextMuted);
    }
  };

  const formatSec = (sec) => {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  return (
    <div
      className="video-ad-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 38,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'manipulation',
        ...(customStyle || {}),
      }}
    >
      {/* ── Ad Video Player ── */}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted={muted}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          background: '#000',
        }}
      />

      {/* ── Top Bar: Ad Badge + Audio Toggle ── */}
      <div
        style={{
          position: 'absolute',
          top: 'max(14px, var(--sat, 14px))',
          left: 16,
          right: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 40,
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              background: '#f59e0b',
              color: '#000',
              fontWeight: 900,
              fontSize: 11,
              letterSpacing: '0.04em',
              padding: '3px 8px',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.4)',
            }}
          >
            Ad · 1 of 1
          </div>
          <span
            style={{
              color: 'rgba(255, 255, 255, 0.85)',
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}
          >
            {formatSec(currentTime)} / {formatSec(duration)}
          </span>
        </div>

        {/* Mute / Unmute Button */}
        <button
          onClick={toggleMute}
          aria-label={muted ? 'Unmute ad' : 'Mute ad'}
          style={{
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#fff',
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </div>

      {/* ── Bottom-Left: Clickable Sponsor Card (Adsterra Smartlink CTA) ── */}
      <motion.div
        onClick={handleSponsorClick}
        whileTap={{ scale: 0.96 }}
        style={{
          position: 'absolute',
          bottom: 'max(24px, calc(var(--android-safe-bottom, 0px) + 24px))',
          left: 16,
          maxWidth: 'min(380px, 60%)',
          background: 'rgba(15, 17, 26, 0.88)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 14,
          padding: '10px 14px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          cursor: 'pointer',
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {ad?.brand || 'Sponsored'}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {ad?.title || 'Visit Partner Sponsor'}
          </span>
        </div>
        <button
          onClick={handleSponsorClick}
          style={{
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
            boxShadow: '0 2px 10px rgba(245, 158, 11, 0.35)',
          }}
        >
          <span>{ad?.ctaText || 'Visit'}</span>
          <ExternalLink size={12} />
        </button>
      </motion.div>

      {/* ── Bottom-Right: 15-Second Skip Countdown / [ Skip Ad ⏭ ] Button ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 'max(24px, calc(var(--android-safe-bottom, 0px) + 24px))',
          right: 16,
          zIndex: 40,
        }}
      >
        <AnimatePresence mode="wait">
          {!canSkip ? (
            <motion.div
              key="countdown"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              style={{
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 12,
                padding: '10px 16px',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span>Skip in</span>
              <span style={{ color: '#f59e0b', fontWeight: 900 }}>{countdown}s</span>
            </motion.div>
          ) : (
            <motion.button
              key="skip-btn"
              onClick={handleSkipClick}
              whileTap={{ scale: 0.93 }}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              style={{
                background: 'rgba(0, 0, 0, 0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1.5px solid rgba(255, 255, 255, 0.35)',
                borderRadius: 12,
                padding: '10px 18px',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                boxShadow: '0 4px 24px rgba(0, 0, 0, 0.6)',
              }}
            >
              <span>Skip Ad</span>
              <FastForward size={15} fill="#fff" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom Amber Progress Bar ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3.5,
          background: 'rgba(255, 255, 255, 0.15)',
          zIndex: 40,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: '#f59e0b',
            boxShadow: '0 0 8px rgba(245, 158, 11, 0.8)',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
  );
}
