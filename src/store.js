// 本機儲存封裝（Tampermonkey GM storage）。單一根物件，方便整包匯出/匯入。
/* global GM_getValue, GM_setValue, GM_deleteValue */
import { mergeSync } from './util.js';

const ROOT_KEY = 'a1p:data';
// 同步設定（token / gistId 等）獨立存放，刻意不放進 ROOT_KEY，
// 這樣 exportAll() 匯出的 JSON 天然不含 token，貼給別人也不會外洩。
const SYNC_KEY = 'a1p:sync';

const DEFAULT_SETTINGS = {
  autoNext: true, // 看完自動下一集
  autoNextThreshold: 0.9, // 看完判定比例
  resume: true, // 續播
  shortcuts: true, // 鍵盤快捷鍵
  seekSeconds: 5, // 方向鍵快進/後退秒數
  rememberRate: true, // 記憶播放速度
  listThumbs: true, // 列表頁增強（封面/卡片）
  gridView: true, // 列表頁卡片檢視（false = 原始列表）
  cardWidth: 250, // 卡片最小寬度 px
  sidebarOpen: false, // 右側欄展開（預設折疊）
};

function loadRoot() {
  try {
    const raw = GM_getValue(ROOT_KEY, '');
    const obj = raw ? JSON.parse(raw) : {};
    return {
      covers: obj.covers || {}, // { [catId]: { subjectId, cover, name, name_cn, score, manual, ts } }
      watch: obj.watch || {}, // { [catId]: { [ep]: { currentTime, duration, done, watchedAt } } }
      meta: obj.meta || {}, // { [catId]: { title, maxEpSeen } }
      settings: { ...DEFAULT_SETTINGS, ...(obj.settings || {}) },
    };
  } catch {
    return { covers: {}, watch: {}, meta: {}, settings: { ...DEFAULT_SETTINGS } };
  }
}

// 資料變動監聽（單一監聽器）：讓 sync 模組訂閱寫入而不必被 store import（避免循環依賴）。
let changeListener = null;
export function onDataChange(fn) {
  changeListener = fn;
}

function saveRoot(root) {
  GM_setValue(ROOT_KEY, JSON.stringify(root));
  if (changeListener) {
    try {
      changeListener();
    } catch {
      /* 監聽器錯誤不可影響儲存 */
    }
  }
}

// ---- 封面 ----
export function getCover(catId) {
  return loadRoot().covers[catId] || null;
}
export function setCover(catId, data) {
  const root = loadRoot();
  root.covers[catId] = { ...data, ts: Date.now() };
  saveRoot(root);
}

// ---- 觀看記錄 ----
export function getAnimeWatch(catId) {
  return loadRoot().watch[catId] || {};
}
export function getEpisode(catId, ep) {
  return (loadRoot().watch[catId] || {})[ep] || null;
}
export function setEpisodeProgress(catId, ep, data) {
  const root = loadRoot();
  root.watch[catId] = root.watch[catId] || {};
  const prev = root.watch[catId][ep] || {};
  root.watch[catId][ep] = { ...prev, ...data, watchedAt: Date.now() };
  saveRoot(root);
}

// ---- meta（標題、看過的最大集數，供新番提醒）----
export function setMeta(catId, data) {
  const root = loadRoot();
  root.meta[catId] = { ...(root.meta[catId] || {}), ...data };
  saveRoot(root);
}
export function getMeta(catId) {
  return loadRoot().meta[catId] || null;
}

// 所有有進度但未看完的動畫（追番面板用）
export function getInProgressList() {
  const root = loadRoot();
  const out = [];
  for (const catId of Object.keys(root.watch)) {
    const eps = root.watch[catId];
    const epNums = Object.keys(eps);
    const anyUnfinished = epNums.some((e) => !eps[e].done);
    const lastWatched = Math.max(...epNums.map((e) => eps[e].watchedAt || 0));
    out.push({
      catId,
      cover: root.covers[catId] || null,
      meta: root.meta[catId] || null,
      episodes: eps,
      anyUnfinished,
      lastWatched,
    });
  }
  return out.sort((a, b) => b.lastWatched - a.lastWatched);
}

