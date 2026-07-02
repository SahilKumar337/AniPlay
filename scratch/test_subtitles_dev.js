import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function run() {
  console.log('🚀 Running headless subtitle test on local dev server...');
  
  const context = await chromium.launchPersistentContext('E:\\Anilab\\.playwright_profile_test_subs', {
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = context.pages().length ? context.pages()[0] : await context.newPage();

  // Setup request intercept to set headers for CDNs
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const headers = { ...request.headers() };
    let modified = false;

    if (url.includes('swiftstream.top') || url.includes('echovideo.ru')) {
      headers['Referer'] = 'https://animetsu.net/';
      headers['Origin'] = 'https://animetsu.net';
      modified = true;
    } else if (url.includes('anineko.to') || url.includes('vivibebe.site') || url.includes('bibiemb.xyz') || url.includes('anizara.store') || url.includes('ibyteimg.com')) {
      headers['Referer'] = 'https://anineko.to/';
      headers['Origin'] = 'https://anineko.to';
      modified = true;
    } else if (url.includes('aniwaves.ru') || url.includes('megacloud') || url.includes('vidplay') || url.includes('myvidplay') || url.includes('sb1254w9megshle.org')) {
      headers['Referer'] = 'https://aniwaves.ru/';
      headers['Origin'] = 'https://aniwaves.ru';
      modified = true;
    }

    if (modified) {
      await route.continue({ headers });
    } else {
      await route.continue();
    }
  });

  // Track ALL console logs from the page
  page.on('console', msg => {
    console.log(`[PAGE LOG - ${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log(`[PAGE RUNTIME ERROR] ${err.toString()}`);
  });

  // Navigate to homepage first to set welcomed state
  console.log('Priming session storage...');
  await page.goto('http://localhost:3000/');
  await page.evaluate(() => {
    sessionStorage.setItem('anilab_welcomed', '1');
  });

  // Now go to One Piece watch page
  console.log('Navigating to One Piece watch page (ID 21, Ep 3)...');
  await page.goto('http://localhost:3000/watch/21/3', { waitUntil: 'networkidle' });

  console.log('Waiting for page and servers to load...');
  await page.waitForTimeout(6000);

  // Click AniHD1 server button
  try {
    const serverBtn = page.locator('button:has-text("AniHD1")').first();
    if (await serverBtn.count() > 0) {
      console.log('Clicking AniHD1 server button...');
      await serverBtn.click();
    } else {
      console.log('AniHD1 server button not found');
    }
  } catch (e) {
    console.log('Server select button click skipped/failed:', e.message);
  }

  // Wait for the video player to render and load HLS/subtitles
  console.log('Waiting for video player and subtitles to load...');
  await page.waitForTimeout(8000);

  // Seek the video to a point where subtitles are active (3.5 seconds in)
  try {
    const seekResult = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video && video.readyState >= 2) {
        video.currentTime = 3.5;
        return `Seeked to ${video.currentTime}`;
      }
      return 'Video not ready for seek';
    });
    console.log(`Seek result: ${seekResult}`);
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('Seek failed:', e.message);
  }

  // Take a screenshot at the subtitle moment
  const screenshotPath = 'C:\\Users\\sahil\\.gemini\\antigravity-ide\\brain\\e59d2bad-4bb0-4c33-87d2-a69b8475b7cf\\dev_test_subtitles.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  await context.close();
  console.log('Done.');
}

run().catch(err => {
  console.error('Test error:', err);
});
