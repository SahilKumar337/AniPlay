import { memo } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Download, Loader } from 'lucide-react';
import { motion } from 'motion/react';

function DownloadQualityModal({
  data, // { episode, variants, loading, onSelect, onCancel }
}) {
  if (!data) return null;

  return (
    <AppDrawer
      open={Boolean(data)}
      onOpenChange={(open) => {
        if (!open) data.onCancel?.();
      }}
      title={data.loading ? 'Fetching Qualities' : 'Select Video Quality'}
      description={`Episode ${data.episode} · Offline Download`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 'max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px), 32px)' }}>
        {data.loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '36px 16px' }}>
            <Loader size={28} className="spin" color="var(--accent)" />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, margin: 0 }}>
              Resolving secure video sources...
            </p>
          </div>
        ) : (
          (data.variants || []).map((v, idx) => (
            <motion.button
              key={idx}
              onClick={() => data.onSelect?.(v)}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                {v.label}
              </span>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'var(--accent-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Download size={13} color="var(--accent)" />
              </div>
            </motion.button>
          ))
        )}
      </div>
    </AppDrawer>
  );
}

export default memo(DownloadQualityModal);
