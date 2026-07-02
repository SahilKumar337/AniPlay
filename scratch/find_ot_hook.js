import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

const term = 'ot=';
const idx = fileContent.indexOf(term);
if (idx !== -1) {
  console.log(`Found ot definition at position ${idx}:`);
  console.log(`Context: ... ${fileContent.slice(idx - 100, idx + 1500)} ...`);
} else {
  console.log('ot= not found. Searching for global state stores...');
  const searchTerms = ['createStore', 'zustand', 'slice', 'watch_id', 'sources', 'set_watch_id'];
  for (const t of searchTerms) {
    const pos = fileContent.indexOf(t);
    if (pos !== -1) {
      console.log(`Found "${t}" at position ${pos}: ... ${fileContent.slice(pos - 50, pos + 150)} ...`);
    }
  }
}
