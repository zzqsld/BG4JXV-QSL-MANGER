const fs = require('fs/promises');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'data', 'qsl.log');
const LOG_CFG_PATH = path.join(__dirname, '..', 'data', 'log_config.json');
const DEFAULT_MAX = 4 * 1024 * 1024; // 4MB

async function readLogConfig() {
  try {
    const raw = await fs.readFile(LOG_CFG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.maxBytes || !Number.isFinite(parsed.maxBytes)) throw new Error('bad cfg');
    return { maxBytes: parsed.maxBytes };
  } catch (err) {
    return { maxBytes: DEFAULT_MAX };
  }
}

let cachedConfig = null;
async function getLogConfig() {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await readLogConfig();
  return cachedConfig;
}

async function setLogConfig(cfg) {
  const next = { maxBytes: cfg.maxBytes || DEFAULT_MAX };
  cachedConfig = next;
  await fs.writeFile(LOG_CFG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function ensureSizeLimit(extraBytes = 0) {
  const cfg = await getLogConfig();
  try {
    const stat = await fs.stat(LOG_PATH);
    if (stat.size + extraBytes <= cfg.maxBytes) return;
    const raw = await fs.readFile(LOG_PATH, 'utf8');
    const keepBytes = cfg.maxBytes - extraBytes;
    const sliced = raw.slice(Math.max(0, raw.length - keepBytes));
    await fs.writeFile(LOG_PATH, sliced, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
}

async function append(level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
  await ensureSizeLimit(Buffer.byteLength(line, 'utf8'));
  await fs.appendFile(LOG_PATH, line, 'utf8');
}

async function logInfo(msg) {
  return append('INFO', msg);
}

async function logError(msg) {
  return append('ERROR', msg);
}

async function readLogFile() {
  try {
    return await fs.readFile(LOG_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

module.exports = {
  LOG_PATH,
  getLogConfig,
  setLogConfig,
  logInfo,
  logError,
  readLogFile
};
