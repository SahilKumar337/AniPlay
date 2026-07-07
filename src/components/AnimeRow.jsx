import AnimeCard from './AnimeCard';

export default function AnimeRow({
  title,
  subtitle,
  animes = [],
  cardWidth = 120,
  cardHeight = 165,
  showRank = false,
  showEpBadge = false,
  onSeeAll,
}) {
  if (!animes.length) return null;

  return (
    <section className="home-section" style={{ position: 'relative' }}>
      <div className="section-header">
        <div>
          <h2 className="section-title">{title}</h2>
          {subtitle && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 1 }}>{subtitle}</span>
          )}
        </div>
        {onSeeAll && (
          <button className="see-all" onClick={onSeeAll}>See all</button>
        )}
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        <div className="h-scroll">
          {animes.map((anime, i) => (
            <AnimeCard
              key={anime.id}
              anime={anime}
              width={cardWidth}
              height={cardHeight}
              rank={showRank ? i + 1 : null}
              epLabel={showEpBadge && anime._latestEp ? `EP ${anime._latestEp}` : null}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
