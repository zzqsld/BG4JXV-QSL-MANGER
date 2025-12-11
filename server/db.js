const fs = require('fs/promises');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'state.json');
const DEFAULT_STATE = { statuses: [], formCursor: null };

async function readDb() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.statuses) parsed.statuses = [];
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE };
    throw err;
  }
}

async function writeDb(db) {
  const next = { ...DEFAULT_STATE, ...db };
  await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeCallsign(value) {
  return (value || '').trim().toUpperCase();
}

module.exports = {
  DATA_PATH,
  DEFAULT_STATE,
  normalizeCallsign,
  readDb,
  writeDb
};
