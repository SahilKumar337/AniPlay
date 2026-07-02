import fetch from 'node-fetch';

const embedUrl = 'https://bibiemb.xyz/ag2ad00d94576b87d24b4ac106ea762ea54h';

async function run() {
  console.log(`Extracting stream for Neko HD2: ${embedUrl}...`);
  try {
    const res = await fetch(`http://localhost:4000/api/extract-stream?url=${encodeURIComponent(embedUrl)}`);
    const data = await res.json();
    console.log('Extraction result:', JSON.stringify(data, null, 2));
    
    if (data.ok && data.url) {
      console.log('Testing extracted stream URL...');
      let targetUrl = data.url;
      if (!targetUrl.startsWith('http')) {
        targetUrl = `http://localhost:4000${targetUrl}`;
      }
      const streamRes = await fetch(targetUrl);
      console.log('Stream status:', streamRes.status);
      const text = await streamRes.text();
      console.log('Stream content (first 600 chars):', text.slice(0, 600));
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
