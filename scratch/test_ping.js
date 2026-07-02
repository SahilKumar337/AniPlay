import fetch from 'node-fetch';

const url = 'https://shadowloq333-anilab-backend.hf.space/api/ping';

async function run() {
  console.log(`Pinging: ${url}`);
  try {
    const res = await fetch(url);
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log('Response Body:', text.slice(0, 1500));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

run().catch(console.error);
