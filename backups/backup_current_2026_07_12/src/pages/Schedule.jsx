import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { getSchedule, getTitle, getCover } from '../api/anilist';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';

import { Plus, Check } from 'lucide-react';

function getDayLabel(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { weekday: 'short' });
}
function getTimeLabel(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function Schedule() {
  const navigate = useNavigate();
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useApp();
  const [schedule,    setSchedule]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeDay,   setActiveDay]   = useState(() => {
    const d = new Date().getDay(); // 0=Sun
    return d === 0 ? 6 : d - 1;   // convert to Mon=0
  });

  useEffect(() => {
    getSchedule(1, 50)
      .then(setSchedule)
      .catch(() => setSchedule([]))
      .finally(() => setLoading(false));
  }, []);

  // Group by day
  const byDay = DAYS.map((_, idx) => {
    return schedule.filter(item => {
      const d = new Date(item.airingAt * 1000).getDay();
      const normalized = d === 0 ? 6 : d - 1;
      return normalized === idx;
    });
  });

  // Group active day items by hour
  const dayItems = byDay[activeDay] || [];
  const grouped = {};
  dayItems.forEach(item => {
    const hour = new Date(item.airingAt * 1000).getHours();
    const key = `${String(hour).padStart(2,'0')}:00`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });
  const timeKeys = Object.keys(grouped).sort();

  const now = Date.now() / 1000;
  const currentHourKey = `${String(new Date().getHours()).padStart(2,'0')}:00`;

  // Get day numbers for this week
  const todayDate = new Date();
  const dayNum = (offset) => {
    const d = new Date(todayDate);
    const todayDay = todayDate.getDay() === 0 ? 6 : todayDate.getDay() - 1;
    d.setDate(d.getDate() + (offset - todayDay));
    return d.getDate();
  };

  return (
    <div className="page">
      {/* Sticky Header Container */}
      <div className="sticky-header">
        {/* Header */}
        <div className="schedule-header" style={{ paddingBottom: 8 }}>
          <h1 className="schedule-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, background: 'var(--accent)', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 900, fontFamily: 'var(--font-brand)', color: '#fff'
            }}>A</div>
            Schedule
          </h1>
          <button className="floating-btn" onClick={() => navigate('/browse')} id="schedule-search" aria-label="Search">
            <Search size={18} />
          </button>
        </div>

        {/* Day Tabs */}
        <div className="day-tabs" style={{ paddingBottom: 10 }}>
          {DAYS.map((day, idx) => (
            <button
              key={day}
              className={`day-tab ${activeDay === idx ? 'active' : ''}`}
              onClick={() => setActiveDay(idx)}
              id={`day-tab-${day.toLowerCase()}`}
            >
              <span className="day-name">{day}</span>
              <span className="day-num">{dayNum(idx)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Wrapper with Entrance Animation */}
      <div className="fade-in-up">
        {/* Timeline */}
        {loading ? (
          <div style={{ padding: 16 }}>
            {[1,2,3,4].map(i => <SkeletonItem key={i} />)}
          </div>
        ) : dayItems.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No schedule for this day</p>
            <p className="empty-sub">Try another day</p>
          </div>
        ) : (
          <div className="schedule-timeline">
            {timeKeys.map(timeKey => {
              const isCurrent = timeKey === currentHourKey;
              return (
                <div key={timeKey} className="time-group">
                  <div className={`time-label ${isCurrent ? 'current-time' : ''}`}>
                    {timeKey}
                    {isCurrent && <span style={{ fontSize: 11, marginLeft: 4 }}>— Current Time · {new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false})}</span>}
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
                      isPast={item.airingAt < now}
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
