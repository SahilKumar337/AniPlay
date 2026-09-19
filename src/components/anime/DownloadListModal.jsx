import { memo, useEffect } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Download, Check, RotateCcw } from 'lucide-react';
import LoadingWheel from '../ui/LoadingWheel';
import { motion } from 'motion/react';
import NativeAdCard from '../ads/NativeAdCard';

function DownloadListModal({
  open,
  onOpenChange,
  anime,
  allEps = [],
  downloadAudioTrack = 'sub',
  onAudioTrackChange,
  downloadedSet = new Set(),
  downloadProgress = {},
  failedSet = new Set(),
  onDownloadEpisode,
  hasDub = true,
}) {
  useEffect(() => {
    if (!hasDub && downloadAudioTrack === 'dub') {
      onAudioTrackChange?.('sub');
    }
  }, [hasDub, downloadAudioTrack, onAudioTrackChange]);

  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Download Episodes"
      description="Save anime for offline viewing"
      headerRight={
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255, 255, 255, 0.05)', padding: 3, borderRadius: 10 }}>
          <button
            onClick={() => onAudioTrackChange?.('sub')}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              background: downloadAudioTrack === 'sub' ? 'var(--accent)' : 'transparent',
              color: downloadAudioTrack === 'sub' ? '#fff' : 'var(--text-tertiary)',
              cursor: 'pointer',
            }}
          >
            SUB
          </button>
          <button
            disabled={!hasDub}
            onClick={() => hasDub && onAudioTrackChange?.('dub')}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              background: downloadAudioTrack === 'dub' && hasDub ? 'var(--accent)' : 'transparent',
              color: !hasDub ? 'rgba(255,255,255,0.25)' : (downloadAudioTrack === 'dub' ? '#fff' : 'var(--text-tertiary)'),
              opacity: !hasDub ? 0.35 : 1,
              cursor: !hasDub ? 'not-allowed' : 'pointer',
              pointerEvents: !hasDub ? 'none' : 'auto',
            }}
          >
            {hasDub ? 'DUB' : 'DUB (None)'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 'max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px), 32px)' }}>
        <NativeAdCard placement="download_drawer" />
        {allEps.map((epNum) => {
          const key = `${epNum}_${downloadAudioTrack}`;
          const taskKey = anime?.id ? `${anime.id}_${epNum}_${downloadAudioTrack}` : null;
          const isDownloaded = downloadedSet.has(key) || (taskKey && downloadedSet.has(taskKey));
          const isFailed = !isDownloaded && (failedSet.has(key) || (taskKey && failedSet.has(taskKey)));
          const progress = (isFailed || isDownloaded) ? undefined : (downloadProgress[key] ?? (taskKey ? downloadProgress[taskKey] : undefined));
          const isDownloading = !isDownloaded && !isFailed && progress !== undefined && progress < 100;

          return (
            <div
              key={epNum}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Episode {epNum}
                </span>
                {isDownloaded && (
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                    Downloaded
                  </span>
                )}
                {isFailed && (
                  <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
                    Failed
                  </span>
                )}
              </div>

              {isDownloaded ? (
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#22c55e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check size={16} />
                </div>
              ) : isDownloading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                    {progress}%
                  </span>
                  <LoadingWheel size={16} />
                </div>
              ) : isFailed ? (
                <motion.button
                  onClick={() => onDownloadEpisode(epNum)}
                  whileTap={{ scale: 0.90 }}
                  title="Retry download with fresh stream link"
                  style={{
                    height: 32,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <RotateCcw size={13} />
                  <span>Retry</span>
                </motion.button>
              ) : (
                <motion.button
                  onClick={() => onDownloadEpisode(epNum)}
                  whileTap={{ scale: 0.90 }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: 'none',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Download size={14} />
                </motion.button>
              )}
            </div>
          );
        })}
      </div>
    </AppDrawer>
  );
}

export default memo(DownloadListModal);
