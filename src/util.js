// 純工具函式（不依賴 GM / DOM，可被 node:test 直接 import）。
import * as OpenCC from 'opencc-js';

// 繁→簡轉換（opencc-js 直接打包進腳本，不靠 @require，避免 sandbox 取不到全域）。
let _ccConv = null;
let _ccTried = false;
function ccConverter() {
  if (_ccTried) return _ccConv;
  _ccTried = true;
  try {
    _ccConv = OpenCC.Converter({ from: 'tw', to: 'cn' });
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
    // 依長度比例給分：短名被長名包含時給較低分，避免不相關短名虛高誤採
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return 0.5 + 0.5 * ratio;
  }
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
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
