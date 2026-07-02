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
    
    let cfFrame = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      cfFrame = page.frames().find(f => f.url().includes('challenges.cloudflare.com'));
      if (cfFrame) break;
    }
    
    if (!cfFrame) {
      console.log('Error: challenges frame not found!');
      return;
    }
    
    console.log('CF Frame found. Waiting for Turnstile elements to load...');
    await page.waitForTimeout(10000);
    
    // List elements inside frame
    const els = await cfFrame.$$eval('*', elements => elements.map(el => ({
      tag: el.tagName,
      id: el.id,
      className: el.className,
      text: el.innerText || ''
    })));
    
    console.log(`Found ${els.length} elements inside CF frame:`);
    console.log(els.slice(0, 30));
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
