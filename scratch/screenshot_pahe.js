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
    await page.waitForTimeout(6000);
    console.log('Saving screenshot...');
    await page.screenshot({ path: 'C:/Users/sahil/.gemini/antigravity-ide/brain/e59d2bad-4bb0-4c33-87d2-a69b8475b7cf/pahe.png' });
    console.log('Page title:', await page.title());
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
