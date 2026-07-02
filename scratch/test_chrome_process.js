import { exec } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profileDir = 'E:\\Anilab\\.chrome_solve_profile';
const targetUrl = 'https://animepahe.pw/';

console.log('Launching real Chrome in separate process...');

const proc = exec(`"${chromePath}" --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check "${targetUrl}"`);

// Wait 20 seconds for solve/load, then close Chrome gracefully
setTimeout(() => {
  console.log('Closing Chrome process gracefully...');
  
  exec('taskkill /IM chrome.exe', async (killErr) => {
    console.log('Graceful close signal sent. Opening database directly...');
    
    const dbPath = join(profileDir, 'Default', 'Network', 'Cookies');
    
    let success = false;
    // Retry every 1s for up to 10s
    for (let attempt = 1; attempt <= 10; attempt++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!existsSync(dbPath)) {
        console.log(`[Attempt ${attempt}] DB not found yet.`);
        continue;
      }
      try {
        // Open database directly in read-only mode (NO COPY!)
        const db = new Database(dbPath, { readonly: true });
        const rows = db.prepare("SELECT host_key, name, value FROM cookies WHERE host_key LIKE '%animepahe%'").all();
        console.log(`\nSUCCESS on attempt ${attempt}! Found ${rows.length} AnimePahe cookies directly:`);
        for (const row of rows) {
          console.log(`- ${row.name}: valueLength=${row.value?.length || 0}`);
        }
        db.close();
        success = true;
        break;
      } catch (err) {
        console.log(`[Attempt ${attempt}] DB read failed: ${err.message}`);
      }
    }
    
    if (!success) {
      console.log('Could not read database. Forcing taskkill...');
      exec('taskkill /IM chrome.exe /F');
    }
  });
}, 20000);
