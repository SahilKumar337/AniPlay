import { gotScraping } from 'got-scraping';

const domains = [
  'https://animepahe.pw',
  'https://animepahe.ru',
  'https://animepahe.org',
  'https://animepahe.co',
  'https://animepahe.com'
];

async function test() {
  for (const domain of domains) {
    console.log(`Testing ${domain}...`);
    try {
      const response = await gotScraping({
        url: `${domain}/api?m=search&q=Chainsaw+Man`,
        timeout: { request: 5000 },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, y Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Referer': domain
        },
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 120 }],
          devices: ['desktop'],
          operatingSystems: ['windows']
        }
      });
      console.log(`Status: ${response.statusCode}, Length: ${response.body.length}`);
      if (response.body.trim().startsWith('{')) {
        console.log(`SUCCESS! Found JSON response: ${response.body.slice(0, 100)}`);
      } else {
        console.log(`HTML response (Cloudflare challenge)`);
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
    console.log('-'.repeat(50));
  }
}

test();
