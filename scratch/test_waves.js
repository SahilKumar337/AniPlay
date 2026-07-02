import fetch from 'node-fetch';

const title = 'MARRIAGETOXIN';
const ep = 1;

async function run() {
  console.log(`Resolving servers for ${title} Ep ${ep}...`);
  const serverRes = await fetch(`http://localhost:4000/api/anineko-servers?titles=${encodeURIComponent(title)}&episode=${ep}`);
  const serverData = await serverRes.json();
  
  console.log('Available servers:', serverData.servers?.map(s => s.name));
  
  const wavesSrv = serverData.servers.find(s => s.name.startsWith('Waves HD1'));
  if (!wavesSrv) {
    console.log('Waves HD1 server not found!');
    return;
  }
  
  console.log(`Waves HD1 Video URL: ${wavesSrv.videoUrl}`);
  
  const videoUrlObj = new URL(wavesSrv.videoUrl, 'http://localhost:4000');
  const targetUrl = videoUrlObj.searchParams.get('url');
  const referer = videoUrlObj.searchParams.get('referer');
  
  console.log(`Original Playlist: ${targetUrl}`);
  console.log(`Referer: ${referer}`);
  
  // Fetch playlist content
  const playlistRes = await fetch(targetUrl, {
    headers: { 'Referer': referer }
  });
  console.log(`Playlist Status: ${playlistRes.status}`);
  const playlistText = await playlistRes.text();
  console.log('Playlist Content (first 600 chars):');
  console.log(playlistText.slice(0, 600));
}

run().catch(console.error);