// ---- 設定 ----
export function getSettings() {
  return loadRoot().settings;
}
export function setSettings(patch) {
  const root = loadRoot();
  root.settings = { ...root.settings, ...patch };
  saveRoot(root);
}

// ---- 維護 ----
export function clearAnime(catId) {
  const root = loadRoot();
  delete root.covers[catId];
  delete root.watch[catId];
  delete root.meta[catId];
  saveRoot(root);
}

// 只清除單一動畫的觀看/追番資料（watch + meta），保留封面快取（cover）
export function clearAnimeWatch(catId) {
  const root = loadRoot();
  delete root.watch[catId];
  delete root.meta[catId];
  saveRoot(root);
}

// 清除指定動畫的封面快取（保留其觀看/追番資料）
export function clearCover(catId) {
  const root = loadRoot();
  delete root.covers[catId];
  saveRoot(root);
}

// 清除所有封面快取（保留觀看/追番與設定）
export function clearCovers() {
  const root = loadRoot();
  root.covers = {};
  saveRoot(root);
}

// 清除所有追番記錄：觀看進度（watch）＋追番輔助資料（meta）。封面與設定保留。
export function clearWatch() {
  const root = loadRoot();
  root.watch = {};
  root.meta = {};
  saveRoot(root);
}

// 還原所有設定為預設值（不動封面/觀看資料）
export function clearSettings() {
  const root = loadRoot();
  root.settings = { ...DEFAULT_SETTINGS };
  saveRoot(root);
}

// 完全重置：封面＋觀看＋追番＋設定全清
export function clearAll() {
  saveRoot({ covers: {}, watch: {}, meta: {}, settings: { ...DEFAULT_SETTINGS } });
}

export function exportAll() {
  return JSON.stringify(loadRoot(), null, 2);
}

export function importAll(jsonText, { merge = true } = {}) {
  const incoming = JSON.parse(jsonText);
  if (!merge) {
    saveRoot({
      covers: incoming.covers || {},
      watch: incoming.watch || {},
      meta: incoming.meta || {},
      settings: { ...DEFAULT_SETTINGS, ...(incoming.settings || {}) },
    });
    return;
  }
  const root = loadRoot();
  saveRoot({
    covers: { ...root.covers, ...(incoming.covers || {}) },
    watch: { ...root.watch, ...(incoming.watch || {}) },
    meta: { ...root.meta, ...(incoming.meta || {}) },
    settings: { ...root.settings, ...(incoming.settings || {}) },
  });
}

// ---- 多端同步（GitHub Gist）----
const DEFAULT_SYNC = { token: '', gistId: '', enabled: false, lastSyncAt: 0, lastError: '' };

export function getSyncConfig() {
  try {
    const raw = GM_getValue(SYNC_KEY, '');
    return { ...DEFAULT_SYNC, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SYNC };
  }
}
export function setSyncConfig(patch) {
  const next = { ...getSyncConfig(), ...patch };
  GM_setValue(SYNC_KEY, JSON.stringify(next));
  return next;
}

// 要上傳同步的子集：只同步觀看進度（watch）與追番輔助（meta），不含封面與裝置設定。
export function getSyncSubset() {
  const root = loadRoot();
  return { watch: root.watch, meta: root.meta };
}

// 把遠端同步資料併入本機（逐集 watchedAt 合併）。回傳 { changed } 供決定是否重繪/再上傳。
export function applySyncedData(incoming) {
  const root = loadRoot();
  const before = JSON.stringify({ watch: root.watch, meta: root.meta });
  const merged = mergeSync({ watch: root.watch, meta: root.meta }, incoming || {});
  const after = JSON.stringify(merged);
  if (after === before) return { changed: false };
  root.watch = merged.watch;
  root.meta = merged.meta;
  saveRoot(root);
  return { changed: true };
}
