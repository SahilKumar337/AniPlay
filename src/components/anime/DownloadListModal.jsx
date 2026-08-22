import { memo } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Download, Check, Loader } from 'lucide-react';
import { motion } from 'motion/react';

function DownloadListModal({
  open,
  onOpenChange,
  anime,
  allEps = [],
  downloadAudioTrack = 'sub',
  onAudioTrackChange,
  downloadedSet = new Set(),
  downloadProgress = {},
  onDownloadEpisode,
}) {
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
            onClick={() => onAudioTrackChange?.('dub')}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              background: downloadAudioTrack === 'dub' ? 'var(--accent)' : 'transparent',
              color: downloadAudioTrack === 'dub' ? '#fff' : 'var(--text-tertiary)',
              cursor: 'pointer',
            }}
          >
            DUB
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 'max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px), 32px)' }}>
        {allEps.map((epNum) => {
          const key = `${epNum}_${downloadAudioTrack}`;
          const taskKey = anime?.id ? `${anime.id}_${epNum}_${downloadAudioTrack}` : null;
          const isDownloaded = downloadedSet.has(key) || downloadedSet.has(String(epNum)) || (taskKey && downloadedSet.has(taskKey));
          const progress = downloadProgress[key] ?? (taskKey ? downloadProgress[taskKey] : undefined);
          const isDownloading = progress !== undefined && progress < 100;

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
                  <Loader size={16} className="spin" color="var(--accent)" />
                </div>
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
