import { chromium } from 'playwright';
import { gotScraping } from 'got-scraping';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function run() {
  console.log('1. Launching Playwright to solve challenge and get cookies...');
  // Launch persistent context or regular context
  const browser = await chromium.launch({
    headless: false, // headed to let it auto-solve easily
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  console.log('Navigating to AnimePahe...');
  await page.goto('https://animepahe.pw/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Wait to see if it solves
  console.log('Waiting 15 seconds for auto-solve...');
  await page.waitForTimeout(15000);
  console.log('Title is:', await page.title());

  const cookies = await context.cookies();
  console.log('Acquired cookies:', cookies.map(c => `${c.name}=${c.value}`).join('; '));
  
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  await browser.close();

  if (!cookieStr.includes('cf_clearance')) {
    console.log('cf_clearance not found in cookies. Cannot proceed.');
    return;
  }

  console.log('\n2. Testing gotScraping with the acquired cookies...');
  try {
    const response = await gotScraping({
      url: 'https://animepahe.pw/api?m=search&q=One+Piece',
      headers: {
        'Cookie': cookieStr,
        'User-Agent': UA,
        'Referer': 'https://animepahe.pw/'
      },
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
    console.error('gotScraping Error:', err.message);
    if (err.response) {
      console.log('Response body:', err.response.body.slice(0, 500));
    }
  }
}

run();
