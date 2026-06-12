// 純工具函式（不依賴 GM / DOM，可被 node:test 直接 import）。

// 繁→簡轉換：OpenCC 由 userscript @require 從 CDN 載入全域 OpenCC（node:test 無 → 原樣返回）。
let _ccConv = null;
let _ccTried = false;
function ccConverter() {
  if (_ccTried) return _ccConv;
  _ccTried = true;
  try {
    const g = typeof unsafeWindow !== 'undefined' ? unsafeWindow : typeof window !== 'undefined' ? window : {};
    const OC = (typeof OpenCC !== 'undefined' && OpenCC) || g.OpenCC;
    if (OC && OC.Converter) _ccConv = OC.Converter({ from: 'tw', to: 'cn' });
  } catch {
    /* ignore */
  }
  return _ccConv;
}
export function toSimplified(s) {
  const str = String(s || '');
  const conv = ccConverter();
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
