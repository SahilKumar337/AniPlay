import fetch from 'node-fetch';

async function test() {
  console.log('Querying Consumet public API for AnimePahe search...');
  try {
    const searchRes = await fetch('https://api.consumet.org/anime/animepahe/Chainsaw%20Man');
    const searchData = await searchRes.json();
    console.log('Search Result:', JSON.stringify(searchData.results?.[0]));
    
    if (searchData.results?.[0]) {
      const id = searchData.results[0].id;
      console.log(`Fetching info for ID: ${id}...`);
      const infoRes = await fetch(`https://api.consumet.org/anime/animepahe/info/${id}`);
      const infoData = await infoRes.json();
      console.log(`Episodes found: ${infoData.episodes?.length}`);
      
      if (infoData.episodes?.[0]) {
        const epId = infoData.episodes[0].id;
        console.log(`Fetching streams for episode ID: ${epId}...`);
        const watchRes = await fetch(`https://api.consumet.org/anime/animepahe/watch/${epId}`);
        const watchData = await watchRes.json();
        console.log('Watch Data:', JSON.stringify(watchData));
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
