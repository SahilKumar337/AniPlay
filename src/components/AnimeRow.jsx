import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AnimeCard from './AnimeCard';

export default function AnimeRow({
  title,
  animes = [],
  cardWidth = 120,
  cardHeight = 165,
  showRank = false,
  onSeeAll,
}) {
  const scrollRef = useRef(null);
  const [showLeftBtn, setShowLeftBtn] = useState(false);
  const [showRightBtn, setShowRightBtn] = useState(true);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftBtn(scrollLeft > 10);
    setShowRightBtn(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', handleScroll);
      // Run once initially
      handleScroll();
      
      // Also listen to window resize to update right button visibility
      window.addEventListener('resize', handleScroll);
    }
    return () => {
      if (el) el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [animes]);

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    const { clientWidth } = scrollRef.current;
    const scrollAmount = clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
  };

  if (!animes.length) return null;

  return (
    <section className="home-section" style={{ position: 'relative' }}>
      <div className="section-header">
        <h2 className="section-title">{title}</h2>
        {onSeeAll && (
          <button className="see-all" onClick={onSeeAll}>See all</button>
        )}
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        {/* Left Arrow Button */}
        {showLeftBtn && (
          <button
            onClick={() => scroll('left')}
            aria-label="Scroll left"
            style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10,
              width: 32, height: 32, borderRadius: '50%', background: 'rgba(15,15,15,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)', transition: 'all 0.2s',
            }}
          >
            <ChevronLeft size={16} />
          </button>
        )}

        {/* Right Arrow Button */}
        {showRightBtn && (
          <button
            onClick={() => scroll('right')}
            aria-label="Scroll right"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10,
              width: 32, height: 32, borderRadius: '50%', background: 'rgba(15,15,15,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer', color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)', transition: 'all 0.2s',
            }}
          >
            <ChevronRight size={16} />
          </button>
        )}

        <div className="h-scroll" ref={scrollRef}>
          {animes.map((anime, i) => (
            <AnimeCard
              key={anime.id}
              anime={anime}
              width={cardWidth}
              height={cardHeight}
              rank={showRank ? i + 1 : null}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
