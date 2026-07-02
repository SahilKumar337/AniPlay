import fetch from 'node-fetch';

const segmentUrl = 'https://hlsxst3.burntburst45.store/komi-san-wa-comyushou-desu/6/720/segment_000.ts';
const referer = 'https://aniwaves.ru/';

async function testSegment() {
  console.log(`Testing Waves Segment URL: ${segmentUrl}`);
  
  // Test direct play (no referer)
  console.log('\n--- Direct Play (No Referer) ---');
  try {
    const res = await fetch(segmentUrl);
    console.log(`Status: ${res.status}`);
    console.log(`CORS Access-Control-Allow-Origin:`, res.headers.get('access-control-allow-origin'));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Test with referer
  console.log('\n--- With Referer: https://aniwaves.ru/ ---');
  try {
    const res = await fetch(segmentUrl, {
      headers: { 'Referer': referer }
    });
    console.log(`Status: ${res.status}`);
    console.log(`CORS Access-Control-Allow-Origin:`, res.headers.get('access-control-allow-origin'));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

testSegment().catch(console.error);
