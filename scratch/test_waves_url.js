import fetch from 'node-fetch';

const videoUrl = '/api/iframe-proxy?url=https%3A%2F%2Fplay.echovideo.ru%2Fembed-1%2FbTjJRib4OpTqOJLzGcS-48w9TL5b3MoD4qFVTPdP0ZuVmqEDPaX-wcj31eaKQlv0wAQGi1hn0ZDRs_E4-7NTK3vI9ZWTeYXyHzworvx5uSz24MVj_5AeIRi5V7yeCAleJDUUT54D0uLu4cXQKOk8N6GLKYEzSMYaReLidEdKDPmXMLtz8YWUf6QjoyjLCodrlSo2Xd5inyXsTA1PPcNkSA%3Fv%3D1%26asi%3D0%26autoPlay%3D0%26ao%3D0';
const url = `http://localhost:4000/api/stream-url?videoUrl=${encodeURIComponent(videoUrl)}`;

async function run() {
  console.log(`Querying: ${url}`);
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
