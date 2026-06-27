import { useNavigate } from 'react-router-dom';
import { Download as DownloadIcon, Smartphone } from 'lucide-react';
import Navbar from '../components/Navbar';

export default function DownloadPage() {
  const navigate = useNavigate();
  return (
    <div className="page fade-in-up">
      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-brand)', marginBottom: 8 }}>Downloads</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Download episodes to watch offline</p>
      </div>
      <div className="empty-state" style={{ paddingTop: 40 }}>
        <DownloadIcon size={60} color="var(--text-muted)" style={{ opacity: 0.3 }} />
        <p className="empty-title" style={{ marginTop: 16 }}>No Downloads Yet</p>
        <p className="empty-sub">Browse anime and tap the download button on any episode</p>
        <button
          className="btn btn-primary"
          style={{ marginTop: 20 }}
          onClick={() => navigate('/')}
          id="download-browse"
        >Browse Anime</button>
      </div>
      <Navbar />
    </div>
  );
}
