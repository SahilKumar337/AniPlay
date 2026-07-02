import React, { useState } from 'react';
import { User, Info, Shield, LogOut, ChevronRight, Heart, Bookmark, Clock, Save, Check, X, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';

// ── Reusable bottom-sheet modal ─────────────────────────────────
function Modal({ title, children, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg-card)',
          borderRadius: '20px 20px 0 0',
          padding: '20px 20px 36px',
          border: '1px solid var(--border)',
          animation: 'slideUp 0.25s cubic-bezier(0.34,1.2,0.64,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}


export default function Profile() {
  const { watchlist, favorites, progress } = useApp();
  const navigate = useNavigate();

  const [showSettings,  setShowSettings]  = useState(false);
  const [showAbout,     setShowAbout]     = useState(false);
  const [showPrivacy,   setShowPrivacy]   = useState(false);
  const [showSignOut,   setShowSignOut]   = useState(false);
  const [cookieVal,     setCookieVal]     = useState('');
  const [saveStatus,    setSaveStatus]    = useState(''); // '', 'saving', 'saved', 'error'

  const watchlistCount = Object.keys(watchlist).length;
  const favCount       = favorites.size;
  const progressCount  = Object.keys(progress).length;

  const handleSaveCookie = async () => {
    if (!cookieVal.trim()) return;
    setSaveStatus('saving');
    try {
      const apiKey = import.meta.env.VITE_API_KEY || 'shadowloq333-anilab-key';
      const res = await fetch('/api/set-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ cookies: { animepahe: cookieVal.trim() } })
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        throw new Error(data.error || 'Failed to save');
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const handleSignOut = () => {
    // Clear all locally stored user data
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  };

  const MENU_ITEMS = [
    { icon: Info,   label: 'About AniPlay',   action: () => setShowAbout(true)   },
    { icon: Shield, label: 'Privacy Policy',  action: () => setShowPrivacy(true) },
    { icon: LogOut, label: 'Sign Out',        action: () => setShowSignOut(true), color: 'var(--accent)' },
  ];

  if (showSettings) {
    return (
      <div className="page fade-in-up">
        <div style={{ padding: '24px 16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button 
              onClick={() => setShowSettings(false)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-primary)',
                cursor: 'pointer', padding: '6px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.05)', fontSize: 13, fontWeight: 600
              }}
            >
              Back
            </button>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Backend Settings</h2>
          </div>
          
          <div style={{
            background: 'var(--bg-card)', padding: 16, borderRadius: 12,
            border: '1px solid var(--border)', marginBottom: 20
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12, color: 'var(--text-primary)' }}>
              AnimePahe (AniHD) Cloudflare Cookies
            </h3>
            
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
              AnimePahe uses Cloudflare Turnstile. Open the site in your browser, complete the challenge, copy your cookies, and paste them here to enable AniHD (720p/1080p soft-subs)!
            </p>
            
            <textarea
              value={cookieVal}
              onChange={(e) => setCookieVal(e.target.value)}
              placeholder="Paste your 'cf_clearance=...' or full browser Cookie string here..."
              style={{
                width: '100%', height: 100, background: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--border)', borderRadius: 8, padding: 10,
                color: '#fff', fontSize: 12, fontFamily: 'monospace', resize: 'vertical',
                marginBottom: 14, boxSizing: 'border-box'
              }}
            />
            
            <button
              onClick={handleSaveCookie}
              disabled={saveStatus === 'saving'}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 8, transition: 'all 0.2s'
              }}
            >
              {saveStatus === 'saving' && 'Saving...'}
              {saveStatus === 'saved' && <><Check size={16}/> Saved to Server!</>}
              {saveStatus === 'error' && 'Error saving cookie'}
              {saveStatus === '' && <><Save size={16}/> Save to Backend</>}
            </button>
          </div>
          
          <div style={{
            background: 'var(--bg-card)', padding: 16, borderRadius: 12,
            border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)',
            lineHeight: 1.5
          }}>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)', fontSize: 13 }}>How to get the cookie:</h4>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Open <b>https://animepahe.pw/</b> in your browser.</li>
              <li>Complete the Cloudflare verification if prompted.</li>
              <li>Press <b>F12</b> (Inspect) &gt; Go to <b>Application</b> (or <b>Storage</b>) &gt; <b>Cookies</b>.</li>
              <li>Copy the value of <b>cf_clearance</b> (or double-click and copy the whole Cookie string) and paste it above!</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-in-up">
      <div style={{ padding: '24px 16px 16px' }}>
        {/* Avatar + Name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent), #ff6b35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '3px solid var(--border)',
          }}>
            <User size={36} color="#fff" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-brand)' }}>Anime Fan</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>AniPlay Member</div>
          </div>
        </div>

        {/* Stats */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12, marginBottom: 28,
        }}>
          {[
            { icon: Bookmark, label: 'My List',   value: watchlistCount, action: () => navigate('/mylist') },
            { icon: Heart,    label: 'Favorites',  value: favCount,       action: () => navigate('/mylist') },
            { icon: Clock,    label: 'Watched',    value: progressCount,  action: () => navigate('/mylist') },
          ].map(stat => (
            <div
              key={stat.label}
              onClick={stat.action}
              id={`profile-stat-${stat.label.toLowerCase()}`}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 12,
                padding: '14px 8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                transition: 'all 0.2s',
              }}
            >
              <stat.icon size={20} color="var(--accent)" />
              <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-brand)' }}>{stat.value}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stat.label}</span>
            </div>
          ))}
        </div>

        {/* Menu */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {MENU_ITEMS.map(item => (
            <button
              key={item.label}
              onClick={item.action}
              id={`profile-menu-${item.label.toLowerCase().replace(/\s/g, '-')}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px',
                background: 'var(--bg-card)',
                borderRadius: 12,
                border: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s',
              }}
            >
              <item.icon size={20} color={item.color || 'var(--text-secondary)'} />
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: item.color || 'var(--text-primary)' }}>
                {item.label}
              </span>
              <ChevronRight size={16} color="var(--text-muted)" />
            </button>
          ))}
        </div>

        {/* App version */}
        <div style={{ textAlign: 'center', marginTop: 28, color: 'var(--text-muted)', fontSize: 12 }}>
          AniPlay v1.0.0 · Made with ❤ for anime fans
        </div>
      </div>

      {/* ── About AniPlay modal ──────────────────────────────────── */}
      {showAbout && (
        <Modal title="About AniPlay" onClose={() => setShowAbout(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 900, color: '#fff', fontFamily: 'var(--font-brand)',
            }}>▶</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-brand)' }}>AniPlay</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Version 1.0.0</div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 300 }}>
              AniPlay is a premium anime streaming app. Watch your favorite shows in HD with subtitles, track your progress, and discover new series.
            </p>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 12, width: '100%' }}>
              Made with ❤ for anime fans
            </div>
          </div>
        </Modal>
      )}

      {/* ── Privacy Policy modal ─────────────────────────────────── */}
      {showPrivacy && (
        <Modal title="Privacy Policy" onClose={() => setShowPrivacy(false)}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, maxHeight: '60vh', overflowY: 'auto' }}>
            <p><b>Data We Collect</b><br />AniPlay stores your watchlist, favorites, and progress locally on your device. No personal data is sent to our servers.</p>
            <p><b>Local Storage</b><br />All preferences are stored using your device's local storage. Clearing app data removes this information.</p>
            <p><b>Streaming Content</b><br />AniPlay aggregates publicly available anime streams. We do not host any video content directly.</p>
            <p><b>Third-Party Services</b><br />We use the AniList API (anilist.co) to fetch anime metadata. Their privacy policy applies to that data.</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last updated: July 2025</p>
          </div>
        </Modal>
      )}

      {/* ── Sign Out confirmation ────────────────────────────────── */}
      {showSignOut && (
        <Modal title="Sign Out" onClose={() => setShowSignOut(false)}>
          <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
            <AlertTriangle size={40} color="var(--accent)" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
              This will clear your <b>watchlist</b>, <b>favorites</b>, and <b>watch progress</b>. Are you sure?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowSignOut(false)}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
