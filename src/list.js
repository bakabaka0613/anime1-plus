// 列表頁（/）：把 TablePress 表格重排成 PLEX 風格海報卡片網格（封面在上、標題/集數在下）。
// 封面沿用 lazy + 限流 + 重試；DataTables 的搜尋/分頁在表格外，仍正常運作。
import { animeKeyFromCategoryPath, yearFromText } from './dom.js';
import {
  getCover,
  setCover,
  getAnimeWatch,
  getInProgressList,
  getSettings,
  setSettings,
  onCoverUpgradeEvent,
  setRecheckHint,
} from './store.js';
import { lookupCover, toCoverData, enqueueRecheck, enqueueMetaBackfill } from './cover.js';
import {
  parseLatestEp,
  pendingNewEpisodes,
  cleanTitle,
  throttle,
  seasonBuckets,
  isAdultLink,
  needsCoverMeta,
} from './util.js';
import { fetchLatestEpMap } from './animelist.js';
import { enqueue } from './coverQueue.js';
import { injectStyles, attachCoverTagsOverlay } from './ui.js';

// 18 禁番（anime1.pw 連結）統一封面：自包含 SVG data URI，不依賴網路、不查 Bangumi。
const ADULT_COVER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">` +
      `<rect width="300" height="450" fill="#1a1a1d"/>` +
      `<rect x="8" y="8" width="284" height="434" rx="14" fill="none" stroke="#e03e3e" stroke-width="6"/>` +
      `<circle cx="150" cy="178" r="76" fill="none" stroke="#e03e3e" stroke-width="9"/>` +
      `<text x="150" y="206" font-family="Arial,sans-serif" font-size="74" font-weight="bold" fill="#e03e3e" text-anchor="middle">18+</text>` +
      `<text x="150" y="322" font-family="'Microsoft JhengHei',sans-serif" font-size="54" font-weight="bold" fill="#f5f5f5" text-anchor="middle">18禁</text>` +
      `</svg>`,
  );

let currentDt = null; // DataTables 實例（供切換時恢復原始分頁）
let initialLen = null; // 原始每頁筆數

// 年+季桶篩選（單選）：狀態 + 桶資料。甲方案：bucketMap 由 fetchLatestEpMap 即時導出、不落地。
let activeBucket = null; // 單選：選中的桶字串（如 '2026春'），null = 無篩選
let bucketMap = null; // { [catId]: ['2025春',...] }，載入後才有
const nodeCatId = new WeakMap(); // row <tr> → catId 快取（predicate 每列每次 draw 都跑）
let filterTable = null; // 首頁 DataTable 的 <table> 元素（predicate 限定只作用本表）
let predicatePushed = false;
let updateBucketEdges = () => {}; // 由 mountToolbar 賦值：依捲動位置切換頭尾箭頭顯隱

// 從連結取穩定 key 與年份。動畫分類頁：/category/<季>/<名>（兩段）或 /?cat=NNNN。
function animeRef(a) {
  const href = a.getAttribute('href') || '';
  if (isAdultLink(href)) return null; // 18 禁 pw 連結：別走 ?cat= 分支誤判成 cat:NN（撞號），也排除出視窗 hint/桶篩選
  let dec = href;
  try {
    dec = decodeURIComponent(href);
  } catch {
    /* keep raw */
  }
  if (/\/category\/[^/]+\/[^/?#]+/.test(dec)) {
    return { key: animeKeyFromCategoryPath(href), year: yearFromText(dec) };
  }
  const m = href.match(/[?&]cat=(\d+)/);
  if (m) return { key: `cat:${m[1]}`, year: null };
  return null;
}

// 依封面資料的信心在海報上加/移除「待確認」角標（疊在海報容器 .a1p-poster-wrap 上）。
// tentative=true（列表頁低信心暫定）→ 顯示提示，誘導使用者點進分類頁重新比對／手選。
function markCover(img, data) {
  const box = img && img.parentNode;
  if (!box) return;
  const uncertain = !!(data && data.tentative);
  let tag = box.querySelector('.a1p-cover-uncertain');
  if (uncertain && !tag) {
    tag = document.createElement('span');
    tag.className = 'a1p-cover-uncertain';
    tag.textContent = '? 待確認';
    tag.title = '封面比對信心較低，點擊進入該動畫可重新比對或手動選擇';
    box.appendChild(tag);
  } else if (!uncertain && tag) {
    tag.remove();
  }
}

// 在海報右下顯示 Bangumi 評分「★ 8.5」。無評分（0/null）→ 不顯示。
function markRating(img, data) {
  const box = img && img.parentNode;
  if (!box) return;
  const score = data && data.rating;
  let tag = box.querySelector('.a1p-rating-badge');
  if (score) {
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'a1p-rating-badge';
      box.appendChild(tag);
    }
    tag.textContent = `★ ${Number(score).toFixed(1)}`;
  } else if (tag) {
    tag.remove();
  }
}

