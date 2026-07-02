import { exec } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, copyFileSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

const profileDir = 'E:\\Anilab\\.chrome_solve_profile';

// Path to cookie database
const dbPath = join(profileDir, 'Default', 'Network', 'Cookies');
if (!existsSync(dbPath)) {
  console.log('Cookie database not found at:', dbPath);
  process.exit(1);
}

console.log('Reading cookie database using better-sqlite3...');
const tempDb = join(profileDir, 'temp_cookies_all.sqlite');
try {
  copyFileSync(dbPath, tempDb);
  const db = new Database(tempDb, { readonly: true });
  const rows = db.prepare("SELECT host_key, name FROM cookies").all();
  
  console.log(`Found ${rows.length} total cookies in database:`);
  for (const row of rows) {
    console.log(`- ${row.host_key}: ${row.name}`);
  }
  db.close();
  try { unlinkSync(tempDb); } catch {}
} catch (err) {
  console.error('Error reading cookies database:', err.message);
}
