// 進入點：依頁面類型分派，註冊油猴選單。
/* global GM_registerMenuCommand */
import {
  SEL,
  getPageType,
  postIdFromPath,
  getCategoryInfo,
  animeKeyFromCategoryPath,
  yearFromText,
  getContentH1,
  getCategoryId,
  getAnimeTitle,
} from './dom.js';
import { parseTitle } from './parse.js';
import { toSimplified } from './util.js';
import { initEpisodePage, initCategoryPlayback } from './progress.js';
import { resolveCover } from './cover.js';
import { initListPage } from './list.js';
import {
  injectStyles,
  markCategoryEpisodes,
  mountTrackingPanel,
  mountSidebarToggle,
  renderLastWatched,
  collapseToSinglePlayer,
  toast,
} from './ui.js';
import { exportAll, importAll, getSettings, setSettings, clearAnime } from './store.js';

let currentAnimeKey = null;

function initCategoryPage() {
  const path = decodeURIComponent(location.pathname);
  const catId = getCategoryId();
  const animeKey = catId ? `cat:${catId}` : animeKeyFromCategoryPath(location.pathname);
  currentAnimeKey = animeKey;
  const year = yearFromText(path);
  const firstAnchor = markCategoryEpisodes(animeKey);

  const h1 = getContentH1();
  const mountEl = h1 || firstAnchor;
  if (!mountEl) return;
  const animeName = getAnimeTitle();
  renderLastWatched(animeKey, mountEl);
  resolveCover({ animeKey, title: animeName, year, mountEl });
  // 折疊重複播放器：上方選集、下方單一播放器
  collapseToSinglePlayer(animeKey);
  // 使用者就在分類頁內嵌播放器看 → 在此記錄真實播放進度
  initCategoryPlayback(animeKey);

  // 隱藏原生分類標題（純動畫名）：插件資訊框已顯示名稱，避免重複又不美觀。
  // 封面卡是插在它前面的兄弟節點，隱藏它本身不影響卡片。
  const pageTitle = document.querySelector('.page-title');
  if (pageTitle) pageTitle.style.display = 'none';
}

function initEpisodePageRoute() {
  const cat = getCategoryInfo();
  const titleEl = document.querySelector(SEL.entryTitle);
  const parsed = parseTitle(titleEl ? titleEl.textContent : document.title);
  const catId = getCategoryId();
  const animeKey = catId ? `cat:${catId}` : cat ? cat.animeKey : `post:${postIdFromPath()}`;
  currentAnimeKey = animeKey;
  const year = cat ? cat.year : null;

  initEpisodePage({ animeKey, ep: parsed.ep, title: parsed.raw });
  if (cat && titleEl) resolveCover({ animeKey, title: cat.name, year, mountEl: titleEl });
}

// ---- 油猴選單：匯出 / 匯入 / 設定 ----
function downloadJson(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importViaFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importAll(String(reader.result), { merge: true });
        toast('匯入完成，重新整理後生效', { duration: 4000 });
      } catch (e) {
        toast(`匯入失敗：${e.message}`, { duration: 5000 });
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function registerMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return;
  GM_registerMenuCommand('匯出資料 (JSON)', () =>
    downloadJson(exportAll(), `anime1-plus-${new Date().toISOString().slice(0, 10)}.json`),
  );
  GM_registerMenuCommand('匯入資料 (JSON)', importViaFile);
  GM_registerMenuCommand(`⏩ 方向鍵快進秒數（目前 ${getSettings().seekSeconds || 5}s）`, () => {
    const cur = getSettings().seekSeconds || 5;
    const v = prompt('方向鍵快進/後退秒數（1–120）：', String(cur));
    if (v == null) return;
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 120) {
      setSettings({ seekSeconds: n });
      toast(`快進秒數已設為 ${n} 秒`, { duration: 2500 });
    } else {
      toast('請輸入 1–120 的數字', { duration: 2500 });
    }
  });
  const toggles = [
    ['autoNext', '看完自動下一集'],
    ['resume', '自動續播'],
    ['shortcuts', '鍵盤快捷鍵'],
    ['rememberRate', '記憶播放速度'],
  ];
  for (const [key, label] of toggles) {
    const on = getSettings()[key];
    GM_registerMenuCommand(`${on ? '✓' : '✗'} ${label}`, () => {
      setSettings({ [key]: !getSettings()[key] });
      toast(`${label}：${!on ? '開啟' : '關閉'}（選單下次開啟更新）`, { duration: 2500 });
    });
  }
  if (currentAnimeKey) {
    GM_registerMenuCommand('🗑 清除此動畫的觀看記錄', () => {
      clearAnime(currentAnimeKey);
      toast('已清除此動畫記錄，重新整理生效', { duration: 3000 });
    });
  }
  GM_registerMenuCommand('🧹 清除所有資料（重置）', () => {
    if (confirm('確定清除所有封面快取與觀看記錄？此動作無法復原。')) {
      importAll('{}', { merge: false });
      toast('已重置，重新整理生效', { duration: 3000 });
    }
  });
}

function main() {
  // 啟動自測：確認版本與 OpenCC 是否生效（「輪迴的花瓣」應轉成「轮回的花瓣」）
  try {
    const ver = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '?';
    console.log(`[anime1-plus] v${ver} opencc 自測 輪迴的花瓣 → ${toSimplified('輪迴的花瓣')}`);
  } catch (e) {
    console.warn('[anime1-plus] opencc 自測失敗', e);
  }
  injectStyles();
  mountTrackingPanel();
  mountSidebarToggle();

  const type = getPageType();
  if (type === 'category') initCategoryPage();
  else if (type === 'episode') initEpisodePageRoute();
  else if (type === 'list') {
    if (getSettings().listThumbs) initListPage();
  }

  registerMenu(); // 放最後：分派時已設定 currentAnimeKey，清除選單才能取到
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