export function initListPage() {
  injectStyles();
  const seen = new WeakSet();
  let trackingPrefetched = false;

  // 別的分頁（例如某動畫頁）背景複查把封面升級轉正 → 本主頁即時重繪對應海報，不必重整。
  // 同分頁的升級走 setCoverUpgradeHook(repaintCard)；這裡只處理跨分頁（remote）事件。
  onCoverUpgradeEvent((catId) => {
    const cover = getCover(catId);
    if (cover && cover.cover) repaintCard(catId, cover);
  });

  // 可見海報排入共享佇列的 visible 層（高優先）；限流/重試由 coverQueue 統一處理。
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        if (e.target._a1pJob) enqueue('visible', () => resolve(e.target._a1pJob));
      }
    },
    { rootMargin: '400px' },
  );

  // job 可能無 img（追番清單補抓：只寫入封面快取，不渲染畫面）
  async function resolve({ img, key, name, year }) {
    const paint = (data) => {
      if (!img) return; // 補抓 job：略過畫面渲染
      img.src = data.cover || '';
      img.classList.remove('a1p-thumb-unknown'); // 前次失敗占位 → 抓到後清掉
      markCover(img, data);
      markRating(img, data);
    };
    // anime1 年+季桶（bucketMap 由 initBucketFilter 建；未就緒則 undefined → 不加分）→ 相符候選小幅加分。
    const buckets = bucketMap ? bucketMap[key] : undefined;
    const res = await lookupCover({ animeKey: key, title: name, year, buckets });
    if (res.cached) {
      paint(res.data);
      if (needsCoverMeta(res.data, Date.now())) enqueueMetaBackfill(key); // 既有快取缺 tags/放送日 → 背景補抓
      return true;
    }
    if (res.data) {
      // 高信心：直接採用、無提示。帶上 anime1 列表的繁體原名（local）供追番清單顯示繁體。
      const data = { ...res.data, local: name };
      setCover(key, data);
      paint(data);
      return true;
    }
    const top = res.ranked && res.ranked[0];
    if (top && top.subject) {
      const data = toCoverData(top);
      if (data.cover) {
        // 信心不足也照放圖，標記「待確認」誘導使用者點進分類頁重新比對／手選；
        // 存成 tentative → 分類頁 lookupCover 不直接採用，會重新嚴謹比對。
        data.tentative = true;
        data.local = name; // anime1 繁體原名
        setCover(key, data);
        paint(data);
        enqueueRecheck(key); // 本 session 新產生的待確認 → 前景深比對複查（眼前卡片，本分頁自做、不讓給租約）
      }
      return true;
    }
    if (img) img.classList.add('a1p-thumb-unknown'); // 完全無可用封面 → 標占位（重試成功會被 paint 清掉）
    return false; // 交給 coverQueue 重試
  }

  // 追番清單中沒有封面的番（多端同步後新端常見：只同步進度、封面各端自抓）→
  // 排進共享佇列的 tracking 層（低於可見海報），等可見海報抓完後接著補抓，下次開追番面板就有封面。
  async function prefetchTrackingCovers() {
    if (trackingPrefetched) return;
    trackingPrefetched = true;
    const inProgress = getInProgressList();
    // 已有封面但缺 tags/放送日的追番番 → 背景補抓（與「完全缺封面」分開處理）。
    for (const x of inProgress) {
      if (x.cover && x.cover.cover && needsCoverMeta(x.cover, Date.now())) enqueueMetaBackfill(x.catId);
    }
    const need = inProgress.filter((x) => !(x.cover && x.cover.cover));
    if (!need.length) return;
    const infoMap = await fetchLatestEpMap(); // 取各番的繁體名/年份（封面查詢需要 title）
    for (const x of need) {
      const info = infoMap[x.catId];
      const name = (info && info.name) || cleanTitle(x.meta && x.meta.title) || null;
      if (!name) continue; // 無名稱可查 → 略過（之後進該動畫頁時仍會抓）
      const job = { key: x.catId, name, year: info ? info.year : null };
      enqueue('tracking', () => resolve(job));
    }
  }

  // 把單一 table row 變成卡片：在名稱格最前插入封面圖
  function enhanceRow(tr) {
    if (seen.has(tr)) return;
    const nameTd = tr.querySelector('td');
    if (!nameTd) return;
    const a = nameTd.querySelector('a[href]');
    if (!a) return;
    const name = (a.textContent || '').trim();
    if (!name) return;
    // 18 禁番（連結到 anime1.pw）：跳過 Bangumi 封面查找，統一改用內建 18 禁封面。
    // 不進 IO/coverQueue、不查、不寫快取（也就避開原 ?cat= 撞號）。點封面仍導向 anime1.pw。
    if (isAdultLink(a.href)) {
      seen.add(tr);
      tr.classList.add('a1p-card-row');
      const img = document.createElement('img');
      img.className = 'a1p-poster';
      img.referrerPolicy = 'no-referrer';
      img.alt = name;
      img.src = ADULT_COVER;
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        window.location.href = a.href;
      });
      const wrap = document.createElement('div');
      wrap.className = 'a1p-poster-wrap';
      wrap.appendChild(img);
      nameTd.insertBefore(wrap, nameTd.firstChild);
      return;
    }
    const ref = animeRef(a);
    if (!ref) return;
    seen.add(tr);
    tr.classList.add('a1p-card-row');

    // 更新提醒：集數欄（第 2 格）的最新集數 > 已看完的最大集 → 右上角徽章「+N」
    const epTd = nameTd.nextElementSibling;
    const latestEp = epTd ? parseLatestEp(epTd.textContent) : null;
    const newCount = pendingNewEpisodes(latestEp, getAnimeWatch(ref.key));
    if (newCount) {
      const badge = document.createElement('span');
      badge.className = 'a1p-update-badge';
      badge.textContent = `+${newCount}`;
      badge.title = `已更新至第 ${latestEp} 話，有 ${newCount} 集未看`;
      tr.appendChild(badge);
    }

    const img = document.createElement('img');
    img.className = 'a1p-poster';
    img.referrerPolicy = 'no-referrer';
    img.alt = name;
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => {
      window.location.href = a.href; // 點封面也進該動畫連結
    });
    // 海報容器：作為角標（待確認／評分）的定位基準，避免相對到含標題的整格
    const wrap = document.createElement('div');
    wrap.className = 'a1p-poster-wrap';
    wrap.appendChild(img);
    nameTd.insertBefore(wrap, nameTd.firstChild);
    attachCoverTagsOverlay(wrap, () => getCover(ref.key)); // 右鍵封面 → 疊出 TAG（讀當下最新快取）

    const cached = getCover(ref.key);
    if (cached && cached.cover) {
      img.src = cached.cover;
      markCover(img, cached);
      markRating(img, cached);
      if (cached.tentative) enqueueRecheck(ref.key); // 待確認 → 前景深比對複查（渲染即排，本分頁自做、就近優先）
      if (needsCoverMeta(cached, Date.now())) enqueueMetaBackfill(ref.key); // 既有快取缺 tags/放送日 → 背景補抓
      return;
    }
    img._a1pJob = { img, key: ref.key, name, year: ref.year };
    io.observe(img);
  }

  function scanTable() {
    // anime1 用 TablePress；退而求其次找任何主表格
    const table = document.querySelector('table.tablepress') || document.querySelector('table');
    if (!table) return;
    table.classList.add('a1p-grid-table');
    table.querySelectorAll('tbody tr').forEach(enhanceRow);
  }

  // 套用使用者偏好（預設卡片檢視）
  document.body.classList.toggle('a1p-grid-on', getSettings().gridView !== false);
  scanTable();
  // DataTables 分頁/搜尋/排序會重建 tbody 的 tr → 持續處理新列
  new MutationObserver(scanTable).observe(document.body, { childList: true, subtree: true });

  mountToolbar();
  setupInfiniteScroll();
  initBucketFilter(); // 年+季桶篩選：即時導出 bucketMap + 填 chip 列（甲方案，不落地）
  prefetchTrackingCovers(); // 可見海報抓完後接著補抓追番清單缺的封面（tracking 層低優先，不擋可見列表）

  // 廣播視窗就近順序給持租約的 worker（可能是別的分頁）→ 它會優先複查使用者眼前那批待確認。
  // 取前 30 名就近 catId；節流避免捲動狂寫。本分頁自己持租約時也會讀到、效果一致。
  const publishHint = throttle(() => setRecheckHint(viewportCatOrder().slice(0, 30)), 1000);
  publishHint();
  window.addEventListener('scroll', publishHint, { passive: true });
}

