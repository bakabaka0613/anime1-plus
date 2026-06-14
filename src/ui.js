// 所有畫面注入：樣式、toast、封面卡 / 候選選擇、分類頁集數標記、追番面板。
import { getInProgressList, getEpisode, setMeta, getAnimeWatch, getMeta, getSettings, setSettings, deleteAnimeSynced, markAnimeWatched } from './store.js';
import { formatTime, toTraditional, caughtUpNewEpisodes, resumeTarget, isCaughtUp, cleanTitle } from './util.js';
import { postUrl } from './dom.js';
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
/* 播放器下方原生「全集連結／下一集／上一集」連結：單集頁→水平按鈕列；分類頁→隱藏 */
.a1p-navrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}
.a1p-navrow .a1p-btn{margin-right:0;text-decoration:none;display:inline-block}
.a1p-btn-disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
.a1p-nav-hidden{display:none!important}
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
.a1p-row a.a1p-row-term{color:#9aa0a6} /* 已看完／已到最新進度：低調灰，仍可點回最後看的一集 */
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
body.a1p-grid-on .a1p-poster-wrap{display:block;position:relative;
  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
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
/* 右鍵封面 → TAG 疊層（metaTags 藍底在前、tags 灰底在後）；滑鼠移開即移除。覆滿封面、超出可捲動。
   淡入漸暗（animation），底色不過暗（半透明＋模糊）；tag 置中、平均分散好看 */
.a1p-cover-tags{position:absolute;inset:0;z-index:6;background:rgba(10,10,14,.62);
  overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
  padding:12px 10px;box-sizing:border-box;backdrop-filter:blur(3px);animation:a1p-tags-fade .22s ease both;
  -webkit-user-select:none;user-select:none;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.32) transparent}
/* 美化垂直捲動條（WebKit）：細、半透明、圓角，hover 加亮 */
.a1p-cover-tags::-webkit-scrollbar{width:6px}
.a1p-cover-tags::-webkit-scrollbar-track{background:transparent;margin:6px 0}
.a1p-cover-tags::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:99px}
.a1p-cover-tags::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.5)}
@keyframes a1p-tags-fade{from{opacity:0}to{opacity:1}}
.a1p-cover-tags.a1p-cover-tags-out{animation:a1p-tags-fadeout .18s ease both;pointer-events:none}
@keyframes a1p-tags-fadeout{from{opacity:1}to{opacity:0}}
.a1p-cover-tags-inner{min-height:100%;display:flex;flex-wrap:wrap;gap:8px;
  justify-content:center;align-content:center;align-items:center}
/* 長 tag 在卡片過窄時於 pill 內換行（不撐出水平捲動）；max-width 限制不超出容器 */
.a1p-cover-tag{font-size:12.5px;line-height:1.4;padding:4px 11px;border-radius:12px;text-align:center;
  white-space:normal;word-break:break-word;max-width:100%;box-sizing:border-box;
  background:rgba(28,30,40,.92);color:#f1f3f9;border:1px solid rgba(255,255,255,.42);
  box-shadow:0 1px 3px rgba(0,0,0,.36)}
