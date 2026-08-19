import { useState, useEffect, useRef } from 'react';
import { Search, Play, Bell } from 'lucide-react';
import { getSchedule, getScheduleWeek2, getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import { Plus, Check } from 'lucide-react';

function getTimeLabel(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Build 14-day array starting from today */
function buildDateTabs() {
  const tabs = [];
  const today = new Date();
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    tabs.push({
      label: DAY_NAMES[d.getDay()],
      date: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear(),
      dayKey: d.toDateString(), // unique per calendar day
    });
  }
  return tabs;
}

export default function Schedule() {
  const navigate = useNavigate();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [activeDay, setActiveDay] = useState(0); // 0 = today
  const [headerHeight, setHeaderHeight] = useState(150); // auto-measured via ResizeObserver
  const dayTabsRef = useRef(null);
  const headerRef = useRef(null);

  // Scroll listener for header transparency (same logic as Home)
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      setScrolled(y > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // ResizeObserver: measure actual fixed header height so paddingTop is always correct
  useEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setHeaderHeight(Math.ceil(entry.contentRect.height) + 8);
      }
    });
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  // Fetch both weeks in parallel
  useEffect(() => {
    Promise.all([
      getSchedule(1, 50).catch(() => []),
      getScheduleWeek2(1, 50).catch(() => []),
    ]).then(([w1, w2]) => {
      setSchedule([...w1, ...w2]);
    }).finally(() => setLoading(false));
  }, []);

  const DATE_TABS = buildDateTabs();

  // Group by calendar date (dayKey)
  const byDay = DATE_TABS.map(tab => {
    return schedule.filter(item => {
      return new Date(item.airingAt * 1000).toDateString() === tab.dayKey;
    });
  });

  const dayItems = byDay[activeDay] || [];
  const grouped = {};
  dayItems.forEach(item => {
    const hour = new Date(item.airingAt * 1000).getHours();
    const key = `${String(hour).padStart(2, '0')}:00`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });
  const timeKeys = Object.keys(grouped).sort();

  const now = Date.now() / 1000;
  const currentHourKey = `${String(new Date().getHours()).padStart(2, '0')}:00`;

  // Scroll active day tab into center view when activeDay changes
  useEffect(() => {
    if (!dayTabsRef.current) return;
    const btn = dayTabsRef.current.children[activeDay];
    if (btn) btn.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  }, [activeDay]);

  return (
    <div className="page" style={{ paddingTop: headerHeight }}>

      {/* ── Fixed Frosted-Glass Header ────────────────────────────────────── */}
      <div ref={headerRef} style={{
        position: 'fixed', top: 0, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        width: '100%', maxWidth: 480,
        background: 'rgba(12,12,14,0.92)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        transition: 'all 0.3s ease',
      }}>
        {/* Brand row */}
        <div style={{
          padding: '10px 16px 8px',
          paddingTop: 'var(--sat)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {/* AniPlay brand logo — same as Home */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #818cf8))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px -2px var(--accent)',
            }}>
              <Play size={14} color="#fff" fill="#fff" />
            </div>
            <div>
              <div style={{
                fontSize: 18, fontWeight: 900, letterSpacing: '-0.04em',
                fontFamily: 'var(--font-brand)', color: 'var(--text-primary)', lineHeight: 1.1,
              }}>Schedule</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Airing Calendar</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="floating-btn"
              onClick={() => navigate('/notifications')}
              id="schedule-bell"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </button>
            <button
              className="floating-btn"
              onClick={() => navigate('/browse')}
              id="schedule-search"
              aria-label="Search"
            >
              <Search size={18} />
            </button>
          </div>
        </div>

        {/* 14-day scrollable tabs */}
        <div
          ref={dayTabsRef}
          className="day-tabs"
          style={{ paddingBottom: 10 }}
        >
          {DATE_TABS.map((tab, idx) => (
            <button
              key={tab.dayKey}
              className={`day-tab ${activeDay === idx ? 'active' : ''}`}
              onClick={() => {
                setActiveDay(idx);
                // Scroll page to top on day change
                window.scrollTo({ top: 0, behavior: 'smooth' });
                document.documentElement.scrollTop = 0;
              }}
              id={`day-tab-${tab.label.toLowerCase()}-${idx}`}
            >
              <span className="day-name">{tab.label}</span>
              <span className="day-num">{tab.date}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Timeline ── */}
      <div className="fade-in-up">
        {loading ? (
          <div style={{ padding: 16 }}>
            {[1, 2, 3, 4].map(i => <SkeletonItem key={i} />)}
          </div>
        ) : dayItems.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No schedule for {DATE_TABS[activeDay]?.label} {DATE_TABS[activeDay]?.date}</p>
            <p className="empty-sub">Try another day</p>
          </div>
        ) : (
          <div className="schedule-timeline">
            {timeKeys.map(timeKey => {
              const isCurrent = activeDay === 0 && timeKey === currentHourKey;
              return (
                <div key={timeKey} className="time-group">
                  <div className={`time-label ${isCurrent ? 'current-time' : ''}`}>
                    {timeKey}
                    {isCurrent && (
                      <span style={{ fontSize: 11, marginLeft: 4 }}>
                        — Current Time · {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    )}
                    <div className="time-line" />
                  </div>
                  {grouped[timeKey].map(item => (
                    <ScheduleItem
                      key={item.id}
                      item={item}
                      navigate={navigate}
                      isInWatchlist={isInWatchlist}
                      addToWatchlist={addToWatchlist}
                      removeFromWatchlist={removeFromWatchlist}
                      isPast={item.airingAt < now && activeDay === 0}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleItem({ item, navigate, isInWatchlist, addToWatchlist, removeFromWatchlist, isPast }) {
  const anime = item.media;
  const title = getTitle(anime);
  const cover = getCover(anime);
  const inList = isInWatchlist(anime.id);

  return (
    <div
      className="schedule-item"
      style={{ opacity: isPast ? 0.6 : 1 }}
      onClick={() => navigate(`/anime/${anime.id}`)}
      id={`schedule-item-${item.id}`}
    >
      <img src={cover} alt={title} className="schedule-thumb" />
      <div className="schedule-info">
        <div className="schedule-name">{title}</div>
        <div className="schedule-ep">Episode {item.episode}</div>
        <button
          className={`add-mylist-btn ${inList ? 'added' : ''}`}
          onClick={e => {
            e.stopPropagation();
            inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime);
          }}
          id={`schedule-mylist-${anime.id}`}
        >
          {inList ? <Check size={11} /> : <Plus size={11} />}
          {inList ? 'In List' : 'My List'}
        </button>
      </div>
    </div>
  );
}

function SkeletonItem() {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, padding: '10px', background: 'var(--bg-card)', borderRadius: 12, alignItems: 'center' }}>
      <div className="skeleton" style={{ width: 72, height: 54, borderRadius: 8, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 14, borderRadius: 4, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 11, width: '50%', borderRadius: 4 }} />
      </div>
    </div>
  );
}
