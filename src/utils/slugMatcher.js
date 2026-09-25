/**
 * Industry-Level Anime Slug Matching & Normalization Engine
 * 
 * Provides:
 * - Mathematical similarity scoring (Token Jaccard + Bigram Dice)
 * - Strict metadata gating (Season, Part/Cour, Movie vs Series, Special/Recap/OVA)
 * - Bilingual matching (English + Japanese Romaji from data-jp)
 * - Canonical slug generation & smart query expansion
 * - Persistent self-learning verified slug registry (localStorage with 30-day TTL)
 * - MAL-Sync cloud cross-reference fallback
 */

import aninekoCatalog from '../data/aninekoCatalog.js';

export const VERIFIED_SLUGS_KEY = 'aniplay_verified_slugs_v2';
export const VERIFIED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Purge legacy poisoned verified slugs and corrupted anime caches from user device storage
if (typeof localStorage !== 'undefined') {
  try {
    if (localStorage.getItem('aniplay_verified_slugs_v1')) {
      localStorage.removeItem('aniplay_verified_slugs_v1');
    }
    // Purge poisoned Spy x Family Cour 2 (142838) and mismapped cache keys
    const poisonedKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.includes('142838') || k.includes('oshi_no_ko_142838'))) {
        poisonedKeys.push(k);
      }
    }
    poisonedKeys.forEach(k => localStorage.removeItem(k));

    // Also check aniplay_verified_slugs_v2
    const v2Raw = localStorage.getItem('aniplay_verified_slugs_v2');
    if (v2Raw) {
      const v2Store = JSON.parse(v2Raw);
      if (v2Store['142838']) {
        delete v2Store['142838'];
        localStorage.setItem('aniplay_verified_slugs_v2', JSON.stringify(v2Store));
      }
    }
  } catch {}
}

// Fast in-memory catalog hash maps
const CATALOG_SLUG_MAP = new Map();
const CATALOG_NORM_TITLE_MAP = new Map();
const CATALOG_INVERTED_TOKENS = new Map();

for (const item of (aninekoCatalog || [])) {
  CATALOG_SLUG_MAP.set(item.slug, item);

  const tNorm = norm(item.title);
  if (tNorm) {
    if (!CATALOG_NORM_TITLE_MAP.has(tNorm)) CATALOG_NORM_TITLE_MAP.set(tNorm, []);
    CATALOG_NORM_TITLE_MAP.get(tNorm).push(item);
  }

  const jNorm = norm(item.jp);
  if (jNorm && jNorm !== tNorm) {
    if (!CATALOG_NORM_TITLE_MAP.has(jNorm)) CATALOG_NORM_TITLE_MAP.set(jNorm, []);
    CATALOG_NORM_TITLE_MAP.get(jNorm).push(item);
  }

  const words = new Set([...tNorm.split(' '), ...jNorm.split(' ')].filter(w => w.length > 2));
  for (const w of words) {
    if (!CATALOG_INVERTED_TOKENS.has(w)) CATALOG_INVERTED_TOKENS.set(w, []);
    CATALOG_INVERTED_TOKENS.get(w).push(item);
  }
}

// ─── 1. String Normalization & HTML Unescaping ───

export function norm(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/&#0*39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[\u2018\u2019\u0060\u00B4\u02BC\u02B9'`']/g, '') // Strip all apostrophe/quote variants
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanAnimeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/&#0*39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&amp;/g, '&')
    .replace(/[\u2018\u2019\u0060\u00B4\u02BC\u02B9'`']/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── 2. Metadata Feature Extraction ───

export function extractSeasonNumber(text) {
  if (!text) return 1;
  const s = text.toLowerCase();
  let m;
  if ((m = s.match(/\bseason\s*(\d+)\b/))) return parseInt(m[1], 10);
  if ((m = s.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/))) return parseInt(m[1], 10);
  if ((m = s.match(/\bs(\d+)\b/))) return parseInt(m[1], 10);
  if (/\b(4th season|season 4|final season|the final season|\biv\b)\b/.test(s)) return 4;
  if (/\b(3rd season|season 3|\biii\b)\b/.test(s)) return 3;
  if (/\b(2nd season|season 2|\bii\b)\b/.test(s)) return 2;

  // Clean auxiliary tags (dub, sub, tv, etc.)
  const clean = s.replace(/\b(dub|sub|uncensored|uncut|tv|movie|ova|ona|special|recap|film|series|audio|multi)\b/g, '').trim();

  // If the number is an identifier (e.g. "No. 8", "Number 8", "#8", "8-gou"), it is NOT a season!
  if (/(?:^|[\s_.-])(?:no|number|num|#)\s*\.?\s*\d+(?:nd|rd|th|st)?$/i.test(clean)) return 1;
  if (/(?:^|[\s_.-])\d+\s*[-_]?\s*gou\b/i.test(clean)) return 1;

  // Check trailing digit after clean title (e.g. "Oshi no Ko 2", "Solo Leveling 2")
  if ((m = clean.match(/\b(\d+)(?:nd|rd|th|st)?$/))) {
    const num = parseInt(m[1], 10);
    if (num >= 2 && num <= 10) return num;
  }
  return 1;
}


export function extractPartNumber(text) {
  if (!text) return 0;
  const s = text.toLowerCase();
  let m;
  if ((m = s.match(/\bpart\s*(\d+)\b/))) return parseInt(m[1], 10);
  if ((m = s.match(/\bcour\s*(\d+)\b/))) return parseInt(m[1], 10);
  return 0; // 0 = standard unpartitioned
}

export function isMovieIndicator(text) {
  if (!text) return false;
  return /\b(movie|film|gekijouban)\b/i.test(text);
}

export function isSpecialIndicator(text) {
  if (!text) return false;
  return /\b(special|specials|ova|ona|recap|mini|chibi|summary|preview|side\s*story|break\s*time)\b/i.test(text);
}

// ─── 3. Similarity Metrics ───

export function diceSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const getBigrams = (str) => {
    const s = str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const bg = [];
    for (let i = 0; i < s.length - 1; i++) {
      bg.push(s.slice(i, i + 2));
    }
    return bg;
  };

  const bgA = getBigrams(a);
  const bgB = getBigrams(b);
  if (!bgA.length || !bgB.length) return 0;

  const setB = new Map();
  for (const g of bgB) {
    setB.set(g, (setB.get(g) || 0) + 1);
  }

  let matches = 0;
  for (const g of bgA) {
    const count = setB.get(g) || 0;
    if (count > 0) {
      matches++;
      setB.set(g, count - 1);
    }
  }

  return (2 * matches) / (bgA.length + bgB.length);
}

export function tokenSimilarity(a, b) {
  const tokensA = new Set(norm(a).split(' ').filter(w => w.length > 1));
  const tokensB = new Set(norm(b).split(' ').filter(w => w.length > 1));
  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── 4. Industry Match Scorer with Strict Gating ───

const MATCH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'is', 'it', 'as', 'that', 'this', 'no', 'wa', 'ga', 'wo', 'ni', 'de', 'mo', 'ya', 'ka',
  'season', 'part', 's', 'ep', 'episode', 'series', 'tv', 'movie', 'film', 'dub', 'sub',
  'uncensored', 'uncut', 'special', 'specials', 'ova', 'ona', 'hd'
]);

export function getSignificantTokens(str) {
  if (!str) return [];
  const s = norm(str).replace(/[^a-z0-9\s]/g, ' ');
  const words = s.split(/\s+/).filter(Boolean);

  // Check if title has "no <digit>", "number <digit>", or "# <digit>"
  const hasNoDigit = /(?:no|number|num)\s+(\d+)/.test(s);
  const titleNumber = hasNoDigit ? s.match(/(?:no|number|num)\s+(\d+)/)[1] : null;

  return words.filter(w => {
    // Keep critical differentiator words: '0' (Steins;Gate 0), 're' (Tokyo Ghoul:re), 'r2' (Code Geass R2), 'zero' (Fate/Zero)
    if (w === '0' || w === 're' || w === 'r2' || w === 'zero') return true;
    if (w.length <= 1 && w !== titleNumber) return false;
    if (MATCH_STOP_WORDS.has(w)) return false;
    if (/^\d+$/.test(w)) {
      // Keep title numbers like '8' in 'kaiju no 8' or numbers >= 10 (e.g. 100, 86)
      if (w === titleNumber || parseInt(w, 10) > 10) return true;
      return false;
    }
    return true;
  });
}

function areTokensEquivalent(qt, ct, allCandidateTokens = []) {
  if (qt === ct) return true;
  if (qt.length > 4 && ct.length > 4 && (ct.startsWith(qt.slice(0, 5)) || qt.startsWith(ct.slice(0, 5)))) {
    return true;
  }
  // Number equivalence checks (digits vs written numbers)
  if (qt === '86' && allCandidateTokens.includes('eighty') && allCandidateTokens.includes('six')) return true;
  if ((qt === 'eighty' || qt === 'six') && allCandidateTokens.includes('86')) return true;
  if ((qt === '100' && ct === 'hundred') || (qt === 'hundred' && ct === '100')) return true;
  if ((qt === '0' && ct === 'zero') || (qt === 'zero' && ct === '0')) return true;
  if ((qt === '1' && (ct === 'one' || ct === 'i' || ct === '1st')) || (qt === 'one' && (ct === '1' || ct === '1st'))) return true;
  if ((qt === '2' && (ct === 'two' || ct === 'ii' || ct === '2nd')) || (qt === 'two' && (ct === '2' || ct === '2nd'))) return true;
  if ((qt === '3' && (ct === 'three' || ct === 'iii' || ct === '3rd')) || (qt === 'three' && (ct === '3' || ct === '3rd'))) return true;
  if ((qt === '4' && (ct === 'four' || ct === 'iv' || ct === '4th')) || (qt === 'four' && (ct === '4' || ct === '4th'))) return true;
  if ((qt === '5' && (ct === 'five' || ct === 'v' || ct === '5th')) || (qt === 'five' && (ct === '5' || ct === '5th'))) return true;
  if ((qt === '6' && (ct === 'six' || ct === 'vi' || ct === '6th')) || (qt === 'six' && (ct === '6' || ct === '6th'))) return true;
  if ((qt === '7' && (ct === 'seven' || ct === 'vii' || ct === '7th')) || (qt === 'seven' && (ct === '7' || ct === '7th'))) return true;
  if ((qt === '8' && (ct === 'eight' || ct === 'viii' || ct === '8th')) || (qt === 'eight' && (ct === '8' || ct === '8th'))) return true;
  if ((qt === '9' && (ct === 'nine' || ct === 'ix' || ct === '9th')) || (qt === 'nine' && (ct === '9' || ct === '9th'))) return true;
  if ((qt === '10' && (ct === 'ten' || ct === 'x' || ct === '10th')) || (qt === 'ten' && (ct === '10' || ct === '10th'))) return true;

  return false;
}

function normalizeTitleForSim(str) {
  let s = norm(str);
  s = s.replace(/\b86\b/g, 'eighty six');
  s = s.replace(/\bpart\s*(\d+)\b/g, 'season $1');
  s = s.replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, 'season $1');
  s = s.replace(/\b(?:season\s*)?iv\b/g, 'season 4');
  s = s.replace(/\b(?:season\s*)?iii\b/g, 'season 3');
  s = s.replace(/\b(?:season\s*)?ii\b/g, 'season 2');
  return s.replace(/\s+/g, ' ').trim();
}

