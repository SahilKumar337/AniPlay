import { chromium } from 'playwright';

const embedUrl = 'https://play.echovideo.ru/embed-1/gaUep4zUW-MKxqQfat2XEy7pr4LhJOvk_hEMFwa-gYcGW479psnRqyofcid1sX7fV8gskZBDRhADZSKl6zk0-uLEbtKShCE7bX9AXgOJDjyWa_xe3VHzpt-pjyn3iJcULNfb0wzffjDCHJjqV7kuhSbgcW35SQcvzUkCr9O2mi4ar0sBq1E36C4yxV2SyXG8?v=1&asi=0&autoPlay=0&ao=0';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Intercept requests to find .m3u8
  page.on('request', request => {
    const url = request.url();
    if (url.includes('.m3u8')) {
      console.log(`[Captured M3U8] ${url}`);
    } else if (url.includes('.ts') || url.includes('segment')) {
      console.log(`[Captured TS Segment] ${url.slice(0, 150)}`);
    }
  });

  console.log(`Navigating to embed page: ${embedUrl}`);
  try {
    await page.goto(embedUrl, {
      referer: 'https://aniwaves.ru/',
      timeout: 30000
    });
    console.log('Page loaded. Waiting for video requests...');
    await page.waitForTimeout(10000);
  } catch (e) {
    console.log(`Navigation error: ${e.message}`);
  }

  await browser.close();
}

run().catch(console.error);
