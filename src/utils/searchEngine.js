/**
 * AniLab Fused Search Engine (4-Layer Matching Algorithm)
 * ════════════════════════════════════════════════════════════════
 *
 * Implements a weighted 4-layer fuzzy matching algorithm:
 *   - Layer 1: Alias / Synonym Matching (35% weight)
 *   - Layer 2: Sørensen–Dice N-gram/Trigram overlap (25% weight)
 *   - Layer 3: Levenshtein Edit Distance Typo-tolerance (20% weight)
 *   - Layer 4: Term Frequency / TF-IDF for description/genres (20% weight)
 */

// Popular anime alias/acronym dictionary
const ALIASES = {
  'fma': ['fullmetal alchemist', 'fullmetal alchemist: brotherhood', 'hagane no renkinjutsushi'],
  'fmab': ['fullmetal alchemist: brotherhood', 'fullmetal alchemist'],
  'aot': ['attack on titan', 'shingeki no kyojin'],
  'jjk': ['jujutsu kaisen'],
  'mha': ['my hero academia', 'boku no hero academia'],
  'ds': ['demon slayer', 'kimetsu no yaiba'],
  'hxh': ['hunter x hunter'],
  'op': ['one piece'],
  'sao': ['sword art online'],
  'tg': ['tokyo ghoul'],
  'narto': ['naruto', 'naruto shippuden'],
  'titan': ['attack on titan', 'shingeki no kyojin'],
  'slime isekai': ['that time i got reincarnated as a slime', 'tensei shitara slime datta ken'],
  'haram': ['harem'],
};

// ── Layer 2 Helpers: Sørensen-Dice Trigrams ──────────────────────
function getTrigrams(str) {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.length < 3) {
    // Fallback to bigrams or single characters if too short
    const grams = [];
    for (let i = 0; i < s.length - 1; i++) grams.push(s.slice(i, i + 2));
    return grams.length ? grams : s.split('');
  }
  const trigrams = [];
  for (let i = 0; i < s.length - 2; i++) {
    trigrams.push(s.slice(i, i + 3));
  }
  return trigrams;
}

function diceCoefficient(str1, str2) {
  const t1 = getTrigrams(str1);
  const t2 = getTrigrams(str2);
  if (!t1.length || !t2.length) return 0;
  
  const s1 = new Set(t1);
  let intersection = 0;
  for (const tri of t2) {
    if (s1.has(tri)) intersection++;
  }
  return (2 * intersection) / (t1.length + t2.length);
}

// ── Layer 3 Helpers: Levenshtein Distance ─────────────────────────
function levenshtein(a, b) {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[a.length][b.length];
}

function levenshteinSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(s1, s2);
  return (maxLen - dist) / maxLen;
}

// Word-level typo matching
function wordLevenshteinSimilarity(query, target) {
  const qWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tWords = target.toLowerCase().split(/\s+/).filter(Boolean);
  if (!qWords.length || !tWords.length) return 0;

  let totalSim = 0;
  for (const qw of qWords) {
    let maxWordSim = 0;
    for (const tw of tWords) {
      const sim = levenshteinSimilarity(qw, tw);
      if (sim > maxWordSim) maxWordSim = sim;
    }
    totalSim += maxWordSim;
  }
  return totalSim / qWords.length;
}

// ── Score calculation per layer ───────────────────────────────────

function getAliasScore(query, anime) {
  const q = query.toLowerCase().trim();
  const titles = [
    anime.title?.english,
    anime.title?.romaji,
    anime.title?.native,
    ...(anime.synonyms || [])
  ].filter(Boolean).map(t => t.toLowerCase());

  // Check direct alias dictionary mappings
  const mapped = ALIASES[q];
  if (mapped) {
    for (const m of mapped) {
      for (const t of titles) {
        if (t.includes(m) || m.includes(t)) return 1.0;
      }
    }
  }

  // Check exact matches or abbreviation matches
  for (const t of titles) {
    if (t === q) return 1.0;
    
    // Check abbreviation (e.g. "aot" matching "attack on titan")
    const abbr = t.split(/\s+/).map(w => w[0]).join('').replace(/[^a-z0-9]/g, '');
    if (abbr === q && q.length >= 2) return 1.0;

    // Substring match with length ratio penalty
    if (t.includes(q)) {
      return q.length / t.length;
    }
  }

  return 0.0;
}

function getTrigramScore(query, anime) {
  const titles = [
    anime.title?.english,
    anime.title?.romaji
  ].filter(Boolean);
  
  let maxDice = 0;
  for (const t of titles) {
    const dice = diceCoefficient(query, t);
    if (dice > maxDice) maxDice = dice;
  }
  return maxDice;
}

function getLevenshteinScore(query, anime) {
  const titles = [
    anime.title?.english,
    anime.title?.romaji
  ].filter(Boolean);

  let maxLev = 0;
  for (const t of titles) {
    // 1. Full string similarity
    const fullSim = levenshteinSimilarity(query, t);
    // 2. Word-level similarity (handles typos on individual words)
    const wordSim = wordLevenshteinSimilarity(query, t);
    const score = Math.max(fullSim, wordSim);
    if (score > maxLev) maxLev = score;
  }
  return maxLev;
}

function getTfidfScore(query, anime) {
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (!qWords.length) return 0.0;

  const desc = (anime.description || '').toLowerCase().replace(/<[^>]+>/g, ' ');
  const genres = (anime.genres || []).map(g => g.toLowerCase());
  
  let score = 0;
  let matches = 0;

  for (const w of qWords) {
    let wordScore = 0;
    
    // Match in genres (high importance)
    if (genres.some(g => g.includes(w))) {
      wordScore += 2.0;
      matches++;
    }
    
    // Match in description
    if (desc.includes(w)) {
      // Simple term frequency count
      const occurrences = desc.split(w).length - 1;
      wordScore += Math.min(occurrences * 0.5, 1.5);
      matches++;
    }

    score += wordScore;
  }

  // Normalize by query words count
  return Math.min(score / (qWords.length * 1.5), 1.0);
}

// ── Unified ranking engine entry point ─────────────────────────────

export function getFusedScore(query, anime) {
  if (!query || !query.trim()) return 0.0;

  const s1 = getAliasScore(query, anime);       // Layer 1 (35%)
  const s2 = getTrigramScore(query, anime);     // Layer 2 (25%)
  const s3 = getLevenshteinScore(query, anime); // Layer 3 (20%)
  const s4 = getTfidfScore(query, anime);       // Layer 4 (20%)

  const totalScore = (s1 * 0.35) + (s2 * 0.25) + (s3 * 0.20) + (s4 * 0.20);
  
  return totalScore;
}

/**
 * Ranks and filters an array of anime objects based on the 4-layer matching score.
 */
export function searchAndRankAnime(query, animes) {
  if (!query || !query.trim()) return animes;

  const scored = animes.map(anime => {
    const score = getFusedScore(query, anime);
    return { anime, score };
  });

  // Filter out completely unrelated anime, keep only those with non-zero match scores
  const filtered = scored.filter(item => item.score > 0.05);

  // Sort by score descending (best matches first)
  filtered.sort((a, b) => b.score - a.score);

  return filtered.map(item => item.anime);
}
