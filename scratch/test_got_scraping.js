import { gotScraping } from 'got-scraping';

async function test() {
  console.log('Testing gotScraping against animepahe.pw...');
  try {
    const response = await gotScraping({
      url: 'https://animepahe.pw/api?m=search&q=One+Piece',
      headerGeneratorOptions: {
        browsers: [
          {
            name: 'chrome',
            minVersion: 120,
          }
        ],
        devices: ['desktop'],
        operatingSystems: ['windows']
      }
    });
    console.log('Status code:', response.statusCode);
    console.log('Body length:', response.body.length);
    console.log('Body snippet:', response.body.slice(0, 500));
  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.log('Response body:', err.response.body.slice(0, 500));
    }
  }
}

test();
