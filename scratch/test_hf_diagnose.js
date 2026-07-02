import fetch from 'node-fetch';

const apiKey = 'shadowloq333-anilab-key';
const target = 'https://morning-credit-3bcc.vibevibe.workers.dev/ag9eac17347e34a5de7c24a9a8c67dfe334h/master.m3u8';
const hfUrl = `https://shadowloq333-anilab-backend.hf.space/api/test-fetch?url=${encodeURIComponent(target)}&api_key=${apiKey}`;

async function run() {
  console.log(`Pinging diagnostic fetch endpoint for MarriageToxin on HF Space...`);
  try {
    const res = await fetch(hfUrl);
    console.log('Response Status:', res.status);
    const data = await res.json();
    console.log('Response Data:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
