import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function testAnimetsu(page) {
  console.log('[Animetsu] Navigating to homepage...');
  await page.goto('https://animetsu.net', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('[Animetsu] Evaluating search & stream fetches from page console...');
  const data = await page.evaluate(async () => {
    const searchRes = await fetch('/v2/api/anime/search?q=Chainsaw%20Man');
    const results = await searchRes.json();
    if (!results.length) return { error: 'No search results' };
    
    const best = results[0];
    const epsRes = await fetch(`/v2/api/anime/eps/${best.id}`);
    const eps = await epsRes.json();
    
    const streamRes = await fetch(`/v2/api/anime/stream/${best.id}/1`);
    const streams = await streamRes.json();
    
    return {
      title: best.title,
      id: best.id,
      episodesCount: eps.length,
      servers: streams.map(s => s.name)
    };
  });
  console.log('[Animetsu Result]:', JSON.stringify(data, null, 2));
}

async function testNeko(page) {
  console.log('[AniNeko] Navigating to homepage...');
  await page.goto('https://anineko.to', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('[AniNeko] Evaluating search & stream fetches from page console...');
  const data = await page.evaluate(async () => {
    const searchRes = await fetch('/api/search?q=Chainsaw%20Man');
    const results = await searchRes.json();
    if (!results.length) return { error: 'No search results' };
    
    const best = results[0];
    const epsRes = await fetch(`/api/episodes/${best.slug}`);
    const eps = await epsRes.json();
    const targetEp = eps.find(e => e.episodeNumber == 1);
    
    let servers = [];
    if (targetEp) {
      const streamRes = await fetch(`/api/episode/sources/${targetEp.id}`);
      const streams = await streamRes.json();
      servers = (streams.servers || []).map(s => s.name);
    }
    
    return {
      title: best.name,
      slug: best.slug,
      episodesCount: eps.length,
      servers
    };
  });
  console.log('[AniNeko Result]:', JSON.stringify(data, null, 2));
}

async function run() {
  console.log('Launching Playwright browser with persistent context...');
  const context = await chromium.launchPersistentContext('E:\\Anilab\\.playwright_profile_test', {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  
  try {
    await testAnimetsu(page);
    console.log('--------------------------------------');
    await testNeko(page);
  } catch (e) {
    console.error('Error during test:', e.message);
  } finally {
    await context.close();
  }
}

run();
