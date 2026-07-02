import { openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const dbPath = 'E:\\Anilab\\.chrome_solve_profile\\Default\\Network\\Cookies';
try {
  const fd = openSync(dbPath, 'r');
  console.log('Successfully opened file with fd:', fd);
  closeSync(fd);
} catch (e) {
  console.error('Error opening file:', e.message);
}
