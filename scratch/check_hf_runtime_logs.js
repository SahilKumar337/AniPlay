import fetch from 'node-fetch';

const hfToken = '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';
const url = 'https://huggingface.co/api/spaces/shadowloq333/anilab-backend/logs/run';

async function run() {
  console.log(`Subscribing to Runtime logs stream...`);
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${hfToken}`
    }
  });
  console.log(`Status: ${res.status}`);
  
  res.body.on('data', chunk => {
    const text = chunk.toString();
    console.log(text);
  });

  // Wait 6 seconds and then exit
  setTimeout(() => {
    console.log('Exiting logs subscription.');
    process.exit(0);
  }, 6000);
}

run().catch(console.error);
