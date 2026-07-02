import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

async function run() {
  console.log('Launching headed stealth Playwright...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Navigating to AnimePahe Homepage...');
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait up to 30 seconds for Cloudflare auto-solve on homepage
    console.log('Waiting for homepage to solve...');
    let title = await page.title();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      title = await page.title();
      if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
        break;
      }
    }
    console.log('Homepage Title:', title);

    if (title.includes('Just a moment') || title.includes('Cloudflare')) {
      console.log('Failed to solve Cloudflare on homepage.');
      await browser.close();
      return;
    }

    // Solve succeeded! Now let's navigate to the API search endpoint in the same tab (which has the clearance cookie)
    console.log('Navigating to search API...');
    await page.goto('https://animepahe.pw/api?m=search&q=Chainsaw+Man', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const content = await page.evaluate(() => document.body.innerText);
    console.log('API Response:', content.slice(0, 500));
  } catch (err) {
    console.error('Error:', err.message);
  }
  await browser.close();
}

run();
