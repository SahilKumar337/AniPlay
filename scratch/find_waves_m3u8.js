import fs from 'fs';
import { join } from 'path';

const logDir = 'C:\\Users\\sahil\\.gemini\\antigravity\\brain\\f631b491-5344-44da-9a67-0ef43999bf8b\\.system_generated\\tasks';

function searchLogs() {
  const files = fs.readdirSync(logDir);
  for (const f of files) {
    if (!f.endsWith('.log')) continue;
    const content = fs.readFileSync(join(logDir, f), 'utf8');
    if (content.includes('echovideo.ru') || content.includes('vibevibe.workers.dev')) {
      console.log(`Found match in file: ${f}`);
      // Find lines with M3U8 Resolver or echovideo
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.includes('m3u8') || line.includes('Master Playlist') || line.includes('captured stream')) {
          console.log(`  ${line.trim()}`);
        }
      }
    }
  }
}

searchLogs();
