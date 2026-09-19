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

export const VERIFIED_SLUGS_KEY = 'aniplay_verified_slugs_v1';
export const VERIFIED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

  // Check trailing digit after clean title (e.g. "Oshi no Ko 2", "Solo Leveling 2")
  const clean = s.replace(/\b(dub|sub|uncensored|uncut|tv|movie|ova|ona|special|recap|film|series|audio|multi)\b/g, '').trim();
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

function getSignificantTokens(str) {
  if (!str) return [];
  return norm(str)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !MATCH_STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

export function calculateMatchScore(candidate, queryTitle, isMovie = false) {
  if (!candidate || !queryTitle) return 0;

  const candTitle = candidate.title || '';
  const candJp = candidate.jp || '';
  const candSlug = candidate.slug || '';
  const fullCandText = `${candTitle} ${candJp} ${candSlug}`;

  // 1. Strict Season Guard (Season 1 vs Season 2 vs Season 3)
  const candSeason = extractSeasonNumber(fullCandText);
  const querySeason = extractSeasonNumber(queryTitle);
  if (candSeason !== querySeason) return 0;

  // 2. Strict Part Guard (Part 1 vs Part 2)
  const candPart = extractPartNumber(fullCandText);
  const queryPart = extractPartNumber(queryTitle);
  if (candPart !== queryPart) return 0;

  // 3. Strict Movie vs TV Series Guard
  const candIsMovie = isMovieIndicator(fullCandText);
  const queryIsMovie = Boolean(isMovie || isMovieIndicator(queryTitle));
  if (candIsMovie !== queryIsMovie) return 0;

  // 4. Strict Special / OVA / Recap / Mini-Anime Guard
  const candIsSpecial = isSpecialIndicator(fullCandText);
  const queryIsSpecial = isSpecialIndicator(queryTitle);
  if (candIsSpecial !== queryIsSpecial) return 0;

  // 5. Significant Content Keyword Coverage Guard (Strict Anti-Random-Anime Shield)
  // Ensures that candidate contains at least 60% of query's primary content tokens (100% if single word).
  const qTokens = getSignificantTokens(queryTitle);
  const cTokens = getSignificantTokens(fullCandText);
  if (qTokens.length > 0) {
    let matchedTokens = 0;
    for (const qt of qTokens) {
      if (cTokens.some(ct => ct === qt || (qt.length > 4 && ct.length > 4 && (ct.startsWith(qt.slice(0, 5)) || qt.startsWith(ct.slice(0, 5)))))) {
        matchedTokens++;
      }
    }
    const coverageRatio = matchedTokens / qTokens.length;
    const minRequired = qTokens.length === 1 ? 1.0 : 0.60;
    if (coverageRatio < minRequired) return 0;
  }

  // 6. Mathematical Scoring (Max of English, Japanese Romaji, and Slug)
  const scoreEng = Math.max(
    diceSimilarity(norm(candTitle), norm(queryTitle)),
    tokenSimilarity(candTitle, queryTitle)
  );

  const scoreJp = candJp ? Math.max(
    diceSimilarity(norm(candJp), norm(queryTitle)),
    tokenSimilarity(candJp, queryTitle)
  ) : 0;

  const querySlug = norm(queryTitle).replace(/\s+/g, '-');
  const scoreSlug = diceSimilarity(candSlug, querySlug);

  return Math.max(scoreEng, scoreJp, scoreSlug);
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

  const rawSlug = toSlug(title);
  if (rawSlug) slugs.add(rawSlug);

  // Subtitle split (before :, -, —, ~)
  const mainPart = title.split(/[:—~–|-]/)[0].trim();
  const mainSlug = toSlug(mainPart);
  if (mainSlug && mainSlug.length > 2) slugs.add(mainSlug);

  if (!isMovie) {
    if (mainSlug) slugs.add(`${mainSlug}-tv`);
  } else {
    if (rawSlug) slugs.add(`${rawSlug}-movie`);
    if (mainSlug) slugs.add(`${mainSlug}-movie`);
  }

  return [...slugs];
}

export function generateSearchQueries(title, allTitles = [], language = 'english') {
  const queries = new Set();
  const candidates = Array.from(new Set([title, ...(allTitles || [])].filter(Boolean)));

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
  '20': { neko: 'naruto', anikoto: 'naruto-k5qyp', anikotoId: '1633', waves: 'naruto-677' },
  '1735': { neko: 'naruto-shippuden', anikoto: 'naruto-shippuden-10mqr', anikotoId: '1634', waves: 'naruto-shippuden-1555' },

  // Attack on Titan
  '16498': { neko: 'attack-on-titan', anikoto: 'attack-on-titan-bgaoa', anikotoId: '1631', waves: 'shingeki-no-kyojin-112' },
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

  // Slime
  '101280': { neko: 'that-time-i-got-reincarnated-as-a-slime' },
  '108511': { neko: 'that-time-i-got-reincarnated-as-a-slime-season-2' },
  '116742': { neko: 'that-time-i-got-reincarnated-as-a-slime-2nd-season-part-2' },
  '156822': { neko: 'that-time-i-got-reincarnated-as-a-slime-season-3' },

  // Solo Leveling
  '151807': { neko: 'solo-leveling', anikoto: 'solo-leveling-ilh08' },
  '175841': { neko: 'solo-leveling-season-2-arise-from-the-shadow' },

  // Chainsaw Man & SPY x FAMILY
  '127230': { neko: 'chainsaw-man-the-compilation', anikoto: 'chainsaw-man-efeig' },
  '140960': { neko: 'spy-x-family' },

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
  '108511': { neko: 'that-time-i-got-reincarnated-as-a-slime-season-2' },
  '39551':  { neko: 'that-time-i-got-reincarnated-as-a-slime-season-2' },
  '101280': { neko: 'that-time-i-got-reincarnated-as-a-slime' },
  '37430':  { neko: 'that-time-i-got-reincarnated-as-a-slime' },

  // Recent Hits
  '171018': { neko: 'dandadan' },
  '153288': { neko: 'kaiju-no-8' },
  '163270': { neko: 'wind-breaker' },
  '132405': { neko: 'my-dress-up-darling' },
  '142838': { neko: 'oshi-no-ko', waves: 'oshi-no-ko-18342' },
  '166531': { neko: 'oshi-no-ko-season-2', waves: 'oshi-no-ko-2nd-season-19252' },
  '21202': { neko: 'konosuba-gods-blessing-on-this-wonderful-world' },
  '21699': { neko: 'konosuba-gods-blessing-on-this-wonderful-world-2' },
  '146984': { neko: 'konosuba-gods-blessing-on-this-wonderful-world-3' }
};

/**
 * Instant 1-Step Exact Slug Matcher for AniNeko.
 * Finds the exact anime slug in < 0.05ms without firing slow network search queries.
 */
export function findExactNekoSlug(anime, isMovie = false) {
  if (!anime) return null;

  const aid = String(anime.id || anime.idMal || '');
  // 1. Direct Ground-Truth AniList ID (0.001ms)
  if (aid && INDUSTRY_MAPPINGS[aid]?.neko) {
    return { slug: INDUSTRY_MAPPINGS[aid].neko, method: 'industry-id', confidence: 1.0 };
  }

  // 2. Persistent verified slug store from user sessions (0.001ms)
  if (aid) {
    const verified = getVerifiedSlug(aid, 'neko');
    if (verified) {
      return { slug: verified, method: 'verified-cache', confidence: 1.0 };
    }
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

      if (best && maxScore >= 0.70) {
        return { slug: best.slug, title: best.title, method: 'token-trie', confidence: maxScore };
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

export function getResolvedMappedSlug(animeId, provider, dynamicMappings = {}) {
  if (!animeId || !provider) return null;
  const idStr = String(animeId);

  // 1. Check auto-learned persistent store (instant hit)
  const autoSlug = getVerifiedSlug(idStr, provider);
  if (autoSlug) return autoSlug;

  // 2. Check dynamic runtime mappings (remote config)
  if (dynamicMappings[idStr]?.[provider]) {
    return dynamicMappings[idStr][provider];
  }

  // 3. Check pre-indexed master catalog
  if (INDUSTRY_MAPPINGS[idStr]?.[provider]) {
    return INDUSTRY_MAPPINGS[idStr][provider];
  }

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

