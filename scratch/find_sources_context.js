import { readFileSync } from 'node:fs';

const fileContent = readFileSync('C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\.system_generated\\steps\\1306\\content.md', 'utf8');

const target = 'sources: s = [], error: r';
const idx = fileContent.indexOf(target);
if (idx !== -1) {
  console.log(`Found target at position ${idx}:`);
  console.log(`Context before:`);
  console.log(fileContent.slice(idx - 1500, idx));
  console.log(`Context after:`);
  console.log(fileContent.slice(idx, idx + 500));
} else {
  console.log('Target not found!');
}