// 目前已渲染的卡片 catId，依與視窗中心的垂直距離排序（最近者在前）。
// 供第三層「待確認複查」就近優先（方案 B）：先複查使用者眼前附近的，其餘照舊接在後面。
// 非列表頁（無卡片）或列表增強關閉時回傳 []。key 與封面快取／getTentativeCovers 同一空間（animeRef）。
export function viewportCatOrder() {
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const center = vh / 2;
  const rows = [];
  for (const row of document.querySelectorAll('.a1p-card-row')) {
    const a = row.querySelector('a[href]');
    if (!a) continue;
    const ref = animeRef(a);
    if (!ref) continue;
    const r = row.getBoundingClientRect();
    rows.push({ key: ref.key, dist: Math.abs((r.top + r.bottom) / 2 - center) });
  }
  rows.sort((p, q) => p.dist - q.dist);
  return rows.map((x) => x.key);
}

// 背景複查把某待確認封面升級轉正後，就地重繪眼前那張卡片：換封面、移除「待確認」角標、補評分。
// 不必重整即可看到結果。卡片不在 DOM（未渲染/已換頁）→ 無事發生。
export function repaintCard(catId, data) {
  for (const row of document.querySelectorAll('.a1p-card-row')) {
    const a = row.querySelector('a[href]');
    if (!a) continue;
    const ref = animeRef(a);
    if (!ref || ref.key !== catId) continue;
    const img = row.querySelector('img.a1p-poster');
    if (!img) return;
    if (data.cover) img.src = data.cover;
    img.classList.remove('a1p-thumb-unknown');
    markCover(img, data); // data 已非 tentative → 移除「待確認」角標
    markRating(img, data);
    return;
  }
}

