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
import { initEpisodePage, initCategoryPlayback } from './progress.js';
import { resolveCover, recheckTentativeCovers, setCoverUpgradeHook } from './cover.js';
import { initListPage, viewportCatOrder, repaintCard } from './list.js';
import {
  injectStyles,
  markCategoryEpisodes,
  mountTrackingPanel,
  mountSidebarToggle,
  renderLastWatched,
  collapseToSinglePlayer,
  enhanceEpisodeNav,
  toast,
} from './ui.js';
import { exportAll, importAll, getSettings, setSettings, getSyncConfig, setSyncConfig, clearAnime, clearCover, clearCovers, clearWatch, clearSettings, clearAll, migrateStored } from './store.js';
import { initSync, configureSync, syncNow } from './sync.js';

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
  enhanceEpisodeNav({ hide: true }); // 分類頁：隱藏原生「全集連結／下一集」（已有選集列＋封面卡，冗餘）
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
  enhanceEpisodeNav({ animeKey, ep: parsed.ep, epRaw: parsed.epRaw, postId: postIdFromPath() }); // 單集頁：水平按鈕＋快取統一序的上/下一集（含特殊集）
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

// 貼上 JSON 匯入：自建對話框，不經檔案選擇器（油猴選單觸發的 file picker 常因 user gesture 失效）。
function importViaPaste() {
  injectStyles();
  const overlay = document.createElement('div');
  overlay.className = 'a1p-modal-overlay';
  overlay.innerHTML = `
    <div class="a1p-modal">
      <h4>貼上 JSON 匯入</h4>
      <textarea class="a1p-modal-ta" placeholder="貼上匯出的 JSON…"></textarea>
      <div class="a1p-modal-btns">
        <button class="a1p-btn a1p-modal-cancel">取消</button>
        <button class="a1p-btn a1p-modal-ok">匯入</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const ta = overlay.querySelector('.a1p-modal-ta');
  overlay.querySelector('.a1p-modal-cancel').onclick = close;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // 點背景關閉
  });
  overlay.querySelector('.a1p-modal-ok').onclick = () => {
    const text = (ta.value || '').trim();
    if (!text) return;
    try {
      importAll(text, { merge: true });
      close();
      toast('匯入完成，重新整理後生效', { duration: 4000 });
    } catch (e) {
      toast(`匯入失敗：${e.message}`, { duration: 5000 });
    }
  };
  ta.focus();
}

function registerMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return;
  GM_registerMenuCommand('匯出資料 (JSON)', () =>
    downloadJson(exportAll(), `anime1-plus-${new Date().toISOString().slice(0, 10)}.json`),
  );
  GM_registerMenuCommand('匯入資料 (JSON)', importViaPaste);

  // 多端同步（GitHub Gist）
  const sync = getSyncConfig();
  if (sync.enabled && sync.gistId) {
    GM_registerMenuCommand('☁️ 立即同步', async () => {
      toast('同步中…', { duration: 1500 });
      const r = await syncNow({ silent: true });
      if (r.ok) toast(r.changed ? '同步完成，部分頁面重新整理後更新' : '已是最新進度 ✓', { duration: 3000 });
      else toast(`同步失敗：${r.reason}`, { duration: 5000 });
    });
    GM_registerMenuCommand('☁️ 同步設定（變更 token）…', configureSync);
    GM_registerMenuCommand('✓ 多端同步（點此停用）', () => {
      setSyncConfig({ enabled: false });
      toast('已停用多端同步（選單下次開啟更新）', { duration: 2500 });
    });
  } else {
    GM_registerMenuCommand('☁️ 設定多端同步（GitHub Gist）…', configureSync);
  }

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
  GM_registerMenuCommand('🧹 清除資料…', openClearMenu);
}

// 統一的清除入口：輸入數字選擇要清除的項目。選項依情境動態組裝
// （在動畫頁才出現「清除此動畫」），所以編號與清單文字一併產生、避免錯位。
function openClearMenu() {
  const opts = [];
  if (currentAnimeKey) {
    opts.push(['清除此動畫的觀看記錄', () => clearAnime(currentAnimeKey)]);
    // 動畫選集/單集頁 → 只清這部的封面；主頁（無 currentAnimeKey）→ 清全部封面
    opts.push(['清除此動畫封面快取', () => clearCover(currentAnimeKey)]);
  } else {
    opts.push(['清除所有封面快取', clearCovers]);
  }
  opts.push(['清除追番記錄（所有觀看進度）', clearWatch]);
  opts.push(['還原所有設定為預設', clearSettings]);
  opts.push(['清除所有資料（完全重置）', clearAll]);

  const menu = opts.map(([label], i) => `${i + 1}. ${label}`).join('\n');
  const v = prompt(`輸入數字選擇要清除的資料：\n\n${menu}`, '');
  if (v == null) return; // 取消
  const n = parseInt(String(v).trim(), 10);
  if (!(n >= 1 && n <= opts.length)) {
    toast('未選擇有效項目', { duration: 2500 });
    return;
  }
  const [label, action] = opts[n - 1];
  if (!confirm(`確定要「${label}」？此動作無法復原。`)) return;
  action();
  toast(`已${label}，重新整理生效`, { duration: 3000 });
}

function main() {
  migrateStored(); // 一次性把舊格式（watch.url / meta.episodes[].url / 髒 title）轉精簡；放最前，後續 sync 才推精簡版上雲
  injectStyles();
  mountTrackingPanel();
  mountSidebarToggle();

  const type = getPageType();
  // footer 置底：內容頁（首頁/分類/單集）都套，內容不足一屏時把 #colophon 推到視窗底，消除底端白邊。
  if (type === 'list' || type === 'category' || type === 'episode') {
    document.body.classList.add('a1p-stick-footer');
  }
  if (type === 'category') initCategoryPage();
  else if (type === 'episode') initEpisodePageRoute();
  else if (type === 'list') {
    if (getSettings().listThumbs) initListPage();
  }

  registerMenu(); // 放最後：分派時已設定 currentAnimeKey，清除選單才能取到
  initSync(); // 訂閱資料變動 + 啟動時拉一次遠端（已設定才會動）
  // 背景複查「待確認」封面（最低優先，與 list 佇列共用限流；三頁皆跑）。
  // 列表頁：註冊 repaintCard → 升級後即時重繪卡片；全量補底以視窗就近排序（方案 B，渲染驅動已涵蓋眼前）。
  if (type === 'list') setCoverUpgradeHook(repaintCard);
  recheckTentativeCovers(type === 'list' ? { orderHint: viewportCatOrder() } : {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
