import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download as DownloadIcon, Trash2, PlayCircle, Smartphone } from 'lucide-react';
import { downloadManager } from '../utils/DownloadManager';

export default function DownloadPage() {
  const navigate = useNavigate();
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDownloads = async () => {
    try {
      const list = await downloadManager.getDownloadsList();
      // Sort: Completed downloads first, then by timestamp descending
      list.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return -1;
        if (a.status !== 'completed' && b.status === 'completed') return 1;
        return b.timestamp - a.timestamp;
      });
      setDownloads(list);
    } catch (e) {
      console.error('[DownloadPage] Error loading downloads:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDownloads();

    // Live update of progress in list if downloads are running
    const unsubscribe = downloadManager.subscribe(() => {
      fetchDownloads();
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = async (animeId, episode) => {
    if (window.confirm(`Delete Episode ${episode}?`)) {
      try {
        await downloadManager.deleteDownload(animeId, episode);
        fetchDownloads();
      } catch (e) {
        console.error('[DownloadPage] Failed to delete download:', e);
      }
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="page fade-in-up">
      <div style={{ padding: '16px 16px 8px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-brand)', marginBottom: 4 }}>Downloads</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Manage your offline secure downloads</p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="skeleton" style={{ width: '100%', height: 100, borderRadius: 12 }} />
        </div>
      ) : downloads.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <DownloadIcon size={50} color="var(--text-muted)" style={{ opacity: 0.3 }} />
          <p className="empty-title" style={{ marginTop: 16 }}>No Downloads Yet</p>
          <p className="empty-sub">Tap download on any episode inside details page</p>
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
            const taskId = `${item.animeId}_${item.episode}`;
            
            return (
              <div key={idx} style={{
                display: 'flex', gap: 12, background: 'var(--bg-card)',
                borderRadius: 14, padding: 12, border: '1px solid var(--border)',
                alignItems: 'center'
              }}>
                {/* Cover Image */}
                <img src={item.cover} alt={item.animeTitle} style={{
                  width: 50, height: 70, borderRadius: 8, objectFit: 'cover',
                  background: '#222', flexShrink: 0
                }} />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {item.animeTitle}
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 2px' }}>
                    Episode {item.episode}
                  </p>
                  
                  {isCompleted ? (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {formatSize(item.size)} • Completed
                    </span>
                  ) : item.status === 'error' ? (
                    <span style={{ fontSize: 11, color: '#e50914', fontWeight: 600 }}>
                      ⚠️ Error occurred
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

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {isCompleted && (
                    <button
                      onClick={() => navigate(`/anime/${item.animeId}?play=true&ep=${item.episode}`)}
                      style={{
                        background: 'rgba(229,9,20,0.1)', border: 'none', borderRadius: 10,
                        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--accent)', cursor: 'pointer'
                      }}
                    >
                      <PlayCircle size={20} fill="var(--accent)" color="#fff" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(item.animeId, item.episode)}
                    style={{
                      background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 10,
                      width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text-secondary)', cursor: 'pointer'
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
