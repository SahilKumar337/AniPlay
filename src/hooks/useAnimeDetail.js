import { useState, useEffect } from 'react';
import { getAnimeDetail } from '../api/anilist';

export function useAnimeDetail(id) {
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function fetchDetail() {
      try {
        setLoading(true);
        setError(null);
        const data = await getAnimeDetail(id);
        if (!cancelled) {
          setAnime(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load anime details.');
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
