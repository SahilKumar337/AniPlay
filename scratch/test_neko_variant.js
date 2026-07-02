import fetch from 'node-fetch';

const variantUrl = 'http://localhost:4000/api/stream/hls?url=https%3A%2F%2Fmorning-credit-3bcc.vibevibe.workers.dev%2Fag2ad00d94576b87d24b4ac106ea762ea54h%2F720p%2Findex.m3u8&referer=https%3A%2F%2Faniwaves.ru%2F';

async function run() {
  console.log(`Fetching Neko HD2 variant playlist...`);
  try {
    const res = await fetch(variantUrl);
    console.log('Variant playlist status:', res.status);
    const text = await res.text();
    console.log('Variant content (first 800 chars):');
    console.log(text.slice(0, 800));

    // Extract first segment URL
    const lines = text.split('\n');
    const segmentUrlLine = lines.find(line => line.startsWith('http') || line.includes('segment'));
    if (segmentUrlLine) {
      console.log(`Testing first segment URL: ${segmentUrlLine}...`);
      const segRes = await fetch(segmentUrlLine);
      console.log('Segment status:', segRes.status);
      console.log('Segment headers:', JSON.stringify(Object.fromEntries(segRes.headers), null, 2));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
