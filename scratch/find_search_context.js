import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

const term = 'search/?query=';
let idx = 0;
const positions = [];
while ((idx = fileContent.indexOf(term, idx)) !== -1) {
  positions.push(idx);
  idx += term.length;
}

console.log(`Found ${positions.length} occurrences of "${term}":`);
for (const pos of positions) {
  console.log(`\nPosition ${pos}:`);
  console.log(`Context: ... ${fileContent.slice(pos - 300, pos + 300)} ...`);
}
