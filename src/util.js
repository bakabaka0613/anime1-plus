// 純工具函式（不依賴 GM / DOM，可被 node:test 直接 import）。

// 繁簡轉換：OpenCC 由 userscript @require 從 CDN 載入全域 OpenCC（node:test 無 → 原樣返回）。
const _ccCache = {};
function ccConverter(from, to) {
  const key = `${from}2${to}`;
  if (key in _ccCache) return _ccCache[key];
  _ccCache[key] = null;
  try {
    const g = typeof unsafeWindow !== 'undefined' ? unsafeWindow : typeof window !== 'undefined' ? window : {};
    const OC = (typeof OpenCC !== 'undefined' && OpenCC) || g.OpenCC;
    if (OC && OC.Converter) _ccCache[key] = OC.Converter({ from, to });
  } catch {
    /* ignore */
  }
  return _ccCache[key];
}
// 繁→簡：名稱正規化、Bangumi 搜尋用（多數條目索引為簡體）。
export function toSimplified(s) {
  const str = String(s || '');
  const conv = ccConverter('tw', 'cn');
  return conv ? conv(str) : str;
}
// 簡→繁：Bangumi 條目名多為簡體，顯示時轉回繁體（anime1 為繁體站）。
export function toTraditional(s) {
  const str = String(s || '');
  const conv = ccConverter('cn', 'tw');
  return conv ? conv(str) : str;
}

// 全形英數 → 半形，方便名稱正規化比對
function toHalfWidth(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
}

