import fetch from 'node-fetch';

async function test(domain) {
  const watchId = '6989be3929cf95f4eb03fadb'; // Chainsaw Man ID
  const epNum = '1';
  const server = 'pahe';
  const sourceType = 'dub';
  
  const url = `${domain}/v2/api/anime/oppai/${watchId}/${epNum}?server=${server}&source_type=${sourceType}`;
  console.log(`Testing DUB stream sources on ${domain}:`);
  console.log(`URL: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': `${domain}/`,
        'Accept': 'application/json, text/plain, */*',
        'Origin': domain
      }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response Length:', text.length);
    if (res.status === 200) {
      console.log('Success! Response snippet:', text.slice(0, 1500));
    } else {
      console.log('Failed. Response:', text.slice(0, 500));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

async function run() {
  await test('https://animetsu.net');
}

run();
