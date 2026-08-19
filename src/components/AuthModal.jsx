import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Preferences } from '@capacitor/preferences';
import { X, Mail, Lock, User, Loader, Eye, EyeOff, AlertCircle, Sparkles } from 'lucide-react';
import { cloudSignIn, cloudSignUp } from '../api/supabase';
import { useApp } from '../context/AppContext';
import { registerBackButtonHandler } from '../utils/backButton';

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

const APPLE_INPUT_STYLE = {
  width: '100%',
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 18,
  padding: '15px 15px 15px 48px',
  color: '#fff',
  fontSize: 15,
  fontWeight: 500,
  outline: 'none',
  transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export default function AuthModal({ isOpen, onClose }) {
  const { showToast } = useApp();

  const [isSignUp, setIsSignUp]         = useState(false);
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [nickname, setNickname]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg]         = useState('');
  const [signUpDone, setSignUpDone]     = useState(false);
  const [isClosing, setIsClosing]       = useState(false);

  const emailInputRef = useRef(null);

  // Smooth close handler with exit animation
  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 240);
  };

  // Guard: don't setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Intercept Physical Back Button when open
  useEffect(() => {
    if (isOpen) {
      return registerBackButtonHandler(() => {
        handleClose();
        return true;
      });
    }
  }, [isOpen]);

  // Reset states when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setEmail(''); setPassword(''); setNickname('');
      setErrorMsg(''); setLoading(false); setSignUpDone(false); setIsSignUp(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validateEmail = (v) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password) {
      setErrorMsg('Please fill in all fields'); return;
    }
    if (isSignUp && !nickname.trim()) {
      setErrorMsg('Please enter a display nickname'); return;
    }
    if (!validateEmail(email.trim())) {
      setErrorMsg('Please enter a valid email address'); return;
    }

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();

    try {
      if (isSignUp) {
        const signUpData = await cloudSignUp(cleanEmail, password, nickname.trim());
        if (!mountedRef.current) return;
        setLoading(false);
        if (signUpData?.session) {
          showToast('Account created successfully!');
          handleClose();
        } else {
          // Email confirmation required
          setSignUpDone(true);
        }
      } else {
        await cloudSignIn(cleanEmail, password);
        if (!mountedRef.current) return;
        setLoading(false);
        showToast('Signed in successfully!');
        handleClose();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setLoading(false);
      setErrorMsg(mapAuthError(err.message));
    }
  };

  const toggleMode = () => {
    setErrorMsg('');
    setIsSignUp(v => !v);
    setSignUpDone(false);
  };

  // ── Apple "Check your email" screen ────────────────────────────────
  if (signUpDone) {
    return createPortal(
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(32px) saturate(210%)',
        WebkitBackdropFilter: 'blur(32px) saturate(210%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, animation: 'appleFade 0.25s ease',
      }}>
        <div style={{
          background: 'linear-gradient(145deg, rgba(30, 30, 42, 0.95), rgba(18, 18, 26, 0.98))',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: 32, width: '100%', maxWidth: 380, padding: '34px 26px',
          textAlign: 'center',
          boxShadow: '0 32px 96px rgba(0, 0, 0, 0.8), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
          boxSizing: 'border-box',
          animation: 'applePop 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(99, 102, 241, 0.2))',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(168, 85, 247, 0.3)',
          }}>
            <Mail size={28} color="#a855f7" />
          </div>

          <h3 style={{ margin: '0 0 8px', fontSize: 23, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>
            Check Your Email
          </h3>
          <p style={{ margin: '0 0 6px', fontSize: 14, color: 'rgba(255, 255, 255, 0.55)', lineHeight: 1.5 }}>
            We sent a confirmation link to
          </p>
          <p style={{ margin: '0 0 26px', fontSize: 15, fontWeight: 800, color: '#c084fc' }}>
            {email}
          </p>

          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '16px 0', borderRadius: 18, border: 'none',
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
              color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 10px 30px -4px rgba(168, 85, 247, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.4)',
            }}
          >
            Got it
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // ── Main Centered Apple Vision Glass Modal ──────────────────────────────
  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0, 0, 0, 0.68)',
        backdropFilter: 'blur(32px) saturate(210%)',
        WebkitBackdropFilter: 'blur(32px) saturate(210%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'opacity',
        transform: 'translateZ(0)',
      }}
    >
      <style>{`
        @keyframes applePopEnter {
          0% { opacity: 0; transform: scale(0.92) translateY(16px); filter: blur(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }
        @keyframes applePopExit {
          0% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
          100% { opacity: 0; transform: scale(0.94) translateY(14px); filter: blur(8px); }
        }
      `}</style>

      <div
        style={{
          background: 'linear-gradient(145deg, rgba(28, 28, 40, 0.96), rgba(16, 16, 24, 0.98))',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: 32, width: '100%', maxWidth: 380,
          padding: '34px 28px', position: 'relative',
          boxShadow: '0 32px 96px rgba(0, 0, 0, 0.8), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
          boxSizing: 'border-box',
          animation: isClosing ? 'applePopExit 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'applePopEnter 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform, opacity, filter',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        {/* Apple Gloss Close Icon Button */}
        <button
          onClick={handleClose}
          disabled={loading}
          style={{
            position: 'absolute', top: 20, right: 20,
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '50%', width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.85)', cursor: 'pointer', zIndex: 2,
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
          }}
          onTouchStart={e => e.currentTarget.style.transform = 'scale(0.92)'}
          onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <X size={16} />
        </button>

        {/* Apple Glass Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 20,
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          marginBottom: 18,
          boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.2)',
        }}>
          <Sparkles size={14} color="#c084fc" />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)', letterSpacing: '0.01em' }}>
            AniPlay Cloud
          </span>
        </div>

        {/* Header Title */}
        <div style={{ textAlign: 'left', marginBottom: 26 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 25, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', fontFamily: 'var(--font-brand)' }}>
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h3>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255, 255, 255, 0.5)', lineHeight: 1.45 }}>
            {isSignUp ? 'Join AniPlay for cloud watchlists & cross-device sync' : 'Sign in to access your cloud anime watchlist'}
          </p>
        </div>

        {/* Error Pill */}
        {errorMsg && (
          <div style={{
            display: 'flex', gap: 10, padding: '13px 16px', borderRadius: 18,
            background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.25)',
            marginBottom: 20, color: '#f87171', fontSize: 13.5, fontWeight: 600,
            lineHeight: 1.4, animation: 'shake 0.3s ease',
          }}>
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Apple Styled Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Nickname Field (Sign up only) */}
          {isSignUp && (
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255, 255, 255, 0.45)' }} />
              <input
                type="text"
                placeholder="Display Nickname"
                value={nickname}
                onChange={e => setNickname(e.target.value.slice(0, 25))}
                style={APPLE_INPUT_STYLE}
                disabled={loading}
                autoComplete="nickname"
                onFocus={e => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                  e.target.style.background = 'rgba(0, 0, 0, 0.55)';
                  e.target.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.15)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                  e.target.style.background = 'rgba(0, 0, 0, 0.35)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>
          )}

          {/* Email Field */}
          <div style={{ position: 'relative' }}>
            <Mail size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255, 255, 255, 0.45)' }} />
            <input
              ref={emailInputRef}
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={APPLE_INPUT_STYLE}
              disabled={loading}
              autoComplete="email"
              inputMode="email"
              onFocus={e => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                e.target.style.background = 'rgba(0, 0, 0, 0.55)';
                e.target.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.15)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                e.target.style.background = 'rgba(0, 0, 0, 0.35)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          {/* Password Field */}
          <div style={{ position: 'relative' }}>
            <Lock size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255, 255, 255, 0.45)' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ ...APPLE_INPUT_STYLE, paddingRight: 48 }}
              disabled={loading}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              onFocus={e => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.35)';
                e.target.style.background = 'rgba(0, 0, 0, 0.55)';
                e.target.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.15)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                e.target.style.background = 'rgba(0, 0, 0, 0.35)';
                e.target.style.boxShadow = 'none';
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowPassword(v => !v);
              }}
              onMouseDown={(e) => e.preventDefault()}
              onTouchEnd={(e) => {
                e.preventDefault();
                setShowPassword(v => !v);
              }}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none',
                color: showPassword ? '#c084fc' : 'rgba(255, 255, 255, 0.5)',
                cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 10, borderRadius: '50%',
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Premium Apple Gradient Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              background: loading
                ? 'rgba(168, 85, 247, 0.4)'
                : 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
              color: '#fff', border: 'none', borderRadius: 18,
              padding: '16px 0', fontSize: 15, fontWeight: 800,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: loading ? 'none' : '0 10px 30px -4px rgba(168, 85, 247, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.4)',
              transition: 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s',
            }}
            onTouchStart={e => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)'; }}
            onTouchEnd={e => { if (!loading) e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {loading ? (
              <>
                <Loader size={18} className="spin" />
                <span>{isSignUp ? 'Creating Account...' : 'Signing In...'}</span>
              </>
            ) : (
              <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
            )}
          </button>
        </form>

        {/* Toggle Mode */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13.5, color: 'rgba(255, 255, 255, 0.5)' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={toggleMode}
            disabled={loading}
            style={{
              background: 'none', border: 'none', color: '#c084fc',
              fontWeight: 800, cursor: 'pointer', padding: 0, fontSize: 13.5,
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
