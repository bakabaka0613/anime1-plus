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
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
