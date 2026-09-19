import { useState, memo } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Tv, Wifi } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LoadingWheel from '../ui/LoadingWheel';

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.03 } },
};

const itemVariants = {
  hidden:  { opacity: 0, x: -14, scale: 0.97 },
  visible: { opacity: 1, x: 0,   scale: 1, transition: { type: 'spring', stiffness: 400, damping: 26 } },
};

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
      onOpenChange={(open) => { if (!open) onClose?.(); }}
      title="Download Episode"
      description={`Episode ${data.episode} · Choose server`}
      headerRight={
        <div style={{
          display: 'flex',
          gap: 4,
          background: 'rgba(255,255,255,0.06)',
          padding: 3,
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          {['sub', 'dub'].map((trk) => {
            const servers = trk === 'sub' ? subServers : dubServers;
            const isActive = effectiveTrack === trk;
            const hasServers = servers.length > 0;
            return (
              <motion.button
                key={trk}
                disabled={!hasServers}
                onClick={() => handleTrackToggle(trk)}
                whileTap={hasServers ? { scale: 0.94 } : {}}
                animate={{ background: isActive ? 'var(--accent)' : 'transparent' }}
                transition={{ duration: 0.18 }}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  border: 'none',
                  color: !hasServers
                    ? 'rgba(255,255,255,0.25)'
                    : isActive ? '#fff' : 'var(--text-tertiary)',
                  opacity: !hasServers ? 0.35 : 1,
                  cursor: !hasServers ? 'not-allowed' : 'pointer',
                  pointerEvents: !hasServers ? 'none' : 'auto',
                  letterSpacing: '0.04em',
                }}
              >
                {trk === 'dub' && !hasServers ? 'DUB (None)' : trk.toUpperCase()}
              </motion.button>
            );
          })}
        </div>
      }
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingBottom: 'max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px), 32px)',
      }}>
        {data.loading ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '36px 16px',
            }}
          >
            <LoadingWheel size={36} text="Finding available download servers..." />
          </motion.div>
        ) : filteredServers.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
          >
            No {trackToUse.toUpperCase()} servers available for this episode.
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={effectiveTrack}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {filteredServers.map((srv, idx) => (
                <motion.button
                  key={srv.id || srv.name || idx}
                  variants={itemVariants}
                  onClick={() => onSelectServer(srv)}
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ scale: 1.01 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    borderRadius: 16,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    willChange: 'transform',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      background: 'linear-gradient(135deg, rgba(108,99,255,0.18) 0%, rgba(108,99,255,0.06) 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent)',
                    }}>
                      <Tv size={18} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {srv.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                        {srv.type === 'dub' ? 'English Dubbed' : 'Japanese Audio (Subbed)'}
                      </div>
                    </div>
                  </div>
                  <Wifi size={14} color="var(--text-muted)" />
                </motion.button>
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </AppDrawer>
  );
}

export default memo(DownloadServerSheet);