// 名稱正規化：去空白、標點、轉小寫、全形轉半形。用於相似度比對。
export function normalizeName(s) {
  // 繁簡統一（OpenCC）讓繁體標題對上簡體 Bangumi 名；短名誤採由 similarity 的包含給分收斂。
  return toSimplified(toHalfWidth(String(s || '')))
    .toLowerCase()
    .replace(/[\s]/g, '')
    .replace(/[!?。．・:~\-—_、,「」『』()\[\]{}"'’“”…★☆※／/]/g, '');
}

// Levenshtein 編輯距離
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// 名稱相似度 0~1（正規化後）。一方包含另一方時給高分。
export function similarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    // 依長度比例給分：短名被長名包含時給很低分，避免常見短詞（如「魔法」）虛高誤採。
    // 候選名長度需達 parsed 約 40% 才可能過 confident 的 name>=0.5 門檻。
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return 0.3 + 0.5 * ratio;
  }
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// 解析首頁「集數」欄文字 → 目前最新「一般集數」。
// 格式樣本：「連載中(11)」「1-8」「1」「0-11.5」「1-12+OVA」「劇場版」「-」。
// 「連載中(N)」取括號內最大數字；其餘取「+」前主集數段的最大數字（避免把 +OVA/+SP 算進來）；
// 純特殊集（劇場版/OVA/SP/-）無一般集數 → null。
export function parseLatestEp(text) {
  const t = String(text || '').trim();
  const airing = t.match(/連載中\s*\(([^)]*)\)/);
  const head = airing ? airing[1] : t.split('+')[0];
  const nums = head.match(/\d+(?:\.\d+)?/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

// 首頁「集數」欄是否標示「連載中」（仍在更新）。供追番清單區分「已到最新進度」與「已看完」。
export function isAiring(text) {
  return /連載中/.test(String(text || ''));
}

// 依「最新集數 vs 已標記完成的集」判斷首頁是否該顯示更新提醒。
// 觸發條件：必須有已完成（done）的集，且最新集數大於最大已完成集 → 回傳新增集數差，否則 null。
export function pendingNewEpisodes(latestEp, watch) {
  if (latestEp == null) return null;
  let maxDone = null;
  for (const ep of Object.keys(watch || {})) {
    if (!watch[ep] || !watch[ep].done) continue;
    const n = Number(ep);
    if (!Number.isNaN(n) && (maxDone === null || n > maxDone)) maxDone = n;
  }
  if (maxDone === null || latestEp <= maxDone) return null;
  return latestEp - maxDone;
}

// 追番面板用的嚴格更新判定：只有「使用者已追平當時最新集（沒有下一集可看）後又出新集」才回傳差額。
// 與 pendingNewEpisodes 的差別：多一道「已追平」門檻——最大已完成集需 >= maxEpSeen
// （上次進分類頁看到的最新集），藉此排除「還落後一堆舊集沒看」的情況（那不算更新提醒）。
export function caughtUpNewEpisodes(latestEp, watch, maxEpSeen) {
  if (latestEp == null || maxEpSeen == null) return null;
  let maxDone = null;
  for (const ep of Object.keys(watch || {})) {
    if (!watch[ep] || !watch[ep].done) continue;
    const n = Number(ep);
    if (!Number.isNaN(n) && (maxDone === null || n > maxDone)) maxDone = n;
  }
  if (maxDone === null || maxDone < maxEpSeen || latestEp <= maxDone) return null;
  return latestEp - maxDone;
}

// 追番清單「繼續看／看下一集」判定：以「最後觀看的集」（watchedAt 最大，不論是否標記看完）為準。
// 不可只在未看完(!done)的集裡挑——否則前集「看了但沒到門檻沒標記」、後集已看完時，會回頭挑到前集。
// 回傳 { mode:'resume', ep:<原集 key> } / { mode:'next', ep:<下一集數> } / { mode:'none' }。
export function resumeTarget(episodes) {
  let lastEp = null;
  let lastAt = -1;
  for (const e of Object.keys(episodes || {})) {
    const at = (episodes[e] && episodes[e].watchedAt) || 0;
    if (at > lastAt) {
      lastAt = at;
      lastEp = e;
    }
  }
  if (lastEp == null) return { mode: 'none' };
  if (!episodes[lastEp].done) return { mode: 'resume', ep: lastEp };
  return { mode: 'next', ep: Number(lastEp) + 1 };
}

// 追番面板分區判定：該動畫是否已是「終端狀態」（已看完 / 已到最新進度），即沒有可續看的下一步。
// false → 有進度（可繼續看／看下一集／看新集）置頂區；true → 終端狀態置下方區。判定須與 panelRowsHtml 的顯示一致。
// episodes：{ [ep]: { done, watchedAt, ... } }；metaEpisodes：meta.episodes 陣列（可能 undefined）；newEps：已追平後新集數。
export function isCaughtUp(episodes, metaEpisodes, newEps) {
  const target = resumeTarget(episodes);
  if (target.mode === 'resume') return false; // 有未看完的集 → 有進度
  const hasNextItem =
    Array.isArray(metaEpisodes) && metaEpisodes.some((it) => String(it.ep) === String(target.ep));
  if (hasNextItem) return false; // 有下一集可看
  if (newEps) return false; // 有新集可看
  return true; // 看下一集無處可去、也沒有新集 → 已看完 / 已到最新進度
}

// 手動標記整部動畫為「已看完」：回傳新的 per-anime watch 物件（不改動輸入）。
// 集數來源＝meta 全集清單 ∪ 已觀看的集；每集設 done，保留原有 currentTime/duration 等欄位。
// watchedAt 依集數遞增（最大集最後看），讓 resumeTarget 指向最高集、其下一集不存在 → 落入「已看完」區。
// now 由呼叫端提供（util 不呼叫 Date.now，且利於測試）。無任何已知集數時回空物件。
export function markEpisodesDone(animeWatch, metaEpisodes, now) {
  const eps = new Set(Object.keys(animeWatch || {}));
  if (Array.isArray(metaEpisodes)) for (const it of metaEpisodes) if (it && it.ep != null) eps.add(String(it.ep));
  const sorted = [...eps].sort((a, b) => Number(a) - Number(b));
  const out = {};
  sorted.forEach((ep, i) => {
    out[ep] = { ...(animeWatch && animeWatch[ep]), done: true, watchedAt: now + i };
  });
  return out;
}

// per-anime watch 中最後一次觀看的時間戳（無記錄→0）。
function maxWatchedAt(animeWatch) {
  let mx = 0;
  for (const k of Object.keys(animeWatch || {})) {
    const w = (animeWatch[k] && animeWatch[k].watchedAt) || 0;
    if (w > mx) mx = w;
  }
  return mx;
}

// 軟刪除墓碑判定：該動畫是否「已刪除」（在追番清單/各處隱藏）。
// 規則＝有 deletedAt 且其不早於最後一次觀看（deletedAt >= 最後 watchedAt）；
// 刪除後又觀看（watchedAt 較新）→ 判為未刪除，達成「再看一次即復原」。用於同步刪除跨端生效。
export function isDeleted(animeWatch, animeMeta) {
  const d = (animeMeta && animeMeta.deletedAt) || 0;
  if (!d) return false;
  return d >= maxWatchedAt(animeWatch);
}

// 多端同步合併（GitHub Gist）：把兩份 { watch, meta } 併成一份，回傳新物件（不改動輸入）。
// watch 逐集（per-episode）按 watchedAt 取較新的一筆——絕不可整包覆蓋，否則兩端看不同集會互相清掉。
// meta 的 maxEpSeen 取兩邊較大（單調遞增，是更新提醒的依據）；title/episodes 採 maxEpSeen 大的一邊。
export function mergeSync(local, remote) {
  const lw = (local && local.watch) || {};
  const rw = (remote && remote.watch) || {};
  const lm = (local && local.meta) || {};
  const rm = (remote && remote.meta) || {};

  const watch = {};
  for (const catId of new Set([...Object.keys(lw), ...Object.keys(rw)])) {
    const le = lw[catId] || {};
    const re = rw[catId] || {};
    const eps = {};
    for (const ep of new Set([...Object.keys(le), ...Object.keys(re)])) {
      const a = le[ep];
      const b = re[ep];
      if (!a) eps[ep] = b;
      else if (!b) eps[ep] = a;
      else eps[ep] = (b.watchedAt || 0) >= (a.watchedAt || 0) ? b : a; // 同分採 remote
    }
    watch[catId] = eps;
  }

  const meta = {};
  for (const catId of new Set([...Object.keys(lm), ...Object.keys(rm)])) {
    const a = lm[catId];
    const b = rm[catId];
    let m;
    if (!a) m = { ...b };
    else if (!b) m = { ...a };
    else {
      const am = typeof a.maxEpSeen === 'number' ? a.maxEpSeen : -Infinity;
      const bm = typeof b.maxEpSeen === 'number' ? b.maxEpSeen : -Infinity;
      m = { ...(bm >= am ? b : a), maxEpSeen: Math.max(am, bm) }; // title/episodes 隨 maxEpSeen 大的一邊
    }
    // 刪除墓碑 deletedAt：取兩邊較新（刪除跨端生效）；但若合併後該番有更新的觀看
    // （watchedAt > deletedAt）則代表已復原 → 清掉墓碑，避免殘留與不一致。
    const dz = Math.max((a && a.deletedAt) || 0, (b && b.deletedAt) || 0);
    if (dz && dz >= maxWatchedAt(watch[catId])) m.deletedAt = dz;
    else delete m.deletedAt;
    meta[catId] = m;
  }

  return { watch, meta };
}

// 節流：每 wait 毫秒最多執行一次（首呼立即、尾呼補一次）。
export function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return function throttled(...args) {
    lastArgs = args;
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn.apply(this, lastArgs);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, lastArgs);
      }, remaining);
    }
  };
}

