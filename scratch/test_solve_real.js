import { exec } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = 'E:\\Anilab\\.chrome_solve_profile';
const targetUrl = 'https://animepahe.pw/';

console.log('Launching real Chrome process...');
const proc = exec(`"${chromePath}" --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check "${targetUrl}"`);

const dbPath = join(profileDir, 'Default', 'Network', 'Cookies');
const tempDb = join(profileDir, 'temp_solve_poll.sqlite');

let foundClearance = null;

const timer = setInterval(() => {
  if (!existsSync(dbPath)) return;
  try {
    const data = readFileSync(dbPath);
    writeFileSync(tempDb, data);
    const db = new Database(tempDb, { readonly: true });
    
    // Check if table contains any cookies
    const rows = db.prepare("SELECT host_key, name, value FROM cookies WHERE host_key LIKE '%animepahe%'").all();
    db.close();
    try { unlinkSync(tempDb); } catch {}
    
    const clearance = rows.find(r => r.name === 'cf_clearance');
    if (clearance) {
      console.log(`\nFOUND cf_clearance: ${clearance.value || '(encrypted/empty)'}`);
      if (clearance.value) {
        foundClearance = clearance.value;
        clearInterval(timer);
        console.log('Closing Chrome...');
        exec('taskkill /IM chrome.exe');
      }
    } else {
      process.stdout.write('.');
    }
  } catch (e) {
    // ignore temporary locks during active writes
  }
}, 1000);

setTimeout(() => {
  clearInterval(timer);
  if (!foundClearance) {
    console.log('\nTimed out without finding clearance.');
    exec('taskkill /IM chrome.exe /F');
  }
}, 45000);
