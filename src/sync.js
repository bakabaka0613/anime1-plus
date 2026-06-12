// 多端追番進度同步：用一個私有 GitHub Gist 當存放點，透過 GM_xmlhttpRequest 讀寫 api.github.com
// （特權環境，繞過 HTTPS 頁面對 LAN/跨域的 mixed-content/CORS 限制）。只同步 watch + meta。
/* global GM_xmlhttpRequest */
import { getSyncConfig, setSyncConfig, getSyncSubset, applySyncedData, onDataChange } from './store.js';
import { toast } from './ui.js';

const GIST_FILENAME = 'anime1-plus-sync.json';
const GIST_DESC = 'anime1-plus 追番進度同步（請勿手動編輯）';
const PUSH_DEBOUNCE = 4000; // 連續觀看寫入合併成一次上傳

// ---- 網路層：Promise 化的 GM_xmlhttpRequest（仿 bangumi.js gmFetch）----
function gmGist({ method, path, token, body }) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url: `https://api.github.com${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      data: body ? JSON.stringify(body) : undefined,
      timeout: 20000,
      onload: (res) => resolve(res),
      onerror: () => reject(new Error('網路錯誤')),
      ontimeout: () => reject(new Error('逾時')),
    });
  });
}

function parseOrThrow(res, ctx) {
  if (res.status < 200 || res.status >= 300) {
    let msg = `${ctx} HTTP ${res.status}`;
    try {
      const j = JSON.parse(res.responseText);
      if (j && j.message) msg += `（${j.message}）`;
    } catch {
      /* 非 JSON 錯誤體，忽略 */
    }
    throw new Error(msg);
  }
  return JSON.parse(res.responseText);
}

// 建立私有 gist，回傳 id
export async function createGist(token) {
  const res = await gmGist({
    method: 'POST',
    path: '/gists',
    token,
    body: {
      description: GIST_DESC,
      public: false,
      files: { [GIST_FILENAME]: { content: '{"_v":1,"watch":{},"meta":{}}' } },
    },
  });
  return parseOrThrow(res, '建立 gist').id;
}

// 找既有的同步 gist（多端用同一 token 設定時，避免各自再建一個）。回傳 id 或 null。
export async function findExistingGist(token) {
  const res = await gmGist({ method: 'GET', path: '/gists?per_page=100', token });
  const list = parseOrThrow(res, '列出 gist');
  const hit = Array.isArray(list) ? list.find((g) => g.files && g.files[GIST_FILENAME]) : null;
  return hit ? hit.id : null;
}

// 舊 gistId 是否仍可被這個 token 讀到。
// true=可讀；false=404（不存在或此 token 無權限）；其他狀態（401/403/5xx）丟出帶 message 的錯，
// 讓呼叫端往外傳而不要誤判成「沒有 gist」去重建一份（會產生重複、且接不回原資料）。
export async function gistReachable(token, gistId) {
  const res = await gmGist({ method: 'GET', path: `/gists/${gistId}`, token });
  if (res.status >= 200 && res.status < 300) return true;
  if (res.status === 404) return false;
  parseOrThrow(res, '讀取 gist'); // 必拋（非 2xx 非 404）
}

// 解析出要用的 gistId：優先沿用舊的（驗證可讀），舊的 404 才重新找既有同名 gist 或新建。
// deps 可注入以利測試。對應 bug：刪 token 後重貼，盲信舊 gistId → 讀取 gist HTTP 404 卡死。
export async function resolveGistId(token, existingId, deps = {}) {
  const { reachable = gistReachable, find = findExistingGist, create = createGist } = deps;
  if (existingId && (await reachable(token, existingId))) return existingId;
  return (await find(token)) || (await create(token));
}

// 讀遠端 → { watch, meta }
export async function pullGist(token, gistId) {
  const res = await gmGist({ method: 'GET', path: `/gists/${gistId}`, token });
  const gist = parseOrThrow(res, '讀取 gist');
  const file = gist.files && gist.files[GIST_FILENAME];
  if (!file || !file.content) return { watch: {}, meta: {} };
  if (file.truncated) throw new Error('同步資料過大（>1MB），暫不支援');
  const obj = JSON.parse(file.content);
  return { watch: obj.watch || {}, meta: obj.meta || {} };
}

// 寫遠端（整檔覆蓋成合併後的子集）
export async function pushGist(token, gistId, subset) {
  const content = JSON.stringify({ _v: 1, watch: subset.watch || {}, meta: subset.meta || {} });
  const res = await gmGist({
    method: 'PATCH',
    path: `/gists/${gistId}`,
    token,
    body: { files: { [GIST_FILENAME]: { content } } },
  });
  parseOrThrow(res, '寫入 gist');
}

// ---- 編排 ----
let syncing = false;
let pushTimer = null;

// pull → 逐集合併進本機 → 若與遠端不同則 push 回去（pull-merge-push，對單人低並發 race-safe）。
export async function syncNow({ silent = false } = {}) {
  const cfg = getSyncConfig();
  if (!cfg.enabled || !cfg.token || !cfg.gistId) return { ok: false, reason: 'not-configured' };
  if (syncing) return { ok: false, reason: 'busy' };
  syncing = true;
  try {
    const remote = await pullGist(cfg.token, cfg.gistId);
    const { changed } = applySyncedData(remote); // 合併期間的 saveRoot 會觸發 changeListener，但 syncing=true 時 schedulePush 會跳過
    const subset = getSyncSubset();
    const remoteStr = JSON.stringify({ watch: remote.watch || {}, meta: remote.meta || {} });
    const localStr = JSON.stringify({ watch: subset.watch || {}, meta: subset.meta || {} });
    if (localStr !== remoteStr) await pushGist(cfg.token, cfg.gistId, subset); // 合併後若有新增才寫回
    setSyncConfig({ lastSyncAt: Date.now(), lastError: '' });
    if (changed && !silent) toast('已同步追番進度，部分頁面重新整理後更新', { duration: 3500 });
    return { ok: true, changed };
  } catch (e) {
    setSyncConfig({ lastError: e.message });
    if (!silent) toast(`同步失敗：${e.message}`, { duration: 5000 });
    return { ok: false, reason: e.message };
  } finally {
    syncing = false;
  }
}

// 本機 watch/meta 變動後，debounce 觸發一次同步上傳
export function schedulePush() {
  if (syncing) return; // 同步自身寫入觸發的，不重排，避免回授迴圈
  const cfg = getSyncConfig();
  if (!cfg.enabled || !cfg.token || !cfg.gistId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    syncNow({ silent: true });
  }, PUSH_DEBOUNCE);
}

// 啟動：訂閱資料變動；已設定則先拉一次。
export function initSync() {
  onDataChange(schedulePush);
  const cfg = getSyncConfig();
  if (cfg.enabled && cfg.token && cfg.gistId) syncNow({ silent: true });
}

// 選單：貼 token → （無 gistId 則找既有或新建）→ 啟用並首次同步。
export async function configureSync() {
  const cfg = getSyncConfig();
  const input = prompt(
    '貼上 GitHub Personal Access Token\n（fine-grained，只需勾選 Gist 讀寫權限）。\n留空並確定＝刪除 token 並停用同步：',
    cfg.token || '',
  );
  if (input === null) return; // 取消（沒按確定）→ 不動作
  const token = input.trim();
  if (!token) {
    // 清空並確定 → 刪除 token 並停用同步（保留 gistId，方便日後重新貼 token 即接回同一份）
    setSyncConfig({ token: '', enabled: false });
    toast('已刪除 token 並停用多端同步', { duration: 3000 });
    return;
  }
  setSyncConfig({ token });
  toast('正在設定同步…', { duration: 2000 });
  try {
    // 不盲信舊 gistId：驗證可讀，404（已刪/換帳號）才重新解析，避免卡在讀取 gist HTTP 404。
    const gistId = await resolveGistId(token, cfg.gistId);
    setSyncConfig({ gistId, enabled: true, lastError: '' });
    const r = await syncNow({ silent: true });
    if (r.ok) toast('同步已啟用並完成首次同步 ✓', { duration: 3500 });
    else toast(`同步已設定，但首次同步失敗：${r.reason}`, { duration: 5000 });
  } catch (e) {
    setSyncConfig({ lastError: e.message });
    toast(`設定同步失敗：${e.message}`, { duration: 5000 });
  }
}
