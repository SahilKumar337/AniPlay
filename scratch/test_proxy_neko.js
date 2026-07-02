import fetch from 'node-fetch';

const url = 'http://localhost:4000/api/anineko-servers?title=Wistoria:%20Wand%20and%20Sword%20Season%202&episode=1';

async function run() {
  console.log(`Querying proxy: ${url}`);
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
