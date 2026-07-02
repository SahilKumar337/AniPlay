import fetch from 'node-fetch';

const title = 'MARRIAGETOXIN';
const ep = 1;

async function run() {
  console.log(`Resolving Neko HD2 for ${title} Ep ${ep}...`);
  try {
    const res = await fetch(`http://localhost:4000/api/anineko-servers?title=${encodeURIComponent(title)}&episode=${ep}`);
    const data = await res.json();
    console.log('Servers payload:', JSON.stringify(data, null, 2));

    const neko2 = data.servers.find(s => s.name === 'Neko HD2');
    if (neko2) {
      console.log('Extracting stream for Neko HD2...');
      const embedUrl = neko2.videoUrl;
      const extRes = await fetch(`http://localhost:4000/api/extract-stream?url=${encodeURIComponent(embedUrl)}`);
      const extData = await extRes.json();
      console.log('Extraction Result:', JSON.stringify(extData, null, 2));
      
      if (extData.ok && extData.url) {
        console.log('Fetching HLS playlist...');
        const hlsRes = await fetch(`http://localhost:4000${extData.url}`);
        console.log('HLS Playlist Status:', hlsRes.status);
        const text = await hlsRes.text();
        console.log('Playlist Content (first 500 chars):');
        console.log(text.slice(0, 500));
      }
    } else {
      console.log('Neko HD2 not found in list!');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
