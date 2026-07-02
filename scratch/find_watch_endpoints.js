import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

// Let's find any fetch or axios paths in index.js that query stream, video, play, watch, or servers
const terms = ['/watch', '/play', '/stream', '/server', '/episode', '/source', '/media', '/video'];
const foundPaths = [];

for (const term of terms) {
  let idx = 0;
  while ((idx = fileContent.indexOf(term, idx)) !== -1) {
    // Extract a window of 100 characters around the term
    const start = Math.max(0, idx - 50);
    const end = Math.min(fileContent.length, idx + 100);
    const snippet = fileContent.slice(start, end);
    if (snippet.includes('.get(') || snippet.includes('.post(') || snippet.includes('fetch(') || snippet.includes('Zoe(') || snippet.includes('U7(')) {
      foundPaths.push({ term, snippet, pos: idx });
    }
    idx += term.length;
  }
}

console.log(`Found ${foundPaths.length} API-related path occurrences:`);
for (const item of foundPaths.slice(0, 30)) {
  console.log(`\nTerm: "${item.term}" at position ${item.pos}`);
  console.log(`Snippet: ${item.snippet}`);
}
