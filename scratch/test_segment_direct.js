import fetch from 'node-fetch';

const title = 'Wistoria: Wand and Sword Season 2';
const ep = 1;

async function run() {
  // Step 1: Query local backend to get current working server playlist URL
  const serverRes = await fetch(`http://localhost:4000/api/anineko-servers?title=${encodeURIComponent(title)}&episode=${ep}`);
  const serverData = await serverRes.json();
  const nekoSrv = serverData.servers.find(s => s.name.startsWith('Neko HD1'));
  
  if (!nekoSrv) {
    console.log('Neko HD1 server not found!');
    return;
  }
  
  // nekoSrv.videoUrl looks like: /api/stream/hls?url=https%3A%2F%2Fvivibebe.site%2Fpublic%2Fstream%2F1c7fb7eca1f34e3e%2Fmaster.m3u8&referer=https%3A%2F%2Fvivibebe.site
  const videoUrlObj = new URL(nekoSrv.videoUrl, 'http://localhost:4000');
  const targetUrl = videoUrlObj.searchParams.get('url');
  const referer = videoUrlObj.searchParams.get('referer');
  
  console.log(`Target Master Playlist: ${targetUrl}`);
  console.log(`Referer: ${referer}`);
  
  // Step 2: Fetch the master playlist (via proxy to avoid CORS/Referer check)
  const masterRes = await fetch(`http://localhost:4000${nekoSrv.videoUrl}`);
  const masterText = await masterRes.text();
  console.log('Master Playlist content:');
  console.log(masterText);
  
  // Find a sub-playlist URL from the content
  const lines = masterText.split('\n');
  const playlistLine = lines.find(l => l.includes('/api/stream/hls?url='));
  if (!playlistLine) {
    console.log('No sub-playlist found in master!');
    return;
  }
  
  console.log(`Sub-playlist proxied URL: ${playlistLine}`);
  
  // Step 3: Fetch the sub-playlist content
  const subRes = await fetch(playlistLine);
  const subText = await subRes.text();
  console.log('Sub-playlist content (first 200 chars):');
  console.log(subText.slice(0, 200));
  
  // Extract a segment URL from the sub-playlist
  const subLines = subText.split('\n');
  const segmentLine = subLines.find(l => l.includes('/api/stream/segment?url='));
  if (!segmentLine) {
    console.log('No segment URL found in sub-playlist!');
    return;
  }
  
  const segmentUrlObj = new URL(segmentLine);
  const targetSegmentUrl = segmentUrlObj.searchParams.get('url');
  console.log(`Original Segment URL: ${targetSegmentUrl}`);
  
  // Step 4: Try downloading the segment directly from the host (NO REFERER)
  console.log('Downloading segment DIRECTLY (NO REFERER)...');
  const startDirect = Date.now();
  const directRes = await fetch(targetSegmentUrl);
  console.log(`Direct Status: ${directRes.status} in ${Date.now() - startDirect}ms`);
  console.log(`Direct Headers:`, Object.fromEntries(directRes.headers.entries()));
  
  // Step 5: Try downloading the segment with Referer
  console.log('Downloading segment with Referer...');
  const startReferer = Date.now();
  const refRes = await fetch(targetSegmentUrl, {
    headers: { 'Referer': referer }
  });
  console.log(`Referer Status: ${refRes.status} in ${Date.now() - startReferer}ms`);
}

run().catch(console.error);
