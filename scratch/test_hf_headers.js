import fetch from 'node-fetch';

const apiKey = 'shadowloq333-anilab-key';
const target = 'https://morning-credit-3bcc.vibevibe.workers.dev/ag2ad00d94576b87d24b4ac106ea762ea54h/720p/index.m3u8';

async function run() {
  const referer = 'https://aniwaves.ru/';
  const origin = 'https://aniwaves.ru';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  console.log('Case 1: Fetching with Referer + Origin...');
  const url1 = `https://shadowloq333-anilab-backend.hf.space/api/test-fetch?url=${encodeURIComponent(target)}&api_key=${apiKey}`;
  
  // Let's modify our diagnostic URL to send referer headers if we want,
  // but wait! Let's write a script that sends requests with different headers to `/api/test-fetch`.
  // Wait, `/api/test-fetch` in proxy.mjs only receives `url`. It doesn't receive headers parameter.
  // But wait! We can pass custom headers or test directly from here using our local machine,
  // or we can test it directly.
  // Let's see: if we send Referer and Origin, does it succeed?
  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Referer': referer,
        'Origin': origin
      }
    });
    console.log('Direct status with headers:', res.status);
  } catch (err) {
    console.error('Direct error with headers:', err.message);
  }
}

run();
