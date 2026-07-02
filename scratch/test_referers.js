import fetch from 'node-fetch';

const segmentUrl = 'https://hlsxst3.burntburst45.store/komi-san-wa-comyushou-desu/6/720/segment_000.ts';

async function testReferers() {
  const referers = [
    'https://play.echovideo.ru/',
    'https://play.echovideo.ru',
    'https://aniwaves.ru/',
    'https://aniwaves.ru'
  ];

  for (const ref of referers) {
    try {
      const res = await fetch(segmentUrl, {
        headers: { 'Referer': ref }
      });
      console.log(`Referer: "${ref}" -> Status: ${res.status}`);
    } catch (e) {
      console.log(`Error for ${ref}: ${e.message}`);
    }
  }
}

testReferers().catch(console.error);
