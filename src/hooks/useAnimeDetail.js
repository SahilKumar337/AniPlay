import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getAnimeDetail } from '../api/anilist';
import { getDetailCache, saveDetailCache } from '../utils/cache';

export function useAnimeDetail(id) {
  const location = useLocation();

  // Optimistic initial state: check router state, then local storage cache
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

    async function fetchDetail() {
      try {
        // If we don't have initial anime, show loading skeleton
        if (!initialAnime) {
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
          if (!anime && !initialAnime) {
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