// 年+季桶顯示排序：年遞減、同年季遞減（秋→夏→春→冬），最新季在前。
const SEASON_ORD = { 冬: 0, 春: 1, 夏: 2, 秋: 3 };
function compareBuckets(a, b) {
  const ya = +a.slice(0, 4);
  const yb = +b.slice(0, 4);
  if (ya !== yb) return yb - ya;
  return (SEASON_ORD[b[4]] ?? -1) - (SEASON_ORD[a[4]] ?? -1);
}

// DataTables 自訂搜尋 predicate：依 activeBucket 過濾。每次 draw() 對每列呼叫。
// 單選 + 多桶歸屬：選中的桶只要命中該番任一桶就保留。與既有文字搜尋天然 AND。
function bucketPredicate(settings, _searchData, dataIndex) {
  if (filterTable && settings.nTable !== filterTable) return true; // 只管首頁表
  if (!activeBucket) return true; // 無篩選 → 全過
  const node = settings.aoData[dataIndex] && settings.aoData[dataIndex].nTr;
  if (!node) return true;
  let catId = nodeCatId.get(node);
  if (catId === undefined) {
    const a = node.querySelector('a[href]');
    const ref = a ? animeRef(a) : null;
    catId = ref ? ref.key : null;
    nodeCatId.set(node, catId);
  }
  if (!catId) return false; // 解不出 catId → 啟用篩選時當不符合
  const bs = (bucketMap && bucketMap[catId]) || [];
  return bs.includes(activeBucket);
}

