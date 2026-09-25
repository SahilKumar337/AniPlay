import { useState, useMemo, memo } from 'react';
import { Play, Search } from 'lucide-react';
import { motion } from 'motion/react';

const EPS_PER_PAGE = 50;

function EpisodeGrid({
  episodes = [],
  currentEp = 1,
  onSelectEp,
  onPrefetchEp,
  watchedEps = new Set(),
  downloadedEps = new Set(),
  columns = 5,
}) {
  const [query, setQuery] = useState('');
  const [activePage, setActivePage] = useState(1);

  // Normalize episode list
  const allList = useMemo(() => {
    return episodes.map((ep) => {
      const rawNum = ep.number ?? ep.epNum ?? ep.id ?? ep;
      const num = typeof rawNum === 'object' && rawNum !== null ? (rawNum.episode || 1) : Number(rawNum) || 1;
      return num;
    });
  }, [episodes]);

  // Filter by query if user types in search
  const filtered = useMemo(() => {
    if (!query.trim()) return allList;
    return allList.filter((n) => String(n).includes(query.trim()));
  }, [allList, query]);

  // Pagination chunks (e.g. 1-50, 51-100)
  const totalPages = Math.ceil(filtered.length / EPS_PER_PAGE);
  const pagedList = useMemo(() => {
    const start = (activePage - 1) * EPS_PER_PAGE;
    return filtered.slice(start, start + EPS_PER_PAGE);
  }, [filtered, activePage]);

  if (!episodes.length) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
        No episodes found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Search & Range Selector ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search input if more than 20 episodes */}
        {allList.length > 20 && (
          <div
            style={{
              position: 'relative',
              flex: '1 1 120px',
              minWidth: 120,
              maxWidth: 200,
            }}
          >
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
              }}
            />
            <input
              type="text"
              placeholder="Ep #"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActivePage(1);
              }}
              style={{
                width: '100%',
                padding: '8px 10px 8px 30px',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border)',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Range pagination pills if multiple pages */}
        {totalPages > 1 && !query && (
          <div
            className="no-scrollbar"
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              flex: 1,
              padding: '2px 0',
            }}
          >
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => {
              const startEp = (pg - 1) * EPS_PER_PAGE + 1;
              const endEp = Math.min(pg * EPS_PER_PAGE, allList.length);
              const isActive = pg === activePage;

              return (
                <button
                  key={pg}
                  onClick={() => setActivePage(pg)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    border: '1px solid',
                    borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                    background: isActive ? 'var(--accent)' : 'rgba(255, 255, 255, 0.04)',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {startEp}-{endEp}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Natural Page-Flow Episode Grid (Zero Scroll Interception) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 8,
        }}
      >
        {pagedList.map((num) => {
          const isCurrent = Number(num) === Number(currentEp);
          const isWatched = watchedEps.has(num) || watchedEps.has(String(num));
          const isDownloaded = downloadedEps.has(num) || downloadedEps.has(String(num));

          return (
            <motion.button
              key={num}
              onClick={() => onSelectEp(num)}
              onMouseEnter={() => onPrefetchEp?.(num)}
              onTouchStart={() => onPrefetchEp?.(num)}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              style={{
                height: 42,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: isCurrent ? 800 : 600,
                position: 'relative',
                background: isCurrent
                  ? 'var(--accent)'
                  : isWatched
                  ? 'rgba(255, 255, 255, 0.06)'
                  : 'rgba(255, 255, 255, 0.03)',
                color: isCurrent
                  ? '#fff'
                  : isWatched
                  ? 'var(--text-secondary)'
                  : 'var(--text-primary)',
                border: isCurrent
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border)',
                boxShadow: isCurrent
                  ? '0 2px 12px color-mix(in srgb, var(--accent) 40%, transparent)'
                  : 'none',
                cursor: 'pointer',
              }}
            >
              {isCurrent && <Play size={10} fill="#fff" strokeWidth={0} style={{ marginRight: 3 }} />}
              {num}
              {isWatched && !isCurrent && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    background: 'var(--accent)',
                  }}
                />
              )}
              {isDownloaded && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 2,
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    background: '#22c55e',
                  }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(EpisodeGrid);
