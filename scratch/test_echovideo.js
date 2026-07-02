import fetch from 'node-fetch';

const url = 'https://play.echovideo.ru/embed-1/gaUep4zUW-MKxqQfat2XEy7pr4LhJOvk_hEMFwa-gYcGW479psnRqyofcid1sX7fciJ5smjhqH1S_ZTHecLg9rf0UoVMRb8mJAKza40bewM9ohp-bFPilwXrPrG1qBR7JVZ_ImbTyh0jBlqEP4MuMYn5LS3Z6e--DXGmI_PbfDbZpQJKLjiGL80zbOEjnNMu?v=1&asi=0&autoPlay=0&ao=0';

async function test() {
  console.log('Testing with Referer: https://aniwaves.ru/');
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://aniwaves.ru/',
      'Origin': 'https://aniwaves.ru'
    }
  });
  console.log('Status:', r.status);
  const text = await r.text();
  console.log('Content length:', text.length);
  console.log('Content slice:', text.slice(0, 500));
}

test().catch(console.error);
