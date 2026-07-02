import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('Navigating to animetsu anime page...');
    await page.goto('https://animetsu.net/anime/6989bf3e29cf95f4eb04078c', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    console.log('Title:', await page.title());
    
    // Log the entire inner text of the page to see if any episodes are listed
    const text = await page.evaluate(() => document.body.innerText || '');
    console.log('Body Text includes "Episode":', text.includes('Episode') || text.includes('episode') || text.includes('EP'));
    console.log('Text snippet:', text.slice(0, 1500));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
