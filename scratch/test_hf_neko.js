import fetch from 'node-fetch';

const apiKey = 'shadowloq333-anilab-key';
const target = 'https://morning-credit-3bcc.vibevibe.workers.dev/ag9eac17347e34a5de7c24a9a8c67dfe334h/master.m3u8';
const hfUrl = `https://shadowloq333-anilab-backend.hf.space/api/stream/hls?url=${encodeURIComponent(target)}&referer=https%3A%2F%2Fbibiemb.xyz&api_key=${apiKey}`;

async function run() {
  console.log(`Checking Hugging Face backend for MarriageToxin playlist...`);
  try {
    const res = await fetch(hfUrl);
    console.log('HF Status:', res.status);
    const text = await res.text();
    console.log('HF Output (first 600 chars):');
    console.log(text.slice(0, 600));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
