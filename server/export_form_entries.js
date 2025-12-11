const fs = require('fs/promises');
const path = require('path');
const { fetchFormEntries } = require('./poller');

function parseOutPath() {
  const arg = process.argv.find((v) => v.startsWith('--out='));
  if (arg) return path.resolve(arg.slice('--out='.length));
  return path.join(__dirname, '..', 'data', 'form_entries.json');
}

async function main() {
  const outPath = parseOutPath();
  const entries = (await fetchFormEntries()) || [];
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    entries
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[scrape] wrote ${entries.length} entries to ${outPath}`);
}

main().catch((err) => {
  console.error('[scrape] failed', err);
  process.exitCode = 1;
});
