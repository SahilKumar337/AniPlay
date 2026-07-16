import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, Lock, User, Loader, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { cloudSignIn, cloudSignUp } from '../api/supabase';
import { useApp } from '../context/AppContext';

// Map Supabase error messages to user-friendly strings
function mapAuthError(msg = '') {
  if (msg.includes('Invalid login credentials'))
    return 'Incorrect email or password. Please try again.';
  if (msg.includes('Email not confirmed'))
    return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (msg.includes('User already registered'))
    return 'An account with this email already exists. Try signing in instead.';
  if (msg.includes('Password should be at least'))
    return 'Password must be at least 6 characters.';
  if (msg.includes('Unable to validate email'))
    return 'Please enter a valid email address.';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Too many attempts. Please wait a minute and try again.';
  if (msg.includes('network') || msg.includes('fetch'))
    return 'Network error. Please check your connection and try again.';
  return msg || 'Something went wrong. Please try again.';
}

const INPUT_STYLE = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1.5px solid rgba(255,255,255,0.1)',
  borderRadius: 14,
  padding: '13px 13px 13px 44px',
  color: '#fff',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.2s',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export default function AuthModal({ isOpen, onClose }) {
  const { showToast } = useApp();

  const [isSignUp, setIsSignUp]       = useState(false);
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [nickname, setNickname]       = useState('');
  const [loading, setLoading]         = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');
  const [signUpDone, setSignUpDone]   = useState(false); // show "check email" state

  // Guard: don't setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reset everything when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setEmail(''); setPassword(''); setNickname('');
      setErrorMsg(''); setLoading(false); setSignUpDone(false); setIsSignUp(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validateEmail = (v) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    // Validation
    if (!email.trim() || !password) {
      setErrorMsg('Please fill in all fields'); return;
    }
    if (isSignUp && !nickname.trim()) {
      setErrorMsg('Please enter a display nickname'); return;
    }
    if (!validateEmail(email.trim())) {
      setErrorMsg('Please enter a valid email address (e.g., user@domain.com)'); return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters'); return;
    }

    if (!mountedRef.current) return;
    setLoading(true);

    // 15-second timeout
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setLoading(false);
        setErrorMsg('Request timed out. Please check your internet connection and try again.');
      }
    }, 15000);

    try {
      if (isSignUp) {
        const signUpData = await cloudSignUp(email.trim(), password, nickname.trim());
        if (mountedRef.current) {
          clearTimeout(timer);
          setLoading(false);
          if (signUpData?.session) {
            showToast('Account created — logged in successfully!');
            onClose();
          } else {
            setSignUpDone(true); // Show "check your email" screen if confirmation is required
          }
        }
      } else {
        await cloudSignIn(email.trim(), password);
        if (mountedRef.current) {
          clearTimeout(timer);
          setLoading(false);
          showToast('Logged in successfully — welcome back.');
          onClose();
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        clearTimeout(timer);
        setLoading(false);
        setErrorMsg(mapAuthError(err.message));
      }
    }
  };

  const switchMode = () => {
    setIsSignUp(v => !v);
    setErrorMsg('');
    setSignUpDone(false);
  };

  // ── "Check your email" confirmation screen ──────────────────────────
  if (signUpDone) {
    return createPortal(
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <div style={{
          background: 'rgba(28,28,30,0.98)', border: '0.5px solid rgba(255,255,255,0.1)',
          borderRadius: 24, width: '100%', maxWidth: 380, padding: 32,
          textAlign: 'center', boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
        }}>
          {/* Icon */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%', margin: '0 auto 20px',
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Mail size={24} color="var(--accent)" />
          </div>

          <h3 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800, color: '#fff' }}>
            Check Your Email
          </h3>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
            We sent a confirmation link to
          </p>
          <p style={{ margin: '0 0 24px', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
            {email}
          </p>
          <p style={{ margin: '0 0 28px', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
            Tap the link in the email to confirm your account and log in. The link opens AniPlay automatically.
          </p>

          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 14, border: 'none',
              background: 'var(--accent)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Got it
          </button>
          <button
            onClick={switchMode}
            style={{
              marginTop: 12, background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.4)', fontSize: 12, cursor: 'pointer', padding: 0,
            }}
          >
            Already confirmed? Sign In
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // ── Main Auth Form ──────────────────────────────────────────────────
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, animation: 'fadeIn 0.2s ease',
    }}>
      <div style={{
        background: 'rgba(15,15,20,0.98)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24, width: '100%', maxWidth: 380, padding: '28px 24px',
        position: 'relative', boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
        boxSizing: 'border-box',
      }}>

        {/* Close */}
        <button
          onClick={onClose}
          disabled={loading}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'rgba(255,255,255,0.06)', border: 'none',
            borderRadius: '50%', width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
            zIndex: 1, transition: 'background 0.2s',
          }}
          onTouchStart={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onTouchEnd={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
        >
          <X size={15} />
        </button>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {isSignUp ? 'Join AniPlay for cloud backups' : 'Sign in to access your cloud watchlist'}
          </p>
        </div>

        {/* Error */}
        {errorMsg && (
          <div style={{
            display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 14,
            background: 'rgba(239,68,68,0.1)', border: '1.5px solid rgba(239,68,68,0.16)',
            marginBottom: 20, color: '#f87171', fontSize: 13, fontWeight: 500,
            lineHeight: 1.5,
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Nickname (sign-up only) */}
          {isSignUp && (
            <div style={{ position: 'relative' }}>
              <User size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)' }} />
              <input
                type="text"
                placeholder="Nickname"
                value={nickname}
                onChange={e => setNickname(e.target.value.slice(0, 25))}
                style={INPUT_STYLE}
                disabled={loading}
                autoComplete="nickname"
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>
          )}

          {/* Email */}
          <div style={{ position: 'relative' }}>
            <Mail size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)' }} />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={INPUT_STYLE}
              disabled={loading}
              autoComplete="email"
              inputMode="email"
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
          </div>

          {/* Password */}
          <div style={{ position: 'relative' }}>
            <Lock size={15} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ ...INPUT_STYLE, paddingRight: 44 }}
              disabled={loading}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                cursor: 'pointer', padding: 4, display: 'flex',
              }}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 6,
              background: loading
                ? 'rgba(10,132,255,0.4)'
                : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 14,
              padding: '14px 0', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? (
              <>
                <Loader size={16} className="spin" />
                <span>{isSignUp ? 'Creating Account...' : 'Signing In...'}</span>
              </>
            ) : (
              <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
            )}
          </button>
        </form>

        {/* Toggle */}
        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={switchMode}
            disabled={loading}
            style={{
              background: 'none', border: 'none', color: 'var(--accent)',
              fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13,
            }}
          >
            {isSignUp ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
