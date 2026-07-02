import fetch from 'node-fetch';

const targetUrl = 'https://hlsxst1.burntburst45.store/marriagetoxin-dub/3/720/index.m3u8';
const referer = 'https://aniwaves.ru/';
const apiKey = 'shadowloq333-anilab-key';

const hfUrl = `https://shadowloq333-anilab-backend.hf.space/api/stream/hls?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&api_key=${encodeURIComponent(apiKey)}`;

async function run() {
  console.log(`Fetching Variant HLS Playlist from HF Space...`);
  console.log(`URL: ${hfUrl}`);
  const start = Date.now();
  try {
    const res = await fetch(hfUrl);
    console.log(`Status: ${res.status} in ${Date.now() - start}ms`);
    console.log(`Headers:`, Object.fromEntries(res.headers.entries()));
    const text = await res.text();
    console.log('Response (first 1000 chars):');
    console.log(text.slice(0, 1000));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

run().catch(console.error);
