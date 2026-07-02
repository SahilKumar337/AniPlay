import playwright from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

const chromium = playwright.chromium;
chromium.use(stealth());

async function run() {
  console.log('Launching browser with --disable-web-security (CORS bypass like mobile app)...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to local AniLab app...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('Injecting scraper validation script...');
  const result = await page.evaluate(async () => {
    // We execute the search & stream resolution inside the page context
    const ANINEKO = 'https://anineko.to';
    const AW = 'https://aniwaves.ru';
    const ANIMETSU = 'https://animetsu.net';
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    async function testFetch(url, referer) {
      const headers = { 'User-Agent': UA };
      if (referer) headers['Referer'] = referer;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }

    function stringSimilarity(str1, str2) {
      const q = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
      const r = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (q === r) return 1;
      const qWords = q.split('');
      const rWords = r.split('');
      const intersection = qWords.filter(w => rWords.includes(w));
      if (!intersection.length) return 0;
      return (2 * intersection.length) / (qWords.length + rWords.length);
    }

    const report = {};

    // 1. Test AniNeko Search + Stream
    try {
      const searchRes = await testFetch(`${ANINEKO}/api/search?q=Chainsaw%20Man`, ANINEKO);
      const items = JSON.parse(searchRes);
      if (items && items.length) {
        const best = items[0];
        const epsRes = await testFetch(`${ANINEKO}/api/episodes/${best.slug}`, `${ANINEKO}/anime/${best.slug}`);
        const eps = JSON.parse(epsRes);
        const ep1 = eps.find(e => e.episodeNumber == 1);
        if (ep1) {
          const sourcesRes = await testFetch(`${ANINEKO}/api/episode/sources/${ep1.id}`, `${ANINEKO}/anime/${best.slug}/episode-1`);
          const sources = JSON.parse(sourcesRes);
          report.anineko = {
            status: 'SUCCESS',
            title: best.name,
            servers: (sources.servers || []).map(s => ({ name: s.name, type: s.isDub ? 'dub' : 'sub' }))
          };
        }
      }
    } catch (e) {
      report.anineko = { status: 'FAILED', error: e.message };
    }

    // 2. Test AniWaves Search + Stream
    try {
      const searchRes = await testFetch(`${AW}/api/search?q=Chainsaw%20Man`, AW);
      const items = JSON.parse(searchRes);
      if (items && items.length) {
        const best = items[0];
        const epsRes = await testFetch(`${AW}/api/episodes/${best.slug}`, `${AW}/anime/${best.slug}`);
        const eps = JSON.parse(epsRes);
        const ep1 = eps.find(e => e.episodeNumber == 1);
        if (ep1) {
          const sourcesRes = await testFetch(`${AW}/api/episode/sources/${ep1.id}`, `${AW}/anime/${best.slug}/episode-1`);
          const sources = JSON.parse(sourcesRes);
          report.aniwaves = {
            status: 'SUCCESS',
            title: best.name,
            servers: (sources.servers || []).map(s => ({ name: s.name, type: s.type }))
          };
        }
      }
    } catch (e) {
      report.aniwaves = { status: 'FAILED', error: e.message };
    }

    // 3. Test Animetsu Search + Stream
    try {
      const searchRes = await testFetch(`${ANIMETSU}/v2/api/anime/search?q=Chainsaw%20Man`, ANIMETSU);
      const items = JSON.parse(searchRes);
      if (items && items.length) {
        const best = items[0];
        const epsRes = await testFetch(`${ANIMETSU}/v2/api/anime/eps/${best.id}`, `${ANIMETSU}/watch/${best.id}`);
        const eps = JSON.parse(epsRes);
        const ep1 = eps.find(e => e.ep == 1);
        if (ep1) {
          const streamRes = await testFetch(`${ANIMETSU}/v2/api/anime/stream/${best.id}/${ep1.ep}`, `${ANIMETSU}/watch/${best.id}/${ep1.ep}`);
          const streams = JSON.parse(streamRes);
          report.animetsu = {
            status: 'SUCCESS',
            title: best.title,
            servers: streams.map(s => ({ name: s.name }))
          };
        }
      }
    } catch (e) {
      report.animetsu = { status: 'FAILED', error: e.message };
    }

    return report;
  });

  console.log('=== SCRAPER RUNTIME VERIFICATION RESULTS ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

run();
