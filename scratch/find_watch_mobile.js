import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

const term = 'XEe=';
const idx = fileContent.indexOf(term);
if (idx !== -1) {
  console.log(`Found XEe definition at position ${idx}:`);
  console.log(`Context: ... ${fileContent.slice(idx - 100, idx + 1500)} ...`);
} else {
  console.log('XEe= not found. Searching for oTe=...');
  const pos = fileContent.indexOf('oTe=');
  if (pos !== -1) {
    console.log(`Found oTe definition at position ${pos}:`);
    console.log(`Context: ... ${fileContent.slice(pos - 100, pos + 1500)} ...`);
  }
}
