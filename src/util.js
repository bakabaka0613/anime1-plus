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

// Bangumi 全文搜尋會被「主名以外的雜訊」帶偏而漏掉正確條目，兩種真實情況：
//   尾端破折號/英文副標——「随兴旅 -That's Journey-」搜不到，只搜「随兴旅」才排第一；
//   前綴 franchise 名——「銀魂 3年Z班銀八老師」搜回一堆銀魂正篇，去前綴搜「3年Z班銀八老師」才排第一。
// 故把標題以「首個空白」切成 主段 / 尾段，兩段都當補搜關鍵字（不必預判哪段是真名）。
// 各段去除前後破折號/空白雜訊；過短（<2 字）或與原字串相同者捨棄。回傳去重後陣列（無空白 → []）。
// 注意：相似度比對仍以完整 baseName 為準（評分閘門不變，這裡只增加召回），不可拿分段取代 baseName。
export function titleSearchSegments(baseName) {
  const k = String(baseName || '').trim();
  const clean = (s) => s.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  const out = [];
  const add = (s) => {
    const c = clean(s);
    if (c && c.length >= 2 && c !== k && !out.includes(c)) out.push(c);
  };
  // 括號內常是「通用譯名/別名」（anime1 把通用名放括號，如「魔王陛下…R(重來吧，魔王大人！ R)」，
  // 而 Bangumi name_cn 對得上括號內）。取括號外與括號內各一段。半/全形括號皆可。此法最優先。
  const paren = k.match(/^(.*?)[（(]([^（()）]+)[)）](.*)$/);
  if (paren) {
    add(`${paren[1]} ${paren[3]}`); // 括號外（前段＋後段）
    add(paren[2]); // 括號內
    return out;
  }
  // 雙語標題「拉丁名 + CJK名」（如「GRAND BLUE 碧藍之海」「WONDANCE—熱舞青春—」）：在 拉丁→CJK
  // 邊界切，否則下面的「首個空白」切法會把含空白的英文名切爛（GRAND｜BLUE）。此法優先。
  const bi = k.match(/^([A-Za-z][A-Za-z0-9 .,&':!?]*?)[\s—–-]+([぀-ヿ㐀-䶿一-鿿豈-﫿].*)$/);
  if (bi) {
    add(bi[1]);
    add(bi[2]);
    return out;
  }
  // 一般：首個分隔符切「主段 / 尾段」。分隔符＝em/en dash（常無空白，如尾端破折號副標）、
  // 空白接連字號（如「… -That's Journey-」）、或單純空白。連字號須前有空白才算分隔 → 保護名稱內連字號（K-ON）。
  const m = k.match(/\s*[—–]+\s*|\s+-+\s*|\s+/);
  if (m) {
    add(k.slice(0, m.index));
    add(k.slice(m.index + m[0].length));
  }
  return out;
}

// Bangumi infobox 的別名值常把多個名字用頓號/逗號併在一條（如「醜男真戰士、丑男真战士」）。
// 拆成個別名字供逐一比對——否則 normalizeName 吃掉頓號後會變相黏接（「丑男真战士丑男真战士」），
// 單一標題只對到一半、過不了 alias 的 0.9 而漏配。只拆列舉分隔（、，,;；/／），不拆空白：
// 保留多字英文名完整（如「Busamen Gachi Fighter」）。回傳去空白後的非空陣列。
export function splitAliasNames(value) {
  return String(value || '')
    .split(/[、，,;；/／]/)
    .map((s) => s.trim())
    .filter(Boolean);
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

// 最長共同子序列長度（字元層級）。供不同中文譯名比對：字多半相同但有插入/換序
// （如「这是你与我的最后战场或是开创世界的圣战」對「你与我最后的战场亦或是世界起始的圣战」）。
export function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// 名稱相似度 0~1（正規化後）。一方包含另一方時依長度比給分；另計 LCS 比例取較大。
export function similarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  let score;
  if (na.includes(nb) || nb.includes(na)) {
    // 依長度比例給分：短名被長名包含時給很低分，避免常見短詞（如「魔法」）虛高誤採。
    // 候選名長度需達 parsed 約 40% 才可能過 confident 的 name>=0.5 門檻。
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    score = 0.3 + 0.5 * ratio;
  } else {
    const dist = levenshtein(na, nb);
    score = 1 - dist / Math.max(na.length, nb.length);
  }
  // 不同譯名（字多半相同、僅插入/換序）→ LCS 比例更準。以較長者正規化：短名被長名包含時
  // lcsRatio ≈ 長度比，不會虛高（避免「短名虛高誤採」回歸）；近長度的兩譯名才會拿到高分。
  const lcsRatio = lcsLength(na, nb) / Math.max(na.length, nb.length);
  return Math.max(score, lcsRatio);
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

// 依視窗 hint（catId 順序，近→遠）從 jobs 中挑「最靠近視窗」的 index：job.key 在 hint 中 rank 最小者。
// 全不在 hint（或無 hint/空 jobs）→ 0（FIFO）。純函式，便於測試。供 recheck 層動態挑最近的待確認。
export function pickByHint(jobs, hint) {
  if (!jobs || !jobs.length || !hint || !hint.length) return 0;
  const rank = new Map();
  hint.forEach((k, i) => {
    if (!rank.has(k)) rank.set(k, i);
  });
  let best = 0;
  let bestRank = Infinity;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const r = j && j.key != null && rank.has(j.key) ? rank.get(j.key) : Infinity;
    if (r < bestRank) {
      bestRank = r;
      best = i;
    }
  }
  return best;
}

// 跨分頁「背景複查」租約決策（純函式，便於測試）：多分頁各自有獨立的封面佇列與限流，
// 若每個分頁都跑背景複查 → 對 Bangumi 請求量翻倍、重複複查同一批待確認。故用一份共享租約，
// 只有持租約的分頁跑背景複查。給定目前 storage 中的租約、本分頁 id、現在時間、TTL，回傳：
//   { owns:true,  lease:{owner,expires} } → 可跑（呼叫端把 lease 寫回 storage 取得/續租）
//   { owns:false, lease:<原租約> }        → 別的分頁正持新鮮租約 → 本分頁不跑
// 規則：無租約 / 租約過期（expires<=now）/ 本來就是自己 → 取得或續租；否則讓賢。
export function evaluateRecheckLease(stored, tabId, now, ttl) {
  const fresh = stored && typeof stored.expires === 'number' && stored.expires > now;
  if (fresh && stored.owner !== tabId) return { owns: false, lease: stored };
  return { owns: true, lease: { owner: tabId, expires: now + ttl } };
}

// 背景複查「待確認」封面的判定：未在 retryMs 內做過深比對者才需再試。
// deepTried 為上次深比對仍配不到的時間戳；retryMs 預設 7 天（日後 Bangumi 新條目上架仍有機會補上）。
export function shouldRecheck(cover, now, retryMs = 7 * 24 * 60 * 60 * 1000) {
  if (!cover || !cover.tentative) return false;
  if (cover.deepTried && now - cover.deepTried < retryMs) return false;
  return true;
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
