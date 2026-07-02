import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating to animetsu eps...');
  try {
    await page.goto('https://animetsu.net/v2/api/anime/eps/6989bf3e29cf95f4eb04078c', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Page loaded. Title:', await page.title());
    await page.waitForTimeout(5000);
    
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    console.log('Body Text Snippet:', bodyText.slice(0, 2000));
    
    const content = await page.content();
    console.log('HTML Content length:', content.length);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
