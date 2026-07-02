import { chromium } from 'playwright';
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 720 }
  });
  
  const page = await context.newPage();
  try {
    await page.goto('https://animepahe.pw/', { waitUntil: 'commit', timeout: 30000 });
    
    let cfFrame = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      cfFrame = page.frames().find(f => f.url().includes('challenges.cloudflare.com'));
      if (cfFrame) {
        const html = await cfFrame.content();
        if (html.includes('checkbox') || html.includes('success') || html.includes('challenge')) {
          console.log('Writing frame.html...');
          fs.writeFileSync('C:/Users/sahil/.gemini/antigravity-ide/brain/e59d2bad-4bb0-4c33-87d2-a69b8475b7cf/frame.html', html);
          break;
        }
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

run();
