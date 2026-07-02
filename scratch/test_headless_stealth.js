import puppeteerExtra from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer-core';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const puppeteer = puppeteerExtra.vanilla ? puppeteerExtra : puppeteerExtra.addExtra(puppeteerVanilla);
puppeteer.use(StealthPlugin());

// Use bundled chrome on Windows, or default path on Linux
const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('Launching headless Puppeteer Stealth...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true, // Headless on server!
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,800',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  // Set real user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  
  console.log('Navigating to AnimePahe...');
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Simulate user behavior: scroll and move mouse
    console.log('Simulating mouse movements...');
    await page.mouse.move(100, 100);
    await new Promise(r => setTimeout(r, 500));
    await page.mouse.move(300, 400, { steps: 10 });
    
    console.log('Waiting for Turnstile solve check...');
    let solved = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const title = await page.title();
      console.log(`Title: "${title}"`);
      if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
        solved = true;
        break;
      }
      
      // If Turnstile checkbox frame is visible, attempt to click it
      const frame = page.frames().find(f => f.url().includes('challenges.cloudflare.com'));
      if (frame) {
        const checkbox = await frame.$('#challenge-stage');
        if (checkbox) {
          console.log('Clicking Turnstile stage frame...');
          const box = await checkbox.boundingBox();
          if (box) {
            await page.mouse.click(box.x + 30, box.y + box.height / 2);
          }
        }
      }
    }

    if (solved) {
      console.log('SUCCESS! Headless solve succeeded!');
      const cookies = await page.cookies();
      console.log('Cookies:', JSON.stringify(cookies.map(c => ({ name: c.name, value: c.value })), null, 2));
    } else {
      console.log('Failed to solve Turnstile headlessly.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  await browser.close();
}

run();
