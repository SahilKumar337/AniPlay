import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

const searchTerms = ['axios.create', 'create({', 'baseURL:', 'base_url', 'window.b', 'window.p'];
for (const term of searchTerms) {
  let idx = 0;
  const positions = [];
  while ((idx = fileContent.indexOf(term, idx)) !== -1) {
    positions.push(idx);
    idx += term.length;
  }
  console.log(`Term "${term}" found ${positions.length} times.`);
  for (const pos of positions.slice(0, 10)) {
    console.log(`Context near ${pos}: ... ${fileContent.slice(pos - 40, pos + 100)} ...`);
  }
}
