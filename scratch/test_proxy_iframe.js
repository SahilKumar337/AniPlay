import fetch from 'node-fetch';

const wavesUrl = 'http://localhost:4000/api/iframe-proxy?url=https%3A%2F%2Fplay.echovideo.ru%2Fembed-1%2FgaUep4zUW-MKxqQfat2XEy7pr4LhJOvk_hEMFwa-gYcGW479psnRqyofcid1sX7fciJ5smjhqH1S_ZTHecLg9rV7dk3X8HOEjRsHOL41fm2TIZntad-2Dx-dSW5ooTFlcdAgK41aiSNfz2-fCdKodv8_PaPBKi2zrseZgfX48sdlu9QVdwTIfCi8NrUmntxQ%3Fv%3D1%26asi%3D0%26autoPlay%3D0%26ao%3D0';

async function run() {
  console.log('Fetching proxy iframe page...');
  const res = await fetch(wavesUrl);
  console.log('Response Status:', res.status);
  const text = await res.text();
  console.log('Response length:', text.length);
  console.log('Content slice (first 500 chars):');
  console.log(text.slice(0, 500));
}

run().catch(console.error);