.a1p-cover-tag.meta{font-weight:600;color:#fff;border-color:rgba(196,214,255,.85);
  background:linear-gradient(135deg,#4f6ee0,#8a4fd6)}
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
/* flex-basis:0 是關鍵：flexbox 換行判斷用的是 basis 而非收縮後寬度，basis 設 0 才能讓
   滑條與圖標鈕一律算進同一行、search 再以 flex-grow 吃掉剩餘空間，不被擠到下一行 */
.a1p-tb-search{flex:1 1 0;min-width:0;display:flex;align-items:center}
.a1p-tb-input{width:100%;height:32px;box-sizing:border-box;background:#1b1b1f;border:1px solid #45464c;
  border-radius:6px;color:#e8e8ea;padding:0 10px;font-size:13px}
.dataTables_filter{display:none!important} /* 原生搜尋隱藏，由工具列的輸入框代理 */
.a1p-tb-btn{cursor:pointer;border:1px solid #45464c;background:#26272c;color:#e8e8ea;
  border-radius:6px;height:32px;padding:0 12px;font-size:13px;white-space:nowrap}
.a1p-tb-btn:hover{background:#303138}
.a1p-tb-size{display:flex;align-items:center;gap:6px;height:32px;font-size:12px;color:#9aa0a6;white-space:nowrap}
/* 滑條縮短成約一半長、固定寬不被 flex 擠壓。完全自訂外觀：原生 WebKit 的 accent 填色在
   最大值時 thumb 中心只到「軌道寬 − 半 thumb」，右側恆留空白＝看起來拉不到底；改用 JS 依值
   設 --a1p-range-fill 的漸層把填色畫到底（Firefox 用原生 ::-moz-range-progress）。*/
.a1p-tb-size input[type=range]{-webkit-appearance:none;appearance:none;width:84px;flex:0 0 auto;
  margin:0;height:18px;background:transparent;cursor:pointer}
.a1p-tb-size input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:4px;
  background:linear-gradient(to right,#2f6fed var(--a1p-range-fill,50%),#45464c var(--a1p-range-fill,50%))}
.a1p-tb-size input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
  width:16px;height:16px;border-radius:50%;background:#2f6fed;border:2px solid #e8e8ea;
  box-sizing:border-box;margin-top:-4px}
.a1p-tb-size input[type=range]::-moz-range-track{height:8px;border-radius:4px;background:#45464c}
.a1p-tb-size input[type=range]::-moz-range-progress{height:8px;border-radius:4px;background:#2f6fed}
.a1p-tb-size input[type=range]::-moz-range-thumb{width:16px;height:16px;border:2px solid #e8e8ea;
  border-radius:50%;background:#2f6fed;box-sizing:border-box}
body:not(.a1p-grid-on) .a1p-tb-size{display:none} /* 原始列表模式不需大小調整 */
/* 年+季桶篩選列：|(✕)‹ 桶 ›|。✕ 在捲動區外最左，頭尾 ‹› 為邊緣淡出指示（不可按）。 */
.a1p-tb-bucketwrap{flex:1 1 100%;display:flex;align-items:center;gap:6px;min-width:0}
.a1p-tb-scroll{position:relative;flex:1 1 auto;min-width:0;display:flex}
.a1p-tb-buckets{flex:1 1 auto;min-width:0;display:flex;gap:6px;align-items:center;overflow-x:auto;
  scrollbar-width:none} /* 隱藏滑條，改用頭尾淡出提示 */
.a1p-tb-buckets::-webkit-scrollbar{display:none}
/* 頭尾淡出：絕對覆蓋邊緣，漸層讓 chip 淡入背景 + 小而淡的 ‹›；不可按、點擊穿透到下方 chip。
   只在該方向還能捲時 .show 淡入。背景色對齊工具列底色 #0d0d10。 */
.a1p-tb-arrow{position:absolute;top:0;bottom:0;width:28px;pointer-events:none;opacity:0;
  display:flex;align-items:center;color:#c2c7cf;font-size:15px;line-height:1;transition:opacity .15s}
.a1p-tb-arrow.show{opacity:1}
.a1p-tb-arrow.l{left:0;justify-content:flex-start;padding-left:1px;
  background:linear-gradient(to right,#0d0d10 35%,transparent)}
.a1p-tb-arrow.r{right:0;justify-content:flex-end;padding-right:1px;
  background:linear-gradient(to left,#0d0d10 35%,transparent)}
.a1p-bucket-chip{flex:0 0 auto;cursor:pointer;border:1px solid #45464c;background:#26272c;color:#cfd2d6;
  border-radius:14px;height:26px;padding:0 12px;font-size:12px;white-space:nowrap}
.a1p-bucket-chip:hover{background:#303138}
.a1p-bucket-chip[aria-pressed="true"]{background:#2f6fed;border-color:#2f6fed;color:#fff}
/* 清除鈕：純 ✕ 緊湊方鈕，在捲動區外最左（✕ 隱藏時 flex gap 不佔位） */
.a1p-bucket-clear{flex:0 0 auto;cursor:pointer;
  border:1px solid #5a3a3a;background:#2c2326;color:#e0a3a3;border-radius:13px;
  width:26px;height:26px;padding:0;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center}
.a1p-bucket-clear:hover{background:#3a2c2f}
.a1p-bucket-clear[hidden]{display:none}
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
body.a1p-grid-on .a1p-grid-table .a1p-poster{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:#2a2a30;
  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
body.a1p-grid-on .a1p-grid-table tbody td:first-child a{display:block;padding:6px 8px 2px;color:#e8e8ea;
  font-weight:600;font-size:13px;line-height:1.3;text-decoration:none}
body.a1p-grid-on .a1p-grid-table tbody td:nth-child(2){padding:0 8px 8px;color:#7aa2f7}
/* 右側欄折疊：跟著檢視模式走——卡片檢視（body.a1p-grid-on）隱藏側欄讓海報網格更寬，
   切回原始列表則顯示。不再有獨立的折疊按鈕。*/
body.a1p-grid-on #secondary,body.a1p-grid-on .widget-area{display:none!important}
body.a1p-grid-on #primary,body.a1p-grid-on .content-area{
  width:100%!important;max-width:100%!important;flex:1 1 100%!important;float:none!important}
/* footer 置底（內容頁 首頁/分類/單集 皆套）：內容不足一屏時把 #colophon 推到視窗底，消除底端白邊。
   只改 #page 直接子層的排版，內部 float 兩欄佈局不受影響。*/
body.a1p-stick-footer #page.site{display:flex;flex-direction:column;min-height:100vh}
/* width:100% 保住原本的滿版置中：site-content 帶 margin:auto，成為 flex 子項後
   auto margin 會讓它收縮到內容寬度（版型變窄）→ 用明確寬度抵銷，仍受 max-width 限制。*/
body.a1p-stick-footer #page.site>#content{flex:1 0 auto;width:100%}
body.a1p-stick-footer #page.site>#colophon{flex-shrink:0;margin-top:auto}
.a1p-last{display:flex;align-items:center;gap:10px;margin:8px 0;padding:8px 12px;
  background:#15233a;border:1px solid #2c4a6e;border-radius:8px;color:#d6e4ff;font-size:14px}
.a1p-last b{color:#fff}
/* 網頁全螢幕：把播放器容器放大填滿視窗（非系統全螢幕）*/
.a1p-webfull{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;
  max-width:none!important;margin:0!important;padding:0!important;border-radius:0!important;
  background:#000!important;z-index:2147483600!important}
.a1p-webfull video,.a1p-webfull .vjs-tech{width:100%!important;height:100%!important;object-fit:contain!important}
body.a1p-webfull-lock{overflow:hidden!important}
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
/* 站方導覽列／底部注入的「插件原始碼」連結（沿用站方選單樣式，僅補圖示與間距）*/
#primary-menu li.a1p-nav-link>a::before{content:"🧩"}
/* 桌機（站方選單斷點 769px）：橫向選單只留 emoji，與原生連結同列平行 */
@media screen and (min-width:769px){#primary-menu li.a1p-nav-link .a1p-nav-text{display:none}}
/* 手機（≤768px，站方收合成「選單」）：emoji+字 */
@media screen and (max-width:768px){#primary-menu li.a1p-nav-link .a1p-nav-text{margin-left:6px}}
.a1p-foot-link{display:inline-block;margin-top:4px}
.a1p-foot-link a::before{content:"🧩 "}
`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

const PROJECT_URL = 'https://github.com/bakabaka0613/anime1-plus';
const PROJECT_LABEL = '插件原始碼';

// 在站方頂部導覽列與底部插入導向 GitHub 專案的文字連結。
// 頂部：append 一個 <li> 到 #primary-menu —— 桌機橫列與手機「選單」展開的選單共用同一個 <ul>，
// 故無需各自處理；底部：在 #colophon .site-info 末尾另起一行連結。皆做去重（重跑不重複插入）。
export function injectProjectLinks() {
  injectStyles();
  // emoji 一律由 CSS ::before 注入；文字放在 .a1p-nav-text，桌機選單以 media query 隱藏（只留 emoji）。
  const mkLink = (textClass) => {
    const a = document.createElement('a');
    a.href = PROJECT_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    const txt = document.createElement('span');
    if (textClass) txt.className = textClass;
    txt.textContent = PROJECT_LABEL;
    a.appendChild(txt);
    return a;
  };
  const menu = document.getElementById('primary-menu');
  if (menu && !menu.querySelector('.a1p-nav-link')) {
    const li = document.createElement('li');
    li.className = 'menu-item a1p-nav-link';
    li.appendChild(mkLink('a1p-nav-text')); // 桌機只 emoji、手機 emoji+字
    menu.appendChild(li);
  }
  const info = document.querySelector('#colophon .site-info');
  if (info && !info.querySelector('.a1p-foot-link')) {
    const span = document.createElement('span');
    span.className = 'a1p-foot-link';
    span.appendChild(document.createElement('br'));
    span.appendChild(mkLink()); // 底部不受空間限制 → 維持 emoji+字
    info.appendChild(span);
  }
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

// 在封面圖上疊出 TAG（metaTags 在前、tags 在後）。
//   桌機：右鍵叫出、滑鼠移開即消失。
//   手機：長按（~480ms）叫出、點任意處關閉（沿用專案 pointerdown＋計時器長按慣例，見 mountTrackingPanel）。
// parentEl 須為 position:relative 的容器（如 .a1p-poster-wrap）。getData() 在叫出當下回最新封面資料
// （tags/metaTags），故背景補抓/升級後的新 tag 也讀得到。無 tag → 不攔截、照常顯示瀏覽器選單。
export function attachCoverTagsOverlay(parentEl, getData) {
  if (!parentEl || parentEl._a1pTagsBound) return;
  parentEl._a1pTagsBound = true;
  let overlay = null;
  let pressTimer = null;
  let docCloser = null;
  let sx = 0;
  let sy = 0;
  let lastType = 'mouse';

  const tagsOf = () => {
    const d = typeof getData === 'function' ? getData() : getData;
    return { meta: (d && d.metaTags) || [], tags: (d && d.tags) || [] };
  };
  const disarm = () => {
    if (docCloser) {
      document.removeEventListener('click', docCloser, true);
      docCloser = null;
    }
  };
  // 即時移除（含尚在淡出的殘留）：供 show 重建前清場，避免新舊疊層同框。
  const removeNow = () => {
    parentEl.querySelectorAll('.a1p-cover-tags').forEach((n) => n.remove());
    overlay = null;
    disarm();
  };
  // 使用者關閉：先跑淡出動畫，結束（或後備逾時）才移除。
  const hide = () => {
    disarm();
    if (!overlay) return;
    const el = overlay;
    overlay = null; // 立即釋放，讓重入的 hide／後續 show 不重複處理同一節點
    el.classList.add('a1p-cover-tags-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 260); // 後備：動畫被打斷也保證移除
  };
  // 手機開啟後，「點任意處關閉」：以擷取階段攔截下一次 click → 關閉並吞掉該次點擊（避免關閉的點擊又觸發導航）。
  const armTapAnywhere = () => {
    if (docCloser) return;
    docCloser = (e) => {
      e.preventDefault();
      e.stopPropagation();
      hide();
    };
    document.addEventListener('click', docCloser, true);
  };
  const show = () => {
    const { meta, tags } = tagsOf();
    if (!meta.length && !tags.length) return false;
    removeNow(); // 清場（含淡出中的殘留），不淡出，立刻換新
    const sel = window.getSelection && window.getSelection(); // 長按常會順手選取附近文字 → 清掉
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    overlay = document.createElement('div');
    overlay.className = 'a1p-cover-tags';
    overlay.innerHTML = `<div class="a1p-cover-tags-inner">${[
      ...meta.map((t) => `<span class="a1p-cover-tag meta">${escapeHtml(t)}</span>`),
      ...tags.map((t) => `<span class="a1p-cover-tag">${escapeHtml(t)}</span>`),
    ].join('')}</div>`;
    parentEl.appendChild(overlay); // 疊在封面上（z-index 高）→ 蓋住圖、點擊不會誤觸原本的點封面導航
    return true;
  };

  // 手機長按時瀏覽器會對封面/鄰近文字啟動選取 → 從容器內發起的 selectstart 一律取消（不影響頁面他處選字）
  parentEl.addEventListener('selectstart', (e) => e.preventDefault());

  // 桌機：右鍵叫出、滑鼠移開消失
  parentEl.addEventListener('mouseleave', hide);
  parentEl.addEventListener('contextmenu', (e) => {
    const { meta, tags } = tagsOf();
    if (!meta.length && !tags.length) return; // 無 tag → 照常顯示原生選單
    e.preventDefault(); // 抑制原生選單（桌機右鍵 / 手機長按的圖片選單）
    if (lastType !== 'touch') show(); // 觸控長按交給計時器，避免與 contextmenu 雙觸發
  });

  // 手機：長按叫出、點任意處關閉
  const cancelTimer = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  parentEl.addEventListener('pointerdown', (e) => {
    lastType = e.pointerType;
    if (e.pointerType !== 'touch') return;
    sx = e.clientX;
    sy = e.clientY;
    cancelTimer();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      show(); // 手指仍按著時叫出
    }, 480);
  });
  parentEl.addEventListener('pointermove', (e) => {
    if (pressTimer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancelTimer(); // 移動＝捲動 → 取消長按
  });
  const onUp = () => {
    cancelTimer();
    // 叫出的這一按放開「之後」（setTimeout 讓本次手勢的 click 先過）才布署「點任意處關」，避免立即關掉。
    if (overlay && lastType === 'touch') setTimeout(armTapAnywhere, 0);
  };
  parentEl.addEventListener('pointerup', onUp);
  parentEl.addEventListener('pointercancel', onUp);
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
    // 用解析後的絕對 a.href（相對 href 如「/28542」也能抓到 postId；getAttribute 取原始值會漏）
    const m = (a.href || a.getAttribute('href') || '').match(/anime1\.me\/(\d+)/);
    if (!m) return;
    const postId = m[1];
    if (!firstAnchor) firstAnchor = h;
    const parsed = parseTitle(h.textContent || '');
    if (parsed.ep != null) {
      episodes.push({ ep: parsed.ep, postId }); // url 由 postId 重建，不入庫
      maxEp = Math.max(maxEp, parsed.ep);
    } else if (parsed.epRaw || parsed.type !== 'TV') {
      // 特殊集（OVA/OAD/SP/劇場）也入庫，供 next/prev 跨到特殊集；無中括號者用 type 當標籤
      episodes.push({ ep: null, epRaw: parsed.epRaw || parsed.type, postId });
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
  if (episodes.length) {
    // 跨分頁合併（分類頁會分頁，特殊集常在別頁）：與既有快取 union（依 postId 去重，當前頁覆蓋）。
    // 整包替換會讓「只看 page 1」漏掉別頁的特殊集、或去到「只有 OVA 的分頁」把數字集與 maxEpSeen 洗掉。
    const prev = getMeta(animeKey);
    const byPost = new Map();
    if (prev && Array.isArray(prev.episodes)) for (const e of prev.episodes) byPost.set(String(e.postId), e);
    for (const e of episodes) byPost.set(String(e.postId), e);
    const merged = [...byPost.values()];
    const maxEpAll = merged.reduce((mx, e) => (typeof e.ep === 'number' ? Math.max(mx, e.ep) : mx), 0);
    setMeta(animeKey, {
      episodes: merged,
      maxEpSeen: Math.max(maxEp, maxEpAll, (prev && prev.maxEpSeen) || 0), // 單調不退
      title: cleanTitle(document.title),
    });
  }
  return firstAnchor;
}

// ---- 分類頁：折疊重複播放器 → 上方選集、下方單一播放器 ----
function appendPagination(bar) {
  const links = document.querySelectorAll(PAGINATION_SEL);
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

// WordPress 分類頁分頁連結（選集列也用來顯示「其他頁」）
const PAGINATION_SEL = '.pagination a, .nav-links a, a.page-numbers, .wp-pagenavi a, .page-nav a';

export function collapseToSinglePlayer(animeKey) {
  injectStyles();
  if (document.querySelector('.a1p-ep-selector')) return;
  const articles = Array.from(document.querySelectorAll('article')).filter(
    (a) => a.querySelector('.entry-content') && a.querySelector('.entry-title'),
  );
  if (!articles.length) return;
  // 單集**且無分頁**才不顯示選集列；分頁分類頁（如 /page/2 只剩一集）仍要顯示，方便跨頁導覽。
  if (articles.length < 2 && !document.querySelector(PAGINATION_SEL)) return;

  const eps = articles.map((a) => {
    const p = parseTitle(a.querySelector('.entry-title').textContent || '');
    return { article: a, ep: p.ep, epRaw: p.epRaw, type: p.type }; // epRaw/type 供特殊集（SP/OVA/OAD…）顯示用
  });
  // 特殊集（ep 為 null）的顯示基底：中括號內容 epRaw → 退回類型（純 OVA 無數字也得「OVA」）→ 退回「特」
  const specialBase = (e) => e.epRaw || (e.type && e.type !== 'TV' ? e.type : '') || '特';
  // 一般集數升序在前；特殊集排在最後，彼此依基底排序（OVA/OAD/SP 群組相鄰、數字自然序）
  eps.sort((a, b) => {
    const na = a.ep ?? Infinity;
    const nb = b.ep ?? Infinity;
    if (na !== nb) return na - nb;
    return specialBase(a).localeCompare(specialBase(b), undefined, { numeric: true });
  });
  // 指派按鈕標籤：一般集＝集數；特殊集＝基底，同基底有多個（如多個無編號 [OVA]）才加序號區分
  const baseCount = {};
  for (const e of eps) if (e.ep == null) baseCount[specialBase(e)] = (baseCount[specialBase(e)] || 0) + 1;
  const baseUsed = {};
  for (const e of eps) {
    if (e.ep != null) {
      e.label = String(e.ep);
      continue;
    }
    const base = specialBase(e);
    e.label = baseCount[base] > 1 ? `${base}${(baseUsed[base] = (baseUsed[base] || 0) + 1)}` : base;
  }

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
    btn.textContent = e.label; // 一般集＝集數；特殊集＝SP/OVA/OAD…（同名多個自動加序號）
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

// 播放器下方 anime1 原生的「全集連結／下一集／上一集」純文字連結（`<p><a>全集連結</a><br><a>下一集</a></p>`）。
// 以連結文字辨識（很穩定）。分類頁有多個 article（折疊後只顯示選中那集），故**就地**處理每個連結所在的
// 父容器（那個 <p>），不跨 article 搬移（避免塞到被隱藏的那集裡）。冪等。
//   hide=false（單集頁）：把 <p> 變 flex 列、去 <br>、連結套 a1p-btn → 水平按鈕（單集頁沒有選集列，這些導覽有用）。
//   hide=true（分類頁）：直接隱藏 <p>（插件已有選集列＋封面卡，「全集連結」指向當前分類、「下一集」皆冗餘）。
const NAV_LINK_TEXTS = ['全集連結', '上一集', '下一集', '上一話', '下一話'];

// 依「選集列相同順序」排 meta.episodes：數字集升序在前，特殊集（ep null，如 OVA/OAD/SP）依 epRaw 在後。
function orderedMetaEpisodes(list) {
  return [...list].sort((a, b) => {
    const na = typeof a.ep === 'number' ? a.ep : Infinity;
    const nb = typeof b.ep === 'number' ? b.ep : Infinity;
    if (na !== nb) return na - nb;
    return String(a.epRaw || '').localeCompare(String(b.epRaw || ''), undefined, { numeric: true });
  });
}

// 取目前集在統一排序清單中的位置與前/後相鄰 URL。目前集以 ep（數字集）或 postId（特殊集）辨識。
// 涵蓋「最後一個數字集 → 第一個特殊集」，與選集列順序一致。回傳 { found, prev, next }；無快取或找不到目前集
// → found:false（呼叫端據此保留原生「下一集」，不亂砍）。
function episodeNeighbors(animeKey, ep, epRaw, postId) {
  const meta = getMeta(animeKey);
  const eps = meta && Array.isArray(meta.episodes) ? meta.episodes : [];
  if (!eps.length) return { found: false, prev: null, next: null };
  const list = orderedMetaEpisodes(eps);
  // 定位目前集：數字集用 ep；特殊集（ep=null）用 epRaw（如「OVA」）；都對不上再退回 postId。
  let idx = ep != null ? list.findIndex((e) => e.ep === ep) : -1;
  if (idx < 0 && epRaw) idx = list.findIndex((e) => e.ep == null && String(e.epRaw) === String(epRaw));
  if (idx < 0 && postId) idx = list.findIndex((e) => String(e.postId) === String(postId));
  if (idx < 0) return { found: false, prev: null, next: null };
  const urlAt = (i) => {
    const t = list[i];
    return t ? t.url || postUrl(t.postId) : null;
  };
  return { found: true, prev: urlAt(idx - 1), next: urlAt(idx + 1) };
}

// 建一顆導覽按鈕：有 href → 可點；無 → 灰色不可點（維持版面一致）。
function navButton(text, href, cls) {
  const a = document.createElement('a');
  a.className = href ? `a1p-btn ${cls}` : `a1p-btn ${cls} a1p-btn-disabled`;
  a.textContent = text;
  if (href) a.href = href;
  return a;
}

export function enhanceEpisodeNav({ hide = false, animeKey = null, ep = null, epRaw = null, postId = null } = {}) {
  injectStyles();
  const rows = new Set();
  for (const a of document.querySelectorAll('a')) {
    // 只排除「已處理」（冪等）；不可用 [class*="a1p-"] 廣排，否則折疊後被隱藏（a1p-ep-hidden）的
    // 各集 article 內的連結會被跳過。這些文字僅原生 <p> 才有，不會誤中插件元件。
    if (a.closest('.a1p-navrow, .a1p-nav-hidden')) continue;
    if (!NAV_LINK_TEXTS.includes((a.textContent || '').trim())) continue;
    if (!hide) a.classList.add('a1p-btn');
    if (a.parentNode) rows.add(a.parentNode); // 同一父容器（通常是 <p>）
  }
  for (const p of rows) {
    if (hide) {
      p.classList.add('a1p-nav-hidden');
    } else {
      p.classList.add('a1p-navrow');
      p.querySelectorAll('br').forEach((br) => br.remove()); // 去掉垂直換行 → flex 水平並排
    }
  }
  if (hide || !animeKey) return;
  // 單集頁：列首補「上一集」、列尾補「下一集」，成為 [上一集] 全集連結 下一集。永遠顯示（無則灰色不可點）。
  // 有集數快取時，「下一集」改用快取的**統一順序**（含 OVA/OAD/SP）取代原生連結 → 最後一個數字集也能到特殊集
  //（原生在最後一集常缺「下一集」，但選集列照順序排得出特殊集，這裡補齊一致）。無快取則保留原生「下一集」。
  // found=true 代表目前集在快取清單中 → 用快取統一序（含特殊集）取代原生「下一集」，補上「上一集」。
  // found=false（無快取/目前集不在清單，如剛上架）→ 保留原生「下一集」不動，只補一顆灰色「上一集」維持版面。
  const { found, prev, next } = episodeNeighbors(animeKey, ep, epRaw, postId);
  for (const p of rows) {
    if (found) {
      // 移除原生所有導覽連結（下一集 / 上一集 / OVA、下一集(SP) 之類特殊集捷徑），只留「全集連結」與我們自己的按鈕；
      // 改用快取統一序的上/下一集（含特殊集、與選集列同序），避免那些裸連結夾在按鈕中間。
      [...p.querySelectorAll('a')].forEach((a) => {
        if (a.classList.contains('a1p-prev-ep') || a.classList.contains('a1p-next-ep')) return;
        if ((a.textContent || '').trim() === '全集連結') return;
        a.remove();
      });
      if (!p.querySelector('.a1p-next-ep')) p.appendChild(navButton('下一集', next, 'a1p-next-ep'));
    }
    const hasPrev =
      p.querySelector('.a1p-prev-ep') ||
      [...p.querySelectorAll('a')].some((a) => (a.textContent || '').trim() === '上一集');
    if (!hasPrev) p.insertBefore(navButton('上一集', prev, 'a1p-prev-ep'), p.firstChild);
  }
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
    if (r && (r.url || r.postId)) return r.url || postUrl(r.postId);
    const it = meta && Array.isArray(meta.episodes) ? meta.episodes.find((m) => String(m.ep) === String(ep)) : null;
    return it ? it.url || postUrl(it.postId) : null;
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

// ---- 追番面板 ----
export function mountTrackingPanel() {
  injectStyles();
  if (document.querySelector('.a1p-fab')) return;
  const fab = document.createElement('button');
  fab.className = 'a1p-fab';
  fab.textContent = '📺';
  fab.title = '追番清單（Shift+點擊 或 長按 1.5 秒 → 管理模式）';
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

  // 長按 📺 1.5 秒 → 與 Shift+點擊 等效，開啟管理模式（給無實體鍵盤/觸控裝置用）
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
    }, 1500);
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
        if (r && (r.url || r.postId)) return r.url || postUrl(r.postId); // 看過的集（跨分頁可用）
        const item =
          x.meta && Array.isArray(x.meta.episodes)
            ? x.meta.episodes.find((it) => String(it.ep) === String(ep))
            : null;
        return item ? item.url || postUrl(item.postId) : catUrl; // 不在當前分頁清單時退回全集連結
      };
      // 以最後觀看的集為準（不論是否標記看完）：未看完→繼續看該集；已看完→指向下一集
      const target = resumeTarget(eps);
      // 最後觀看的集（watchedAt 最大）— 終端狀態（已看完/已到最新進度）用來連回最後看的一集
      let lastWatchedEp = null;
      let lastAt = -1;
      for (const k of Object.keys(eps)) {
        const at = (eps[k] && eps[k].watchedAt) || 0;
        if (at > lastAt) {
          lastAt = at;
          lastWatchedEp = k;
        }
      }
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
          link = `<a href="${nextItem.url || postUrl(nextItem.postId)}">看下一集 第${nextEp}集</a>`;
        } else if (x.newEps) {
          // 有新集、但本機 meta 尚未記錄該集單集頁（沒再進過分類頁）→ 連到分類頁看新集
          link = `<a href="${catUrl}">看新集 第${nextEp}集</a>`;
        } else {
          // 連載中（首頁標「連載中」）→ 已追到最新進度；否則該番已完結 → 已看完。
          // 連到「最後觀看的一集」，方便回看（有些人想點回最後看的那集）。
          const label = x.airing ? '已到最新進度' : '已看完';
          const u = lastWatchedEp != null ? epUrl(lastWatchedEp) : null;
          const epTxt = /^\d+$/.test(String(lastWatchedEp)) ? `第${lastWatchedEp}集` : String(lastWatchedEp || '');
          link = u
            ? `<a class="a1p-row-term" href="${u}">${label}${epTxt ? `（回看${epTxt}）` : ''}</a>`
            : `<span class="a1p-sub">${label}</span>`;
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