export function calculateMatchScore(candidate, queryTitle, isMovie = false) {
  if (!candidate || !queryTitle) return 0;

  const candTitle = candidate.title || '';
  const candJp = candidate.jp || '';
  const candSlug = candidate.slug || '';
  const fullCandText = `${candTitle} ${candJp} ${candSlug}`;

  // Direct exact match bypass
  if (norm(candTitle) === norm(queryTitle)) return 1.0;

  // 1. Strict Season & Part Guard
  const candSeason = extractSeasonNumber(fullCandText);
  const querySeason = extractSeasonNumber(queryTitle);
  const candPart = extractPartNumber(fullCandText);
  const queryPart = extractPartNumber(queryTitle);

  // If both have explicit part numbers (e.g. Part 1 vs Part 2), they MUST match!
  if (candPart > 0 && queryPart > 0 && candPart !== queryPart) {
    return 0;
  }

  // Cross-compatibility between "Part X" and "Season X" / "Xnd Season"
  // Streaming sites frequently title cours as "2nd Season" while AniList titles them "Part 2"
  if (queryPart > 0 && candPart === 0) {
    const isSeasonPartCompatible = (candSeason === queryPart) || (querySeason === candSeason && querySeason > 1);
    if (!isSeasonPartCompatible) return 0;
  } else if (candPart > 0 && queryPart === 0) {
    const isSeasonPartCompatible = (querySeason === candPart) || (querySeason === candSeason && candSeason > 1);
    if (!isSeasonPartCompatible) return 0;
  } else {
    if (candSeason !== querySeason) return 0;
  }

  // 3. Strict Movie vs TV Series Guard
  const candIsMovie = isMovieIndicator(fullCandText);
  const queryIsMovie = Boolean(isMovie || isMovieIndicator(queryTitle));
  if (candIsMovie !== queryIsMovie) return 0;

  // 4. Strict Special / OVA / Recap / Mini-Anime Guard
  const candIsSpecial = isSpecialIndicator(fullCandText);
  const queryIsSpecial = isSpecialIndicator(queryTitle);
  if (candIsSpecial !== queryIsSpecial) return 0;

  const qTokens = getSignificantTokens(queryTitle);
  const cTokens = getSignificantTokens(fullCandText);

  // 5. Strict Subtitle / Sequel Distinction Guard
  // If query has a subtitle or arc name (e.g. "Sword Art Online: Alicization", "Fullmetal Alchemist: Brotherhood"),
  // the candidate MUST contain the distinctive subtitle tokens!
  const querySubtitleParts = queryTitle.split(/[:–—~|]/).slice(1);
  if (querySubtitleParts.length > 0) {
    const subtitleText = querySubtitleParts.join(' ');
    const subTokens = getSignificantTokens(subtitleText);
    if (subTokens.length > 0) {
      const hasSubToken = subTokens.some(st =>
        cTokens.some(ct => areTokensEquivalent(st, ct, cTokens))
      );
      if (!hasSubToken) return 0;
    }
  }

  // 6. Significant Content Keyword Coverage Guard (Strict Anti-Random-Anime Shield)
  // Ensures candidate contains at least 75% of query's content tokens (100% for short 1-2 token titles)
  if (qTokens.length > 0) {
    let matchedTokens = 0;
    for (const qt of qTokens) {
      if (cTokens.some(ct => areTokensEquivalent(qt, ct, cTokens))) {
        matchedTokens++;
      }
    }
    const coverageRatio = matchedTokens / qTokens.length;
    const minRequired = qTokens.length <= 2 ? 1.0 : 0.75;
    if (coverageRatio < minRequired) return 0;
  }

  // 7. Subtitle / Spinoff Guard (Reverse)
  // If query does NOT have a subtitle (no colon or dash), but candidate has extra subtitle words,
  // penalize score unless the colon is merely separating a season/part label (e.g. "Eighty Six: 2nd Season")
  const queryHasColon = /[:–—~|]/.test(queryTitle);
  const candHasColon = /[:–—~|]/.test(candTitle);
  const candColonIsSeason = /[:–—~|]\s*(?:season|\d+(?:st|nd|rd|th)?\s+season|part|cour)\b/i.test(candTitle);
  const spinoffPenalty = (!queryHasColon && candHasColon && !candColonIsSeason) ? 0.20 : 0;

  // 8. Mathematical Scoring (Normalized for numbers, season/part variants)
  const normCand = normalizeTitleForSim(candTitle);
  const normQuery = normalizeTitleForSim(queryTitle);
  const normJp = candJp ? normalizeTitleForSim(candJp) : '';

  const scoreEng = Math.max(
    diceSimilarity(normCand, normQuery),
    tokenSimilarity(normCand, normQuery)
  );

  const scoreJp = normJp ? Math.max(
    diceSimilarity(normJp, normQuery),
    tokenSimilarity(normJp, normQuery)
  ) : 0;

  const querySlug = norm(queryTitle).replace(/\s+/g, '-');
  const scoreSlug = diceSimilarity(candSlug, querySlug);

  const rawScore = Math.max(scoreEng, scoreJp, scoreSlug);
  return Math.max(0, rawScore - spinoffPenalty);
}


