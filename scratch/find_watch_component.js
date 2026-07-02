import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

const term = 'lTe=';
const idx = fileContent.indexOf(term);
if (idx !== -1) {
  console.log(`Found lTe definition at position ${idx}:`);
  console.log(`Context: ... ${fileContent.slice(idx - 100, idx + 1500)} ...`);
} else {
  console.log('lTe= not found. Searching for watch component reference...');
  // Let's search for '/watch/:id/:ep?'
  const pos = fileContent.indexOf('/watch/:id/:ep?');
  console.log(`Context near watch route: ... ${fileContent.slice(pos - 500, pos + 500)} ...`);
}
