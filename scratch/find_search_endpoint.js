import { readFileSync } from 'node:fs';

let fileContent;
try {
  fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');
} catch (e) {
  fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1268\\content.md', 'utf8');
}

console.log('File length:', fileContent.length);

// Search for any string literals containing search or q=
const searchMatches = [...fileContent.matchAll(/"([^"]*search[^"]*)"/gi)];
console.log(`Found ${searchMatches.length} double-quoted string matches containing 'search':`);
for (const match of searchMatches.slice(0, 30)) {
  console.log(`- ${match[0]}`);
}

const singleMatches = [...fileContent.matchAll(/'([^']*search[^']*)'/gi)];
console.log(`Found ${singleMatches.length} single-quoted string matches containing 'search':`);
for (const match of singleMatches.slice(0, 30)) {
  console.log(`- ${match[0]}`);
}

// Search for tick-quoted strings containing search
const tickMatches = [...fileContent.matchAll(/`([^`]*search[^`]*)`/gi)];
console.log(`Found ${tickMatches.length} tick-quoted string matches containing 'search':`);
for (const match of tickMatches.slice(0, 30)) {
  console.log(`- ${match[0]}`);
}
