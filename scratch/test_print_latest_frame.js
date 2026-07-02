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
  console.log('Navigating...');
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(10000);
    
    // Get the LATEST frame from the active frames list
    const cfFrame = page.frames().find(f => f.url().includes('challenges.cloudflare.com') && !f.isDetached());
    if (!cfFrame) {
      console.log('Active CF frame not found!');
    } else {
      console.log('Active CF Frame URL:', cfFrame.url());
      const els = await cfFrame.$$eval('*', elements => elements.map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text: el.innerText || ''
      })));
      console.log(`Found ${els.length} elements in active frame:`);
      // Print elements that are inputs, divs or spans
      console.log(els.filter(e => ['INPUT', 'DIV', 'SPAN', 'LABEL'].includes(e.tag)));
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
