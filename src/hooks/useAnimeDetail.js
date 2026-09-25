import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getAnimeDetail } from '../api/anilist';
import { getDetailCache, saveDetailCache } from '../utils/cache';

// Helper to determine if an anime object has full details vs being a minimal stub
function isFullAnime(item) {
  return Boolean(
    item &&
    (item.status || item.description || typeof item.episodes === 'number' || (Array.isArray(item.genres) && item.genres.length > 0))
  );
}

export function useAnimeDetail(id) {
  const location = useLocation();
  const prevIdRef = useRef(null);

  // Optimistic initial state: check router state, then local storage cache
  // Prefer cached data if it has full details (e.g. status, episodes)
  const cached = id ? getDetailCache(id) : null;
  const stateAnime = (location?.state?.anime && String(location.state.anime.id) === String(id))
    ? location.state.anime
    : null;

  const initialAnime = (() => {
    if (isFullAnime(cached)) {
      return stateAnime ? { ...cached, ...stateAnime } : cached;
    }
    if (isFullAnime(stateAnime)) {
      return cached ? { ...cached, ...stateAnime } : stateAnime;
    }
    return stateAnime || cached || null;
  })();

  const [anime, setAnime] = useState(initialAnime);
  const [loading, setLoading] = useState(!isFullAnime(initialAnime));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    // If the ID changed (navigating to a different anime), immediately clear
    // the stale data so we show the skeleton instead of the wrong anime
    if (prevIdRef.current && prevIdRef.current !== String(id)) {
      const freshCache = getDetailCache(id);
      if (isFullAnime(freshCache)) {
        // We have cache for the new anime — show it instantly (no flash of old data)
        setAnime(freshCache);
        setLoading(false);
      } else {
        // No full cache — show partial or skeleton and show loading
        setAnime(freshCache || null);
        setLoading(true);
      }
      setError(null);
    }
    prevIdRef.current = String(id);

    async function fetchDetail() {
      try {
        // If we don't have full data for this id yet, show loading
        const currentCache = getDetailCache(id);
        if (!isFullAnime(currentCache)) {
          setLoading(true);
        }
        setError(null);
        const data = await getAnimeDetail(id);
        if (!cancelled && data) {
          setAnime(data);
          saveDetailCache(id, data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          // Only show error if we have no metadata whatsoever
          const currentCache = getDetailCache(id);
          if (!currentCache && !stateAnime) {
            setError(err.message || 'Failed to load anime details.');
          } else {
            console.warn('[useAnimeDetail] Network revalidate failed, using cached metadata:', err.message);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDetail();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return { anime, loading, error, setAnime };
}

