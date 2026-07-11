import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download as DownloadIcon, Trash2, CheckCircle2, Loader } from 'lucide-react';
import { downloadManager } from '../utils/DownloadManager';

export default function DownloadPage() {
  const navigate = useNavigate();
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDownloads = async () => {
    try {
      const list = await downloadManager.getDownloadsList();
      setDownloads(list);
    } catch (e) {
      console.error('[DownloadPage] Error loading downloads:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDownloads();

    const unsubscribe = downloadManager.subscribe(() => {
      fetchDownloads();
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (animeId, episode, track) => {
    try {
      await downloadManager.deleteDownload(animeId, episode, track || 'sub');
      fetchDownloads();
    } catch (e) {
      console.error('[DownloadPage] Failed to clear download:', e);
    }
  };

  return (
    <div className="page fade-in-up">
      <div style={{ padding: '16px 16px 8px', paddingTop: 'max(32px, env(safe-area-inset-top))' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-brand)', marginBottom: 4 }}>Download Center</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Track active downloads. Videos are saved directly to your Gallery.</p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="skeleton" style={{ width: '100%', height: 100, borderRadius: 12 }} />
        </div>
      ) : downloads.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <DownloadIcon size={50} color="var(--text-muted)" style={{ opacity: 0.3 }} />
          <p className="empty-title" style={{ marginTop: 16 }}>No Active Downloads</p>
          <p className="empty-sub">Go to any episode watch details page to download</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 20 }}
            onClick={() => navigate('/')}
            id="download-browse"
          >
            Browse Anime
          </button>
        </div>
      ) : (
        <div style={{ padding: '10px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {downloads.map((item, idx) => {
            const isCompleted = item.status === 'completed';
            const taskId = `${item.animeId}_${item.episode}_${item.track || 'sub'}`;
            
            return (
              <div key={idx} style={{
                display: 'flex', gap: 12, background: 'var(--bg-card)',
                borderRadius: 14, padding: 12, border: '1px solid var(--border)',
                alignItems: 'center'
              }}>
                {/* Download indicator icon */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: isCompleted ? 'rgba(76,175,80,0.1)' : 'rgba(229,9,20,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {isCompleted ? (
                    <CheckCircle2 size={22} color="#4caf50" />
                  ) : (
                    <Loader size={20} className="spin" color="var(--accent)" />
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    Episode {item.episode} ({(item.track || 'sub').toUpperCase()})
                  </h3>
                  
                  {isCompleted ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 11, color: '#4caf50', fontWeight: 600 }}>
                        ✓ Completed • Saved to Gallery
                      </span>
                      {item.remuxError && (
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 500, display: 'block', wordBreak: 'break-word', opacity: 0.8 }}>
                          ℹ️ Fallback TS ({item.remuxError}) - Use VLC/MX
                        </span>
                      )}
                    </div>
                  ) : item.status === 'error' ? (
                    <span style={{ fontSize: 11, color: '#e50914', fontWeight: 600, display: 'block', wordBreak: 'break-word' }}>
                      ⚠️ Download failed: {item.error || 'Unknown error'}
                    </span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${item.progress || 0}%`, height: '100%', background: 'var(--accent)' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>
                        {item.progress || 0}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={() => handleDelete(item.animeId, item.episode, item.track)}
                  style={{
                    background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 10,
                    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-secondary)', cursor: 'pointer'
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
