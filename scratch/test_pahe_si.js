import { gotScraping } from 'got-scraping';

async function test() {
  console.log('Testing https://animepahe.si...');
  try {
    const response = await gotScraping({
      url: `https://animepahe.si/api?m=search&q=Chainsaw+Man`,
      timeout: { request: 15000 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://animepahe.si'
      }
    });
    console.log(`Status: ${response.statusCode}, Length: ${response.body.length}`);
    if (response.body.trim().startsWith('{')) {
      console.log(`SUCCESS! Found JSON response: ${response.body.slice(0, 300)}`);
    } else {
      console.log(`HTML response (Cloudflare challenge)`);
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

test();
