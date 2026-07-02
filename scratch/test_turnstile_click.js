import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

async function run() {
  console.log('Launching headed stealth Playwright for Turnstile auto-solve...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Navigating to AnimePahe Homepage...');
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait up to 10 seconds for Turnstile iframe to appear
    console.log('Waiting for Turnstile iframe to appear...');
    let iframeElement = null;
    for (let i = 0; i < 20; i++) {
      iframeElement = await page.$('iframe[src*="challenges.cloudflare.com"]');
      if (iframeElement) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (iframeElement) {
      console.log('Turnstile iframe found! Getting bounding box...');
      // Wait for iframe to be fully rendered
      await new Promise(r => setTimeout(r, 2000));
      const box = await iframeElement.boundingBox();
      if (box) {
        // The Turnstile checkbox is roughly at x = 30-40px from the left edge of the iframe, and vertically centered
        const clickX = box.x + 35;
        const clickY = box.y + (box.height / 2);
        
        console.log(`Clicking Turnstile checkbox at coordinates: x=${clickX}, y=${clickY}`);
        // Move mouse realistically first
        await page.mouse.move(clickX - 50, clickY - 20, { steps: 5 });
        await new Promise(r => setTimeout(r, 200));
        await page.mouse.move(clickX, clickY, { steps: 5 });
        await new Promise(r => setTimeout(r, 100));
        await page.mouse.click(clickX, clickY);
        console.log('Checkbox clicked!');
      } else {
        console.log('Could not get bounding box for iframe');
      }
    } else {
      console.log('No Turnstile iframe found');
    }

    // Monitor title change to verify solve
    console.log('Waiting for solve check...');
    let solved = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      const title = await page.title();
      console.log(`Current Title: "${title}"`);
      if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
        solved = true;
        break;
      }
    }

    if (solved) {
      console.log('SUCCESS! Turnstile solved!');
      const cookies = await page.context().cookies();
      const cfClearance = cookies.find(c => c.name === 'cf_clearance');
      console.log('Captured cf_clearance:', cfClearance?.value);
    } else {
      console.log('Failed to solve Turnstile.');
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
  await browser.close();
}

run();
