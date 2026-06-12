// 所有畫面注入：樣式、toast、封面卡 / 候選選擇、分類頁集數標記、追番面板。
import { getInProgressList, getEpisode, setMeta, getAnimeWatch, getMeta, getSettings, setSettings, deleteAnimeSynced, markAnimeWatched } from './store.js';
import { formatTime, toTraditional, caughtUpNewEpisodes, resumeTarget, isCaughtUp } from './util.js';
import { fetchLatestEpMap } from './animelist.js';
import { parseTitle } from './parse.js';

const BGM = (id) => `https://bgm.tv/subject/${id}`;

let stylesInjected = false;
export function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
.a1p-card{display:flex;gap:12px;align-items:flex-start;margin:10px 0;padding:12px;
  background:#1b1b1f;border:1px solid #33343a;border-radius:10px;color:#e8e8ea;font-size:14px}
.a1p-card img{width:96px;height:136px;object-fit:cover;border-radius:6px;flex:none;background:#2a2a30}
.a1p-card .a1p-meta{flex:1;min-width:0}
.a1p-card .a1p-name{font-weight:700;font-size:16px;margin:0 0 4px}
.a1p-card .a1p-sub{color:#9aa0a6;margin:0 0 6px}
.a1p-badge{display:inline-block;padding:1px 7px;border-radius:99px;font-size:12px;margin-right:6px}
.a1p-badge.ok{background:#1e3a24;color:#7ee29a}
.a1p-badge.warn{background:#3a2f1e;color:#e2c47e}
.a1p-btn{cursor:pointer;border:1px solid #45464c;background:#26272c;color:#e8e8ea;
  border-radius:6px;padding:4px 10px;font-size:13px;margin-right:6px}
.a1p-btn:hover{background:#303138}
.a1p-pick{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.a1p-pick .a1p-opt{width:84px;cursor:pointer;text-align:center}
.a1p-pick .a1p-opt img{width:84px;height:118px;object-fit:cover;border-radius:6px;background:#2a2a30}
.a1p-pick .a1p-opt span{display:block;font-size:11px;color:#cfd2d6;margin-top:3px;line-height:1.2}
.a1p-ep-done{opacity:.55}
.a1p-ep-done::after{content:" ✓";color:#7ee29a}
.a1p-ep-bar{height:3px;background:#7aa2f7;border-radius:2px;margin-top:3px}
.a1p-toast-wrap{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;
  display:flex;flex-direction:column;gap:8px;align-items:center}
.a1p-toast{background:#26272cdd;color:#fff;border:1px solid #45464c;border-radius:8px;
  padding:8px 14px;font-size:14px;display:flex;align-items:center;gap:10px;backdrop-filter:blur(4px)}
.a1p-toast .a1p-btn{padding:2px 8px}
/* 貼上 JSON 匯入對話框（不依賴檔案選擇器，油猴環境較可靠）*/
.a1p-modal-overlay{position:fixed;inset:0;z-index:2147483640;background:#000a;
  display:flex;align-items:center;justify-content:center}
.a1p-modal{background:#1b1b1f;border:1px solid #33343a;border-radius:10px;padding:16px;
  width:min(560px,90vw);color:#e8e8ea}
.a1p-modal h4{margin:0 0 10px;font-size:15px}
.a1p-modal-ta{width:100%;height:200px;box-sizing:border-box;background:#0d0d10;border:1px solid #45464c;
  border-radius:6px;color:#e8e8ea;padding:8px;font-size:12px;font-family:monospace;resize:vertical}
.a1p-modal-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.a1p-fab{position:fixed;right:18px;bottom:18px;z-index:2147483600;width:46px;height:46px;border-radius:50%;
  background:#7aa2f7;color:#0b1020;font-size:22px;border:none;cursor:pointer;box-shadow:0 3px 10px #0006;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
.a1p-panel{position:fixed;right:18px;bottom:74px;z-index:2147483600;width:370px;max-height:60vh;overflow:auto;
  background:#1b1b1f;border:1px solid #33343a;border-radius:10px;color:#e8e8ea;font-size:13px;padding:10px}
.a1p-panel h4{margin:2px 0 8px;font-size:14px}
.a1p-row{display:flex;gap:8px;padding:6px 0;border-top:1px solid #2a2a30;align-items:center}
.a1p-row img{width:40px;height:56px;object-fit:cover;border-radius:4px;flex:none;background:#2a2a30;cursor:zoom-in}
/* 追番列封面 hover 放大預覽：浮在面板外（面板 overflow:auto 會裁切，故獨立貼 body 並 fixed 定位） */
.a1p-cover-preview{position:fixed;z-index:2147483601;display:none;width:240px;height:338px;padding:4px;
  background:#0b0b0d;border:1px solid #45464c;border-radius:8px;box-shadow:0 8px 28px #000a;
  object-fit:contain;pointer-events:none}
.a1p-row a{color:#9ec1ff;text-decoration:none}
.a1p-row .a1p-rname{font-weight:600}
.a1p-row.a1p-row-new{background:#2a1820;border-left:3px solid #e0466e;padding-left:6px;margin-left:-3px}
.a1p-row-badge{display:inline-block;margin-left:6px;background:#e0466e;color:#fff;font-size:11px;
  font-weight:700;line-height:1;padding:2px 6px;border-radius:99px;vertical-align:middle}
.a1p-row-actions{margin-left:auto;flex:none;display:flex;flex-direction:column;gap:6px}
.a1p-row-del{flex:none;border:1px solid #e0466e;background:transparent;color:#e0466e;
  cursor:pointer;border-radius:6px;width:28px;height:28px;font-size:15px;line-height:1;
  display:flex;align-items:center;justify-content:center}
.a1p-row-del:hover{background:#e0466e;color:#fff}
.a1p-row-done{flex:none;border:1px solid #7ee29a;background:transparent;color:#7ee29a;
  cursor:pointer;border-radius:6px;width:28px;height:28px;font-size:15px;line-height:1;
  display:flex;align-items:center;justify-content:center}
.a1p-row-done:hover{background:#1e3a24;color:#7ee29a}
.a1p-panel-hint{margin:-4px 0 8px;font-size:11px;color:#e0466e}
.a1p-hide{display:none!important}
.a1p-list-thumb{width:34px;height:48px;object-fit:cover;border-radius:4px;vertical-align:middle;
  margin-right:8px;background:#2a2a30;display:inline-block}
.a1p-thumb-unknown{border:1px dashed #6a6a72}
/* 海報容器：角標（待確認／評分）的定位基準。原始列表模式同封面一起隱藏 */
.a1p-poster-wrap{display:none}
body.a1p-grid-on .a1p-poster-wrap{display:block;position:relative}
/* 封面待確認角標：低信心仍放圖，左上角標提示，誘導點進分類頁重新比對／手選 */
.a1p-cover-uncertain{display:none}
body.a1p-grid-on .a1p-cover-uncertain{display:flex;align-items:center;gap:3px;position:absolute;
  top:6px;left:6px;z-index:2;pointer-events:none;background:#3a2f1ee6;color:#e2c47e;font-size:11px;
  font-weight:600;line-height:1;padding:3px 7px;border-radius:99px;border:1px solid #6b5a2e;backdrop-filter:blur(2px)}
/* Bangumi 評分：海報右下角「★ 8.5」 */
.a1p-rating-badge{display:none}
body.a1p-grid-on .a1p-rating-badge{display:block;position:absolute;right:6px;bottom:6px;z-index:2;
  pointer-events:none;background:#000a;color:#ffd24a;font-size:12px;font-weight:700;line-height:1;
  padding:3px 7px;border-radius:99px;backdrop-filter:blur(2px)}
/* 更新提醒徽章：卡片右上角，僅卡片檢視模式定位（原始列表模式隱藏）*/
.a1p-update-badge{display:none}
body.a1p-grid-on .a1p-card-row{position:relative}
body.a1p-grid-on .a1p-update-badge{display:block;position:absolute;top:6px;right:6px;z-index:3;
  background:#e0466e;color:#fff;font-size:12px;font-weight:700;line-height:1;padding:3px 7px;
  border-radius:99px;box-shadow:0 1px 5px #0008;pointer-events:none}
/* PLEX 風格海報卡片網格（僅在 body.a1p-grid-on 時生效，可切換回原始列表）*/
.a1p-poster{display:none} /* 原始列表模式：封面隱藏 */
/* 懸浮工具列：搜尋 + 卡片/列表切換 + 大小調整 */
.a1p-toolbar{display:flex;gap:10px;align-items:center;
  flex-wrap:wrap;padding:8px 12px;margin:0 auto 14px;max-width:1152px;background:#0d0d10ee;backdrop-filter:blur(6px);
  border:1px solid #2a2a30;border-radius:8px}
/* 吸頂時保留原本尺寸與留白：頂部留間距、沿用圓角/邊框（不貼滿）。
   left/width 由 setupStickyToolbar 量測 spacer 後以 inline style 設定，確保與靜止狀態完全對齊。*/
.a1p-toolbar.a1p-toolbar-fixed{position:fixed;top:12px;right:auto;margin:0;z-index:2147483600;
  box-shadow:0 6px 24px #0009}
/* 吸頂時的頂部漸層遮罩：實心蓋頂端間距＋工具列後方，下緣淡出顯露內容（高度/漸層由 JS 設定）*/
.a1p-toolbar-mask{position:fixed;top:0;left:0;right:0;z-index:2147483599;pointer-events:none;display:none}
.a1p-toolbar-mask.on{display:block}
.a1p-toolbar>*{align-self:center}
.a1p-tb-search{flex:1 1 200px;min-width:160px;display:flex;align-items:center}
.a1p-tb-input{width:100%;height:32px;box-sizing:border-box;background:#1b1b1f;border:1px solid #45464c;
  border-radius:6px;color:#e8e8ea;padding:0 10px;font-size:13px}
.dataTables_filter{display:none!important} /* 原生搜尋隱藏，由工具列的輸入框代理 */
.a1p-tb-btn{cursor:pointer;border:1px solid #45464c;background:#26272c;color:#e8e8ea;
  border-radius:6px;height:32px;padding:0 12px;font-size:13px;white-space:nowrap}
.a1p-tb-btn:hover{background:#303138}
.a1p-tb-size{display:flex;align-items:center;gap:6px;height:32px;font-size:12px;color:#9aa0a6;white-space:nowrap}
body:not(.a1p-grid-on) .a1p-tb-size{display:none} /* 原始列表模式不需大小調整 */
/* 窄螢幕：搜尋框獨佔一行，卡片大小滑條與「原始列表」按鈕換到第二行並靠右，避免擠壓 */
@media (max-width:640px){.a1p-tb-search{flex-basis:100%}.a1p-toolbar{justify-content:flex-end}}
body.a1p-grid-on .a1p-grid-table thead{display:none}
body.a1p-grid-on .a1p-grid-table{margin-top:8px!important}
body.a1p-grid-on .dataTables_paginate,body.a1p-grid-on .dataTables_info,
body.a1p-grid-on .dataTables_length{display:none!important}
body.a1p-grid-on .a1p-grid-table,body.a1p-grid-on .a1p-grid-table tbody{display:block;border:none!important;width:100%!important}
body.a1p-grid-on .a1p-grid-table tbody{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--a1p-card-w,250px),1fr));gap:16px}
body.a1p-grid-on .a1p-grid-table tbody tr{display:flex;flex-direction:column;background:#1b1b1f;
  border:1px solid #2a2a30!important;border-radius:8px;overflow:hidden;transition:transform .1s}
body.a1p-grid-on .a1p-grid-table tbody tr:hover{transform:translateY(-2px);border-color:#7aa2f7!important}
body.a1p-grid-on .a1p-grid-table tbody td{display:block;border:none!important;padding:3px 8px;
  font-size:12px;color:#9aa0a6;background:transparent!important;text-align:left}
body.a1p-grid-on .a1p-grid-table tbody td:first-child{padding:0}
body.a1p-grid-on .a1p-grid-table tbody td:nth-child(n+3){display:none}
body.a1p-grid-on .a1p-grid-table .a1p-poster{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:#2a2a30}
body.a1p-grid-on .a1p-grid-table tbody td:first-child a{display:block;padding:6px 8px 2px;color:#e8e8ea;
  font-weight:600;font-size:13px;line-height:1.3;text-decoration:none}
body.a1p-grid-on .a1p-grid-table tbody td:nth-child(2){padding:0 8px 8px;color:#7aa2f7}
/* 右側欄折疊 */
.a1p-sidebar-toggle{position:fixed;right:0;top:105px;z-index:2147483600;cursor:pointer;
  border:1px solid #45464c;border-right:none;background:#26272cee;color:#e8e8ea;
  border-radius:12px 0 0 12px;width:20px;height:56px;padding:0;font-size:15px;line-height:1;
  display:flex;align-items:center;justify-content:center}
.a1p-sidebar-toggle:hover{background:#303138}
body.a1p-sidebar-collapsed #secondary,body.a1p-sidebar-collapsed .widget-area{display:none!important}
body.a1p-sidebar-collapsed #primary,body.a1p-sidebar-collapsed .content-area{
  width:100%!important;max-width:100%!important;flex:1 1 100%!important;float:none!important}
/* footer 置底（僅首頁 /）：內容不足一屏（如搜尋無結果）時把 #colophon 推到視窗底，消除底端大片空白。
   只改 #page 直接子層的排版，內部 float 兩欄佈局不受影響；其他頁面（分類/單集）維持原樣。*/
body.a1p-list-page #page.site{display:flex;flex-direction:column;min-height:100vh}
/* width:100% 保住原本的滿版置中：site-content 帶 margin:auto，成為 flex 子項後
   auto margin 會讓它收縮到內容寬度（無結果/廣告未載入時版型變窄）→ 用明確寬度抵銷，仍受 max-width 限制。*/
body.a1p-list-page #page.site>#content{flex:1 0 auto;width:100%}
body.a1p-list-page #page.site>#colophon{flex-shrink:0;margin-top:auto}
.a1p-last{display:flex;align-items:center;gap:10px;margin:8px 0;padding:8px 12px;
  background:#15233a;border:1px solid #2c4a6e;border-radius:8px;color:#d6e4ff;font-size:14px}
.a1p-last b{color:#fff}
/* 網頁全螢幕：把播放器容器放大填滿視窗（非系統全螢幕）*/
.a1p-webfull{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;
  max-width:none!important;margin:0!important;padding:0!important;border-radius:0!important;
  background:#000!important;z-index:2147483600!important}
.a1p-webfull video,.a1p-webfull .vjs-tech{width:100%!important;height:100%!important;object-fit:contain!important}
body.a1p-webfull-lock{overflow:hidden!important}
body.a1p-webfull-lock .a1p-sidebar-toggle,
body.a1p-webfull-lock .a1p-fab,
body.a1p-webfull-lock .a1p-panel{display:none!important}
.a1p-webfull-btn{position:absolute!important;top:10px!important;right:10px!important;z-index:2147483000!important;
  width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;
  border:2px solid #fff!important;border-radius:8px!important;background:#000c!important;color:#fff!important;
  font-size:24px!important;cursor:pointer!important;line-height:1!important;opacity:1!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
  box-shadow:0 2px 8px #000a!important;text-shadow:none!important;outline:none!important;
  transition:background .15s,transform .15s,opacity .25s,visibility .25s!important}
.a1p-webfull-btn:focus,.a1p-webfull-btn:focus-visible{outline:none!important;box-shadow:0 2px 8px #000a!important}
.a1p-webfull-btn:hover{background:#fff!important;border-color:#fff!important;color:#000!important;transform:scale(1.08)!important}
.a1p-webfull .a1p-webfull-btn{top:16px!important;right:16px!important}
/* 播放中且使用者閒置時跟 video.js 控制列一起淡出（一般與網頁全螢幕皆適用）；滑鼠移入播放器才顯示 */
.video-js.vjs-has-started.vjs-playing.vjs-user-inactive .a1p-webfull-btn{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
/* 分類頁：上方選集、下方單一播放器（隱藏其餘集的 article）*/
.a1p-ep-selector{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0;padding:10px 12px;
  background:#1b1b1f;border:1px solid #2a2a30;border-radius:8px}
.a1p-ep-label{color:#9aa0a6;font-size:12px}
.a1p-ep-btn{cursor:pointer;border:1px solid #45464c;background:#26272c;color:#e8e8ea;
  border-radius:6px;padding:5px 11px;font-size:13px;min-width:38px;text-align:center}
.a1p-ep-btn:hover{background:#303138}
.a1p-ep-btn.a1p-ep-active{background:#7aa2f7;color:#0b1020;border-color:#7aa2f7;font-weight:700}
.a1p-ep-btn.a1p-ep-done-btn{opacity:.6}
.a1p-ep-btn.a1p-ep-done-btn::after{content:" ✓";color:#7ee29a}
.a1p-ep-btn.a1p-ep-done-btn.a1p-ep-active::after{color:#0b1020}
.a1p-ep-page{color:#9ec1ff;text-decoration:none;padding:5px 9px;border:1px solid #45464c;
  border-radius:6px;font-size:13px}
.a1p-ep-page:hover{background:#303138}
.a1p-ep-hidden{display:none!important}
.pagination,.wp-pagenavi{display:none!important} /* 原生上一頁/下一頁，已併入選集列 */
`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

// ---- toast ----
function toastWrap() {
  let w = document.querySelector('.a1p-toast-wrap');
  if (!w) {
    w = document.createElement('div');
    w.className = 'a1p-toast-wrap';
    document.body.appendChild(w);
  }
  return w;
}
export function toast(msg, { actionLabel, onAction, actions, duration = 4000 } = {}) {
  injectStyles();
  const el = document.createElement('div');
  el.className = 'a1p-toast';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  // 支援多顆按鈕（actions）；保留單顆 actionLabel/onAction 的舊用法。
  const list = actions && actions.length ? actions : actionLabel ? [{ label: actionLabel, onAction }] : [];
  for (const a of list) {
    const btn = document.createElement('button');
    btn.className = 'a1p-btn';
    btn.textContent = a.label;
    btn.onclick = () => {
      try {
        a.onAction && a.onAction();
      } finally {
        el.remove();
      }
    };
    el.appendChild(btn);
  }
  toastWrap().appendChild(el);
  if (duration > 0) setTimeout(() => el.remove(), duration);
  return el;
}

// ---- 封面卡 ----
export function renderCoverCard(mountEl, data, { onChange } = {}) {
  injectStyles();
  if (!mountEl) return;
  const old = document.querySelector('.a1p-card');
  if (old) old.remove();
  const card = document.createElement('div');
  card.className = 'a1p-card';
  const badge = data.manual
    ? '<span class="a1p-badge ok">已手動確認</span>'
    : `<span class="a1p-badge ${data.score >= 0.6 ? 'ok' : 'warn'}">信心 ${Math.round((data.score || 0) * 100)}%</span>`;
  const bgmNames = [data.name_cn, data.name].filter(Boolean).join(' · ');
  card.innerHTML = `
    <img referrerpolicy="no-referrer" src="${data.cover || ''}" alt="">
    <div class="a1p-meta">
      <p class="a1p-name">${escapeHtml(data.local || data.name_cn || data.name || '')}</p>
      <p class="a1p-sub">${escapeHtml(bgmNames)}</p>
      <div>${badge}</div>
      <div style="margin-top:8px">
        <a class="a1p-btn" href="${BGM(data.subjectId)}" target="_blank" rel="noreferrer">Bangumi 條目</a>
        <button class="a1p-btn a1p-change">換一個</button>
      </div>
    </div>`;
  mountEl.parentNode.insertBefore(card, mountEl);
  card.querySelector('.a1p-change').onclick = () => onChange && onChange();
}

// ---- 低信心候選選擇 ----
export function renderCoverPicker(mountEl, ranked, parsed, onPick) {
  injectStyles();
  if (!mountEl) return;
  const old = document.querySelector('.a1p-card');
  if (old) old.remove();
  const card = document.createElement('div');
  card.className = 'a1p-card';
  const opts = ranked
    .map((r, i) => {
      const s = r.subject;
      const cover = (s.images && (s.images.medium || s.images.common || s.images.grid)) || '';
      return `<div class="a1p-opt" data-i="${i}">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <span>${escapeHtml(s.name_cn || s.name || '')}</span>
      </div>`;
    })
    .join('');
  card.innerHTML = `
    <div class="a1p-meta" style="flex:1">
      <p class="a1p-name">無法確定封面，請手動選擇</p>
      <p class="a1p-sub">解析名稱：${escapeHtml(parsed.baseName)}${parsed.seasonNum > 1 ? `（第${parsed.seasonNum}季）` : ''}</p>
      <div class="a1p-pick">${opts || '<span class="a1p-sub">查無候選</span>'}</div>
    </div>`;
  mountEl.parentNode.insertBefore(card, mountEl);
  card.querySelectorAll('.a1p-opt').forEach((opt) => {
    opt.onclick = () => onPick(ranked[Number(opt.dataset.i)]);
  });
}

// ---- 分類頁：標記每集已看狀態，並建立集數清單存入 meta ----
export function markCategoryEpisodes(animeKey) {
  injectStyles();
  // 每集標題是 <h2 class="entry-title"><a href="/{postId}">名稱 [NN]</a></h2>
  const titles = document.querySelectorAll('.entry-title');
  const episodes = [];
  let maxEp = 0;
  let firstAnchor = null;
  titles.forEach((h) => {
    const a = h.querySelector('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const m = href.match(/anime1\.me\/(\d+)/);
    if (!m) return;
    const postId = m[1];
    if (!firstAnchor) firstAnchor = h;
    const parsed = parseTitle(h.textContent || '');
    if (parsed.ep != null) {
      episodes.push({ ep: parsed.ep, postId, url: `https://anime1.me/${postId}` });
      maxEp = Math.max(maxEp, parsed.ep);
    }
    const rec = parsed.ep != null ? getEpisode(animeKey, parsed.ep) : null;
    if (rec && rec.done) {
      h.classList.add('a1p-ep-done');
    } else if (rec && rec.currentTime > 5 && rec.duration > 0) {
      const bar = document.createElement('div');
      bar.className = 'a1p-ep-bar';
      bar.style.width = `${Math.min(100, (rec.currentTime / rec.duration) * 100)}%`;
      h.parentNode.appendChild(bar);
    }
  });
  if (episodes.length) setMeta(animeKey, { episodes, maxEpSeen: maxEp, title: document.title });
  return firstAnchor;
}

// ---- 分類頁：折疊重複播放器 → 上方選集、下方單一播放器 ----
function appendPagination(bar) {
  const links = document.querySelectorAll(
    '.pagination a, .nav-links a, a.page-numbers, .wp-pagenavi a, .page-nav a',
  );
  if (!links.length) return;
  const sep = document.createElement('span');
  sep.className = 'a1p-ep-label';
  sep.textContent = '｜其他頁：';
  bar.appendChild(sep);
  const seen = new Set();
  links.forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || seen.has(href)) return;
    seen.add(href);
    const link = document.createElement('a');
    link.className = 'a1p-ep-page';
    link.href = href;
    link.textContent = (a.textContent || '').trim() || '頁';
    bar.appendChild(link);
  });
}

export function collapseToSinglePlayer(animeKey) {
  injectStyles();
  if (document.querySelector('.a1p-ep-selector')) return;
  const articles = Array.from(document.querySelectorAll('article')).filter(
    (a) => a.querySelector('.entry-content') && a.querySelector('.entry-title'),
  );
  if (articles.length < 2) return; // 只有一集不需折疊

  const eps = articles.map((a) => ({
    article: a,
    ep: parseTitle(a.querySelector('.entry-title').textContent || '').ep,
  }));
  eps.sort((a, b) => (a.ep ?? 1e9) - (b.ep ?? 1e9)); // 集數升序

  const watch = getAnimeWatch(animeKey);
  const bar = document.createElement('div');
  bar.className = 'a1p-ep-selector';
  const label = document.createElement('span');
  label.className = 'a1p-ep-label';
  label.textContent = '選集：';
  bar.appendChild(label);

  const select = (i) => {
    eps.forEach((e, j) => {
      const hide = j !== i;
      e.article.classList.toggle('a1p-ep-hidden', hide);
      e.btn.classList.toggle('a1p-ep-active', j === i);
      if (hide) {
        const v = e.article.querySelector('video');
        if (v && !v.paused) {
          try {
            v.pause(); // 切走的集暫停，避免背景播放
          } catch {
            /* ignore */
          }
        }
      }
    });
    window.dispatchEvent(new Event('resize')); // 讓 video.js 重算尺寸
  };

  eps.forEach((e, i) => {
    const btn = document.createElement('button');
    btn.className = 'a1p-ep-btn';
    btn.type = 'button';
    btn.textContent = e.ep != null ? String(e.ep) : '#';
    const rec = e.ep != null ? watch[e.ep] : null;
    if (rec && rec.done) btn.classList.add('a1p-ep-done-btn');
    btn.addEventListener('click', () => select(i));
    e.btn = btn;
    bar.appendChild(btn);
  });

  appendPagination(bar);
  articles[0].parentNode.insertBefore(bar, articles[0]);

  // 預設選集：最後看的未看完→該集續播；已看完→下一集；下一集不在本頁或無記錄→最新集（升序最後）
  let defaultIdx = eps.length - 1;
  const target = resumeTarget(watch);
  if (target.mode === 'resume' || target.mode === 'next') {
    const idx = eps.findIndex((x) => String(x.ep) === String(target.ep));
    if (idx >= 0) defaultIdx = idx;
  }
  select(defaultIdx);
}

// ---- 分類頁：最後看到第幾話 ----
export function renderLastWatched(animeKey, mountEl) {
  injectStyles();
  if (!mountEl) return;
  const watch = getAnimeWatch(animeKey);
  const eps = Object.keys(watch);
  if (!eps.length) return;
  let lastEp = eps[0];
  for (const e of eps) {
    if ((watch[e].watchedAt || 0) > (watch[lastEp].watchedAt || 0)) lastEp = e;
  }
  const rec = watch[lastEp];
  const meta = getMeta(animeKey);
  const num = String(animeKey).replace(/^cat:/, '');
  const catUrl = /^\d+$/.test(num) ? `https://anime1.me/?cat=${num}` : null;
  // 某集的單集頁網址：優先看當下存的網址，其次 meta 集數清單，最後退分類頁
  const findUrl = (ep) => {
    const r = watch[ep];
    if (r && r.url) return r.url;
    const it = meta && Array.isArray(meta.episodes) ? meta.episodes.find((m) => String(m.ep) === String(ep)) : null;
    return it ? it.url : null;
  };

  const target = resumeTarget(watch);
  let text;
  let link = '';
  if (target.mode === 'resume') {
    // 最後看的未看完 → 繼續看該集
    text = `上次看到 <b>第 ${escapeHtml(String(lastEp))} 話</b>（看到 ${formatTime(rec.currentTime || 0)}）`;
    const u = findUrl(target.ep) || catUrl;
    if (u) link = `<a class="a1p-btn" href="${u}">▶ 繼續看</a>`;
  } else {
    // 最後看的已看完 → 有下一集才顯示按鈕；看完最新集（無下一集）則不顯示。
    // 分類頁的 meta.episodes 由 markCategoryEpisodes 先以「當前頁即時集數」寫入，故找不到即代表沒有下一集。
    text = `上次看完 <b>第 ${escapeHtml(String(lastEp))} 話</b>`;
    const u = findUrl(target.ep);
    if (u) link = `<a class="a1p-btn" href="${u}">▶ 看下一集 第 ${escapeHtml(String(target.ep))} 話</a>`;
  }

  const old = document.querySelector('.a1p-last');
  if (old) old.remove();
  const bar = document.createElement('div');
  bar.className = 'a1p-last';
  bar.innerHTML = `<span>${text}</span>${link}`;
  mountEl.parentNode.insertBefore(bar, mountEl);
}

// ---- 右側欄折疊（搜尋/近期更新等 widget 很佔版面，預設折疊）----
export function mountSidebarToggle() {
  const aside = document.querySelector('#secondary, .widget-area');
  if (!aside || document.querySelector('.a1p-sidebar-toggle')) return;
  injectStyles();
  let open = !!getSettings().sidebarOpen;
  const btn = document.createElement('button');
  btn.className = 'a1p-sidebar-toggle';
  const apply = () => {
    document.body.classList.toggle('a1p-sidebar-collapsed', !open);
    btn.textContent = open ? '❯' : '❮';
    btn.title = open ? '隱藏側欄' : '顯示側欄';
  };
  btn.onclick = () => {
    open = !open;
    setSettings({ sidebarOpen: open });
    apply();
  };
  document.body.appendChild(btn);
  apply();
}

// ---- 追番面板 ----
export function mountTrackingPanel() {
  injectStyles();
  if (document.querySelector('.a1p-fab')) return;
  const fab = document.createElement('button');
  fab.className = 'a1p-fab';
  fab.textContent = '📺';
  fab.title = '追番清單（Shift+點擊 或 長按 3 秒 → 管理模式）';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'a1p-panel a1p-hide';
  document.body.appendChild(panel);

  let pressTimer = null;
  let longPressed = false; // 長按已開啟管理模式 → 抑制隨後的 click
  fab.onclick = (e) => {
    if (longPressed) {
      longPressed = false;
      return; // 長按已處理開啟，忽略這次 click
    }
    const willOpen = panel.classList.contains('a1p-hide');
    panel.classList.toggle('a1p-hide');
    if (willOpen) {
      // 按住 Shift 開啟 → 進入管理模式，每列右側出現 ✓/🗑 鈕
      panel.classList.toggle('a1p-del-mode', e.shiftKey);
      renderPanel(panel);
    } else {
      preview.style.display = 'none'; // 收合面板時一併隱藏封面預覽
    }
  };

  // 長按 📺 三秒 → 與 Shift+點擊 等效，開啟管理模式（給無實體鍵盤/觸控裝置用）
  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  fab.addEventListener('pointerdown', () => {
    longPressed = false;
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressed = true;
      panel.classList.remove('a1p-hide');
      panel.classList.add('a1p-del-mode');
      preview.style.display = 'none';
      renderPanel(panel);
    }, 3000);
  });
  fab.addEventListener('pointerup', cancelPress);
  fab.addEventListener('pointerleave', cancelPress);
  fab.addEventListener('pointercancel', cancelPress);
  // 長按時瀏覽器可能跳出右鍵/長按選單，於開啟管理模式期間抑制
  fab.addEventListener('contextmenu', (e) => e.preventDefault());

  // 封面 hover 放大預覽：滑鼠移到列的小封面上時，於面板左側浮出大圖（委派以撐過 innerHTML 重繪）
  const preview = document.createElement('img');
  preview.className = 'a1p-cover-preview';
  preview.referrerPolicy = 'no-referrer';
  document.body.appendChild(preview);
  const isRowThumb = (el) => el && el.tagName === 'IMG' && el.closest('.a1p-row') && !!el.getAttribute('src');
  panel.addEventListener('mouseover', (e) => {
    if (!isRowThumb(e.target)) return;
    preview.src = e.target.src;
    preview.style.display = 'block';
    const pr = panel.getBoundingClientRect();
    const ir = e.target.getBoundingClientRect();
    const pw = preview.offsetWidth;
    const ph = preview.offsetHeight;
    let left = pr.left - pw - 10; // 預設貼在面板左側
    if (left < 8) left = Math.min(pr.right + 10, window.innerWidth - pw - 8); // 左側空間不足 → 改放右側
    let top = ir.top + ir.height / 2 - ph / 2; // 與縮圖垂直置中對齊
    top = Math.max(8, Math.min(top, window.innerHeight - ph - 8)); // 夾在視窗內
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  });
  panel.addEventListener('mouseout', (e) => {
    if (isRowThumb(e.target)) preview.style.display = 'none';
  });

  // 管理鈕（委派在 panel 上，撐過 innerHTML 重繪）：✓ 標記已看完、🗑 刪除進度，動作後重繪
  panel.addEventListener('click', (e) => {
    const done = e.target.closest('.a1p-row-done');
    if (done) {
      e.preventDefault();
      e.stopPropagation();
      const name = done.dataset.name || '這部動畫';
      if (!confirm(`把「${name}」標記為已看完？會把已知的每一集都設為看完。`)) return;
      markAnimeWatched(done.dataset.cat);
      renderPanel(panel);
      return;
    }
    const del = e.target.closest('.a1p-row-del');
    if (!del) return;
    e.preventDefault();
    e.stopPropagation();
    const name = del.dataset.name || '這部動畫';
    if (!confirm(`確定刪除「${name}」的觀看進度？\n此刪除會同步到其他裝置並隱藏；再次觀看此動畫即可復原。`)) return;
    deleteAnimeSynced(del.dataset.cat);
    renderPanel(panel);
  });
}

async function renderPanel(panel) {
  const delMode = panel.classList.contains('a1p-del-mode');
  const head = `<h4>追番清單</h4>${delMode ? '<div class="a1p-panel-hint">管理模式：✓ 標記已看完、🗑 刪除該動畫進度</div>' : ''}`;
  const list = getInProgressList(); // 含「當前記錄全看完」的，改顯示「看下一集」而非消失
  if (!list.length) {
    panel.innerHTML = `${head}<div class="a1p-sub">還沒有觀看記錄</div>`;
    return;
  }
  // 先用現有資料即時渲染（newEps 未知，先依「有進度/終端」粗分區），避免等待網路造成空白
  sortByGroup(list);
  panel.innerHTML = `${head}${panelRowsHtml(list, delMode)}`;
  // 再抓即時最新集數：標出「已追平後又出新集」者，並帶上「連載中」狀態（供「已看完/已到最新進度」區分）
  const latestMap = await fetchLatestEpMap();
  for (const x of list) {
    const info = latestMap[x.catId];
    x.newEps = caughtUpNewEpisodes(info ? info.ep : null, x.episodes, x.meta && x.meta.maxEpSeen);
    x.airing = !!(info && info.airing);
  }
  sortByGroup(list);
  panel.innerHTML = `${head}${panelRowsHtml(list, delMode)}`;
}

// 分兩區：有進度（可繼續看/看下一集/看新集）置頂、已看完/已到最新進度在下方；
// 各區內維持「最後觀看時間」由新到舊（getInProgressList 已給此序，stable sort 保留組內原序）。
function sortByGroup(list) {
  list.sort(
    (a, b) =>
      (isCaughtUp(a.episodes, a.meta && a.meta.episodes, a.newEps) ? 1 : 0) -
      (isCaughtUp(b.episodes, b.meta && b.meta.episodes, b.newEps) ? 1 : 0),
  );
}

function panelRowsHtml(list, delMode) {
  return list
    .map((x) => {
      const cover = x.cover && x.cover.cover ? x.cover.cover : '';
      const cleanTitle = (s) => String(s || '').replace(/\s*[–\-|]\s*Anime1.*$/i, '').trim();
      // 優先 anime1 原生繁體名（cover.local），其次 Bangumi 名，最後頁面標題。
      // Bangumi name_cn 多為簡體 → 簡轉繁顯示（local 已是繁體、name 為日文，皆不轉）。
      const name =
        (x.cover && (x.cover.local || (x.cover.name_cn && toTraditional(x.cover.name_cn)) || x.cover.name)) ||
        cleanTitle(x.meta && x.meta.title) ||
        x.catId;
      // 找最近一集未看完，給「繼續看」連結
      const eps = x.episodes;
      const num = String(x.catId).replace(/^cat:/, '');
      const catUrl = /^\d+$/.test(num) ? `https://anime1.me/?cat=${num}` : '#';
      const epUrl = (ep) => {
        const r = eps[ep];
        if (r && r.url) return r.url; // 看過的集存了單集頁網址（跨分頁可用）
        const item =
          x.meta && Array.isArray(x.meta.episodes)
            ? x.meta.episodes.find((it) => String(it.ep) === String(ep))
            : null;
        return item ? item.url : catUrl; // 不在當前分頁清單時退回全集連結
      };
      // 以最後觀看的集為準（不論是否標記看完）：未看完→繼續看該集；已看完→指向下一集
      const target = resumeTarget(eps);
      let link;
      if (target.mode === 'resume') {
        const t = formatTime((eps[target.ep] || {}).currentTime || 0);
        link = `<a href="${epUrl(target.ep)}">繼續看 第${target.ep}集 (${t})</a>`;
      } else {
        // 已看完最後觀看的集 → 看下一集
        const nextEp = target.ep;
        const nextItem =
          x.meta && Array.isArray(x.meta.episodes)
            ? x.meta.episodes.find((it) => String(it.ep) === String(nextEp))
            : null;
        if (nextItem) {
          link = `<a href="${nextItem.url}">看下一集 第${nextEp}集</a>`;
        } else if (x.newEps) {
          // 有新集、但本機 meta 尚未記錄該集單集頁（沒再進過分類頁）→ 連到分類頁看新集
          link = `<a href="${catUrl}">看新集 第${nextEp}集</a>`;
        } else {
          // 連載中（首頁標「連載中」）→ 已追到最新進度；否則該番已完結 → 已看完
          link = x.airing
            ? '<span class="a1p-sub">已到最新進度</span>'
            : '<span class="a1p-sub">已看完</span>';
        }
      }
      const badge = x.newEps ? `<span class="a1p-row-badge">+${x.newEps} 新集</span>` : '';
      // 管理模式（Shift 開啟）：✓ 標記已看完（已是終端狀態者不顯示）＋ 🗑 刪除進度
      const caughtUp = isCaughtUp(eps, x.meta && x.meta.episodes, x.newEps);
      const actions = delMode
        ? `<div class="a1p-row-actions">${caughtUp ? '' : `<button class="a1p-row-done" type="button" title="標記為已看完" data-cat="${escapeHtml(x.catId)}" data-name="${escapeHtml(name)}">✓</button>`}` +
          `<button class="a1p-row-del" type="button" title="刪除此動畫進度" data-cat="${escapeHtml(x.catId)}" data-name="${escapeHtml(name)}">🗑</button></div>`
        : '';
      return `<div class="a1p-row${x.newEps ? ' a1p-row-new' : ''}">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <div><div class="a1p-rname">${escapeHtml(name)}${badge}</div>${link}</div>
        ${actions}
      </div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
