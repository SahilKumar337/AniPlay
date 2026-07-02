import fetch from 'node-fetch';

const hfToken = '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';
const url = 'https://huggingface.co/api/spaces/shadowloq333/anilab-backend/logs/build';

async function run() {
  console.log(`Fetching Build logs from HF API...`);
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${hfToken}`
    }
  });
  console.log(`Status: ${res.status}`);
  const text = await res.text();
  console.log('Build Logs Output (last 800 chars):');
  console.log(text.slice(-800));
}

run().catch(console.error);
