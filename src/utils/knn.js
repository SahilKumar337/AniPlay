/**
 * K-Nearest Neighbors (KNN) Content-Based Classifier & Recommendation Engine
 * ═══════════════════════════════════════════════════════════════════════════
 * Represent each anime as a feature vector in a multi-dimensional space:
 * - 14 dimensions for main genres (binary 1/0)
 * - 1 dimension for normalized rating (0.0 to 1.0)
 * - 1 dimension for status (binary: releasing = 1, finished = 0)
 * 
 * Calculate similarity using Euclidean Distance / Cosine Similarity.
 * Use KNN to find the K nearest neighbors to the user's watch profile.
 */

const GENRES = [
  'Action','Adventure','Comedy','Drama','Fantasy',
  'Horror','Mecha','Mystery','Romance','Sci-Fi',
  'Slice of Life','Sports','Thriller','Supernatural'
];

/**
 * Convert an anime object to a normalized feature vector.
 */
export function getFeatureVector(anime) {
  const vec = new Array(GENRES.length + 2).fill(0);
  
  // 1. Genre dimensions
  const genres = anime.genres || [];
  for (let i = 0; i < GENRES.length; i++) {
    if (genres.includes(GENRES[i])) {
      vec[i] = 1.0;
    }
  }

  // 2. Score dimension (normalized [0, 1])
  const score = anime.averageScore || 70;
  vec[GENRES.length] = score / 100.0;

  // 3. Airing Status dimension
  vec[GENRES.length + 1] = anime.status === 'RELEASING' ? 1.0 : 0.0;

  return vec;
}

/**
 * Compute the user's preference profile vector (centroid of recently viewed).
 */
export function getUserProfileVector(recentlyViewed) {
  if (!recentlyViewed || recentlyViewed.length === 0) {
    // Return a default neutral vector
    return new Array(GENRES.length + 2).fill(0.5);
  }

  const profile = new Array(GENRES.length + 2).fill(0);
  let totalWeight = 0;

  recentlyViewed.forEach((item, index) => {
    if (!item || !item.anime) return;
    // Recency weighting: more recent items have higher weight
    const weight = 1.0 / (index + 1);
    const vec = getFeatureVector(item.anime);
    for (let i = 0; i < vec.length; i++) {
      profile[i] += vec[i] * weight;
    }
    totalWeight += weight;
  });

  // If no valid items were found, return neutral profile
  if (totalWeight === 0) {
    return new Array(GENRES.length + 2).fill(0.5);
  }

  // Normalize
  for (let i = 0; i < profile.length; i++) {
    profile[i] /= totalWeight;
  }

  return profile;
}

/**
 * Calculate Euclidean Distance between two vectors.
 */
export function getDistance(v1, v2) {
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    sum += Math.pow(v1[i] - v2[i], 2);
  }
  return Math.sqrt(sum);
}

/**
 * Use KNN to rank and sort anime list based on similarity to recently viewed profile.
 * High similarity items are sorted to the front.
 */
export function rankAnimeByKnn(animes, recentlyViewed) {
  if (!recentlyViewed || recentlyViewed.length === 0 || !animes || animes.length === 0) {
    return animes;
  }

  const profileVec = getUserProfileVector(recentlyViewed);
  
  // Calculate distance for each anime
  const scored = animes.map(anime => {
    const vec = getFeatureVector(anime);
    const distance = getDistance(profileVec, vec);
    return { anime, distance };
  });

  // Sort by distance ascending (closest first)
  scored.sort((a, b) => a.distance - b.distance);

  return scored.map(s => s.anime);
}
