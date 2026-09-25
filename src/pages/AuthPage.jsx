import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, Eye, EyeOff, AlertCircle, Mail, Play } from 'lucide-react';
import LoadingWheel from '../components/ui/LoadingWheel';
import { cloudSignIn, cloudSignUp, cloudResetPassword } from '../api/supabase';
import { useApp } from '../context/AppContext';
import { registerBackButtonHandler } from '../utils/backButton';

/* ── Error message mapper (kept from AuthModal) ── */
function mapAuthError(msg = '') {
  const m = String(msg || '').toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid_credentials'))
    return 'Incorrect email or password. Check Caps Lock or tap "Forgot Password" below.';
  if (m.includes('email not confirmed'))
    return 'Email not verified yet — check your inbox and spam folder for the confirmation link.';
  if (m.includes('user already registered') || m.includes('already exists') || m.includes('email_exists'))
    return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('password should be at least') || m.includes('password must be at least') || m.includes('signup requires a valid password'))
    return 'Password must be at least 6 characters.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('valid email address'))
    return 'Please enter a valid email address.';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('after 60 seconds') || m.includes('over_email_send_rate_limit'))
    return 'Too many attempts. For security, please wait a minute and try again.';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
    return 'Network connection error. Please check your internet connection.';
  if (m.includes('email link is invalid') || m.includes('token has expired') || m.includes('otp_expired') || m.includes('invalid token') || m.includes('sub claim') || m.includes('jwt expired') || m.includes('auth session missing'))
    return 'This link has expired or is invalid. Please request a new password reset link.';
  if (m.includes('email and password are required') || m.includes('fields are required'))
    return 'Please enter both your email and password.';
  return msg || 'Authentication error. Please try again.';
}

