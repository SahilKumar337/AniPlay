import { memo } from 'react';
import AppDrawer from '../ui/AppDrawer';
import { Check, Tv, Zap } from 'lucide-react';
import { motion } from 'motion/react';

function ServerPickerDrawer({
  open,
  onOpenChange,
  servers = [],
  currentServer,
  onSelectServer,
  category = 'sub', // 'sub' | 'dub' | 'raw'
  onCategoryChange,
  subCount = 0,
  dubCount = 0,
}) {
  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Select Stream Server"
      description="Choose a high-speed video provider"
      headerRight={
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255, 255, 255, 0.05)', padding: 3, borderRadius: 10 }}>
          <button
            onClick={() => onCategoryChange?.('sub')}
            style={{
              padding: '4px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              background: category === 'sub' ? 'var(--accent)' : 'transparent',
              color: category === 'sub' ? '#fff' : 'var(--text-tertiary)',
            }}
          >
            SUB {subCount > 0 && `(${subCount})`}
          </button>
          <button
            onClick={() => onCategoryChange?.('dub')}
            style={{
              padding: '4px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              background: category === 'dub' ? 'var(--accent)' : 'transparent',
              color: category === 'dub' ? '#fff' : 'var(--text-tertiary)',
            }}
          >
            DUB {dubCount > 0 && `(${dubCount})`}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {servers.map((srv, idx) => {
          const isSelected = currentServer && (srv.name === currentServer.name || srv.id === currentServer.id);
          const isFast = srv.name?.toLowerCase().includes('neko') || srv.name?.toLowerCase().includes('waves') || srv.name?.toLowerCase().includes('anihd');

          return (
            <motion.div
              key={srv.id || srv.name || idx}
              onClick={() => {
                onSelectServer(srv);
                onOpenChange(false);
              }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: 14,
                background: isSelected ? 'rgba(108, 99, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isSelected ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  <Tv size={18} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {srv.name || `Server ${idx + 1}`}
                    </span>
                    {isFast && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          color: '#22c55e',
                          background: 'rgba(34, 197, 94, 0.12)',
                          padding: '2px 6px',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Zap size={9} /> FAST
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {srv.quality || 'Multi-Quality HD (1080p/720p/480p)'}
                  </span>
                </div>
              </div>

              {isSelected ? (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                  }}
                >
                  <Check size={14} strokeWidth={3} />
                </div>
              ) : (
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    border: '1.5px solid var(--border-strong)',
                  }}
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </AppDrawer>
  );
}

export default memo(ServerPickerDrawer);
