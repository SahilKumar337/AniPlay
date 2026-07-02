import fetch from 'node-fetch';

const targetUrl = 'https://hlsxst3.burntburst45.store/komi-san-wa-comyushou-desu/6/720/segment_000.ts';
const referer = 'https://aniwaves.ru/';
const apiKey = 'shadowloq333-anilab-key';

// Deployed HF Space URL
const hfUrl = `https://shadowloq333-anilab-backend.hf.space/api/stream/segment?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(referer)}&api_key=${encodeURIComponent(apiKey)}`;

async function run() {
  console.log(`Fetching proxied segment from HF Space...`);
  console.log(`URL: ${hfUrl}`);
  const start = Date.now();
  try {
    const res = await fetch(hfUrl);
    console.log(`Status: ${res.status} in ${Date.now() - start}ms`);
    console.log(`Headers:`, Object.fromEntries(res.headers.entries()));
    if (res.ok) {
      console.log('Success! Downloaded length:', (await res.buffer()).length);
    } else {
      console.log('Failed:', await res.text());
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

run().catch(console.error);
