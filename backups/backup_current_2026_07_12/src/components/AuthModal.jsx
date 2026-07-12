import { useState, useRef, useEffect } from 'react';
import { X, Mail, Lock, User, Loader, Eye, EyeOff } from 'lucide-react';
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
            showToast('Account created & logged in successfully! Welcome 🎉');
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
          showToast('Logged in successfully! Welcome back 👋');
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
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <div style={{
          background: 'rgba(15,15,20,0.98)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 24, width: '100%', maxWidth: 380, padding: 32,
          textAlign: 'center', boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
        }}>
          {/* Icon */}
          <div style={{
            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.2))',
            border: '2px solid rgba(124,58,237,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
          }}>📬</div>

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
              background: 'linear-gradient(135deg, var(--accent), #6366f1)',
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
      </div>
    );
  }

  // ── Main Auth Form ──────────────────────────────────────────────────
  return (
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
          }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>{isSignUp ? '✨' : '👋'}</div>
          <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#fff' }}>
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {isSignUp
              ? 'Sync your watchlist across devices'
              : 'Sign in to restore your watchlist & favorites'}
          </p>
        </div>

        {/* Error */}
        {errorMsg && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 12, padding: '11px 14px', marginBottom: 18,
            color: '#f87171', fontSize: 13, lineHeight: 1.5, display: 'flex', gap: 8,
          }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
        <form noValidate onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Nickname (sign-up only) */}
          {isSignUp && (
            <div style={{ position: 'relative' }}>
              <User size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Display Nickname"
                value={nickname}
                onChange={e => setNickname(e.target.value.slice(0, 25))}
                style={INPUT_STYLE}
                disabled={loading}
                autoComplete="nickname"
              />
            </div>
          )}

          {/* Email */}
          <div style={{ position: 'relative' }}>
            <Mail size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={INPUT_STYLE}
              disabled={loading}
              autoComplete="email"
              inputMode="email"
            />
          </div>

          {/* Password */}
          <div style={{ position: 'relative' }}>
            <Lock size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password (min. 6 characters)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ ...INPUT_STYLE, paddingRight: 44 }}
              disabled={loading}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
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
                ? 'rgba(124,58,237,0.5)'
                : 'linear-gradient(135deg, var(--accent), #6366f1)',
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
    </div>
  );
}
