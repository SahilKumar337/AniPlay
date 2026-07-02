import fetch from 'node-fetch';

const domain = 'https://anineko.to';
const url = `${domain}/watch/wistoria-wand-and-sword-season-2/ep-1`;

async function run() {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': domain
    }
  });
  const html = await res.text();
  
  const panelsRe = /<div[^>]+data-id="(sub|dub)"[\s\S]*?<\/div>\s*<\/div>/g;
  let pMatch;
  console.log(`Checking panels for ${url}:`);
  while ((pMatch = panelsRe.exec(html)) !== null) {
    const panelId = pMatch[1];
    console.log(`Found panel data-id="${panelId}"`);
    
    const btnRe = /<button class="nv-server-btn server-video server[^"]*"[^>]*data-video="([^"]+)"[^>]*>([\s\S]+?)<\/button>/g;
    let m;
    while ((m = btnRe.exec(pMatch[0])) !== null) {
      const videoUrl = m[1];
      const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`  - Button: "${name}"`);
    }
  }
}

run().catch(console.error);
