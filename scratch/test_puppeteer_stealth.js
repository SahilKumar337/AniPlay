import puppeteerExtra from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer-core';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const puppeteer = puppeteerExtra.vanilla ? puppeteerExtra : puppeteerExtra.addExtra(puppeteerVanilla);
puppeteer.use(StealthPlugin());

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('Launching headed Puppeteer Stealth...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  console.log('Navigating to AnimePahe...');
  
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('Waiting for solve...');
    let solved = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const title = await page.title();
      console.log(`Title: "${title}"`);
      if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
        solved = true;
        break;
      }
    }

    if (solved) {
      console.log('SUCCESS! Puppeteer Stealth solved Turnstile!');
      const cookies = await page.cookies();
      console.log('Cookies:', JSON.stringify(cookies.map(c => ({ name: c.name, value: c.value })), null, 2));
    } else {
      console.log('Failed to solve Turnstile.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  await browser.close();
}

run();
