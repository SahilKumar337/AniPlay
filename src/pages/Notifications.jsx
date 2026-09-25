import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Heart, MessageCircle, ChevronRight, Trash2, Play, Activity, ArrowLeft, CheckCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../api/supabase';
import LoadingWheel from '../components/ui/LoadingWheel';

export default function Notifications() {
  const navigate = useNavigate();
  const { user, refreshUnreadCount } = useApp();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [activeTab, setActiveTab]         = useState('all');

  const tabRefs = useRef({});
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0, opacity: 0 });

  // 15-minute in-memory cache — prevents a DB round-trip on every tab-switch/back-nav
  const notifCacheRef = useRef({ data: null, ts: 0 });
  const NOTIF_CACHE_TTL = 15 * 60 * 1000; // 15 minutes — egress-safe, users rarely need instant

  /* ── Fetch & Auto-Clean Notifications ───────────────────────────── */
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    let supabaseNotifs = [];

    if (user?.id) {
      // Serve from cache if fresh (avoids DB hit on every navigation)
      const cached = notifCacheRef.current;
      if (cached.data && (Date.now() - cached.ts) < NOTIF_CACHE_TTL) {
        supabaseNotifs = cached.data;
      } else {
        try {
          const { data, error } = await supabase
            .from('notifications')
            .select('id, target_user_id, actor_name, type, comment_preview, anime_id, is_read, created_at')
            .eq('target_user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(15); // 15 rows — covers typical user's feed, saves ~50% egress vs 30

          if (!error && data) {
            supabaseNotifs = data;
            notifCacheRef.current = { data, ts: Date.now() }; // cache the result

            // Auto-prune: delete read notifications older than 7 days (fire-and-forget)
            const nowMs = Date.now();
            const expiredIds = data
              .filter(n => n.is_read && (nowMs - new Date(n.created_at).getTime()) > 7 * 24 * 3600 * 1000)
              .map(n => n.id);
            if (expiredIds.length > 0) {
              supabase.from('notifications').delete().in('id', expiredIds).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[Notifications] fetch error:', e.message);
        }
      }
    }

    // Merge with local episode release notifications from localStorage
    let localNotifs = [];
    try {
      const raw = localStorage.getItem('aniplay_local_notifications') || '[]';
      localNotifs = JSON.parse(raw);
    } catch (_) {}

    // Combine & deduplicate
    const combined = [...supabaseNotifs];
    for (const loc of localNotifs) {
      const exists = combined.some(n =>
        (n.id && n.id === loc.id) ||
        (String(n.anime_id) === String(loc.anime_id) && n.type === loc.type && n.comment_preview === loc.comment_preview)
      );
      if (!exists) {
        combined.push(loc);
      }
    }

    // Sort by created_at DESC
    combined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // Auto-Cleanup: keep unread OR items less than 24 hours old. Also hide future alerts!
    const now = Date.now();
    const cleaned = combined.filter(n => {
      const createdAtMs = new Date(n.created_at).getTime();
      if (createdAtMs > now) return false;

      const ageHours = (now - createdAtMs) / (1000 * 3600);
      return !n.is_read || ageHours < 24;
    });

    setNotifications(cleaned);
    setLoading(false);
  }, [user?.id]);

  /* ── Mark all as read ──────────────────────────────────────────────── */
  const markAllRead = useCallback(async () => {
    try {
      const raw = localStorage.getItem('aniplay_local_notifications') || '[]';
      const list = JSON.parse(raw).map(item => ({ ...item, is_read: true }));
      localStorage.setItem('aniplay_local_notifications', JSON.stringify(list));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aniplay_unread_notifications_updated'));
      }
    } catch (_) {}

    if (user?.id) {
      try {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('target_user_id', user.id)
          .eq('is_read', false);
      } catch (_) {}
    }
    refreshUnreadCount();
  }, [user?.id, refreshUnreadCount]);

  useEffect(() => {
    fetchNotifications();
    const timer = setTimeout(() => {
      markAllRead();
    }, 2000);
    return () => clearTimeout(timer);
  }, [fetchNotifications, markAllRead]);

  /* ── Update Sliding Pill Position ─────────────────────────────────── */
  useEffect(() => {
    const activeEl = tabRefs.current[activeTab];
    if (activeEl) {
      setPillStyle({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
        opacity: 1,
      });
    }
  }, [activeTab, notifications]);

  const [deletingNotifId, setDeletingNotifId] = useState(null);

  /* ── Delete single ────────────────────────────────────────────────── */
  const deleteOne = async (id) => {
    const next = notifications.filter(n => n.id !== id);
    setNotifications(next);

    try {
      const raw = localStorage.getItem('aniplay_local_notifications') || '[]';
      const list = JSON.parse(raw).filter(n => n.id !== id);
      localStorage.setItem('aniplay_local_notifications', JSON.stringify(list));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aniplay_unread_notifications_updated'));
      }
    } catch (_) {}

    try {
      await supabase.from('notifications').delete().eq('id', id);
    } catch (_) {}
    refreshUnreadCount();
  };

  const handleDeleteOne = (e, id) => {
    e.stopPropagation();
    setDeletingNotifId(id);
    setTimeout(() => {
      deleteOne(id);
      setDeletingNotifId(null);
    }, 320);
  };

  /* ── Clear everything ────────────────────────────────────────────── */
  const clearAll = async () => {
    setNotifications([]);
    localStorage.removeItem('aniplay_local_notifications');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aniplay_unread_notifications_updated'));
    }
    try {
      if (user?.id) {
        await supabase.from('notifications').delete().eq('target_user_id', user.id);
      }
    } catch (_) {}
    refreshUnreadCount();
  };

  /* ── Tap notification ──────────────────────────────────────────────── */
  const handleItemClick = async (n) => {
    if (!n.is_read) {
      setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, is_read: true } : item));

      try {
        const raw = localStorage.getItem('aniplay_local_notifications') || '[]';
        const list = JSON.parse(raw).map(item => item.id === n.id ? { ...item, is_read: true } : item);
        localStorage.setItem('aniplay_local_notifications', JSON.stringify(list));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aniplay_unread_notifications_updated'));
        }
      } catch (_) {}

      if (user?.id) {
        supabase.from('notifications').update({ is_read: true }).eq('id', n.id).then(() => refreshUnreadCount()).catch(() => {});
      } else {
        refreshUnreadCount();
      }
    }

    if (n.anime_id) {
      navigate(`/anime/${n.anime_id}`);
    }
  };

  const timeAgo = (ts) => {
    const d = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (d < 60)   return `${d}s ago`;
    if (d < 3600) return `${Math.floor(d/60)}m ago`;
    if (d < 86400)return `${Math.floor(d/3600)}h ago`;
    return `${Math.floor(d/86400)}d ago`;
  };

  const getTypeStyle = (type) => {
    if (type === 'like') return {
      icon: <Heart size={20} fill="#f43f5e" color="#f43f5e" />,
      subIcon: <Heart size={10} color="#f43f5e" fill="#f43f5e" />,
      bg: 'rgba(244,63,94,0.12)',
      badge: 'LIKE',
      badgeBg: 'rgba(244,63,94,0.18)',
      badgeColor: '#fb7185'
    };
    if (type === 'episode') return {
      icon: <Play size={20} fill="#10b981" color="#10b981" />,
      subIcon: <Activity size={10} color="#10b981" />,
      bg: 'rgba(16,185,129,0.12)',
      badge: 'RELEASE',
      badgeBg: 'rgba(16,185,129,0.18)',
      badgeColor: '#34d399'
    };
    return {
      icon: <MessageCircle size={20} color="#8b5cf6" fill="#8b5cf6" />,
      subIcon: <MessageCircle size={10} color="#8b5cf6" fill="#8b5cf6" />,
      bg: 'rgba(139,92,246,0.12)',
      badge: 'REPLY',
      badgeBg: 'rgba(139,92,246,0.18)',
      badgeColor: '#a78bfa'
    };
  };

  const textFor = (n) => {
    const name = n.actor_name || 'Someone';
    if (n.type === 'like')   return `${name} liked your comment`;
    if (n.type === 'reply')  return `${name} replied to your comment`;
    if (n.type === 'episode')return `New episode released`;
    return n.message || 'New notification';
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const filteredNotifs = notifications.filter(n => {
    if (activeTab === 'releases') return n.type === 'episode';
    if (activeTab === 'reminders') return n.type === 'like' || n.type === 'reply';
    return true;
  });

  const groupNotificationsByDate = (notifs) => {
    const groups = {
      'TODAY': [],
      'YESTERDAY': [],
      'THIS WEEK': [],
      'OLDER': []
    };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - 86400000 * 7;

    notifs.forEach(n => {
      const t = new Date(n.created_at).getTime();
      if (t >= today) groups['TODAY'].push(n);
      else if (t >= yesterday) groups['YESTERDAY'].push(n);
      else if (t >= lastWeek) groups['THIS WEEK'].push(n);
      else groups['OLDER'].push(n);
    });
    return groups;
  };

  const grouped = groupNotificationsByDate(filteredNotifs);

  const tabs = [
    { id: 'all', label: 'All', count: notifications.length },
    { id: 'releases', label: 'Releases', count: notifications.filter(n => n.type === 'episode').length },
    { id: 'reminders', label: 'Reminders', count: notifications.filter(n => n.type === 'like' || n.type === 'reply').length },
  ];

  return (
    <div className="page" style={{ minHeight: '100vh', background: 'var(--bg-primary, #0b0f19)', paddingBottom: 60 }}>
      
      {/* ── Glass Floating Header ────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'linear-gradient(to bottom, rgba(16, 16, 20, 0.93) 0%, rgba(10, 10, 13, 0.98) 100%)',
        backdropFilter: 'blur(32px) brightness(0.5) saturate(1.2)',
        WebkitBackdropFilter: 'blur(32px) brightness(0.5) saturate(1.2)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      }}>
        {/* Title Bar */}
        <div style={{
          padding: '10px 16px 10px',
          paddingTop: 'var(--sat)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                width: 36, height: 36, borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 style={{
                fontSize: 20, fontWeight: 800, color: '#fff', margin: 0,
                fontFamily: 'var(--font-brand)', letterSpacing: '-0.02em',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                Notifications
                {unreadCount > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(229, 9, 20, 0.18)', color: '#ff4d4d',
                    border: '1px solid rgba(229, 9, 20, 0.3)',
                    boxShadow: '0 0 10px rgba(229, 9, 20, 0.2)'
                  }}>
                    {unreadCount} NEW
                  </span>
                )}
              </h1>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                {notifications.length} total update{notifications.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 10,
                padding: '6px 12px',
                paddingTop: 'var(--sat)',
                display: 'flex', alignItems: 'center', gap: 6,
                color: '#f87171', fontWeight: 600, fontSize: 12,
                cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              <Trash2 size={13} />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* ── Glass Tabs Row with Sliding Pill Animation ───────────────── */}
        <div style={{
          padding: '4px 16px 12px',
        }}>
          <div style={{
            position: 'relative',
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 14,
            padding: 4,
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}>
            {/* GPU-Accelerated Sliding Pill Track */}
            <div style={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: 4,
              width: 'calc((100% - 8px) / 3)',
              transform: `translate3d(${(tabs.findIndex(t => t.id === activeTab) >= 0 ? tabs.findIndex(t => t.id === activeTab) : 0) * 100}%, 0, 0)`,
              transition: 'transform 0.34s cubic-bezier(0.2, 0.9, 0.28, 1)',
              willChange: 'transform',
              pointerEvents: 'none',
              zIndex: 0,
            }}>
              <div style={{
                width: '100%',
                height: '100%',
                borderRadius: 10,
                background: 'var(--accent)',
                boxShadow: '0 4px 16px color-mix(in srgb, var(--accent) 50%, transparent)',
              }} />
            </div>

          {tabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                ref={el => (tabRefs.current[t.id] = el)}
                onClick={() => setActiveTab(t.id)}
                style={{
                  flex: 1,
                  position: 'relative',
                  zIndex: 1,
                  background: 'none',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  color: active ? '#fff' : 'var(--text-muted)',
                  fontWeight: active ? 700 : 600,
                  fontSize: 13,
                  transition: 'color 0.2s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{t.label}</span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 8,
                  background: active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                  color: active ? '#fff' : 'var(--text-muted)',
                }}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      </header>

      {/* ── Content Container ───────────────────────────────────────── */}
      <div style={{ padding: '16px', paddingTop: 'var(--sat)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!user ? (
          <EmptyState
            icon={<Bell size={44} color="var(--accent)" style={{ filter: 'drop-shadow(0 0 12px var(--accent))' }} />}
            title="Sign in to sync alerts"
            subtitle="Never miss comment likes, replies, or new episode drops."
          />
        ) : loading ? (
          <div style={{ padding: '60px 0', paddingTop: 'var(--sat)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <LoadingWheel size={40} text="Loading notifications..." />
          </div>
        ) : filteredNotifs.length === 0 ? (
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 20,
            border: '1px dashed rgba(255, 255, 255, 0.08)',
            padding: '48px 20px',
            textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <CheckCheck size={24} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>All Caught Up</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                New episode drops and community activity will show up here.
              </p>
            </div>
          </div>
        ) : (
          Object.entries(grouped).map(([groupName, items]) => {
            if (items.length === 0) return null;
            return (
              <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h3 style={{
                  fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
                  letterSpacing: '0.08em', margin: '0 0 2px 4px', textTransform: 'uppercase'
                }}>
                  {groupName}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.map(n => {
                    const style = getTypeStyle(n.type);
                    const isDeleting = deletingNotifId === n.id;
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleItemClick(n)}
                        style={{
                          display: 'flex',
                          gap: 14,
                          padding: isDeleting ? '0 16px' : '14px 16px',
                          borderRadius: 16,
                          background: n.is_read ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)',
                          backdropFilter: 'blur(12px)',
                          WebkitBackdropFilter: 'blur(12px)',
                          border: n.is_read ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(255, 255, 255, 0.12)',
                          cursor: n.anime_id ? 'pointer' : 'default',
                          position: 'relative',
                          overflow: 'hidden',
                          opacity: isDeleting ? 0 : 1,
                          transform: isDeleting ? 'scale(0.85) translateY(-12px)' : 'none',
                          filter: isDeleting ? 'blur(8px)' : 'none',
                          maxHeight: isDeleting ? 0 : 200,
                          transition: 'transform 0.32s cubic-bezier(0.2, 1, 0.3, 1), opacity 0.32s ease, max-height 0.32s ease, filter 0.32s ease',
                        }}
                      >
                        {/* Unread Left Glowing Border Accent */}
                        {!n.is_read && (
                          <div style={{
                            position: 'absolute',
                            left: 0, top: 0, bottom: 0,
                            width: 3.5,
                            background: style.badgeColor || 'var(--accent)',
                            boxShadow: `0 0 10px ${style.badgeColor || 'var(--accent)'}`,
                          }} />
                        )}

                        {/* Icon Area */}
                        <div style={{
                          position: 'relative',
                          width: 44, height: 44,
                          borderRadius: 12, flexShrink: 0,
                          background: style.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: `1px solid ${style.badgeBg}`
                        }}>
                          {style.icon}
                          <div style={{
                            position: 'absolute', bottom: -3, right: -3,
                            width: 18, height: 18, borderRadius: '50%',
                            background: '#0b0f19',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1.5px solid rgba(255,255,255,0.1)'
                          }}>
                            {style.subIcon}
                          </div>
                        </div>

                        {/* Content Area */}
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6,
                                background: style.badgeBg, color: style.badgeColor, letterSpacing: '0.05em'
                              }}>
                                {style.badge}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                                {timeAgo(n.created_at)}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={(e) => handleDeleteOne(e, n.id)}
                                style={{
                                  background: 'rgba(255, 255, 255, 0.04)', border: 'none',
                                  borderRadius: 8, padding: '4px 6px', cursor: 'pointer',
                                  color: 'var(--text-muted)', transition: 'all 0.2s',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}
                                onTouchStart={e => e.currentTarget.style.color = '#ef4444'}
                                onTouchEnd={e => e.currentTarget.style.color = 'var(--text-muted)'}
                              >
                                <Trash2 size={13} />
                              </button>
                              <ChevronRight size={14} color="var(--text-muted)" />
                            </div>
                          </div>

                          <h4 style={{ margin: '3px 0 0', fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>
                            {textFor(n)}
                          </h4>

                          {n.comment_preview && (
                            <p style={{
                              margin: '4px 0 0', fontSize: 12, color: 'rgba(255, 255, 255, 0.7)',
                              lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden'
                            }}>
                              {n.comment_preview}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{
      textAlign: 'center', padding: '60px 20px',
      paddingTop: 'var(--sat)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 24,
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
      }}>
        {icon}
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: '4px 0 0' }}>{title}</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, maxWidth: 260, lineHeight: 1.4 }}>{subtitle}</p>
    </div>
  );
}
