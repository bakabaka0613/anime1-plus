// 本機儲存封裝（Tampermonkey GM storage）。單一根物件，方便整包匯出/匯入。
/* global GM_getValue, GM_setValue, GM_deleteValue */

const ROOT_KEY = 'a1p:data';

const DEFAULT_SETTINGS = {
  autoNext: true, // 看完自動下一集
  autoNextThreshold: 0.9, // 看完判定比例
  resume: true, // 續播
  shortcuts: true, // 鍵盤快捷鍵
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

function saveRoot(root) {
  GM_setValue(ROOT_KEY, JSON.stringify(root));
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
