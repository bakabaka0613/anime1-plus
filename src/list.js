// 列表頁（/）：把 TablePress 表格重排成 PLEX 風格海報卡片網格（封面在上、標題/集數在下）。
// 封面沿用 lazy + 限流 + 重試；DataTables 的搜尋/分頁在表格外，仍正常運作。
import { animeKeyFromCategoryPath, yearFromText } from './dom.js';
import { getCover, setCover, getAnimeWatch, getSettings, setSettings } from './store.js';
import { lookupCover, toCoverData } from './cover.js';
import { parseLatestEp, pendingNewEpisodes } from './util.js';
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

export function initListPage() {
  injectStyles();
  const seen = new WeakSet();
  const queue = [];
  let pumping = false;

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
    while (queue.length) {
      const job = queue.shift();
      let ok = false;
      try {
        ok = await resolve(job);
      } catch {
        ok = false;
      }
      if (!ok) {
        job.retries = (job.retries || 0) + 1;
        if (job.retries <= MAX_RETRIES) queue.push(job);
        else job.img.classList.add('a1p-thumb-unknown');
      }
      await sleep(REQUEST_GAP_MS);
    }
    pumping = false;
  }

  async function resolve({ img, key, name, year }) {
    const res = await lookupCover({ animeKey: key, title: name, year });
    if (res.cached) {
      img.src = res.data.cover || '';
      return true;
    }
    if (res.data) {
      setCover(key, res.data);
      img.src = res.data.cover || '';
      return true;
    }
    if (res.ranked && res.ranked.length && res.ranked[0].subject) {
      const top = res.ranked[0];
      const nameScore = (top.breakdown && top.breakdown.name) || 0;
      const data = toCoverData(top);
      // 只在名稱夠相似時才用暫定封面，避免列表顯示雜項錯圖；嚴謹比對（含別名）留給分類頁
      if (nameScore >= 0.7 && data.cover) {
        data.tentative = true;
        setCover(key, data);
        img.src = data.cover;
      } else {
        img.classList.add('a1p-thumb-unknown'); // 名稱不夠像 → 占位，進分類頁再嚴謹比對
      }
      return true;
    }
    return false;
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
    nameTd.insertBefore(img, nameTd.firstChild);

    const cached = getCover(ref.key);
    if (cached && cached.cover) {
      img.src = cached.cover;
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
  const spacer = document.createElement('div');
  bar.parentNode.insertBefore(spacer, bar);
  let fixed = false;
  const update = () => {
    const top = spacer.getBoundingClientRect().top;
    if (!fixed && top < 0) {
      spacer.style.height = `${bar.offsetHeight}px`;
      bar.classList.add('a1p-toolbar-fixed');
      fixed = true;
    } else if (fixed && top >= 0) {
      spacer.style.height = '0';
      bar.classList.remove('a1p-toolbar-fixed');
      fixed = false;
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
