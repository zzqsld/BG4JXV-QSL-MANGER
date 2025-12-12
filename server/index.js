const express = require('express');
const path = require('path');
const https = require('https');
const fetch = require('node-fetch');
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
const GITHUB_OWNER = process.env.SERVER_GITHUB_OWNER || 'zzqsld';
const GITHUB_REPO = process.env.SERVER_GITHUB_REPO || 'BG4JXV-QSL-MANGER';
const GITHUB_WORKFLOW = process.env.SERVER_GITHUB_WORKFLOW || 'forms-scrape.yml';
const GITHUB_REF = process.env.SERVER_GITHUB_REF || 'main';
const GITHUB_TOKEN = process.env.SERVER_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const GITHUB_INSECURE = process.env.SERVER_INSECURE_TLS === '1';

if (GITHUB_INSECURE) {
  // 本地无证书时，允许 GitHub 调用跳过证书校验（仅限受信环境）。
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = express();
app.use(express.json());

const { syncFromForms } = require('./poller');

let refreshing = false;

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

async function triggerGithubWorkflow() {
  if (!GITHUB_TOKEN) {
    await logInfo('[refresh] skip workflow dispatch: no token');
    return { skipped: true, reason: 'no token' };
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;
  const agent = GITHUB_INSECURE ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'qsl-refresh',
      Authorization: `Bearer ${GITHUB_TOKEN}`
    },
    body: JSON.stringify({ ref: GITHUB_REF }),
    agent
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`workflow dispatch failed ${res.status} ${text.slice(0, 160)}`);
  }

  return { skipped: false, workflow: GITHUB_WORKFLOW, ref: GITHUB_REF };
}

app.post('/api/refresh', async (_req, res) => {
  if (refreshing) return res.status(429).json({ error: 'refresh already running' });
  refreshing = true;
  const startedAt = new Date().toISOString();

  try {
    const dispatchResult = await triggerGithubWorkflow();
    const syncResult = await syncFromForms();
    await logInfo(`[refresh] done dispatch skipped=${dispatchResult.skipped} synced=${JSON.stringify(syncResult)}`);
    res.json({ ok: true, startedAt, dispatch: dispatchResult, sync: syncResult });
  } catch (err) {
    await logError(`[refresh] failed ${err.message}`);
    res.status(500).json({ error: err.message || 'refresh failed' });
  } finally {
    refreshing = false;
  }
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
