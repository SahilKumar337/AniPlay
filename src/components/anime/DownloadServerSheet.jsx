import { useState, memo } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Tv, Loader } from 'lucide-react';
import { motion } from 'motion/react';

function DownloadServerSheet({
  data, // { episode, servers, loading, audioTrack }
  audioTrack = 'sub',
  onAudioTrackChange,
  onSelectServer,
  onClose,
}) {
  const [currentTrack, setCurrentTrack] = useState(audioTrack);
  const trackToUse = onAudioTrackChange ? audioTrack : currentTrack;

  const handleTrackToggle = (trk) => {
    setCurrentTrack(trk);
    onAudioTrackChange?.(trk);
  };

  if (!data) return null;

  const subServers = (data?.servers || []).filter((srv) => srv.type === 'sub');
  const dubServers = (data?.servers || []).filter((srv) => srv.type === 'dub');
  const effectiveTrack = (trackToUse === 'dub' && dubServers.length === 0 && subServers.length > 0) ? 'sub' : trackToUse;
  const filteredServers = (data?.servers || []).filter((srv) => srv.type === effectiveTrack);

  return (
    <AppDrawer
      open={Boolean(data)}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
      title="Download Episode"
      description={`Episode ${data.episode} · Choose server`}
      headerRight={
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255, 255, 255, 0.05)', padding: 3, borderRadius: 10 }}>
          <button
            disabled={subServers.length === 0}
            onClick={() => handleTrackToggle('sub')}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              background: effectiveTrack === 'sub' ? 'var(--accent)' : 'transparent',
              color: subServers.length === 0 ? 'rgba(255,255,255,0.2)' : (effectiveTrack === 'sub' ? '#fff' : 'var(--text-tertiary)'),
              cursor: subServers.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            SUB
          </button>
          <button
            disabled={dubServers.length === 0}
            onClick={() => handleTrackToggle('dub')}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              border: 'none',
              background: effectiveTrack === 'dub' ? 'var(--accent)' : 'transparent',
              color: dubServers.length === 0 ? 'rgba(255,255,255,0.2)' : (effectiveTrack === 'dub' ? '#fff' : 'var(--text-tertiary)'),
              cursor: dubServers.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            DUB
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 'max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px), 32px)' }}>
        {data.loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '36px 16px' }}>
            <Loader size={28} className="spin" color="var(--accent)" />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, margin: 0 }}>
              Finding available download servers...
            </p>
          </div>
        ) : filteredServers.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No {trackToUse.toUpperCase()} servers available for this episode.
          </div>
        ) : (
          filteredServers.map((srv, idx) => (
            <motion.button
              key={srv.id || srv.name || idx}
              onClick={() => onSelectServer(srv)}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: 14,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Tv size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {srv.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {srv.type === 'dub' ? 'English Dubbed' : 'Japanese Audio (Subbed)'}
                  </div>
                </div>
              </div>
            </motion.button>
          ))
        )}
      </div>
    </AppDrawer>
  );
}

export default memo(DownloadServerSheet);
