import fetch from 'node-fetch';

const url = 'http://localhost:4000/api/stream/hls?url=https%3A%2F%2Fvivibebe.site%2Fpublic%2Fstream%2Fe7433c856e10e9b0%2Fmaster.m3u8&referer=https%3A%2F%2Fvivibebe.site';

async function run() {
  console.log(`Fetching m3u8: ${url}`);
  const start = Date.now();
  const res = await fetch(url);
  console.log(`Status: ${res.status} in ${Date.now() - start}ms`);
  const text = await res.text();
  console.log(text.slice(0, 500));
}

run().catch(console.error);
