// 列表頁（/）：把 TablePress 表格重排成 PLEX 風格海報卡片網格（封面在上、標題/集數在下）。
// 封面沿用 lazy + 限流 + 重試；DataTables 的搜尋/分頁在表格外，仍正常運作。
import { animeKeyFromCategoryPath, yearFromText } from './dom.js';
import { getCover, setCover, getAnimeWatch, getInProgressList, getSettings, setSettings } from './store.js';
import { lookupCover, toCoverData } from './cover.js';
import { parseLatestEp, pendingNewEpisodes, cleanTitle } from './util.js';
import { fetchLatestEpMap } from './animelist.js';
import { injectStyles } from './ui.js';

const REQUEST_GAP_MS = 500; // 兩次 Bangumi 搜尋間隔，避免限流
const MAX_RETRIES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let currentDt = null; // DataTables 實例（供切換時恢復原始分頁）
let initialLen = null; // 原始每頁筆數

// 從連結取穩定 key 與年份。動畫分類頁：/category/<季>/<名>（兩段）或 /?cat=NNNN。
function animeRef(a) {
  const href = a.getAttribute('href') || '';
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
  const queue = []; // 可見海報（高優先）
  const bgQueue = []; // 追番清單補抓封面（低優先，僅在可見海報排空後處理）
  let pumping = false;
  let trackingPrefetched = false;

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        if (e.target._a1pJob) {
          queue.push(e.target._a1pJob);
          pump();
        }
      }
    },
    { rootMargin: '400px' },
  );

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length || bgQueue.length) {
      const job = queue.length ? queue.shift() : bgQueue.shift(); // 可見海報永遠優先於補抓
      let ok = false;
      try {
        ok = await resolve(job);
      } catch {
        ok = false;
      }
      if (!ok) {
        job.retries = (job.retries || 0) + 1;
        if (job.retries <= MAX_RETRIES) (job.prefetch ? bgQueue : queue).push(job);
        else if (job.img) job.img.classList.add('a1p-thumb-unknown');
      }
      await sleep(REQUEST_GAP_MS);
    }
    pumping = false;
  }

  // job 可能無 img（追番清單補抓：只寫入封面快取，不渲染畫面）
  async function resolve({ img, key, name, year }) {
    const paint = (data) => {
      if (!img) return; // 補抓 job：略過畫面渲染
      img.src = data.cover || '';
      markCover(img, data);
      markRating(img, data);
    };
    const res = await lookupCover({ animeKey: key, title: name, year });
    if (res.cached) {
      paint(res.data);
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
      }
      return true;
    }
    return false; // 完全無可用封面 → 交給 retry，用完標 unknown 占位
  }

  // 追番清單中沒有封面的番（多端同步後新端常見：只同步進度、封面各端自抓）→
  // 排進低優先 bgQueue，等可見海報抓完後接著補抓，下次開追番面板就有封面。
  async function prefetchTrackingCovers() {
    if (trackingPrefetched) return;
    trackingPrefetched = true;
    const need = getInProgressList().filter((x) => !(x.cover && x.cover.cover));
    if (!need.length) return;
    const infoMap = await fetchLatestEpMap(); // 取各番的繁體名/年份（封面查詢需要 title）
    for (const x of need) {
      const info = infoMap[x.catId];
      const name = (info && info.name) || cleanTitle(x.meta && x.meta.title) || null;
      if (!name) continue; // 無名稱可查 → 略過（之後進該動畫頁時仍會抓）
      bgQueue.push({ key: x.catId, name, year: info ? info.year : null, prefetch: true });
    }
    pump();
  }

  // 把單一 table row 變成卡片：在名稱格最前插入封面圖
  function enhanceRow(tr) {
    if (seen.has(tr)) return;
    const nameTd = tr.querySelector('td');
    if (!nameTd) return;
    const a = nameTd.querySelector('a[href]');
    if (!a) return;
    const ref = animeRef(a);
    if (!ref) return;
    const name = (a.textContent || '').trim();
    if (!name) return;
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

    const cached = getCover(ref.key);
    if (cached && cached.cover) {
      img.src = cached.cover;
      markCover(img, cached);
      markRating(img, cached);
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
  prefetchTrackingCovers(); // 可見海報抓完後接著補抓追番清單缺的封面（bgQueue 低優先，不擋可見列表）
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
    viewBtn.textContent = document.body.classList.contains('a1p-grid-on') ? '☰ 原始列表' : '▦ 卡片檢視';
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
  const applyWidth = (w) => document.documentElement.style.setProperty('--a1p-card-w', `${w}px`);
  applyWidth(range.value);
  range.oninput = () => {
    applyWidth(range.value);
    setSettings({ cardWidth: Number(range.value) });
  };
  sizeWrap.append('卡片大小', range);

  bar.append(search, sizeWrap, viewBtn);

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
