import fetch from 'node-fetch';

const hfToken = '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';
const url = 'https://huggingface.co/api/spaces/shadowloq333/anilab-backend';

async function run() {
  console.log(`Checking overall Space details...`);
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${hfToken}`
    }
  });
  const data = await res.json();
  console.log('Full Space Runtime Details:', JSON.stringify(data.runtime, null, 2));
}

run().catch(console.error);
