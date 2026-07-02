import fetch from 'node-fetch';

const target = 'https://morning-credit-3bcc.vibevibe.workers.dev/ag9eac17347e34a5de7c24a9a8c67dfe334h/master.m3u8';

async function run() {
  console.log(`Fetching MarriageToxin master playlist directly from local machine...`);
  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    console.log('Status:', res.status);
    console.log('Headers:', JSON.stringify(Object.fromEntries(res.headers), null, 2));
    const text = await res.text();
    console.log('Content (first 400 chars):');
    console.log(text.slice(0, 400));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