// 等 DataTables 程式庫就緒後 push predicate（只一次）。ext.search 在表格 init 前即可用。
function ensureBucketPredicate(tries = 0) {
  if (predicatePushed) return;
  const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const $ = w.jQuery || w.$;
  if ($ && $.fn && $.fn.dataTable && $.fn.dataTable.ext) {
    $.fn.dataTable.ext.search.push(bucketPredicate);
    predicatePushed = true;
    return;
  }
  if (tries < 48) setTimeout(() => ensureBucketPredicate(tries + 1), 250); // ~12s 輪詢
}

function redrawFilter() {
  const dt = currentDt || getDataTable();
  if (dt) {
    try {
      dt.draw(false); // 保留分頁長度，配合無限捲動
    } catch {
      /* ignore */
    }
  }
}

// 單選一個桶（傳 null = 取消）。同步 chip 的 aria-pressed 與清除鈕顯隱，並重繪。
function selectBucket(bucket, wrap) {
  activeBucket = bucket;
  for (const chip of wrap.querySelectorAll('.a1p-bucket-chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.bucket === bucket));
  }
  const clear = document.querySelector('.a1p-bucket-clear'); // ✕ 在捲動區外，全域查找
  if (clear) clear.hidden = !bucket;
  redrawFilter();
}

// 甲方案：fetchLatestEpMap（已 5 分快取）即時導出 bucketMap + 全桶集合，填入 chip 列。不落地。
async function initBucketFilter() {
  const wrap = document.querySelector('.a1p-tb-buckets');
  if (!wrap || wrap.dataset.filled) return;
  const map = await fetchLatestEpMap();
  bucketMap = {};
  const all = new Set();
  for (const [catId, info] of Object.entries(map)) {
    const bs = seasonBuckets(info.year, info.season);
    if (!bs.length) continue;
    bucketMap[catId] = bs;
    for (const b of bs) all.add(b);
  }
  filterTable = document.querySelector('table.tablepress') || document.querySelector('table');
  ensureBucketPredicate();
  const buckets = [...all].sort(compareBuckets);
  const frag = document.createDocumentFragment();
  for (const b of buckets) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'a1p-bucket-chip';
    chip.textContent = b;
    chip.dataset.bucket = b;
    chip.setAttribute('aria-pressed', 'false');
    chip.onclick = () => selectBucket(b === activeBucket ? null : b, wrap);
    frag.appendChild(chip);
  }
  wrap.appendChild(frag);
  wrap.dataset.filled = '1';
  updateBucketEdges(); // chip 填完 → 依是否溢出顯示頭尾箭頭
}

