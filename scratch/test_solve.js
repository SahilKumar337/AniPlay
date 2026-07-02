import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  console.log('Navigating to AnimePahe...');
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(8000);
    
    const html = await page.content();
    let idx = 0;
    while (true) {
      idx = html.indexOf('challenges.cloudflare.com', idx);
      if (idx === -1) break;
      console.log('--- FOUND OCCURRENCE ---');
      console.log(html.slice(Math.max(0, idx - 250), Math.min(html.length, idx + 250)));
      idx += 25;
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
