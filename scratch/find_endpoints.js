import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

// Let's find all occurrences of "await n.get" or ".get(" in the file
const getMatches = [...fileContent.matchAll(/([a-z]\.get\([^)]+\))/gi)];
console.log(`Found ${getMatches.length} .get calls:`);
for (const match of getMatches.slice(0, 30)) {
  console.log(`- ${match[0]}`);
}

// Let's search for "/anime/" or "/search" near "get(" or "post("
const searchTerms = ['get("/', 'post("/', 'delete("/', 'get(`/', 'post(`/', 'delete(`/'];
for (const term of searchTerms) {
  let idx = 0;
  const positions = [];
  while ((idx = fileContent.indexOf(term, idx)) !== -1) {
    positions.push(idx);
    idx += term.length;
  }
  console.log(`Term "${term}" found ${positions.length} times.`);
  for (const pos of positions.slice(0, 10)) {
    console.log(`Context near ${pos}: ... ${fileContent.slice(pos - 30, pos + 70)} ...`);
  }
}
