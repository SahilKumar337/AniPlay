import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

// Search for F7 or GT or fetch or axios near position 1239616
const pos = 1239616;
console.log(`Context around position ${pos}:`);
console.log(fileContent.slice(pos - 1000, pos + 1000));
