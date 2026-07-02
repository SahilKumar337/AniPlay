import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const profileDir = 'E:\\Anilab\\.chrome_solve_profile';
const dbPath = join(profileDir, 'Default', 'Network', 'Cookies');
const tempDb = join(profileDir, 'temp_cookies_buf.sqlite');

if (!existsSync(dbPath)) {
  console.log('Database does not exist yet at:', dbPath);
  process.exit(1);
}

try {
  console.log('Reading buffer of database directly...');
  const data = readFileSync(dbPath);
  console.log('Buffer read successfully! Length:', data.length);
  
  console.log('Writing buffer to temp file...');
  writeFileSync(tempDb, data);
  console.log('Temp file written successfully!');
  
  console.log('Opening temp database using better-sqlite3...');
  const db = new Database(tempDb, { readonly: true });
  const rows = db.prepare("SELECT host_key, name FROM cookies LIMIT 5").all();
  console.log('Successfully queried database! Row count:', rows.length);
  db.close();
  try { unlinkSync(tempDb); } catch {}
} catch (err) {
  console.error('Error occurred:', err.message);
}
