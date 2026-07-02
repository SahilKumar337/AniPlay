import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('Navigating to animetsu to check search endpoint...');
    await page.goto('https://animetsu.net', { waitUntil: 'networkidle', timeout: 30000 });
    
    const results = await page.evaluate(async () => {
      const res = await fetch('/v2/api/anime/search?q=One%20Piece');
      return res.json();
    });
    
    console.log('Search Results for One Piece:', JSON.stringify(results, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
