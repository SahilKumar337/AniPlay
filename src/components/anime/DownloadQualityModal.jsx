import { memo } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LoadingWheel from '../ui/LoadingWheel';

// Stagger container — children slide up one after another
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const itemVariants = {
  hidden:  { opacity: 0, y: 18, scale: 0.97 },
  visible: { opacity: 1, y: 0,  scale: 1, transition: { type: 'spring', stiffness: 420, damping: 28 } },
};

function DownloadQualityModal({
  data, // { episode, variants, loading, onSelect, onCancel }
}) {
  if (!data) return null;

  return (
    <AppDrawer
      open={Boolean(data)}
      onOpenChange={(open) => {
        if (!open) data.onCancel?.(data.episode);
      }}
      title={data.loading ? 'Fetching Qualities' : 'Select Video Quality'}
      description={`Episode ${data.episode} · Offline Download`}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
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
            <LoadingWheel size={36} text="Resolving secure video sources..." />
          </motion.div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key="quality-list"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {(data.variants || []).map((v, idx) => (
                <motion.button
                  key={idx}
                  variants={itemVariants}
                  // Only start download when user EXPLICITLY taps a quality option
                  onClick={() => data.onSelect?.(v)}
                  whileTap={{ scale: 0.96, brightness: 0.9 }}
                  whileHover={{ scale: 1.01 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  style={{
                    width: '100%',
                    padding: '16px 18px',
                    background: 'linear-gradient(135deg, rgba(108,99,255,0.10) 0%, rgba(108,99,255,0.04) 100%)',
                    border: '1px solid rgba(108,99,255,0.22)',
                    borderRadius: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    willChange: 'transform',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                    <span style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: 'var(--text-primary)',
                      letterSpacing: '-0.03em',
                    }}>
                      {v.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                      Tap to begin download
                    </span>
                  </div>
                  <motion.div
                    whileHover={{ rotate: -12, scale: 1.1 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 20 }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--accent-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Download size={15} color="var(--accent)" />
                  </motion.div>
                </motion.button>
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </AppDrawer>
  );
}

export default memo(DownloadQualityModal);
