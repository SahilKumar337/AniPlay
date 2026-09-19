import { Component } from 'react';

/**
 * Global Error Boundary for AniPlay
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a graceful fallback UI instead of crashing to a blank white screen.
 */
export default class GlobalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[GlobalErrorBoundary] Caught unexpected error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetAndReload = () => {
    try {
      // Clear non-essential caches while preserving user watch history and favorites
      const preserveKeys = new Set([
        'aniplay_favorites',
        'aniplay_history',
        'aniplay_mylist',
        'aniplay_watched',
        'aniplay_settings',
        'sb-qvvqjbljhywuvfqupzgr-auth-token', // Supabase session
        'aniplay_onboarded',
        'anilab_welcomed'
      ]);

      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !preserveKeys.has(key) && !key.startsWith('sb-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch (_) {}
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || 'An unexpected error occurred.';

      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            backgroundColor: '#0a0a0f',
            backgroundImage: 'radial-gradient(ellipse 80% 80% at 50% -20%, rgba(120, 119, 198, 0.25), rgba(255, 255, 255, 0))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            fontFamily: 'var(--font-main, system-ui, -apple-system, sans-serif)',
            color: '#fff',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: 'rgba(26, 26, 36, 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRadius: 24,
              padding: '32px 24px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          >
            {/* Animated Icon Container */}
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(249, 115, 22, 0.1))',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                margin: '0 auto 20px',
                boxShadow: '0 8px 24px rgba(239, 68, 68, 0.2)',
              }}
            >
              ⚠️
            </div>

            <h2
              style={{
                fontSize: 20,
                fontWeight: 800,
                marginBottom: 8,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(to right, #fff, #a1a1aa)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Something Went Wrong
            </h2>

            <p
              style={{
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.6)',
                lineHeight: 1.5,
                marginBottom: 20,
              }}
            >
              AniPlay caught a runtime display issue. Your saved watch history and settings are completely safe.
            </p>

            {/* Error Detail Pill */}
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                borderRadius: 12,
                padding: '10px 14px',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: 12,
                fontFamily: 'monospace',
                color: '#f87171',
                textAlign: 'left',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 100,
                marginBottom: 24,
              }}
            >
              {errorMsg}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={this.handleReload}
                style={{
                  width: '100%',
                  padding: '13px 0',
                  borderRadius: 14,
                  border: 'none',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(99, 102, 241, 0.35)',
                  touchAction: 'manipulation',
                  transition: 'opacity 0.2s ease, transform 0.15s ease',
                }}
              >
                🔄 Reload App
              </button>

              <button
                onClick={this.handleResetAndReload}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 14,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  transition: 'background 0.2s ease',
                }}
              >
                Clear Temp Cache & Return Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