/* ── Underline field with floating label ── */
function AuthField({ label, type = 'text', value, onChange, disabled, autoComplete, inputMode, showToggle, onToggle, showPassword }) {
  const [focused, setFocused] = useState(false);
  const isActive = focused || value.length > 0;

  return (
    <div className="auth-field">
      <label className={`auth-field-label${focused ? ' focused' : ''}`} style={{
        transform: isActive ? 'translateY(0) scale(1)' : 'translateY(20px) scale(1.05)',
        transformOrigin: 'left top',
        transition: 'transform 0.18s ease, color 0.18s ease',
        display: 'block',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.01em',
        pointerEvents: 'none',
      }}>
        {label}
      </label>
      <input
        className="auth-underline-input"
        type={showToggle ? (showPassword ? 'text' : 'password') : type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete={autoComplete}
        autoCapitalize={type === 'email' ? 'none' : undefined}
        autoCorrect="off"
        spellCheck="false"
        inputMode={inputMode}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ display: 'block' }}
      />
      {showToggle && (
        <button
          type="button"
          className="auth-eye-btn"
          onClick={onToggle}
          tabIndex={-1}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Main AuthPage component
   ══════════════════════════════════════════════════════ */
export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useApp();

  // Mode: 'login' | 'signup' | 'forgot'
  const [mode, setMode]               = useState(location.state?.mode || 'login');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [nickname, setNickname]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');

  // Post-submit success screens
  const [signUpDone, setSignUpDone]   = useState(false);
  const [resetSent, setResetSent]     = useState(false);

  // Exit animation
  const [exiting, setExiting]         = useState(false);
  const mountedRef                    = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reset form when mode changes
  useEffect(() => {
    setErrorMsg('');
    setSignUpDone(false);
    setResetSent(false);
  }, [mode]);

  // Hardware back button
  useEffect(() => {
    return registerBackButtonHandler(() => {
      handleClose();
      return true;
    });
  }, []);

  /* ── Exit with animation ── */
  const handleClose = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => {
      const from = location.state?.from;
      if (from) {
        navigate(from, { replace: true });
      } else if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate('/', { replace: true });
      }
    }, 220);
  }, [exiting, navigate, location.state]);

  const validateEmail = (v) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);

  /* ── Form submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg('');

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();

    if (mode === 'forgot') {
      if (!cleanEmail) { setErrorMsg('Please enter your email address.'); return; }
      if (!validateEmail(cleanEmail)) { setErrorMsg('Please enter a valid email address.'); return; }
      setLoading(true);
      try {
        await cloudResetPassword(cleanEmail);
        if (!mountedRef.current) return;
        setLoading(false);
        setResetSent(true);
      } catch (err) {
        if (!mountedRef.current) return;
        setLoading(false);
        setErrorMsg(mapAuthError(err.message));
      }
      return;
    }

    if (!cleanEmail || !cleanPassword) { setErrorMsg('Please fill in all fields.'); return; }
    if (!validateEmail(cleanEmail)) { setErrorMsg('Please enter a valid email address.'); return; }
    if (cleanPassword.length < 6) { setErrorMsg('Password must be at least 6 characters.'); return; }

    setLoading(true);

    try {
      if (mode === 'signup') {
        const cleanNick = (nickname.trim() || cleanEmail.split('@')[0]).slice(0, 25);
        const signUpData = await cloudSignUp(cleanEmail, cleanPassword, cleanNick);
        if (!mountedRef.current) return;
        setLoading(false);

        // EDGE CASE: If user already exists and email confirmations are on,
        // Supabase returns an empty identities array to prevent enumeration.
        if (signUpData?.user && (!signUpData.user.identities || signUpData.user.identities.length === 0)) {
          setErrorMsg('An account with this email already exists. Try logging in instead.');
          return;
        }

        if (signUpData?.session) {
          showToast('Account created! Welcome to AniPlay 🎉');
          handleClose();
        } else {
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

  const headings = { login: 'Log In', signup: 'Create Account', forgot: 'Reset Password' };

  /* ── Success screens ── */
  if (signUpDone || resetSent) {
    const displayEmail = (email || '').trim().toLowerCase();
    return (
      <div className={`auth-page${exiting ? ' exiting' : ''}`}>
        <div className="auth-topbar">
          <div className="auth-topbar-logo">
            <div className="auth-topbar-logo-icon">
              <Play size={16} fill="#fff" color="#fff" strokeWidth={0} />
            </div>
            <span className="auth-topbar-title">AniPlay</span>
          </div>
          <button className="auth-close-btn" onClick={handleClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="auth-body" style={{ justifyContent: 'center' }}>
          <div className="auth-check-email">
            <div className="auth-check-email-icon">
              <Mail size={32} color="#c084fc" />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', margin: 0 }}>
              Check Your Email
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0, maxWidth: 280 }}>
              {resetSent
                ? "We've sent a password reset link to"
                : 'We sent a confirmation link to'}
            </p>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#c084fc', margin: 0 }}>{displayEmail}</p>
            <button
              onClick={() => { setSignUpDone(false); setResetSent(false); handleClose(); }}
              className="auth-submit-btn"
              style={{ marginTop: 24, marginBottom: 0 }}
            >
              Got It
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main form ── */
  return (
    <div className={`auth-page${exiting ? ' exiting' : ''}`}>
      {/* Top bar */}
      <div className="auth-topbar">
        <div className="auth-topbar-logo">
          <div className="auth-topbar-logo-icon">
            <Play size={16} fill="#fff" color="#fff" strokeWidth={0} />
          </div>
          <span className="auth-topbar-title">AniPlay</span>
        </div>
        <button className="auth-close-btn" onClick={handleClose} aria-label="Close" disabled={loading}>
          <X size={18} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="auth-body">
        <h1 className="auth-heading">{headings[mode]}</h1>

        {/* Error */}
        {errorMsg && (
          <div className="auth-error" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Nickname — signup only */}
          {mode === 'signup' && (
            <AuthField
              label="Display Name"
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value.slice(0, 25))}
              disabled={loading}
              autoComplete="nickname"
            />
          )}

          {/* Email */}
          <AuthField
            label="Email Address"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={loading}
            autoComplete="email"
            inputMode="email"
          />

          {/* Password — not shown for forgot */}
          {mode !== 'forgot' && (
            <AuthField
              label="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              showToggle
              showPassword={showPassword}
              onToggle={() => setShowPassword(v => !v)}
            />
          )}

          {/* Forgot password link — login mode only */}
          {mode === 'login' && (
            <div className="auth-forgot">
              <button
                type="button"
                className="auth-forgot-btn"
                onClick={() => setMode('forgot')}
              >
                Forgot Password?
              </button>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            className={`auth-submit-btn${loading ? ' loading' : ''}`}
            disabled={loading}
          >
            {loading ? (
              <>
                <LoadingWheel size={18} />
                <span>
                  {mode === 'forgot' ? 'Sending Link...' : mode === 'signup' ? 'Creating Account...' : 'Signing In...'}
                </span>
              </>
            ) : (
              <span>{mode === 'forgot' ? 'Send Reset Link' : mode === 'signup' ? 'Create Account' : 'Log In'}</span>
            )}
          </button>
        </form>

        {/* Footer links */}
        <div className="auth-footer-links">
          {mode === 'forgot' ? (
            <button className="auth-footer-btn" onClick={() => setMode('login')}>
              Back to Log In
            </button>
          ) : mode === 'signup' ? (
            <>
              <button className="auth-footer-btn" onClick={() => setMode('login')}>
                Log In
              </button>
            </>
          ) : (
            <>
              <button className="auth-footer-btn" onClick={() => setMode('forgot')}>
                Forgot Password?
              </button>
              <span className="auth-footer-divider">|</span>
              <button className="auth-footer-btn" onClick={() => setMode('signup')}>
                Create Account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
