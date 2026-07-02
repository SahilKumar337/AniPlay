import fetch from 'node-fetch';

const hfToken = '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';
const url = 'https://shadowloq333-anilab-backend.hf.space/api/ping';

async function run() {
  console.log(`Pinging private Space with HF Token...`);
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${hfToken}`
    }
  });
  console.log(`Status: ${res.status}`);
  const text = await res.text();
  console.log('Response Body:', text.slice(0, 1000));
}

run().catch(console.error);
