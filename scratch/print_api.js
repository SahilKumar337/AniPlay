import axios from 'axios';

async function run() {
  const targetUrl = 'https://swiftstream.top/proxy/oppai/kite/DBpHAwAfHAY0FwsCH1cDHV4EQV4JUU1LTHdQXFMRTREQE1hWWloDTEsQJlAIUhQdQ0JMTh0cDxEdBxklFkEmHB4cHVkJQB8ZEQ';
  const proxyUrl = `http://localhost:4000/api/scrape?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent('https://animetsu.net/watch/6989b89f29cf95f4eb03b4ed')}`;
  
  try {
    const res = await axios.get(proxyUrl);
    console.log('API scrape length:', res.data.length);
  } catch (e) {
    console.error('Error:', e.message);
  }

  const segmentProxyUrl = `http://localhost:4000/api/stream/segment?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent('https://animetsu.net/watch/6989b89f29cf95f4eb03b4ed')}`;
  try {
    const res2 = await axios.get(segmentProxyUrl);
    console.log('Segment proxy length:', res2.data.length);
    console.log('Segment proxy start snippet:', res2.data.toString().slice(0, 100));
  } catch (e) {
    console.error('Error2:', e.message);
  }
}

run();