// 秒 → MM:SS 或 H:MM:SS
// 去掉站名後綴「 – Anime1.me 動畫線上看」，只留動畫名。
// 寫入時就存乾淨值（縮小同步資料），讀取時仍套用以相容舊資料。冪等。
export function cleanTitle(s) {
  return String(s || '')
    .replace(/\s*[–\-|]\s*Anime1.*$/i, '')
    .trim();
}

// 把舊格式的 { watch, meta } 整包就地轉成精簡格式（不改動輸入，回傳新物件 + changed）：
//   watch[ep]：有 url → 解析出 postId 後刪 url（解析不到才保留 url 當退路）
//   meta.episodes[]：能用 postId 重建的就刪去 url
//   meta.title：去站名後綴
// 用於一次性遷移與同步合併，讓既有資料不必逐集重看就轉新格式。
export function normalizeWatchMeta(data) {
  const src = data || {};
  const before = JSON.stringify({ watch: src.watch || {}, meta: src.meta || {} });
  const POST_ID = /anime1\.me\/(\d+)/;
  const slimEp = (rec) => {
    const r = { ...rec };
    if (r.url) {
      if (!r.postId) {
        const m = String(r.url).match(POST_ID);
        if (m) r.postId = m[1];
      }
      if (r.postId) delete r.url; // 能用 postId 重建才刪
    }
    return r;
  };
  const watch = {};
  for (const cat of Object.keys(src.watch || {})) {
    const eps = src.watch[cat] || {};
    watch[cat] = {};
    for (const ep of Object.keys(eps)) watch[cat][ep] = slimEp(eps[ep]);
  }
  const meta = {};
  for (const cat of Object.keys(src.meta || {})) {
    const m = { ...(src.meta[cat] || {}) };
    if (typeof m.title === 'string') m.title = cleanTitle(m.title);
    if (Array.isArray(m.episodes)) m.episodes = m.episodes.map(slimEp);
    meta[cat] = m;
  }
  const after = JSON.stringify({ watch, meta });
  return { watch, meta, changed: after !== before };
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
