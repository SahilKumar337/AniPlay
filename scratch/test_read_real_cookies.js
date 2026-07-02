import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const chromeCookieDb = join(
  process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local',
  'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'
);

console.log('Target path:', chromeCookieDb);

if (!existsSync(chromeCookieDb)) {
  console.log('Real Chrome cookie database not found.');
  process.exit(1);
}

try {
  console.log('Reading real Chrome database buffer...');
  const data = readFileSync(chromeCookieDb);
  console.log('Buffer read successfully! Length:', data.length);
  
  const tempDb = join(process.env.TEMP, `temp_anilab_real_${Date.now()}.sqlite`);
  console.log('Writing to temp database:', tempDb);
  writeFileSync(tempDb, data);
  
  console.log('Opening database...');
  const db = new Database(tempDb, { readonly: true });
  
  // Search for any animepahe cookies
  const rows = db.prepare("SELECT host_key, name, value FROM cookies WHERE host_key LIKE '%animepahe%'").all();
  console.log(`\nFound ${rows.length} AnimePahe cookies in real Chrome:`);
  for (const row of rows) {
    console.log(`- ${row.host_key}: name=${row.name}, valueLength=${row.value?.length || 0}`);
  }
  
  db.close();
  try { unlinkSync(tempDb); } catch {}
} catch (err) {
  console.error('Error occurred:', err.message);
}
