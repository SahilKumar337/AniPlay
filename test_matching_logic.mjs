function stripSeasonSuffix(title) {
  return title.replace(/\s+(?:part|season|s)?\s*(?:[ivxldcm]+|\d+)(?:st|nd|rd|th)?$/i, '').trim();
}

function getNormalizedSeason(title) {
  const t = title.toLowerCase();
  if (t.includes('season 5') || t.includes('5th season') || t.includes('part 5') || t.includes('part v') || /\b5\b/.test(t)) return 5;
  if (t.includes('season 4') || t.includes('4th season') || t.includes('part 4') || t.includes('part iv') || /\b4\b/.test(t)) return 4;
  if (t.includes('season 3') || t.includes('3rd season') || t.includes('part 3') || t.includes('part iii') || /\b3\b/.test(t)) return 3;
  if (t.includes('season 2') || t.includes('2nd season') || t.includes('part 2') || t.includes('part ii') || /\b2\b/.test(t)) return 2;
  return 1;
}

function getMatchScore(resultTitle, queryTitle) {
  const rt = resultTitle.toLowerCase().replace(/&#039;/g, "'").replace(/&amp;/g, '&');
  const qt = queryTitle.toLowerCase();

  const querySeason = getNormalizedSeason(qt);
  const resultSeason = getNormalizedSeason(rt);

  if (querySeason !== resultSeason) return 0;

  const strippedQt = stripSeasonSuffix(qt);
  const qWords = strippedQt.split(/\s+/).filter(w => w.length > 2);
  if (qWords.length === 0) return 0.5;

  let matched = 0;
  for (const w of qWords) {
    if (rt.includes(w)) matched++;
  }
  return matched / qWords.length;
}

const results = [
  { title: "Komi-san wa, Comyushou desu. 2nd Season", slug: "komi-2" },
  { title: "Komi Can't Communicate", slug: "komi-1" }
];

console.log("Matching score for Season 1 query: 'Komi Can't Communicate'");
for (const r of results) {
  console.log(`- ${r.title} Score:`, getMatchScore(r.title, "Komi Can't Communicate"));
}

console.log("\nMatching score for Season 2 query: 'Komi Can't Communicate Part 2'");
for (const r of results) {
  console.log(`- ${r.title} Score:`, getMatchScore(r.title, "Komi Can't Communicate Part 2"));
}
