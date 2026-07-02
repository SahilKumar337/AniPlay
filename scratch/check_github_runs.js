import fetch from 'node-fetch';

const url = 'https://api.github.com/repos/SahilKumar337/Anilab/actions/runs';

async function run() {
  console.log('Fetching GitHub Action runs...');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });
  console.log(`Status: ${res.status}`);
  const data = await res.json();
  if (data.workflow_runs && data.workflow_runs.length > 0) {
    const latest = data.workflow_runs[0];
    console.log(`Latest Run Details:`);
    console.log(`- ID: ${latest.id}`);
    console.log(`- Status: ${latest.status}`);
    console.log(`- Conclusion: ${latest.conclusion}`);
    console.log(`- Event: ${latest.event}`);
    console.log(`- HTML URL: ${latest.html_url}`);
  } else {
    console.log('No workflow runs found.');
  }
}

run().catch(console.error);
