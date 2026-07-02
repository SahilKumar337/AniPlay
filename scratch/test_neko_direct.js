import fetch from 'node-fetch';

const directSegmentUrl = 'https://morning-credit-3bcc.vibevibe.workers.dev/ag2ad00d94576b87d24b4ac106ea762ea54h/720p/0000.ts';

async function run() {
  console.log(`Testing Neko HD2 direct segment download (no headers)...`);
  try {
    const res = await fetch(directSegmentUrl);
    console.log('Direct download status:', res.status);
    console.log('Direct download headers:', JSON.stringify(Object.fromEntries(res.headers), null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
