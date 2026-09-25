import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getAnimeDetail } from '../api/anilist';
import { getDetailCache, saveDetailCache } from '../utils/cache';

export function useAnimeDetail(id) {
  const location = useLocation();
  const prevIdRef = useRef(null);

  // Optimistic initial state: check router state, then local storage cache
  // ONLY use cache if it matches the CURRENT id (prevents stale data flash)
  const initialAnime = (() => {
    if (location?.state?.anime && String(location.state.anime.id) === String(id)) {
      return location.state.anime;
    }
    return getDetailCache(id);
  })();

  const [anime, setAnime] = useState(initialAnime);
  const [loading, setLoading] = useState(!initialAnime);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    // If the ID changed (navigating to a different anime), immediately clear
    // the stale data so we show the skeleton instead of the wrong anime
    if (prevIdRef.current && prevIdRef.current !== String(id)) {
      const freshCache = getDetailCache(id);
      if (freshCache) {
        // We have cache for the new anime — show it instantly (no flash of old data)
        setAnime(freshCache);
        setLoading(false);
      } else {
        // No cache — clear old anime and show loading skeleton
        setAnime(null);
        setLoading(true);
      }
      setError(null);
    }
    prevIdRef.current = String(id);

    async function fetchDetail() {
      try {
        // If we don't have data for this id yet, show loading skeleton
        const currentCache = getDetailCache(id);
        if (!currentCache) {
          setLoading(true);
        }
        setError(null);
        const data = await getAnimeDetail(id);
        if (!cancelled && data) {
          setAnime(data);
          saveDetailCache(id, data);
        }
      } catch (err) {
        if (!cancelled) {
          // Only show error if we have no metadata whatsoever
          const currentCache = getDetailCache(id);
          if (!currentCache) {
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
