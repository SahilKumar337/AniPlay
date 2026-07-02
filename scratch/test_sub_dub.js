import fetch from 'node-fetch';

const url = 'http://localhost:4000/api/stream/subtitle?url=https%3A%2F%2Fcdn.anizara.store%2Fsubtitles%2F1b%2F41%2F1b412e0b6bc017f0be18dba5ee8ad1a4_132407_dub_eng-0.vtt';

async function run() {
  const res = await fetch(url);
  const cues = await res.json();
  console.log(`Total cues: ${cues.length}`);
  console.log('First 10 cues:');
  console.log(JSON.stringify(cues.slice(0, 10), null, 2));
}

run().catch(console.error);
