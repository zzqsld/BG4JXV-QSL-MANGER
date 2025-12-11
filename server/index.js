const express = require('express');
const path = require('path');
const { readDb, writeDb, normalizeCallsign } = require('./db');
const {
  logInfo,
  logError,
  getLogConfig,
  setLogConfig,
  getLogFilePath,
  readLogFile
} = require('./logger');

const PORT = process.env.PORT || 4000;
const WEB_DIR = path.join(__dirname, '..', 'web');

const app = express();
app.use(express.json());

function generateCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

app.get('/api/status', async (_req, res) => {
  const db = await readDb();
  res.json(db.statuses);
});

app.post('/api/dispatch', async (req, res) => {
  const { callsign } = req.body || {};
  const normalized = normalizeCallsign(callsign);
  if (!normalized) return res.status(400).json({ error: 'callsign is required' });

  const db = await readDb();
  const now = new Date().toISOString();
  const nextRecord = {
    callsign: normalized,
    name: null,
    dispatchCode: generateCode(),
    sentAt: now,
    status: 'sent',
    warning: null
  };

  const existingIndex = db.statuses.findIndex((s) => s.callsign === normalized);
  if (existingIndex >= 0) {
    db.statuses[existingIndex] = { ...db.statuses[existingIndex], ...nextRecord };
  } else {
    db.statuses.push(nextRecord);
  }

  await writeDb(db);
  await logInfo(`dispatch created for ${normalized}, code=${nextRecord.dispatchCode}`);
  res.json(nextRecord);
});

app.post('/api/mark-received', async (req, res) => {
  const { callsign, receivedAt } = req.body || {};
  const normalized = normalizeCallsign(callsign);
  if (!normalized) return res.status(400).json({ error: 'callsign is required' });

  const db = await readDb();
  const existingIndex = db.statuses.findIndex((s) => s.callsign === normalized);
  if (existingIndex < 0) return res.status(404).json({ error: 'callsign not found' });

  const now = receivedAt || new Date().toISOString();
  db.statuses[existingIndex] = {
    ...db.statuses[existingIndex],
    status: 'received',
    receivedAt: now,
    warning: null
  };

  await writeDb(db);
  await logInfo(`manual mark-received ${normalized}`);
  res.json(db.statuses[existingIndex]);
});

app.post('/api/resolve-warning', async (req, res) => {
  const { callsign, action } = req.body || {};
  const normalized = normalizeCallsign(callsign);
  if (!normalized) return res.status(400).json({ error: 'callsign is required' });
  if (!['ignore', 'confirm'].includes(action)) return res.status(400).json({ error: 'action must be ignore or confirm' });

  const db = await readDb();
  const idx = db.statuses.findIndex((s) => s.callsign === normalized);
  if (idx < 0) return res.status(404).json({ error: 'callsign not found' });

  const record = db.statuses[idx];
  record.warning = null;
  if (action === 'confirm') {
    record.status = 'received';
    record.receivedAt = new Date().toISOString();
  }
  db.statuses[idx] = record;
  await writeDb(db);
  await logInfo(`resolve-warning ${action} for ${normalized}`);
  res.json(record);
});

app.get('/api/log-config', async (_req, res) => {
  const cfg = await getLogConfig();
  res.json(cfg);
});

app.post('/api/log-config', async (req, res) => {
  const { maxBytes } = req.body || {};
  const parsed = Number(maxBytes);
  if (!Number.isFinite(parsed) || parsed <= 1024) {
    return res.status(400).json({ error: 'maxBytes must be > 1024' });
  }
  await setLogConfig({ maxBytes: parsed });
  res.json({ maxBytes: parsed });
});

app.get('/api/logs', async (_req, res) => {
  try {
    const content = await readLogFile();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    await logError(`read logs failed: ${err.message}`);
    res.status(500).json({ error: 'read logs failed' });
  }
});

app.use(express.static(WEB_DIR));
app.get('*', (_req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[qsl] server listening on http://localhost:${PORT}`);
});
