import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Eye, EyeOff, AlertCircle, Sparkles, CheckCircle2, X } from 'lucide-react';
import LoadingWheel from './ui/LoadingWheel';
import { cloudUpdatePassword } from '../api/supabase';
import { useApp } from '../context/AppContext';
import { registerBackButtonHandler } from '../utils/backButton';

export default function NewPasswordModal({ isOpen, onClose }) {
  const { showToast } = useApp();

  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword]     = useState(false);
  const [loading, setLoading]               = useState(false);
  const [errorMsg, setErrorMsg]             = useState('');
  const [isSuccess, setIsSuccess]           = useState(false);
  const [sheetVisible, setSheetVisible]     = useState(false);
  const [isClosing, setIsClosing]           = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Entrance animation
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setSheetVisible(false);
      setPassword(''); setConfirmPassword('');
      setErrorMsg(''); setLoading(false); setIsSuccess(false); setShowPassword(false);
      const t = requestAnimationFrame(() => requestAnimationFrame(() => setSheetVisible(true)));
      return () => cancelAnimationFrame(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return registerBackButtonHandler(() => { handleClose(); return true; });
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setSheetVisible(false);
    setTimeout(() => {
      if (mountedRef.current) setIsClosing(false);
      onClose();
    }, 320);
  }, [isClosing, onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg('');

    const cleanPassword = (password || '').trim();
    const cleanConfirm = (confirmPassword || '').trim();

    if (!cleanPassword || !cleanConfirm) { setErrorMsg('Please fill in both fields.'); return; }
    if (cleanPassword.length < 6) { setErrorMsg('Password must be at least 6 characters.'); return; }
    if (cleanPassword !== cleanConfirm) { setErrorMsg('Passwords do not match.'); return; }

    setLoading(true);
    try {
      await cloudUpdatePassword(cleanPassword);
      if (!mountedRef.current) return;
      setLoading(false);
      setIsSuccess(true);
      showToast('Password updated successfully!');
      setTimeout(() => { if (mountedRef.current) handleClose(); }, 2000);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoading(false);
      let msg = err.message || 'Failed to update password. Please try again.';
      if (msg.includes('session') || msg.includes('not authenticated') || msg.includes('JWT') || msg.includes('token')) {
        msg = 'Session expired. Please request a new password reset link.';
      } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
        msg = 'Network connection error. Please check your internet connection.';
      }
      setErrorMsg(msg);
    }
  };

  if (!isOpen) return null;

  // ── Success screen ───────────────────────────────────────────────
  if (isSuccess) {
    return createPortal(
      <div style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
        animation: 'authFadeIn 0.28s ease both',
      }}>
        <div style={{
          background: 'linear-gradient(145deg, rgba(22,22,34,0.97), rgba(14,14,22,0.99))',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 32, width: '100%', maxWidth: 360,
          padding: '40px 28px 32px', textAlign: 'center',
          boxShadow: '0 40px 100px rgba(0,0,0,0.85)',
          animation: 'authCardIn 0.35s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 22px',
            background: 'linear-gradient(135deg,rgba(34,197,94,0.18),rgba(99,102,241,0.18))',
            border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(34,197,94,0.25), 0 0 0 8px rgba(34,197,94,0.06)',
          }}>
            <CheckCircle2 size={34} color="#4ade80" />
          </div>
          <h3 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>
            Password Updated!
          </h3>
          <p style={{ margin: '0 0 26px', fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
            Your new password is set. You are now signed in to AniPlay.
          </p>
          <button
            onClick={handleClose}
            style={{
              width: '100%', padding: '16px 0', borderRadius: 18, border: 'none',
              background: 'linear-gradient(135deg,#6366f1,#a855f7 50%,#ec4899)',
              color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 10px 32px -4px rgba(168,85,247,0.5)',
            }}
          >
            Continue to AniPlay
          </button>
        </div>
      </div>,
      document.body
    );
  }

  // ── Password Entry Bottom Sheet ──────────────────────────────────
  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(8,4,20,0.80) 100%)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        opacity: sheetVisible ? 1 : 0,
        transition: 'opacity 0.28s ease',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        pointerEvents: sheetVisible ? 'all' : 'none',
      }}
    >
      {/* Ambient orbs */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', width: 260, height: 260, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(34,197,94,0.14) 0%, transparent 70%)',
          top: '15%', right: '5%', filter: 'blur(40px)',
          animation: 'authOrb1 9s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 220, height: 220, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.16) 0%, transparent 70%)',
          top: '30%', left: '-5%', filter: 'blur(36px)',
          animation: 'authOrb2 12s ease-in-out infinite',
        }} />
      </div>

      {/* Sheet */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%', maxWidth: 480, margin: '0 auto',
          background: 'linear-gradient(180deg, rgba(14,14,24,0.97) 0%, rgba(8,8,18,0.99) 100%)',
          borderTop: '0.5px solid rgba(255,255,255,0.14)',
          borderLeft: '0.5px solid rgba(255,255,255,0.08)',
          borderRight: '0.5px solid rgba(255,255,255,0.08)',
          borderTopLeftRadius: 32, borderTopRightRadius: 32,
          borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
          paddingBottom: 'calc(max(24px, env(safe-area-inset-bottom, 24px)))',
          boxShadow: '0 -20px 80px rgba(0,0,0,0.7)',
          transform: sheetVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${sheetVisible ? '0.38s' : '0.28s'} cubic-bezier(0.16, 1, 0.3, 1)`,
          willChange: 'transform',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Drag handle */}
        <div style={{
          width: 38, height: 4.5, background: 'rgba(255,255,255,0.22)',
          borderRadius: 99, margin: '14px auto 0',
        }} />

        <div style={{
          padding: '20px 24px 0',
          maxHeight: '90svh', overflowY: 'auto',
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px 4px 8px', borderRadius: 30, marginBottom: 10,
                background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.22)',
              }}>
                <Lock size={12} color="#4ade80" />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', letterSpacing: '0.02em' }}>
                  Secure Reset
                </span>
              </div>
              <h2 style={{
                margin: '0 0 6px', fontSize: 26, fontWeight: 900, color: '#fff',
                letterSpacing: '-0.04em', lineHeight: 1.1,
              }}>
                New Password
              </h2>
              <p style={{ margin: 0, fontSize: 13.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
                Choose a strong password for your account
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={loading}
              style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: '50%',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
              onTouchStart={e => e.currentTarget.style.transform = 'scale(0.88)'}
              onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <X size={15} />
            </button>
          </div>

          {/* Error */}
          {errorMsg && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '12px 14px', borderRadius: 16, marginTop: 14, marginBottom: 4,
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)',
              color: '#f87171', fontSize: 13, fontWeight: 500, lineHeight: 1.45,
              animation: 'authShake 0.38s cubic-bezier(0.36,0.07,0.19,0.97) both',
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>

            {/* New password */}
            <PasswordInput
              placeholder="New password (min 6 chars)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              showPassword={showPassword}
              onToggle={() => setShowPassword(v => !v)}
              autoComplete="new-password"
            />

            {/* Confirm password */}
            <PasswordInput
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              disabled={loading}
              showPassword={showPassword}
              onToggle={() => setShowPassword(v => !v)}
              autoComplete="new-password"
            />

            {/* Password strength hint */}
            {password.length > 0 && (
              <PasswordStrength password={password} />
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 6, padding: '16px 0', borderRadius: 18, border: 'none',
                background: loading
                  ? 'rgba(99,102,241,0.35)'
                  : 'linear-gradient(135deg, #22c55e 0%, #6366f1 50%, #a855f7 100%)',
                color: '#fff', fontSize: 15, fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                boxShadow: loading ? 'none' : '0 8px 28px -4px rgba(34,197,94,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
                transition: 'transform 0.15s, opacity 0.15s',
                WebkitTapHighlightColor: 'transparent',
              }}
              onTouchStart={e => { if (!loading) e.currentTarget.style.transform = 'scale(0.97)'; }}
              onTouchEnd={e => { if (!loading) e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {loading
                ? <><LoadingWheel size={18} /><span>Updating Password...</span></>
                : <span>Set New Password</span>
              }
            </button>
          </form>

          <p style={{
            textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.22)',
            lineHeight: 1.5, marginTop: 16, marginBottom: 6,
          }}>
            Your password is encrypted and saved securely by Supabase.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes authFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes authCardIn {
          from { opacity: 0; transform: scale(0.93) translateY(16px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes authShake {
          0%,100% { transform: translateX(0); }
          15%     { transform: translateX(-5px); }
          30%     { transform: translateX(4px); }
          45%     { transform: translateX(-3px); }
          60%     { transform: translateX(2px); }
        }
        @keyframes authOrb1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%     { transform: translate(-20px,20px) scale(1.1); }
        }
        @keyframes authOrb2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%     { transform: translate(25px,-15px) scale(0.9); }
        }
      `}</style>
    </div>,
    document.body
  );
}

