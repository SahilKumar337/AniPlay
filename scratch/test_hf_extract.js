import fetch from 'node-fetch';

const embedUrl = 'https://bibiemb.xyz/ag2ad00d94576b87d24b4ac106ea762ea54h';
const apiKey = 'shadowloq333-anilab-key';
const hfUrl = `https://shadowloq333-anilab-backend.hf.space/api/extract-stream?url=${encodeURIComponent(embedUrl)}&api_key=${apiKey}`;

async function run() {
  console.log(`Extracting stream from Hugging Face backend: ${hfUrl}...`);
  try {
    const res = await fetch(hfUrl);
    console.log('HF Extraction status:', res.status);
    const data = await res.json();
    console.log('HF Extraction result:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