// 懸浮工具列：搜尋（移入原生 filter）+ 卡片/列表切換 + 卡片大小
function mountToolbar() {
  if (document.querySelector('.a1p-toolbar')) return;
  injectStyles();

  const bar = document.createElement('div');
  bar.className = 'a1p-toolbar';

  const search = document.createElement('div');
  search.className = 'a1p-tb-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '搜尋動畫…';
  input.className = 'a1p-tb-input';
  // 轉發到 anime1 原生搜尋框觸發過濾（原生那顆已隱藏），拿不到才退回 DataTables API
  input.oninput = () => {
    const native = document.querySelector(
      '.dataTables_filter input, .dataTables_wrapper input[type="search"], .dataTables_wrapper input[type="text"]',
    );
    if (native) {
      native.value = input.value;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('keyup', { bubbles: true }));
    } else if (currentDt) {
      try {
        currentDt.search(input.value).draw();
      } catch {
        /* ignore */
      }
    }
  };
  search.appendChild(input);

  const viewBtn = document.createElement('button');
  viewBtn.className = 'a1p-tb-btn';
  const refresh = () => {
    const on = document.body.classList.contains('a1p-grid-on');
    // 圖標對換：卡片模式顯示 ▦、列表模式顯示 ☰（代表目前檢視狀態）
    viewBtn.textContent = on ? '▦' : '☰';
    viewBtn.title = on ? '切換為原始列表' : '切換為卡片檢視';
  };
  viewBtn.onclick = () => {
    const on = !document.body.classList.contains('a1p-grid-on');
    document.body.classList.toggle('a1p-grid-on', on);
    setSettings({ gridView: on });
    refresh();
    if (on) window.dispatchEvent(new Event('scroll'));
    else if (currentDt && initialLen != null) {
      try {
        currentDt.page.len(initialLen).draw(false);
      } catch {
        /* ignore */
      }
    }
  };
  refresh();

  const sizeWrap = document.createElement('label');
  sizeWrap.className = 'a1p-tb-size';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '140';
  range.max = '360';
  range.step = '10';
  range.value = String(getSettings().cardWidth || 250);
  const applyWidth = (w) => {
    document.documentElement.style.setProperty('--a1p-card-w', `${w}px`);
    // 同步 WebKit 自訂軌道的填色百分比（值→0..100%），讓最大值時填色畫到最右端
    const pct = ((Number(w) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100;
    range.style.setProperty('--a1p-range-fill', `${pct}%`);
  };
  applyWidth(range.value);
  range.oninput = () => {
    applyWidth(range.value);
    setSettings({ cardWidth: Number(range.value) });
  };
  sizeWrap.append(range);

  // 年+季桶篩選列（獨佔第二行，橫向捲動）。chip 由 initBucketFilter 載入後填入。
  const buckets = document.createElement('div');
  buckets.className = 'a1p-tb-buckets';
  // 直向滾輪 → 橫向捲動（原生 overflow-x 不吃直向滾輪）
  buckets.addEventListener(
    'wheel',
    (e) => {
      if (!e.deltaY) return;
      e.preventDefault();
      buckets.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
  // ✕ 清除：在捲動區外、最左側。有選時 |(✕)‹ 桶 ›|、無選時 |‹ 桶 ›|。
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'a1p-bucket-clear';
  clearBtn.textContent = '✕';
  clearBtn.title = '清除';
  clearBtn.hidden = true;
  clearBtn.onclick = () => selectBucket(null, buckets);

  // 捲動區（relative）內覆蓋頭尾 ‹›：純漸層淡出提示、不可按（pointer-events:none），
  // 讓 chip 在邊緣淡入背景，只在該方向還能捲時淡入顯示。
  const scroll = document.createElement('div');
  scroll.className = 'a1p-tb-scroll';
  const arrowL = document.createElement('span');
  arrowL.className = 'a1p-tb-arrow l';
  arrowL.textContent = '‹';
  const arrowR = document.createElement('span');
  arrowR.className = 'a1p-tb-arrow r';
  arrowR.textContent = '›';
  updateBucketEdges = () => {
    const max = buckets.scrollWidth - buckets.clientWidth;
    arrowL.classList.toggle('show', buckets.scrollLeft > 2);
    arrowR.classList.toggle('show', buckets.scrollLeft < max - 2);
  };
  buckets.addEventListener('scroll', updateBucketEdges, { passive: true });
  window.addEventListener('resize', updateBucketEdges, { passive: true });
  scroll.append(buckets, arrowL, arrowR);

  const bucketWrap = document.createElement('div');
  bucketWrap.className = 'a1p-tb-bucketwrap';
  bucketWrap.append(clearBtn, scroll);

  bar.append(search, sizeWrap, viewBtn, bucketWrap);

  const anchor = document.querySelector('#primary, .content-area, #main, #content') || document.body;
  anchor.insertBefore(bar, anchor.firstChild);
  setupStickyToolbar(bar);
}

// position:sticky 在 anime1 的 float 佈局（容器常有 overflow:hidden）會失效，
// 改用捲動超過原位時切到 position:fixed 的後備做法；spacer 佔位避免內容跳動。
function setupStickyToolbar(bar) {
  const MAX_W = 1152; // 與 .a1p-toolbar 的 max-width 一致
  const FADE = 26; // 工具列下緣往下的漸層淡出距離
  const spacer = document.createElement('div');
  bar.parentNode.insertBefore(spacer, bar);
  // 全寬頂部遮罩：實心蓋住頂端間距＋工具列後方（順帶讓半透明工具列不透出卡片），
  // 工具列下緣往下漸層淡出顯露內容。色用工具列自身深色，亮/暗模式皆一致。
  const mask = document.createElement('div');
  mask.className = 'a1p-toolbar-mask';
  document.body.appendChild(mask);
  let fixed = false;
  // 吸頂時用 spacer（佔位元素）的幾何，把寬度/水平位置設成與靜止狀態（max-width 置中）完全一致，
  // 避免兩種定位基準（viewport vs content-area）在不同視窗寬度下對不齊。
  const applyGeom = () => {
    const r = spacer.getBoundingClientRect();
    const w = Math.min(r.width, MAX_W);
    bar.style.width = `${w}px`;
    bar.style.left = `${r.left + (r.width - w) / 2}px`;
    const solid = Math.ceil(bar.getBoundingClientRect().bottom);
    mask.style.height = `${solid + FADE}px`;
    mask.style.background = `linear-gradient(to bottom,#0d0d10 0,#0d0d10 ${solid}px,transparent ${solid + FADE}px)`;
  };
  const update = () => {
    const top = spacer.getBoundingClientRect().top;
    if (!fixed && top < 0) {
      spacer.style.height = `${bar.offsetHeight}px`;
      bar.classList.add('a1p-toolbar-fixed');
      mask.classList.add('on');
      applyGeom();
      fixed = true;
    } else if (fixed && top >= 0) {
      spacer.style.height = '0';
      bar.classList.remove('a1p-toolbar-fixed');
      mask.classList.remove('on');
      bar.style.left = bar.style.width = '';
      fixed = false;
    } else if (fixed) {
      applyGeom(); // 捲動/縮放期間持續對齊（捲軸出現或縮放會改變橫向幾何）
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// 取頁面的 DataTables 實例（需 unsafeWindow 存取頁面 jQuery）
function getDataTable() {
  const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const $ = w.jQuery || w.$;
  const table = document.querySelector('table.tablepress') || document.querySelector('table');
  if (!$ || !$.fn || !$.fn.DataTable || !table) return null;
  if (!$.fn.DataTable.isDataTable(table)) return null;
  try {
    return $(table).DataTable();
  } catch {
    return null;
  }
}

// 下滾動載入下一頁：捲到底時逐步加大 DataTables 每頁筆數，讓更多卡片進 DOM。
// DataTables 可能晚於腳本就緒 → 輪詢等待最多 ~12 秒。
function setupInfiniteScroll() {
  const STEP = 60;
  let tries = 0;
  const timer = setInterval(() => {
    const dt = getDataTable();
    if (dt) {
      clearInterval(timer);
      attach(dt);
    } else if (++tries > 48) {
      clearInterval(timer); // 拿不到 DataTables → 保留原生分頁
    }
  }, 250);

  function attach(dt) {
    currentDt = dt;
    try {
      initialLen = dt.page.info().length; // 記住原始每頁筆數，供切回原始列表
      dt.page(0);
    } catch {
      /* ignore */
    }
    let loading = false;
    const onScroll = () => {
      if (loading) return;
      if (!document.body.classList.contains('a1p-grid-on')) return; // 原始列表模式不無限載入
      let info;
      try {
        info = dt.page.info();
      } catch {
        return;
      }
      if (!info || info.length < 0) return; // 已顯示全部
      if (info.length >= info.recordsDisplay) return; // 全部已載入
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
      if (!nearBottom) return;
      loading = true;
      try {
        dt.page.len(info.length + STEP).draw(false);
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        loading = false;
        onScroll();
      }, 250);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}