// ── Reusable password input ──────────────────────────────────────
function PasswordInput({ placeholder, value, onChange, disabled, showPassword, onToggle, autoComplete }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: focused ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
      border: focused ? '1.5px solid rgba(129,140,248,0.55)' : '1px solid rgba(255,255,255,0.09)',
      borderRadius: 16, transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
      boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.12)' : 'none',
      overflow: 'hidden',
    }}>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingLeft: 14, color: focused ? 'rgba(129,140,248,0.85)' : 'rgba(255,255,255,0.35)',
        flexShrink: 0, transition: 'color 0.2s',
      }}>
        <Lock size={17} />
      </span>
      <input
        type={showPassword ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck="false"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1, background: 'none', border: 'none', outline: 'none',
          padding: '15px 8px 15px 12px',
          color: '#fff', fontSize: 15, fontWeight: 500,
          fontFamily: 'inherit', caretColor: '#818cf8',
          touchAction: 'manipulation',
        }}
      />
      <button
        type="button"
        onMouseDown={e => e.preventDefault()}
        onTouchEnd={e => { e.preventDefault(); onToggle(); }}
        onClick={e => { e.preventDefault(); onToggle(); }}
        style={{
          background: 'none', border: 'none', padding: '0 14px 0 0',
          color: showPassword ? '#818cf8' : 'rgba(255,255,255,0.38)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, height: '100%',
        }}
      >
        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

// ── Password strength bar ────────────────────────────────────────
function PasswordStrength({ password }) {
  const len = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasNum = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const score = (len >= 8 ? 1 : 0) + (len >= 12 ? 1 : 0) + (hasUpper ? 1 : 0) + (hasNum ? 1 : 0) + (hasSpecial ? 1 : 0);

  const levels = [
    { label: 'Weak',   color: '#ef4444', bars: 1 },
    { label: 'Fair',   color: '#f97316', bars: 2 },
    { label: 'Good',   color: '#eab308', bars: 3 },
    { label: 'Strong', color: '#22c55e', bars: 4 },
    { label: 'Great',  color: '#4ade80', bars: 5 },
  ];
  const lvl = levels[Math.min(score, 4)];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{
            height: 3, flex: 1, borderRadius: 99,
            background: i <= lvl.bars ? lvl.color : 'rgba(255,255,255,0.10)',
            transition: 'background 0.3s ease',
          }} />
        ))}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: lvl.color, flexShrink: 0 }}>{lvl.label}</span>
    </div>
  );
}
