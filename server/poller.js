const fs = require('fs/promises');
const path = require('path');
const fetch = require('node-fetch');
const { normalizeCallsign, readDb, writeDb } = require('./db');
const { logInfo, logError } = require('./logger');

const FORM_MOCK_PATH = path.join(__dirname, '..', 'data', 'mock_form_entries.json');

const { ANALYSIS_PAGE_URL, RELEASE_JSON_URL } = process.env;
// 硬编码的 GitHub Release tag，用于默认拉取
const HARD_RELEASE_OWNER = 'zzqsld';
const HARD_RELEASE_REPO = 'BG4JXV-QSL-MANGER';
const HARD_RELEASE_TAG = 'data-latest';

async function fetchWithRetry(url, attempts = 3, options = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', ...options });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
      }
      const buf = await res.arrayBuffer();
      return buf;
    } catch (err) {
      lastErr = err;
      await logError(`[poller] fetch retry ${i + 1}/${attempts} failed for ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

function extractLatestAnswers(html, questionText, limit = 3) {
  const answers = [];
  const idx = html.indexOf(questionText);
  if (idx !== -1) {
    const slice = html.slice(idx, idx + 1600); // primary window near question
    const m = slice.match(/[\"“”']([^\"”'<]{1,80})[\"“”']/g) || [];
    for (const raw of m) {
      const val = raw.replace(/[\"“”']/g, '').trim();
      if (val) answers.push(val);
      if (answers.length >= limit) break;
    }
  }

  // Fallback: look for "最新回复" segment near the question
  if (answers.length < limit) {
    const blockRe = new RegExp(`${questionText}[\s\S]{0,1000}?最新回复[\s\S]{0,600}`, 'i');
    const blockMatch = html.match(blockRe);
    if (blockMatch) {
      const block = blockMatch[0];
      const m2 = block.match(/[\"“”']([^\"”'<]{1,80})[\"“”']/g) || [];
      for (const raw of m2) {
        const val = raw.replace(/[\"“”']/g, '').trim();
        if (val && !answers.includes(val)) answers.push(val);
        if (answers.length >= limit) break;
      }
    }
  }

  // Fallback 2: capture bare alnum tokens near question text
  if (answers.length < limit) {
    const block = html.slice(Math.max(0, idx - 200), idx + 1200);
    const tokenRe = /([A-Z0-9]{2,16})/g;
    let m;
    while ((m = tokenRe.exec(block)) && answers.length < limit) {
      const val = m[1];
      if (val && !answers.includes(val)) answers.push(val);
    }
  }

  return answers.slice(0, limit);
}

async function fetchFormEntriesFromAnalysisPage() {
  if (!ANALYSIS_PAGE_URL) return null;
  const htmlBuf = await fetchWithRetry(ANALYSIS_PAGE_URL, 3, { headers: { Accept: 'text/html' } });
  const html = Buffer.from(htmlBuf).toString('utf8');

  const calls = extractLatestAnswers(html, '请问您的呼号');
  const codes = extractLatestAnswers(html, '请输入签收码');
  const names = extractLatestAnswers(html, '请问您的卡片类型');

  // 采用“最新在前”的顺序，以呼号和签收码的最短长度为准，避免错位
  const pairLen = Math.min(calls.length || 0, codes.length || 0);
  const size = pairLen > 0 ? pairLen : Math.max(calls.length, codes.length, names.length);
  const entries = [];
  for (let i = 0; i < size; i++) {
    entries.push({
      name: names[i] || '',
      callsign: calls[i] || '',
      password: codes[i] || '',
      // 用递减偏移保证同批次顺序稳定，最新在前
      submittedAt: new Date(Date.now() - i * 1000).toISOString()
    });
  }

  const callRe = /^[A-Z0-9]{2,10}$/i;
  const codeRe = /^\d{3,10}$/;
  const filtered = entries.filter((e) => callRe.test(String(e.callsign || '').trim()) && codeRe.test(String(e.password || '').trim()));

  await logInfo(`[poller] analysis entries ${JSON.stringify(entries)} | filtered ${JSON.stringify(filtered)}`);

  return filtered;

}

async function fetchFormEntriesFromRelease() {
  if (!RELEASE_JSON_URL) return null;

  let text;
  // 支持 HTTP(S) 以及本地文件路径（便于调试）
  const isHttp = /^https?:\/\//i.test(RELEASE_JSON_URL);
  if (isHttp) {
    const buf = await fetchWithRetry(RELEASE_JSON_URL, 3, { headers: { Accept: 'application/json,text/plain' } });
    text = Buffer.from(buf).toString('utf8');
  } else {
    const abs = path.isAbsolute(RELEASE_JSON_URL)
      ? RELEASE_JSON_URL
      : path.resolve(__dirname, RELEASE_JSON_URL);
    text = await fs.readFile(abs, 'utf8');
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    await logError(`[poller] release json parse failed: ${err.message}`);
    return [];
  }

  // 支持两种结构：{entries: [...]} 或直接是数组
  const entries = Array.isArray(payload) ? payload : Array.isArray(payload.entries) ? payload.entries : [];
  await logInfo(`[poller] release entries count=${entries.length}`);
  return entries;
}

async function fetchFormEntriesFromHardcodedReleaseTag() {
  try {
    const apiUrl = `https://api.github.com/repos/${HARD_RELEASE_OWNER}/${HARD_RELEASE_REPO}/releases/tags/${HARD_RELEASE_TAG}`;
    const metaBuf = await fetchWithRetry(apiUrl, 3, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'qsl-poller'
      }
    });
    const meta = JSON.parse(Buffer.from(metaBuf).toString('utf8'));
    if (!meta || !Array.isArray(meta.assets)) return [];
    const asset = meta.assets.find((a) => a && a.name === 'form_entries.json');
    if (!asset || !asset.browser_download_url) return [];
    const dataBuf = await fetchWithRetry(asset.browser_download_url, 3, {
      headers: { Accept: 'application/json,text/plain', 'User-Agent': 'qsl-poller' }
    });
    const text = Buffer.from(dataBuf).toString('utf8');
    const payload = JSON.parse(text);
    const entries = Array.isArray(payload) ? payload : Array.isArray(payload.entries) ? payload.entries : [];
    await logInfo(`[poller] hardcoded release entries count=${entries.length}`);
    return entries;
  } catch (err) {
    await logError(`[poller] hardcoded release fetch failed: ${err.message}`);
    return [];
  }
}

