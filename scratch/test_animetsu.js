import fetch from 'node-fetch';

async function test() {
  console.log('Fetching https://animetsu.net...');
  try {
    const res = await fetch('https://animetsu.net/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Length:', text.length);
    console.log('Content Snippet:', text.slice(0, 1000));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
