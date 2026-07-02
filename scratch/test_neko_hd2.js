import fetch from 'node-fetch';

const title = 'That Time I Got Reincarnated as a Slime Season 4';
const ep = 1;

async function run() {
  console.log(`Resolving Neko HD2 for ${title} Ep ${ep}...`);
  try {
    const res = await fetch(`http://localhost:4000/api/anineko-servers?title=${encodeURIComponent(title)}&episode=${ep}`);
    const data = await res.json();
    console.log('Servers payload:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