async function fetchFormEntriesFromMock() {
  try {
    const raw = await fs.readFile(FORM_MOCK_PATH, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function fetchFormEntries() {
  if (RELEASE_JSON_URL) return fetchFormEntriesFromRelease();
  // 无环境变量时，尝试硬编码的 release tag
  const hard = await fetchFormEntriesFromHardcodedReleaseTag();
  if (hard && hard.length) return hard;
  if (ANALYSIS_PAGE_URL) return fetchFormEntriesFromAnalysisPage();
  return fetchFormEntriesFromMock();
}

async function syncFromForms() {
  const db = await readDb();
  // 分析页无可靠时间戳，这里不使用游标过滤，避免漏掉最新三条（游标仍更新以记录最近处理时间）
  // release 模式与分析页一样不可信时间戳，统一绕过游标
  const useAnalysis = !!ANALYSIS_PAGE_URL || !!RELEASE_JSON_URL;
  const cursor = useAnalysis ? 0 : db.formCursor ? new Date(db.formCursor).getTime() : 0;
  const entries = await fetchFormEntries();

  if (!entries || entries.length === 0) {
    await logInfo('[poller] no entries fetched');
  }

  let updated = false;
  let newest = cursor;

  for (const entry of entries) {
    const callsign = normalizeCallsign(entry.callsign);
    const submittedAt = entry.submittedAt ? new Date(entry.submittedAt).getTime() : Date.now();
    if (!callsign) continue;
    if (submittedAt <= cursor) continue; // already processed

    newest = Math.max(newest, submittedAt);
    const match = db.statuses.find((s) => s.callsign === callsign);
    if (!match) continue;

    if (entry.password) {
      const passOk = match.dispatchCode && String(match.dispatchCode) === String(entry.password);
      if (!passOk) {
        match.warning = {
          type: 'code-mismatch',
          code: entry.password,
          at: new Date(submittedAt).toISOString()
        };
        updated = true;
        continue; // do not mark received yet
      }
    }

    if (match.status !== 'received') {
      match.status = 'received';
      match.receivedAt = new Date(submittedAt).toISOString();
      match.formName = entry.name || null;
      match.warning = null;
      updated = true;
    }
  }

  if (newest > cursor) {
    db.formCursor = new Date(newest).toISOString();
    updated = true;
  }

  if (updated) await writeDb(db);
  if (updated) await logInfo('[poller] db updated');
  return { updated, processedAt: new Date().toISOString() };
}

async function main() {
  try {
    const result = await syncFromForms();
    console.log('[qsl] sync result', result);
    await logInfo(`[poller] sync result ${JSON.stringify(result)}`);
  } catch (err) {
    console.error('[qsl] sync failed', err);
    await logError(`[poller] sync failed ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  syncFromForms,
  fetchFormEntries
};