// ─── 5. Canonical Slug Generator & Smart Query Expander ───

export function generateCanonicalSlugs(title, isMovie = false) {
  if (!title) return [];
  const slugs = new Set();

  const toSlug = (str) => {
    return str
      .toLowerCase()
      .replace(/[\u2018\u2019\u0060\u00B4\u02BC\u02B9'`']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const toOrdinal = (num) => {
    const n = parseInt(num, 10);
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return `${n}th`;
  };

  const rawSlug = toSlug(title);
  if (rawSlug) slugs.add(rawSlug);

  // Clean duplicate consecutive words: e.g. "86-eighty-six" or "eighty-six-eighty-six"
  const dedupedSlug = rawSlug
    .replace(/\b86-eighty-six\b/g, 'eighty-six')
    .replace(/\beighty-six-eighty-six\b/g, 'eighty-six');
  if (dedupedSlug) slugs.add(dedupedSlug);

  // Expand "Part X" -> "Season X" and "Xnd Season"
  const partMatch = title.match(/\bpart\s*(\d+)\b/i);
  if (partMatch) {
    const pNum = partMatch[1];
    const ord = toOrdinal(pNum);
    const s1 = toSlug(title.replace(/\bpart\s*(\d+)\b/i, `Season ${pNum}`));
    const s2 = toSlug(title.replace(/\bpart\s*(\d+)\b/i, `${ord} Season`));
    slugs.add(s1);
    slugs.add(s2);
    slugs.add(s1.replace(/\b86-eighty-six\b/g, 'eighty-six').replace(/\beighty-six-eighty-six\b/g, 'eighty-six'));
    slugs.add(s2.replace(/\b86-eighty-six\b/g, 'eighty-six').replace(/\beighty-six-eighty-six\b/g, 'eighty-six'));
  }

  // If title has 86, add variants without 86 or with 86 replaced
  if (/\b86\b/.test(title)) {
    const without86 = title.replace(/\b86\s*[:-]?\s*/gi, '').trim();
    if (without86) {
      slugs.add(toSlug(without86));
      if (partMatch) {
        const pNum = partMatch[1];
        const ord = toOrdinal(pNum);
        slugs.add(toSlug(without86.replace(/\bpart\s*(\d+)\b/i, `Season ${pNum}`)));
        slugs.add(toSlug(without86.replace(/\bpart\s*(\d+)\b/i, `${ord} Season`)));
      }
    }
  }

  const qSeason = extractSeasonNumber(title);
  const qPart = extractPartNumber(title);
  const isMovieTarget = Boolean(isMovie || isMovieIndicator(title));

  // Subtitle split (before :, -, —, ~)
  // ONLY consider mainPart if it preserves the exact same season, part, and movie context!
  const mainPart = title.split(/[:—~–|-]/)[0].trim();
  const mainSlug = toSlug(mainPart);
  const mainSeason = extractSeasonNumber(mainPart);
  const mainPartNum = extractPartNumber(mainPart);
  const mainIsMovie = isMovieIndicator(mainPart);

  const isSafeMain = mainSlug &&
    mainSlug.length > 2 &&
    mainSeason === qSeason &&
    mainPartNum === qPart &&
    mainIsMovie === isMovieTarget &&
    !/\b(season|part|cour|arc|hen|movie|film)\b/i.test(title.slice(mainPart.length));

  if (isSafeMain) {
    slugs.add(mainSlug);
  }

  if (!isMovieTarget) {
    for (const s of [...slugs]) {
      slugs.add(`${s}-tv`);
    }
  } else {
    for (const s of [...slugs]) {
      slugs.add(`${s}-movie`);
    }
  }

  return [...slugs];
}

export function generateSearchQueries(title, allTitles = [], language = 'english') {
  const queries = new Set();
  const safeAll = Array.isArray(allTitles) ? allTitles : (allTitles && typeof allTitles === 'object' ? Object.values(allTitles) : []);
  const rawCandidates = Array.from(new Set([title, ...safeAll].filter(Boolean)));

  // Expand variants: "Part X" -> "Season X" / "Xnd Season", and "86" <-> "Eighty Six"
  const candidates = [];
  for (const c of rawCandidates) {
    if (typeof c !== 'string') continue;
    candidates.push(c);
    const pMatch = c.match(/\bpart\s*(\d+)\b/i);
    if (pMatch) {
      const pNum = pMatch[1];
      const ord = (pNum === '1') ? '1st' : (pNum === '2') ? '2nd' : (pNum === '3') ? '3rd' : `${pNum}th`;
      candidates.push(c.replace(/\bpart\s*(\d+)\b/i, `Season ${pNum}`));
      candidates.push(c.replace(/\bpart\s*(\d+)\b/i, `${ord} Season`));
    }
    if (/\b86\b/.test(c)) {
      candidates.push(c.replace(/\b86\s*[:-]?\s*/gi, '').trim());
      candidates.push(c.replace(/\b86\b/g, 'Eighty Six'));
    }
  }

  // Pass 1: Concise titles (<= 4 words)
  for (const t of candidates) {
    const clean = cleanAnimeTitle(t);
    const words = clean.split(' ').filter(w => w.length > 1);
    if (clean && words.length >= 1 && words.length <= 4) {
      queries.add(clean);
    }
  }

  // Pass 2: Main franchise prefix AND unique arc/subtitle clauses
  for (const t of candidates) {
    const parts = t.split(/[:—~–|]/).map(p => cleanAnimeTitle(p)).filter(p => p && p.length > 2);
    for (const p of parts) {
      const pWords = p.split(' ').filter(w => w.length > 1);
      if (pWords.length <= 4) {
        queries.add(p);
      }
      // If a part has arc/season keywords (e.g. "Entertainment District Arc", "Season 2"), extract the 2-3 word arc suffix
      if (/\b(arc|season|hen|part|cour)\b/i.test(p) && pWords.length > 3) {
        queries.add(pWords.slice(-3).join(' '));
      }
    }
  }

  // Pass 3: 2-3 word prefixes for long titles
  for (const t of candidates) {
    const clean = cleanAnimeTitle(t);
    const words = clean.split(' ').filter(w => w.length > 1);
    if (words.length > 4) {
      queries.add(words.slice(0, 3).join(' '));
    }
    // Also include full string as fallback
    if (clean && clean.length > 2) {
      queries.add(clean);
    }
  }

  return Array.from(queries).slice(0, 6);
}

// ─── 6. Master Pre-Indexed Mappings (Industry Benchmark) ───

export const INDUSTRY_MAPPINGS = {
  // ONE PIECE (1100+ episodes — instant index lookup)
  '21': { neko: 'one-piece', anikoto: 'one-piece-odmau', anikotoId: '1642', waves: 'one-piece-ov8' },

  // Naruto & Shippuden
  '20': { neko: 'naruto', waves: 'naruto-677' },
  '1735': { neko: 'naruto-shippuden', waves: 'naruto-shippuden-1555' },

  // Attack on Titan
  '16498': { neko: 'attack-on-titan', anikoto: 'attack-on-titan-bgaoa', anikotoId: '1631', waves: 'shingeki-no-kyojin-74865' },
  '20958': { neko: 'attack-on-titan-season-2', anikoto: 'attack-on-titan-season-2-0rtbh', anikotoId: '1385', waves: 'shingeki-no-kyojin-season-2-113' },
  '99147': { neko: 'attack-on-titan-season-3', anikoto: 'attack-on-titan-season-3-3jgrx', anikotoId: '1585', waves: 'shingeki-no-kyojin-season-3-114' },
  '104578': { neko: 'attack-on-titan-season-3', waves: 'shingeki-no-kyojin-season-3-part-2-115' },
  '110277': { neko: 'attack-on-titan-final-season-part-1', waves: 'shingeki-no-kyojin-the-final-season-116' },
  '131681': { neko: 'attack-on-titan-final-season-part-2' },

  // Demon Slayer (Kimetsu no Yaiba)
  '101922': { neko: 'demon-slayer-kimetsu-no-yaiba', anikoto: 'demon-slayer-kimetsu-no-yaiba-8ea4p' },
  '112151': { neko: 'demon-slayer-movie-mugen-train', anikoto: 'demon-slayer-movie-mugen-train-8ea4p' },
  '129874': { neko: 'the-demon-slayer-kimetsu-no-yaiba-mugen-train-arc-tv', anikoto: 'the-demon-slayer-kimetsu-no-yaiba-mugen-train-arc-tv-jsqtn' },
  '142329': { neko: 'demon-slayer-entertainment-district-arc', anikoto: null },
  '145139': { neko: 'demon-slayer-kimetsu-no-yaiba-swordsmith-village-arc', anikoto: null },
  '166240': { neko: 'demon-slayer-kimetsu-no-yaiba-hashira-training-arc', anikoto: null },

  // JUJUTSU KAISEN
  '113415': { neko: 'jujutsu-kaisen-tv', anikoto: 'jujutsu-kaisen-tv-8ssye', waves: 'jujutsu-kaisen-78052' },
  '145064': { neko: 'jujutsu-kaisen-2nd-season', anikoto: 'jujutsu-kaisen-2nd-season-hk2c9' },
  '131573': { neko: 'jujutsu-kaisen-0-movie', anikoto: 'jujutsu-kaisen-0-movie-lmsg3' },

  // My Hero Academia
  '21459': { neko: 'my-hero-academia', anikoto: 'my-hero-academia-kuzfp' },
  '21856': { neko: 'my-hero-academia-2' },
  '100166': { neko: 'my-hero-academia-3' },
  '104276': { neko: 'my-hero-academia-4' },
  '117193': { neko: 'my-hero-academia-5th-season' },
  '138940': { neko: 'my-hero-academia-season-6' },
  '162985': { neko: 'my-hero-academia-season-7' },

  // Bleach
  '269': { neko: 'bleach', waves: 'bleach-3' },
  '136604': { neko: 'bleach-thousand-year-blood-war-arc', waves: 'bleach-sennen-kessen-hen-18150' },
  '159322': { neko: 'bleach-thousand-year-blood-war-the-separation' },
  '171044': { neko: 'bleach-thousand-year-blood-war-the-conflict' },

  // Re:Zero
  '21355': { neko: 'rezero-starting-life-in-another-world' },
  '108632': { neko: 'rezero-starting-life-in-another-world-season-2' },
  '119661': { neko: 'rezero-starting-life-in-another-world-2nd-season-part-2' },
  '163588': { neko: 'rezero-starting-life-in-another-world-season-3' },


  // Solo Leveling
  '151807': { neko: 'solo-leveling', anikoto: 'solo-leveling-ilh08' },
  '175841': { neko: 'solo-leveling-season-2-arise-from-the-shadow' },

  // Chainsaw Man
  '127230': { neko: 'chainsaw-man-the-compilation', anikoto: 'chainsaw-man-efeig' },

  // SPY x FAMILY (Franchise Master Index)
  '140960': { neko: 'spy-x-family', waves: 'spy-x-family-74534', anikoto: 'spy-x-family-6zlbz', anikotoId: '7095' },
  '50265':  { neko: 'spy-x-family', waves: 'spy-x-family-74534', anikoto: 'spy-x-family-6zlbz', anikotoId: '7095' }, // MAL
  '142838': { neko: 'spy-x-family-part-2', waves: 'spy-x-family-part-2-74529', anikoto: 'spy-x-family-part-2-p56od', anikotoId: '7165' },
  '53887':  { neko: 'spy-x-family-part-2', waves: 'spy-x-family-part-2-74529', anikoto: 'spy-x-family-part-2-p56od', anikotoId: '7165' }, // MAL
  '158927': { neko: 'spy-x-family-season-2', waves: 'spy-x-family-season-2-74531', anikoto: 'spy-x-family-season-2-qlfdj', anikotoId: '6399' },
  '55347':  { neko: 'spy-x-family-season-2', waves: 'spy-x-family-season-2-74531', anikoto: 'spy-x-family-season-2-qlfdj', anikotoId: '6399' }, // MAL
  '158928': { neko: 'spy-x-family-code-white', waves: 'spy-x-family-movie-code-white-74539', anikoto: 'spy-x-family-code-white-pwzbi', anikotoId: '6303' },
  '55348':  { neko: 'spy-x-family-code-white', waves: 'spy-x-family-movie-code-white-74539', anikoto: 'spy-x-family-code-white-pwzbi', anikotoId: '6303' }, // MAL

  // Death Note & Fullmetal Alchemist
  '1535': { neko: 'death-note', anikoto: 'death-note-fc8mq' },
  '5114': { neko: 'fullmetal-alchemist-brotherhood', anikoto: 'fullmetal-alchemist-brotherhood-9s0fl' },

  // Hunter x Hunter
  '11061': { neko: 'hunter-x-hunter', waves: 'hunter-x-hunter-2011-2' },

  // Steins;Gate & Vinland Saga
  '9253': { neko: 'steinsgate', anikoto: 'steins-gate-c93ww' },
  '101348': { neko: 'vinland-saga', anikoto: null },
  '136430': { neko: 'vinland-saga-2nd-season', anikoto: null },

  // Sword Art Online & Black Clover
  '11757': { neko: 'sword-art-online', anikoto: 'sword-art-online-c6fbv' },
  '97940': { neko: 'black-clover', anikoto: 'black-clover-g7tjy' },

  // Frieren
  '154587': { neko: 'frieren-beyond-journeys-end', anikoto: 'frieren-beyond-journey-s-end-c6fbj', waves: 'sousou-no-frieren-74577' },

  // One-Punch Man
  '21087': { neko: 'one-punch-man', anikoto: 'one-punch-man-jylym' },
  '97668': { neko: 'one-punch-man-2nd-season', anikoto: 'one-punch-man-2nd-season-commemorative-special-cra29' },

  // Blue Lock
  '137822': { neko: 'blue-lock' },
  '163146': { neko: 'blue-lock-season-2' },

  // That Time I Got Reincarnated as a Slime
  '182205': { neko: 'that-time-i-got-reincarnated-as-a-slime-season-4', anikoto: 'that-time-i-got-reincarnated-as-a-slime-season-4-0u851' },
  '59970':  { neko: 'that-time-i-got-reincarnated-as-a-slime-season-4', anikoto: 'that-time-i-got-reincarnated-as-a-slime-season-4-0u851' },
  '156822': { neko: 'that-time-i-got-reincarnated-as-a-slime-season-3' },
  '53580':  { neko: 'that-time-i-got-reincarnated-as-a-slime-season-3' },
  '116742': { neko: 'that-time-i-got-reincarnated-as-a-slime-2nd-season-part-2' },
  '41487':  { neko: 'that-time-i-got-reincarnated-as-a-slime-2nd-season-part-2' },
  '108511': { neko: 'that-time-i-got-reincarnated-as-a-slime-season-2', waves: 'tensei-shitara-slime-datta-ken-2nd-season-77967' },
  '39551':  { neko: 'that-time-i-got-reincarnated-as-a-slime-season-2', waves: 'tensei-shitara-slime-datta-ken-2nd-season-77967' },
  '101280': { neko: 'that-time-i-got-reincarnated-as-a-slime', waves: 'tensei-shitara-slime-datta-ken-77966' },
  '37430':  { neko: 'that-time-i-got-reincarnated-as-a-slime', waves: 'tensei-shitara-slime-datta-ken-77966' },

  // Recent & Airing Hits
  '144647': { neko: 'kaiju-no-8', waves: 'kaijuu-8-gou-77976', anikoto: 'kaiju-no-8-ewvpr', anikotoId: '6089' },
  '153288': { neko: 'kaiju-no-8', waves: 'kaijuu-8-gou-77976', anikoto: 'kaiju-no-8-ewvpr', anikotoId: '6089' },
  '179040': { neko: 'kaiju-no-8-season-2', waves: 'kaijuu-8-gou-2nd-season-82262', anikoto: 'kaiju-no-8-season-2-rhi38' },
  '171018': { neko: 'dandadan', waves: 'dandadan-82405', anikoto: 'dandadan-m3o4v' },
  '163270': { neko: 'wind-breaker', waves: 'wind-breaker-82305', anikoto: 'wind-breaker-5yly8' },
  '132405': { neko: 'my-dress-up-darling' },
  '150672': { neko: 'oshi-no-ko', waves: 'oshi-no-ko-18342', anikoto: 'my-star-hg319', anikotoId: '6475' },
  '52034':  { neko: 'oshi-no-ko', waves: 'oshi-no-ko-18342', anikoto: 'my-star-hg319', anikotoId: '6475' }, // MAL
  '166531': { neko: 'oshi-no-ko-season-2', waves: 'oshi-no-ko-2nd-season-19252', anikoto: 'my-star-season-2-cwjwu', anikotoId: '6328' },
  '55791':  { neko: 'oshi-no-ko-season-2', waves: 'oshi-no-ko-2nd-season-19252', anikoto: 'my-star-season-2-cwjwu', anikotoId: '6328' }, // MAL
  '21202': { neko: 'konosuba-gods-blessing-on-this-wonderful-world' },
  '21699': { neko: 'konosuba-gods-blessing-on-this-wonderful-world-2' },
  '146984': { neko: 'konosuba-gods-blessing-on-this-wonderful-world-3' },

  // Classics & Legendary Masterpieces
  '1': { neko: 'cowboy-bebop', waves: 'cowboy-bebop-414', anikoto: 'cowboy-bebop-m20r9' },
  '223': { neko: 'dragon-ball', waves: 'dragon-ball-68', anikoto: 'dragon-ball-c4j10' },
  '813': { neko: 'dragon-ball-z', waves: 'dragon-ball-z-69', anikoto: 'dragon-ball-z-7813k' },
  '21175': { neko: 'dragon-ball-super', waves: 'dragon-ball-super-163', anikoto: 'dragon-ball-super-71329' },
  '1575': { neko: 'code-geass-lelouch-of-the-rebellion', waves: 'code-geass-hangyaku-no-lelouch-41', anikoto: 'code-geass-lelouch-of-the-rebellion-j9yow' },
  '2904': { neko: 'code-geass-lelouch-of-the-rebellion-r2', waves: 'code-geass-hangyaku-no-lelouch-r2-42', anikoto: 'code-geass-lelouch-of-the-rebellion-r2-n4yow' },
  '20605': { neko: 'tokyo-ghoul', waves: 'tokyo-ghoul-760', anikoto: 'tokyo-ghoul-993v2' },
  '20464': { neko: 'haikyu', waves: 'haikyuu-88', anikoto: 'haikyu-1j92n' },
  '21507': { neko: 'mob-psycho-100', waves: 'mob-psycho-100-349', anikoto: 'mob-psycho-100-3l412' },
  '101338': { neko: 'mob-psycho-100-ii', waves: 'mob-psycho-100-ii-350', anikoto: 'mob-psycho-100-ii-m929j' },
  '140439': { neko: 'mob-psycho-100-iii', waves: 'mob-psycho-100-iii-18151', anikoto: 'mob-psycho-100-iii-z7784' },
  '116589': { neko: '86', waves: '86-77983', anikoto: '86-nqcoh', anikotoId: '5751' },
  '41457':  { neko: '86', waves: '86-77983', anikoto: '86-nqcoh', anikotoId: '5751' },
  '131586': { neko: 'eighty-six-2nd-season', waves: '86-81410', anikoto: 'eighty-six-2nd-season-v6zlw', anikotoId: '6690' },
  '48569':  { neko: 'eighty-six-2nd-season', waves: '86-81410', anikoto: 'eighty-six-2nd-season-v6zlw', anikotoId: '6690' },

  // Mushoku Tensei: Jobless Reincarnation (All Seasons + Season 3)
  '108465': { neko: 'mushoku-tensei-jobless-reincarnation', anikoto: 'mushoku-tensei-jobless-reincarnation-g20z1', anikotoId: '5694', waves: 'mushoku-tensei-isekai-ittara-honki-dasu-76467' },
  '39535':  { neko: 'mushoku-tensei-jobless-reincarnation', anikoto: 'mushoku-tensei-jobless-reincarnation-g20z1', anikotoId: '5694', waves: 'mushoku-tensei-isekai-ittara-honki-dasu-76467' },
  '127720': { neko: 'mushoku-tensei-jobless-reincarnation-part-2', anikoto: 'mushoku-tensei-jobless-reincarnation-part-2-hkgog', anikotoId: '6675', waves: 'mushoku-tensei-isekai-ittara-honki-dasu-part-2-76468' },
  '45576':  { neko: 'mushoku-tensei-jobless-reincarnation-part-2', anikoto: 'mushoku-tensei-jobless-reincarnation-part-2-hkgog', anikotoId: '6675', waves: 'mushoku-tensei-isekai-ittara-honki-dasu-part-2-76468' },
  '146065': { neko: 'mushoku-tensei-jobless-reincarnation-season-2', anikoto: 'mushoku-tensei-jobless-reincarnation-season-2-u1lv2', anikotoId: '6537', waves: 'mushoku-tensei-ii-isekai-ittara-honki-dasu-76470' },
  '51179':  { neko: 'mushoku-tensei-jobless-reincarnation-season-2', anikoto: 'mushoku-tensei-jobless-reincarnation-season-2-u1lv2', anikotoId: '6537', waves: 'mushoku-tensei-ii-isekai-ittara-honki-dasu-76470' },
  '166873': { neko: 'mushoku-tensei-jobless-reincarnation-season-2-part-2', anikoto: 'mushoku-tensei-jobless-reincarnation-season-2-part-2-eaqko', anikotoId: '6159', waves: 'mushoku-tensei-ii-isekai-ittara-honki-dasu-part-2-76485' },
  '55888':  { neko: 'mushoku-tensei-jobless-reincarnation-season-2-part-2', anikoto: 'mushoku-tensei-jobless-reincarnation-season-2-part-2-eaqko', anikotoId: '6159', waves: 'mushoku-tensei-ii-isekai-ittara-honki-dasu-part-2-76485' },
  '178789': { neko: 'mushoku-tensei-jobless-reincarnation-season-3', anikoto: 'mushoku-tensei-jobless-reincarnation-season-3', anikotoId: '8800', waves: 'mushoku-tensei-iii-isekai-ittara-honki-dasu-82693' },
  '59193':  { neko: 'mushoku-tensei-jobless-reincarnation-season-3', anikoto: 'mushoku-tensei-jobless-reincarnation-season-3', anikotoId: '8800', waves: 'mushoku-tensei-iii-isekai-ittara-honki-dasu-82693' },

  // Boruto
  '100526': { neko: 'boruto-naruto-next-generations', waves: 'boruto-naruto-next-generations-1555' },

  // Fairy Tail
  '6702':   { neko: 'fairy-tail', waves: 'fairy-tail-265' },
  '14059':  { neko: 'fairy-tail-season-2', waves: 'fairy-tail-2014-265' },
  '20856':  { neko: 'fairy-tail-3rd-series', waves: 'fairy-tail-2018-266' },
  '48549':  { neko: 'fairy-tail-100-years-quest', waves: 'fairy-tail-100-years-quest-82270' },

  // Classroom of the Elite
  '98659':  { neko: 'classroom-of-the-elite', waves: 'youkoso-jitsuryoku-shijou-shugi-no-kyoushitsu-e-1' },
  '139587': { neko: 'classroom-of-the-elite-2nd-season', waves: 'youkoso-jitsuryoku-shijou-shugi-no-kyoushitsu-e-2nd-season-77989' },
  '163918': { neko: 'classroom-of-the-elite-3rd-season', waves: 'youkoso-jitsuryoku-shijou-shugi-no-kyoushitsu-e-3rd-season-82266' },

  // Overlord
  '29803':  { neko: 'overlord', waves: 'overlord-15' },
  '79693':  { neko: 'overlord-ii', waves: 'overlord-ii-16' },
  '98437':  { neko: 'overlord-iii', waves: 'overlord-iii-17' },
  '121897': { neko: 'overlord-iv', waves: 'overlord-iv-18' },

  // Kaguya-sama: Love is War
  '101921': { neko: 'kaguya-sama-love-is-war', waves: 'kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen-76442' },
  '112641': { neko: 'kaguya-sama-love-is-war-season-2' },
  '125367': { neko: 'kaguya-sama-love-is-war-ultra-romantic' },
  '151384': { neko: 'kaguya-sama-love-is-war-the-first-kiss-that-never-ends' },

  // The Rising of the Shield Hero
  '99263':  { neko: 'the-rising-of-the-shield-hero', waves: 'tate-no-yuusha-no-nariagari-77974' },
  '108729': { neko: 'the-rising-of-the-shield-hero-season-2', waves: 'tate-no-yuusha-no-nariagari-season-2-77975' },
  '145662': { neko: 'the-rising-of-the-shield-hero-season-3', waves: 'tate-no-yuusha-no-nariagari-season-3-82269' },

  // Sword Art Online (sequels)
  '20594':  { neko: 'sword-art-online-ii', waves: 'sword-art-online-ii-1001' },
  '79491':  { neko: 'sword-art-online-alicization', waves: 'sword-art-online-alicization-1002' },
  '107191': { neko: 'sword-art-online-alicization-war-of-underworld', waves: 'sword-art-online-alicization-war-of-underworld-1003' },
  '114308': { neko: 'sword-art-online-alicization-war-of-underworld-2nd-season', waves: 'sword-art-online-alicization-war-of-underworld-part-2-1004' },
  '144970': { neko: 'sword-art-online-progressive-aria-of-a-starless-night', waves: 'sword-art-online-progressive-movie-hoshi-naki-yoru-no-aria-1005' },

  // Tokyo Ghoul (sequels)
  '21314':  { neko: 'tokyo-ghoul-root-a', waves: 'tokyo-ghoul-root-a-761' },
  '31240':  { neko: 'tokyo-ghoul-re', waves: 'tokyo-ghoul-re-762' },
  '100535': { neko: 'tokyo-ghoul-re-part-2', waves: 'tokyo-ghoul-re-2nd-season-763' },

  // Fate series
  '10087':  { neko: 'fate-zero', waves: 'fate-zero-52' },
  '11741':  { neko: 'fate-zero-2nd-season', waves: 'fate-zero-2nd-season-53' },
  '22297':  { neko: 'fate-stay-night-unlimited-blade-works', waves: 'fate-stay-night-unlimited-blade-works-2014-54' },
  '61115':  { neko: 'fate-stay-night-unlimited-blade-works-2nd-season', waves: 'fate-stay-night-unlimited-blade-works-2nd-season-55' },
  '20787':  { neko: 'fate-stay-night-heavens-feel-i-presage-flower', waves: 'fate-stay-night-movie-heavens-feel-i-presage-flower-1' },
  '25537':  { neko: 'fate-stay-night-heavens-feel-ii-lost-butterfly', waves: 'fate-stay-night-movie-heavens-feel-ii-lost-butterfly-2' },
  '100444': { neko: 'fate-stay-night-heavens-feel-iii-spring-song', waves: 'fate-stay-night-movie-heavens-feel-iii-spring-song-3' },
  '103275': { neko: 'fate-grand-order-absolute-demonic-front-babylonia', waves: 'fate-grand-order-zettai-majuu-sensen-babylonia-1' },

  // Haikyuu sequels
  '20583':  { neko: 'haikyu-2nd-season', waves: 'haikyuu-2nd-season-89' },
  '21698':  { neko: 'haikyu-3rd-season', waves: 'haikyuu-3rd-season-90' },
  '100261': { neko: 'haikyu-to-the-top', waves: 'haikyuu-to-the-top-91' },
  '107207': { neko: 'haikyu-to-the-top-2nd-season', waves: 'haikyuu-to-the-top-2nd-season-92' },
  '124406': { neko: 'haikyu-the-dumpster-battle', waves: 'haikyuu-movie-gomisuteba-no-kessen-93' },

  // Violet Evergarden
  '21827':  { neko: 'violet-evergarden', waves: 'violet-evergarden-8082' },
  '104073': { neko: 'violet-evergarden-the-movie', waves: 'violet-evergarden-the-movie-8083' },

  // Promised Neverland
  '101759': { neko: 'the-promised-neverland', waves: 'yakusoku-no-neverland-77956' },
  '110764': { neko: 'the-promised-neverland-2nd-season', waves: 'yakusoku-no-neverland-2nd-season-77957' },

  // Dr. Stone
  '105333': { neko: 'dr-stone', waves: 'dr-stone-77959' },
  '113936': { neko: 'dr-stone-stone-wars', waves: 'dr-stone-stone-wars-77960' },
  '130013': { neko: 'dr-stone-new-world', waves: 'dr-stone-new-world-82264' },

  // Mashle
  '158893': { neko: 'mashle-magic-and-muscles', waves: 'mashle-magic-and-muscles-82271' },
  '163292': { neko: 'mashle-magic-and-muscles-season-2', waves: 'mashle-magic-and-muscles-2nd-season-82272' },

  // Dungeon (DanMachi)
  '20920':  { neko: 'is-it-wrong-to-try-to-pick-up-girls-in-a-dungeon', waves: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-77977' },
  '101167': { neko: 'is-it-wrong-to-try-to-pick-up-girls-in-a-dungeon-ii', waves: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-ii-77978' },
  '112124': { neko: 'is-it-wrong-to-try-to-pick-up-girls-in-a-dungeon-iii', waves: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-iii-77979' },
  '129196': { neko: 'is-it-wrong-to-try-to-pick-up-girls-in-a-dungeon-iv', waves: 'dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-iv-77980' },
  '155211': { neko: 'is-it-wrong-to-try-to-pick-up-girls-in-a-dungeon-iv-part-2' },
  '170732': { neko: 'is-it-wrong-to-try-to-pick-up-girls-in-a-dungeon-v' },

  // Tensei Slime / Black Clover (additional)
  '108569': { neko: 'black-clover-movie-sword-of-the-wizard-king' },

  // Bocchi the Rock
  '130003': { neko: 'bocchi-the-rock', waves: 'bocchi-the-rock-82252' },

  // Lycoris Recoil
  '130112': { neko: 'lycoris-recoil', waves: 'lycoris-recoil-82253' },

  // Hell's Paradise
  '130010': { neko: 'hells-paradise', waves: 'jigokuraku-82260' },

  // Zom 100
  '161645': { neko: 'zom-100-bucket-list-of-the-dead', waves: 'zombie-100-zombie-ni-naru-made-ni-shitai-100-no-koto-82261' },

  // Apothecary Diaries
  '157903': { neko: 'the-apothecary-diaries', waves: 'kusuriya-no-hitorigoto-82262' },

  // My Hero Academia (additional)
  '176496': { neko: 'my-hero-academia-season-7-part-2' },
};



/**
 * Instant 1-Step Exact Slug Matcher for AniNeko.
 * Finds the exact anime slug in < 0.05ms without firing slow network search queries.
 */
export function findExactNekoSlug(anime, isMovie = false) {
  if (!anime) return null;

  const aid = anime.id ? String(anime.id) : '';
  const mid = anime.idMal ? String(anime.idMal) : '';

  // 1. Direct Ground-Truth AniList or MAL ID (0.001ms)
  if (aid && INDUSTRY_MAPPINGS[aid]?.neko) {
    return { slug: INDUSTRY_MAPPINGS[aid].neko, method: 'industry-id', confidence: 1.0 };
  }
  if (mid && INDUSTRY_MAPPINGS[mid]?.neko) {
    return { slug: INDUSTRY_MAPPINGS[mid].neko, method: 'industry-id', confidence: 1.0 };
  }

  // 2. Persistent verified slug store from user sessions (0.001ms)
  if (aid) {
    const verified = getVerifiedSlug(aid, 'neko');
    if (verified) return { slug: verified, method: 'verified-cache', confidence: 1.0 };
  }
  if (mid) {
    const verified = getVerifiedSlug(mid, 'neko');
    if (verified) return { slug: verified, method: 'verified-cache', confidence: 1.0 };
  }

  const allTitles = [
    anime.title?.english,
    anime.title?.romaji,
    anime.title?.native,
    ...(Array.isArray(anime.synonyms) ? anime.synonyms : [])
  ].filter(t => t && typeof t === 'string');

  const isMovieTarget = Boolean(isMovie || anime.format === 'MOVIE');

  // 3. Exact Normalized Title Match (0.001ms)
  for (const t of allTitles) {
    const nt = norm(t);
    if (CATALOG_NORM_TITLE_MAP.has(nt)) {
      const cands = CATALOG_NORM_TITLE_MAP.get(nt);
      for (const c of cands) {
        const cIsMovie = isMovieIndicator(c.slug + ' ' + c.title);
        if (cIsMovie === isMovieTarget) {
          const qPart = extractPartNumber(t);
          const cPart = extractPartNumber(c.slug + ' ' + c.title);
          if (qPart !== cPart) continue;

          const qSeason = extractSeasonNumber(t);
          const cSeason = extractSeasonNumber(c.slug + ' ' + c.title);
          if (qSeason !== cSeason) continue;

          return { slug: c.slug, title: c.title, method: 'exact-norm', confidence: 1.0 };
        }
      }
    }
  }

  // 4. Exact Canonical Slug Match (0.001ms)
  for (const t of allTitles) {
    const candSlug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (candSlug && CATALOG_SLUG_MAP.has(candSlug)) {
      const c = CATALOG_SLUG_MAP.get(candSlug);
      const cIsMovie = isMovieIndicator(c.slug + ' ' + c.title);
      if (cIsMovie === isMovieTarget) {
        const qPart = extractPartNumber(t);
        const cPart = extractPartNumber(c.slug + ' ' + c.title);
        if (qPart === cPart) {
          const qSeason = extractSeasonNumber(t);
          const cSeason = extractSeasonNumber(c.slug + ' ' + c.title);
          if (qSeason === cSeason) {
            return { slug: c.slug, title: c.title, method: 'exact-slug', confidence: 1.0 };
          }
        }
      }
    }
  }

  // 5. Inverted Word Token Intersection with Strict Season & Format Guard (<1ms)
  const primaryTitle = anime.title?.english || anime.title?.romaji || allTitles[0];
  if (primaryTitle) {
    const queryWords = norm(primaryTitle).split(' ').filter(w => w.length > 2 && !['season', 'part', 'the'].includes(w));
    if (queryWords.length > 0) {
      const firstWord = queryWords[0];
      const pool = CATALOG_INVERTED_TOKENS.get(firstWord) || [];

      const getExplicitSeason = (str) => {
        const s = str.toLowerCase();
        const m = s.match(/\bseason\s*(\d+)\b/) || s.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/) || s.match(/\bs(\d+)\b/);
        if (m) return parseInt(m[1], 10);
        const m2 = s.match(/-(\d+)$/);
        if (m2) return parseInt(m2[1], 10);
        return 1;
      };

      const qSeason = getExplicitSeason(primaryTitle);

      let best = null, maxScore = -1;
      for (const cand of pool) {
        const candText = `${cand.slug} ${cand.title} ${cand.jp}`;
        if (isMovieIndicator(candText) !== isMovieTarget) continue;
        if (getExplicitSeason(candText) !== qSeason) continue;

        const candWords = new Set(norm(candText).split(' '));
        let matchCount = 0;
        for (const qw of queryWords) {
          if (candWords.has(qw)) matchCount++;
        }
        const score = matchCount / queryWords.length;
        if (score > maxScore) {
          maxScore = score;
          best = cand;
        }
      }

      // 5. Inverted Word Token Intersection with Strict Match Score (Requires >= 0.92 strict score)
      if (best && maxScore >= 0.90) {
        const strictScore = calculateMatchScore({ title: best.title, jp: best.jp, slug: best.slug }, primaryTitle, isMovieTarget);
        if (strictScore >= 0.92) {
          return { slug: best.slug, title: best.title, method: 'token-trie', confidence: strictScore };
        }
      }
    }
  }

  return null;
}


// ─── 7. Verified Slug Storage & Auto-Learning ───

export function getVerifiedSlug(animeId, provider) {
  if (!animeId || !provider) return null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(VERIFIED_SLUGS_KEY) : null;
    if (!raw) return null;
    const store = JSON.parse(raw);
    const entry = store[String(animeId)]?.[provider];
    if (entry && (Date.now() - entry.ts < VERIFIED_TTL_MS)) {
      return entry.slug;
    }
  } catch {}
  return null;
}

export function saveVerifiedSlug(animeId, provider, slug, extra = {}) {
  if (!animeId || !provider || !slug) return;
  // Strictly prevent auto-learning wrong anime: require verified high confidence
  if (extra?.confidence != null && extra.confidence < 0.88) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(VERIFIED_SLUGS_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const idStr = String(animeId);
    if (!store[idStr]) store[idStr] = {};
    store[idStr][provider] = { slug, ts: Date.now(), ...extra };
    localStorage.setItem(VERIFIED_SLUGS_KEY, JSON.stringify(store));
    console.log(`[SlugEngine] Auto-learned verified slug: ID ${idStr} [${provider}] ➔ "${slug}"`);
  } catch {}
}

/**
 * Evicts a poisoned verified slug from the auto-learning store.
 * Call this whenever a slug probe or server fetch reveals the wrong anime was matched.
 * Prevents the bad slug from being re-used on future visits via the instant cache path.
 */
export function clearVerifiedSlug(animeId, provider, slug = null) {
  if (!animeId || !provider) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(VERIFIED_SLUGS_KEY);
    if (!raw) return;
    const store = JSON.parse(raw);
    const idStr = String(animeId);
    if (!store[idStr]) return;
    // Only evict if the stored slug matches the bad slug (or if no slug specified — evict all)
    if (slug && store[idStr][provider]?.slug !== slug) return;
    delete store[idStr][provider];
    localStorage.setItem(VERIFIED_SLUGS_KEY, JSON.stringify(store));
    console.warn(`[SlugEngine] ⚠️ Evicted poisoned verified slug for ID ${idStr} [${provider}]${slug ? ` ("${slug}")` : ''}`);
  } catch {}
}



export function getResolvedMappedSlug(animeId, provider, dynamicMappings = {}) {
  if (!animeId || !provider) return null;
  const idStr = String(animeId);

  // 1. Check pre-indexed ground truth master catalog (instant hit)
  if (INDUSTRY_MAPPINGS[idStr]?.[provider]) {
    return INDUSTRY_MAPPINGS[idStr][provider];
  }

  // 2. Check Cloudflare D1 edge mapping cache from slugMapClient
  try {
    const rawEdge = localStorage.getItem('aniplay_slugmap_v1');
    if (rawEdge) {
      const edgeStore = JSON.parse(rawEdge);
      const edgeEntry = edgeStore[idStr];
      if (edgeEntry && edgeEntry[provider]) {
        return edgeEntry[provider];
      }
    }
  } catch {}

  // 3. Check dynamic runtime mappings (remote config)
  if (dynamicMappings[idStr]?.[provider]) {
    return dynamicMappings[idStr][provider];
  }

  // 4. Check auto-learned persistent store
  const autoSlug = getVerifiedSlug(idStr, provider);
  if (autoSlug) return autoSlug;

  return null;
}

export const getMappedSlug = getResolvedMappedSlug;

// ─── 9. On-Device AI Engine (Gemini Nano via window.ai + Micro-Vector AI) ───

/**
 * 128-dimensional dense semantic hash projection for titles and slugs.
 * Runs locally in ~1 microsecond in pure JavaScript.
 */
export function microVectorEmbed(text) {
  if (!text) return new Float32Array(128);
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const vec = new Float32Array(128);

  // Character Trigrams Hash Projection
  const str = ` ${clean} `;
  for (let i = 0; i < str.length - 2; i++) {
    const tri = str.slice(i, i + 3);
    let hash = 2166136261;
    for (let j = 0; j < tri.length; j++) {
      hash ^= tri.charCodeAt(j);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % 128;
    const sign = (hash & 1) ? 1 : -1;
    vec[idx] += sign * 1.0;
  }

  // Word Token Unigrams with double weight
  const words = clean.split(' ').filter(w => w.length > 1);
  for (const w of words) {
    let hash = 2166136261;
    for (let j = 0; j < w.length; j++) {
      hash ^= w.charCodeAt(j);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % 128;
    vec[idx] += 2.0;
  }

  // L2 Normalize
  let normVal = 0;
  for (let i = 0; i < 128; i++) normVal += vec[i] * vec[i];
  normVal = Math.sqrt(normVal);
  if (normVal > 0) {
    for (let i = 0; i < 128; i++) vec[i] /= normVal;
  }
  return vec;
}

export function cosineSim(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < 128; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (!normA || !normB) return 0;
  return Math.max(0, dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

/**
 * On-Device LLM (Google Gemini Nano) via Chrome Built-in AI / Prompt API.
 * 100% offline, 0 MB added to APK, zero rate limits.
 */
export async function resolveWithGeminiNano(queryInfo, candidates) {
  if (typeof window === 'undefined') return null;
  const ai = window.ai || window.model;
  if (!ai || !ai.languageModel) return null;

  try {
    const capabilities = await ai.languageModel.capabilities();
    if (capabilities.available === 'no') return null;

    const session = await ai.languageModel.create({
      systemPrompt: 'You are an accurate anime slug matcher. You will be given an anime query and a list of candidate slugs. Return ONLY the exact matching slug from the list. If none match, return "NONE". Do not include any explanation.'
    });

    const prompt = `Anime Query:
Title: "${queryInfo.title}"
Romaji: "${queryInfo.romaji || ''}"
Season: ${queryInfo.season || 1}
Is Movie: ${queryInfo.isMovie ? 'true' : 'false'}

Candidate Slugs:
${candidates.map((c, i) => `${i + 1}. ${c.slug} (${c.title || c.slug})`).join('\n')}

Which candidate slug is the exact match?`;

    const rawResponse = await session.prompt(prompt);
    if (session.destroy) session.destroy();

    const text = (rawResponse || '').trim().toLowerCase();
    const matched = candidates.find(c => text.includes(c.slug.toLowerCase()));
    if (matched) {
      console.log(`[GeminiNano] On-device AI matched slug: "${matched.slug}"`);
      return { slug: matched.slug, title: matched.title, source: 'gemini-nano', confidence: 0.99 };
    }
  } catch (e) {
    console.warn('[GeminiNano] On-device LLM query error or unavailable:', e.message);
  }
  return null;
}

/**
 * High-Speed Zero-Dependency Micro-Vector AI Fallback.
 * Computes normalized semantic vector cosine similarity across candidate titles and slugs.
 * Runs in ~5ms on any phone, completely offline.
 */
export function resolveWithMicroVectorAI(queryInfo, candidates) {
  if (!candidates || candidates.length === 0) return null;
  const queryText = `${queryInfo.title} ${queryInfo.romaji || ''}`;
  const qVec = microVectorEmbed(queryText);
  const queryIsMovie = Boolean(queryInfo.isMovie);
  const querySeason = queryInfo.season || 1;

  let best = null, maxSim = -1;
  for (const cand of candidates) {
    const candText = `${cand.title || ''} ${cand.jp || ''} ${cand.slug.replace(/-/g, ' ')}`;

    // Strict season gating
    const candSeason = extractSeasonNumber(candText);
    if (candSeason !== querySeason) continue;

    // Strict movie vs tv gating
    const candIsMovie = isMovieIndicator(candText);
    if (candIsMovie !== queryIsMovie) continue;

    const cVec = microVectorEmbed(candText);
    let sim = cosineSim(qVec, cVec);

    // Penalize specials/recaps when searching main anime
    if (isSpecialIndicator(candText)) {
      sim *= 0.5;
    }

    if (sim > maxSim) {
      maxSim = sim;
      best = cand;
    }
  }

  if (best && maxSim >= 0.50) {
    return { slug: best.slug, title: best.title, source: 'micro-vector-ai', confidence: maxSim };
  }
  return null;
}

/**
 * Unified AI Disambiguation Layer.
 * Attempts Google Gemini Nano on-device first; gracefully falls back to Micro-Vector AI.
 */
export async function resolveAmbiguityWithAI(queryInfo, candidates) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { slug: candidates[0].slug, title: candidates[0].title, source: 'single-candidate', confidence: 1.0 };
  }

  // 1. Attempt on-device Gemini Nano if supported
  try {
    const nanoRes = await resolveWithGeminiNano(queryInfo, candidates);
    if (nanoRes) return nanoRes;
  } catch {}

  // 2. High-speed local micro-vector AI fallback (universal compatibility)
  return resolveWithMicroVectorAI(queryInfo, candidates);
}

/**
 * Fetch candidate anime slugs from MAL-Sync cross-reference API.
 * Pulls confirmed slug mappings from Zoro/AniWatch, 9anime/AniWave, Gogoanime, Crunchyroll, etc.
 */
export async function fetchMalSyncCandidateSlugs(idMal) {
  if (!idMal) return [];
  try {
    const res = await fetch(`https://api.malsync.moe/mal/anime/${idMal}`);
    if (!res.ok) return [];
    const data = await res.json();
    const sites = data.Sites || {};
    const slugs = new Set();
    for (const [siteName, sitePages] of Object.entries(sites)) {
      for (const [pageId, pageObj] of Object.entries(sitePages)) {
        const url = pageObj.url || '';
        const title = pageObj.title || '';
        const slugMatch = url.match(/(?:\/watch\/|\/category\/|\.com\/|\.to\/|\.lt\/|\.me\/)([a-zA-Z0-9_-]+)/);
        if (slugMatch) {
          const rawSlug = slugMatch[1].replace(/-[a-z0-9]{4,6}$/, '').replace(/-\d+$/, '');
          if (rawSlug && rawSlug.length > 2 && !['watch', 'anime', 'series'].includes(rawSlug)) {
            slugs.add(rawSlug);
          }
        }
        if (title) {
          const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          if (titleSlug && titleSlug.length > 2) {
            slugs.add(titleSlug);
          }
        }
      }
    }
    return [...slugs];
  } catch (e) {
    return [];
  }
}

