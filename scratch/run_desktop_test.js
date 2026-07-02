import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function run() {
  console.log('--------------------------------------------------');
  console.log('🚀 Launching AniLab Windows Test Environment...');
  console.log('--------------------------------------------------');
  
  // 1. Launch persistent browser with disabled web security (CORS)
  const context = await chromium.launchPersistentContext('E:\\Anilab\\.playwright_profile_test', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  console.log('Browser launched successfully.');

  // 2. Intercept requests to dynamically inject correct Referer/Origin headers
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const headers = { ...request.headers() };

    let modified = false;

    // Inject referers for specific video hosting CDNs
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

  console.log('Network request intercepts active.');

  // 3. Navigate to the local dev server
  console.log('Navigating to local development server http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  
  console.log('\n🌟 AniLab Test Browser is ready! You can now search and play anime.');
  console.log('Leave this terminal window open. Close the browser window to exit testing.');
}

run().catch(err => {
  console.error('Error launching test environment:', err);
});
