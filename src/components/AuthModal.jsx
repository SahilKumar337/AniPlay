import { useState } from 'react';
import { X, Mail, Lock, User, Loader } from 'lucide-react';
import { cloudSignIn, cloudSignUp } from '../api/supabase';
import { useApp } from '../context/AppContext';

export default function AuthModal({ isOpen, onClose }) {
  const { showToast } = useApp();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || (isSignUp && !nickname)) {
      setErrorMsg('Please fill in all fields');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      if (isSignUp) {
        await cloudSignUp(email.trim(), password, nickname.trim());
        showToast('Account created successfully! Welcome 🎉');
      } else {
        await cloudSignIn(email.trim(), password);
        showToast('Logged in successfully! Welcome back 👋');
      }
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, animation: 'fade-in 0.25s ease'
    }}>
      <div style={{
        background: 'rgba(18, 18, 18, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 24, width: '100%', maxWidth: 400, padding: 28,
        position: 'relative', boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
        boxSizing: 'border-box'
      }}>
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 18, right: 18,
            background: 'rgba(255, 255, 255, 0.05)', border: 'none',
            borderRadius: '50%', width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer', transition: 'all 0.2s'
          }}
        >
          <X size={16} />
        </button>

        {/* Title */}
        <h3 style={{ margin: '0 0 8px 0', fontSize: 20, fontWeight: 800, color: '#fff' }}>
          {isSignUp ? 'Create Account' : 'Welcome Back'}
        </h3>
        <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {isSignUp ? 'Sync your watchlist and comments to the cloud' : 'Log in to recover your watchlist and favorites'}
        </p>

        {/* Error Alert */}
        {errorMsg && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 12, padding: '12px 14px', marginBottom: 20,
            color: '#ef4444', fontSize: 13, lineHeight: '1.4'
          }}>
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isSignUp && (
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Display Nickname"
                value={nickname}
                onChange={e => setNickname(e.target.value.slice(0, 25))}
                style={{
                  width: '100%', background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12,
                  padding: '12px 12px 12px 42px', color: '#fff', fontSize: 14,
                  outline: 'none', transition: 'all 0.2s', boxSizing: 'border-box'
                }}
                disabled={loading}
                required
              />
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12,
                padding: '12px 12px 12px 42px', color: '#fff', fontSize: 14,
                outline: 'none', transition: 'all 0.2s', boxSizing: 'border-box'
              }}
              disabled={loading}
              required
            />
          </div>

          <div style={{ position: 'relative' }}>
            <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 12,
                padding: '12px 12px 12px 42px', color: '#fff', fontSize: 14,
                outline: 'none', transition: 'all 0.2s', boxSizing: 'border-box'
              }}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 12, padding: '14px 0', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'default' : 'pointer', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 10
            }}
          >
            {loading ? (
              <>
                <Loader size={16} className="spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
            )}
          </button>
        </form>

        {/* Toggle Mode */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(''); }}
            style={{
              background: 'none', border: 'none', color: 'var(--accent)',
              fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13
            }}
            disabled={loading}
          >
            {isSignUp ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
