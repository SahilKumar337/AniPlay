/**
 * K-Nearest Neighbors (KNN) Content-Based Classifier & Recommendation Engine
 * Represents each anime as a feature vector in a multi-dimensional space and
 * calculates similarity using Euclidean Distance against user watch profile.
 */

const GENRES = [
  'Action','Adventure','Comedy','Drama','Fantasy',
  'Horror','Mecha','Mystery','Romance','Sci-Fi',
  'Slice of Life','Sports','Thriller','Supernatural'
];

export function getFeatureVector(anime) {
  const vec = new Array(GENRES.length + 2).fill(0);
  
  const genres = anime.genres || [];
  for (let i = 0; i < GENRES.length; i++) {
    if (genres.includes(GENRES[i])) {
      vec[i] = 1.0;
    }
  }

  const score = anime.averageScore || 70;
  vec[GENRES.length] = score / 100.0;

  vec[GENRES.length + 1] = anime.status === 'RELEASING' ? 1.0 : 0.0;

  return vec;
}

export function getUserProfileVector(recentlyViewed) {
  if (!recentlyViewed || recentlyViewed.length === 0) {
    return new Array(GENRES.length + 2).fill(0.5);
  }

  const profile = new Array(GENRES.length + 2).fill(0);
  let totalWeight = 0;

  recentlyViewed.forEach((item, index) => {
    const weight = 1.0 / (index + 1);
    const vec = getFeatureVector(item.anime);
    for (let i = 0; i < vec.length; i++) {
      profile[i] += vec[i] * weight;
    }
    totalWeight += weight;
  });

  for (let i = 0; i < profile.length; i++) {
    profile[i] /= totalWeight;
  }

  return profile;
}

export function getDistance(v1, v2) {
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    sum += Math.pow(v1[i] - v2[i], 2);
  }
  return Math.sqrt(sum);
}

export function rankAnimeByKnn(animes, recentlyViewed) {
  if (!recentlyViewed || recentlyViewed.length === 0 || !animes || animes.length === 0) {
    return animes;
  }

  const profileVec = getUserProfileVector(recentlyViewed);
  
  const scored = animes.map(anime => {
    const vec = getFeatureVector(anime);
    const distance = getDistance(profileVec, vec);
    return { anime, distance };
  });

  scored.sort((a, b) => a.distance - b.distance);

  return scored.map(s => s.anime);
}
