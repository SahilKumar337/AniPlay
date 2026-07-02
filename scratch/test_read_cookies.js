import { readFileSync, createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';

const chromeCookieDb = join(
  process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local',
  'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'
);

console.log('Target path:', chromeCookieDb);

function testReadFileSync() {
  try {
    const data = readFileSync(chromeCookieDb);
    console.log('readFileSync SUCCESS! Length:', data.length);
    return true;
  } catch (e) {
    console.log('readFileSync FAILED:', e.message);
    return false;
  }
}

function testReadStream() {
  return new Promise((resolve) => {
    const tempOut = join(process.env.TEMP, 'temp_anilab_cookies.sqlite');
    const rs = createReadStream(chromeCookieDb);
    const ws = createWriteStream(tempOut);
    rs.on('error', (err) => {
      console.log('ReadStream FAILED:', err.message);
      resolve(false);
    });
    ws.on('error', (err) => {
      console.log('WriteStream FAILED:', err.message);
      resolve(false);
    });
    ws.on('finish', () => {
      console.log('ReadStream SUCCESS!');
      resolve(true);
    });
    rs.pipe(ws);
  });
}

async function run() {
  testReadFileSync();
  await testReadStream();
}

run();
