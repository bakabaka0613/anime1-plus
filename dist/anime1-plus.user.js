// ==UserScript==
// @name         Anime1.me Plus
// @namespace    https://github.com/bakabaka0613/anime1-plus
// @version      0.6.37
// @description  Anime1.me 增強：自動封面圖、觀看記錄、續播、自動下一集、網頁全螢幕、快捷鍵
// @author       bakabaka0613
// @license      MIT
// @match        https://anime1.me/*
// @icon         https://anime1.me/favicon.ico
// @homepageURL  https://github.com/bakabaka0613/anime1-plus
// @supportURL   https://github.com/bakabaka0613/anime1-plus/issues
// @updateURL    https://raw.githubusercontent.com/bakabaka0613/anime1-plus/main/dist/anime1-plus.user.js
// @downloadURL  https://raw.githubusercontent.com/bakabaka0613/anime1-plus/main/dist/anime1-plus.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.bgm.tv
// @connect      lain.bgm.tv
// @connect      api.github.com
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  // src/dom.js
  var SEL = {
    entryTitle: ".entry-title",
    entryContent: ".entry-content",
    // 單集頁的分類連結（WordPress 標準 rel，外加 fallback）
    categoryLink: 'a[rel~="category"], .cat-links a, .entry-meta a[href*="/category/"], .entry-footer a[href*="/category/"], footer a[href*="/category/"]',
    // 分類頁每集連結：指向 /{postId} 且內含標題
    episodeLink: 'a[href*="anime1.me/"] h3, a[href*="anime1.me/"] h2'
  };
  function getPageType(loc = location) {
    const p = loc.pathname;
    if (/^\/category\//.test(p)) return "category";
    if (/^\/\d+\/?$/.test(p)) return "episode";
    if (p === "/" || p === "") return "list";
    return "other";
  }
  function postIdFromPath(loc = location) {
    const m = loc.pathname.match(/^\/(\d+)\/?$/);
    return m ? m[1] : null;
  }
  function postIdFromUrl(url) {
    const m = String(url || "").match(/anime1\.me\/(\d+)/);
    return m ? m[1] : null;
  }
  function postUrl(postId) {
    return postId ? `https://anime1.me/${postId}` : null;
  }
  function animeKeyFromCategoryPath(path) {
    let p = path;
    try {
      p = decodeURIComponent(path);
    } catch {
    }
    const m = p.match(/\/category\/.+$/);
    p = m ? m[0] : p;
    return p.replace(/\/page\/\d+\/?$/, "").replace(/\/+$/, "");
  }
  function yearFromText(text) {
    const m = String(text || "").match(/(\d{4})\s*年/);
    return m ? parseInt(m[1], 10) : null;
  }
  function waitForVideo(timeout = 2e4) {
    return new Promise((resolve) => {
      const existing = document.querySelector("video");
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const v = document.querySelector("video");
        if (v) {
          obs.disconnect();
          resolve(v);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(document.querySelector("video"));
      }, timeout);
    });
  }
  function parseApiReq(el) {
    if (!el) return null;
    const raw = el.getAttribute && el.getAttribute("data-apireq");
    if (!raw) return null;
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  function getCategoryId() {
    const req = parseApiReq(document.querySelector("[data-apireq]"));
    if (req && req.c) return String(req.c);
    const cls = `${document.body.className} ${(document.querySelector('article[class*="category-"]') || {}).className || ""}`;
    const m = cls.match(/category-(\d+)/);
    if (m) return m[1];
    const a = document.querySelector('a[href*="cat="]');
    if (a) {
      const mm = (a.getAttribute("href") || "").match(/[?&]cat=(\d+)/);
      if (mm) return mm[1];
    }
    for (const s of document.querySelectorAll("script:not([src])")) {
      const mm = (s.textContent || "").match(/categoryID['"]?\s*[:=]\s*['"]?(\d+)/);
      if (mm) return mm[1];
    }
    return null;
  }
  function getAnimeTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.replace(/\s*全集\s*$/, "").trim();
    const h1 = getContentH1();
    if (h1) return h1.textContent.trim();
    return (document.title || "").replace(/\s*[–\-|].*$/, "").trim();
  }
  function getContentH1() {
    const pageTitle = document.querySelector(".page-title");
    if (pageTitle && pageTitle.textContent.trim()) return pageTitle;
    return Array.from(document.querySelectorAll("h1")).find(
      (h) => !h.closest("#masthead, .site-header, nav, footer, aside") && h.textContent.trim()
    ) || null;
  }
  function getCategoryInfo() {
    const a = document.querySelector(SEL.categoryLink);
    if (!a) return null;
    const href = a.getAttribute("href") || "";
    const name = (a.textContent || "").trim();
    const animeKey = animeKeyFromCategoryPath(href);
    return { href, name, animeKey, year: yearFromText(animeKey) };
  }

  // src/parse.js
  var CN_DIGIT = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnToNum(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === "十") return 10;
    let m;
    if (m = s.match(/^十([一二三四五六七八九])$/)) return 10 + CN_DIGIT[m[1]];
    if (m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/)) {
      return CN_DIGIT[m[1]] * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
    }
    return CN_DIGIT[s] || null;
  }
  var ROMAN = { "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5, "Ⅵ": 6 };
  var ROMAN_ASCII = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
  var ORDINAL_WORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
  function extractEpisode(title) {
    const m = title.match(/\[([^\]]*)\]\s*$/);
    if (!m) return { ep: null, epRaw: null, rest: title.trim() };
    const epRaw = m[1].trim();
    const n = epRaw.match(/^(\d+(?:\.\d+)?)(?:v\d+)?$/i);
    return {
      ep: n ? parseFloat(n[1]) : null,
      epRaw,
      rest: title.slice(0, m.index).trim()
    };
  }
  function extractType(rest, epRaw) {
    const hay = `${rest} ${epRaw || ""}`;
    let type = "TV";
    if (/劇場版|剧场版|電影版|电影版|\bmovie\b/i.test(hay)) type = "MOVIE";
    else if (/OVA|OAD/i.test(hay)) type = "OVA";
    else if (/特別篇|特别篇|總集篇|总集篇|\bSP\b|\bspecial\b/i.test(hay)) type = "SP";
    const cleaned = rest.replace(
      /劇場版|剧场版|電影版|电影版|\bmovie\b|OVA|OAD|特別篇|特别篇|總集篇|总集篇|\bSP\b|\bspecial\b/gi,
      ""
    );
    return { type, rest: cleaned };
  }
  function extractSeason(rest) {
    const tries = [
      { re: /第\s*([一二三四五六七八九十\d]+)\s*[季期部]/, num: (m) => cnToNum(m[1]) },
      { re: /\b(\d+)\s*(?:st|nd|rd|th)\s+season\b/i, num: (m) => parseInt(m[1], 10) },
      { re: /\bseason\s*(\d+)\b/i, num: (m) => parseInt(m[1], 10) },
      { re: /\bseason\s+(iii|ii|iv|vi|v|i)\b/i, num: (m) => ROMAN_ASCII[m[1].toLowerCase()] },
      { re: /\b(first|second|third|fourth|fifth|sixth)\s+season\b/i, num: (m) => ORDINAL_WORD[m[1].toLowerCase()] },
      { re: /\bpart\s*(\d+)\b/i, num: (m) => parseInt(m[1], 10) },
      { re: /\b(?:the\s+)?final\s+season\b/i, num: () => 2 },
      { re: /[ⅡⅢⅣⅤⅥ]/, num: (m) => ROMAN[m[0]] }
    ];
    let seasonNum = 1;
    let out = rest;
    for (const t of tries) {
      const m = out.match(t.re);
      if (!m) continue;
      const n = t.num(m);
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
      if (seasonNum === 1 && n) seasonNum = n;
    }
    return { seasonNum, rest: out };
  }
  function normalizeSpace(s) {
    return s.replace(/[（(]\s*[）)]/g, "").replace(/\s[–\-—]+(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
  }
  function parseTitle(raw) {
    const title = String(raw || "").trim();
    const { ep, epRaw, rest: r1 } = extractEpisode(title);
    const { type, rest: r2 } = extractType(r1, epRaw);
    const { seasonNum, rest: r3 } = extractSeason(r2);
    return { raw: title, ep, epRaw, seasonNum, type, baseName: normalizeSpace(r3) };
  }

  // src/util.js
  var _ccCache = {};
  function ccConverter(from, to) {
    const key = `${from}2${to}`;
    if (key in _ccCache) return _ccCache[key];
    _ccCache[key] = null;
    try {
      const g = typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : {};
      const OC = typeof OpenCC !== "undefined" && OpenCC || g.OpenCC;
      if (OC && OC.Converter) _ccCache[key] = OC.Converter({ from, to });
    } catch {
    }
    return _ccCache[key];
  }
  function toSimplified(s) {
    const str = String(s || "");
    const conv = ccConverter("tw", "cn");
    return conv ? conv(str) : str;
  }
  function toTraditional(s) {
    const str = String(s || "");
    const conv = ccConverter("cn", "tw");
    return conv ? conv(str) : str;
  }
  function titleSearchSegments(baseName) {
    const k = String(baseName || "").trim();
    const clean = (s) => s.replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
    const out = [];
    const add = (s) => {
      const c = clean(s);
      if (c && c.length >= 2 && c !== k && !out.includes(c)) out.push(c);
    };
    const paren = k.match(/^(.*?)[（(]([^（()）]+)[)）](.*)$/);
    if (paren) {
      add(`${paren[1]} ${paren[3]}`);
      add(paren[2]);
      return out;
    }
    const bi = k.match(/^([A-Za-z][A-Za-z0-9 .,&':!?]*?)[\s—–-]+([぀-ヿ㐀-䶿一-鿿豈-﫿].*)$/);
    if (bi) {
      add(bi[1]);
      add(bi[2]);
      return out;
    }
    const m = k.match(/\s*[—–]+\s*|\s+-+\s*|\s+/);
    if (m) {
      add(k.slice(0, m.index));
      add(k.slice(m.index + m[0].length));
    }
    return out;
  }
  function splitAliasNames(value) {
    return String(value || "").split(/[、，,;；/／]/).map((s) => s.trim()).filter(Boolean);
  }
  function toHalfWidth(s) {
    return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/　/g, " ");
  }
  function normalizeName(s) {
    return toSimplified(toHalfWidth(String(s || ""))).toLowerCase().replace(/[\s]/g, "").replace(/[!?。．・:~\-—_、,「」『』()\[\]{}"'’“”…★☆※／/]/g, "");
  }
  function levenshtein(a, b) {
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
  function lcsLength(a, b) {
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
  function similarity(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    let score;
    if (na.includes(nb) || nb.includes(na)) {
      const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
      score = 0.3 + 0.5 * ratio;
    } else {
      const dist = levenshtein(na, nb);
      score = 1 - dist / Math.max(na.length, nb.length);
    }
    const lcsRatio = lcsLength(na, nb) / Math.max(na.length, nb.length);
    return Math.max(score, lcsRatio);
  }
  function parseLatestEp(text) {
    const t = String(text || "").trim();
    const airing = t.match(/連載中\s*\(([^)]*)\)/);
    const head = airing ? airing[1] : t.split("+")[0];
    const nums = head.match(/\d+(?:\.\d+)?/g);
    return nums ? Math.max(...nums.map(Number)) : null;
  }
  function isAiring(text) {
    return /連載中/.test(String(text || ""));
  }
  function pendingNewEpisodes(latestEp, watch) {
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
  function caughtUpNewEpisodes(latestEp, watch, maxEpSeen) {
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
  function resumeTarget(episodes) {
    let lastEp = null;
    let lastAt = -1;
    for (const e of Object.keys(episodes || {})) {
      const at = episodes[e] && episodes[e].watchedAt || 0;
      if (at > lastAt) {
        lastAt = at;
        lastEp = e;
      }
    }
    if (lastEp == null) return { mode: "none" };
    if (!episodes[lastEp].done) return { mode: "resume", ep: lastEp };
    return { mode: "next", ep: Number(lastEp) + 1 };
  }
  function isCaughtUp(episodes, metaEpisodes, newEps) {
    const target = resumeTarget(episodes);
    if (target.mode === "resume") return false;
    const hasNextItem = Array.isArray(metaEpisodes) && metaEpisodes.some((it) => String(it.ep) === String(target.ep));
    if (hasNextItem) return false;
    if (newEps) return false;
    return true;
  }
  function pickByHint(jobs, hint) {
    if (!jobs || !jobs.length || !hint || !hint.length) return 0;
    const rank = /* @__PURE__ */ new Map();
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
  function evaluateRecheckLease(stored, tabId, now, ttl) {
    const fresh = stored && typeof stored.expires === "number" && stored.expires > now;
    if (fresh && stored.owner !== tabId) return { owns: false, lease: stored };
    return { owns: true, lease: { owner: tabId, expires: now + ttl } };
  }
  function shouldRecheck(cover, now, retryMs = 7 * 24 * 60 * 60 * 1e3) {
    if (!cover || !cover.tentative) return false;
    if (cover.deepTried && now - cover.deepTried < retryMs) return false;
    return true;
  }
  function markEpisodesDone(animeWatch, metaEpisodes, now) {
    const eps = new Set(Object.keys(animeWatch || {}));
    if (Array.isArray(metaEpisodes)) {
      for (const it of metaEpisodes) if (it && it.ep != null) eps.add(String(it.ep));
    }
    const sorted = [...eps].sort((a, b) => Number(a) - Number(b));
    const out = {};
    sorted.forEach((ep, i) => {
      out[ep] = { ...animeWatch && animeWatch[ep], done: true, watchedAt: now + i };
    });
    return out;
  }
  function maxWatchedAt(animeWatch) {
    let mx = 0;
    for (const k of Object.keys(animeWatch || {})) {
      const w = animeWatch[k] && animeWatch[k].watchedAt || 0;
      if (w > mx) mx = w;
    }
    return mx;
  }
  function isDeleted(animeWatch, animeMeta) {
    const d = animeMeta && animeMeta.deletedAt || 0;
    if (!d) return false;
    return d >= maxWatchedAt(animeWatch);
  }
  function unionEpisodes(a, b) {
    const byPost = /* @__PURE__ */ new Map();
    for (const e of Array.isArray(a) ? a : []) if (e && e.postId != null) byPost.set(String(e.postId), e);
    for (const e of Array.isArray(b) ? b : []) if (e && e.postId != null) byPost.set(String(e.postId), e);
    return [...byPost.values()];
  }
  function mergeSync(local, remote) {
    const lw = local && local.watch || {};
    const rw = remote && remote.watch || {};
    const lm = local && local.meta || {};
    const rm = remote && remote.meta || {};
    const watch = {};
    for (const catId of /* @__PURE__ */ new Set([...Object.keys(lw), ...Object.keys(rw)])) {
      const le = lw[catId] || {};
      const re = rw[catId] || {};
      const eps = {};
      for (const ep of /* @__PURE__ */ new Set([...Object.keys(le), ...Object.keys(re)])) {
        const a = le[ep];
        const b = re[ep];
        if (!a) eps[ep] = b;
        else if (!b) eps[ep] = a;
        else eps[ep] = (b.watchedAt || 0) >= (a.watchedAt || 0) ? b : a;
      }
      watch[catId] = eps;
    }
    const meta = {};
    for (const catId of /* @__PURE__ */ new Set([...Object.keys(lm), ...Object.keys(rm)])) {
      const a = lm[catId];
      const b = rm[catId];
      let m;
      if (!a) m = { ...b };
      else if (!b) m = { ...a };
      else {
        const am = typeof a.maxEpSeen === "number" ? a.maxEpSeen : -Infinity;
        const bm = typeof b.maxEpSeen === "number" ? b.maxEpSeen : -Infinity;
        m = { ...bm >= am ? b : a, maxEpSeen: Math.max(am, bm), episodes: unionEpisodes(a.episodes, b.episodes) };
      }
      const dz = Math.max(a && a.deletedAt || 0, b && b.deletedAt || 0);
      if (dz && dz >= maxWatchedAt(watch[catId])) m.deletedAt = dz;
      else delete m.deletedAt;
      meta[catId] = m;
    }
    return { watch, meta };
  }
  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    let lastArgs = null;
    return function throttled(...args) {
      lastArgs = args;
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
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
  function cleanTitle(s) {
    return String(s || "").replace(/\s*[–\-|]\s*Anime1.*$/i, "").trim();
  }
  function normalizeWatchMeta(data) {
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
        if (r.postId) delete r.url;
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
      const m = { ...src.meta[cat] || {} };
      if (typeof m.title === "string") m.title = cleanTitle(m.title);
      if (Array.isArray(m.episodes)) m.episodes = m.episodes.map(slimEp);
      meta[cat] = m;
    }
    const after = JSON.stringify({ watch, meta });
    return { watch, meta, changed: after !== before };
  }
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60 % 60);
    const h = Math.floor(sec / 3600);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function seasonBuckets(r3, r4) {
    const s = String(r4 || "");
    const prefixed = [...s.matchAll(/(\d{4})\s*([春夏秋冬])/g)];
    if (prefixed.length) return prefixed.map((m) => m[1] + m[2]);
    const seasons = s.match(/[春夏秋冬]/g) || [];
    const years = [];
    for (const y of String(r3 || "").match(/\d{4}/g) || []) if (!years.includes(y)) years.push(y);
    if (!seasons.length || !years.length) return [];
    if (years.length === seasons.length) return seasons.map((se, i) => years[i] + se);
    if (years.length === 1) return seasons.map((se) => years[0] + se);
    return seasons.map((se) => years[0] + se);
  }

  // src/store.js
  var ROOT_KEY = "a1p:data";
  var SYNC_KEY = "a1p:sync";
  var RECHECK_LEASE_KEY = "a1p:recheck_lease";
  var COVER_EVT_KEY = "a1p:cover_evt";
  var RECHECK_HINT_KEY = "a1p:recheck_hint";
  var DEFAULT_SETTINGS = {
    autoNext: true,
    // 看完自動下一集
    autoNextThreshold: 0.9,
    // 看完判定比例
    resume: true,
    // 續播
    shortcuts: true,
    // 鍵盤快捷鍵
    seekSeconds: 5,
    // 方向鍵快進/後退秒數
    rememberRate: true,
    // 記憶播放速度
    listThumbs: true,
    // 列表頁增強（封面/卡片）
    gridView: true,
    // 列表頁卡片檢視（false = 原始列表）
    cardWidth: 250
    // 卡片最小寬度 px
  };
  function loadRoot() {
    try {
      const raw = GM_getValue(ROOT_KEY, "");
      const obj = raw ? JSON.parse(raw) : {};
      return {
        covers: obj.covers || {},
        // { [catId]: { subjectId, cover, name, name_cn, score, manual, ts } }
        watch: obj.watch || {},
        // { [catId]: { [ep]: { currentTime, duration, done, watchedAt, postId } } }（postId 重建單集頁網址）
        meta: obj.meta || {},
        // { [catId]: { title(乾淨無站名後綴), maxEpSeen, episodes:[{ep,postId}] } }
        settings: { ...DEFAULT_SETTINGS, ...obj.settings || {} }
      };
    } catch {
      return { covers: {}, watch: {}, meta: {}, settings: { ...DEFAULT_SETTINGS } };
    }
  }
  var changeListener = null;
  function onDataChange(fn) {
    changeListener = fn;
  }
  function saveRoot(root) {
    GM_setValue(ROOT_KEY, JSON.stringify(root));
    if (changeListener) {
      try {
        changeListener();
      } catch {
      }
    }
  }
  function getCover(catId) {
    return loadRoot().covers[catId] || null;
  }
  function setCover(catId, data) {
    const root = loadRoot();
    root.covers[catId] = { ...data, ts: Date.now() };
    saveRoot(root);
  }
  function getRecheckLease() {
    try {
      return JSON.parse(GM_getValue(RECHECK_LEASE_KEY, "") || "null");
    } catch {
      return null;
    }
  }
  function setRecheckLease(lease) {
    GM_setValue(RECHECK_LEASE_KEY, JSON.stringify(lease));
  }
  function notifyCoverUpgrade(catId) {
    GM_setValue(COVER_EVT_KEY, JSON.stringify({ catId, ts: Date.now() }));
  }
  function setRecheckHint(order) {
    GM_setValue(RECHECK_HINT_KEY, JSON.stringify({ ts: Date.now(), order: order || [] }));
  }
  function getRecheckHint(maxAgeMs = 12e4) {
    try {
      const h = JSON.parse(GM_getValue(RECHECK_HINT_KEY, "") || "null");
      if (h && Array.isArray(h.order) && typeof h.ts === "number" && Date.now() - h.ts <= maxAgeMs) return h.order;
    } catch {
    }
    return null;
  }
  function onCoverUpgradeEvent(fn) {
    if (typeof GM_addValueChangeListener !== "function") return;
    GM_addValueChangeListener(COVER_EVT_KEY, (_name, _old, newV, remote) => {
      if (!remote) return;
      try {
        const e = JSON.parse(newV);
        if (e && e.catId) fn(e.catId);
      } catch {
      }
    });
  }
  function getTentativeCovers() {
    const { covers } = loadRoot();
    return Object.entries(covers).filter(([, c]) => c && c.tentative).map(([catId, c]) => ({ catId, ...c }));
  }
  function getAnimeWatch(catId) {
    const root = loadRoot();
    if (isDeleted(root.watch[catId], root.meta[catId])) return {};
    return root.watch[catId] || {};
  }
  function getEpisode(catId, ep) {
    const root = loadRoot();
    if (isDeleted(root.watch[catId], root.meta[catId])) return null;
    return (root.watch[catId] || {})[ep] || null;
  }
  function setEpisodeProgress(catId, ep, data) {
    const root = loadRoot();
    root.watch[catId] = root.watch[catId] || {};
    const prev = root.watch[catId][ep] || {};
    const rec = { ...prev, ...data, watchedAt: Date.now() };
    if (rec.postId && rec.url) delete rec.url;
    root.watch[catId][ep] = rec;
    if (root.meta[catId] && root.meta[catId].deletedAt) delete root.meta[catId].deletedAt;
    saveRoot(root);
  }
  function setMeta(catId, data) {
    const root = loadRoot();
    root.meta[catId] = { ...root.meta[catId] || {}, ...data };
    saveRoot(root);
  }
  function getMeta(catId) {
    return loadRoot().meta[catId] || null;
  }
  function getInProgressList() {
    const root = loadRoot();
    const out = [];
    for (const catId of Object.keys(root.watch)) {
      if (isDeleted(root.watch[catId], root.meta[catId])) continue;
      const eps = root.watch[catId];
      const epNums = Object.keys(eps);
      const anyUnfinished = epNums.some((e) => !eps[e].done);
      const lastWatched = Math.max(...epNums.map((e) => eps[e].watchedAt || 0));
      out.push({
        catId,
        cover: root.covers[catId] || null,
        meta: root.meta[catId] || null,
        episodes: eps,
        anyUnfinished,
        lastWatched
      });
    }
    return out.sort((a, b) => b.lastWatched - a.lastWatched);
  }
  function getSettings() {
    return loadRoot().settings;
  }
  function setSettings(patch) {
    const root = loadRoot();
    root.settings = { ...root.settings, ...patch };
    saveRoot(root);
  }
  function clearAnime(catId) {
    const root = loadRoot();
    delete root.covers[catId];
    delete root.watch[catId];
    delete root.meta[catId];
    saveRoot(root);
  }
  function markAnimeWatched(catId) {
    const root = loadRoot();
    const metaEps = root.meta[catId] && root.meta[catId].episodes;
    root.watch[catId] = markEpisodesDone(root.watch[catId] || {}, metaEps, Date.now());
    saveRoot(root);
  }
  function deleteAnimeSynced(catId) {
    const root = loadRoot();
    const eps = root.watch[catId];
    if (eps) for (const ep of Object.keys(eps)) eps[ep] = { ...eps[ep], currentTime: 0 };
    root.meta[catId] = { ...root.meta[catId] || {}, deletedAt: Date.now() };
    saveRoot(root);
  }
  function clearCover(catId) {
    const root = loadRoot();
    delete root.covers[catId];
    saveRoot(root);
  }
  function clearCovers() {
    const root = loadRoot();
    root.covers = {};
    saveRoot(root);
  }
  function clearWatch() {
    const root = loadRoot();
    root.watch = {};
    root.meta = {};
    saveRoot(root);
  }
  function clearSettings() {
    const root = loadRoot();
    root.settings = { ...DEFAULT_SETTINGS };
    saveRoot(root);
  }
  function clearAll() {
    saveRoot({ covers: {}, watch: {}, meta: {}, settings: { ...DEFAULT_SETTINGS } });
  }
  function exportAll() {
    return JSON.stringify(loadRoot(), null, 2);
  }
  function importAll(jsonText, { merge = true } = {}) {
    const incoming = JSON.parse(jsonText);
    if (!merge) {
      saveRoot({
        covers: incoming.covers || {},
        watch: incoming.watch || {},
        meta: incoming.meta || {},
        settings: { ...DEFAULT_SETTINGS, ...incoming.settings || {} }
      });
      return;
    }
    const root = loadRoot();
    saveRoot({
      covers: { ...root.covers, ...incoming.covers || {} },
      watch: { ...root.watch, ...incoming.watch || {} },
      meta: { ...root.meta, ...incoming.meta || {} },
      settings: { ...root.settings, ...incoming.settings || {} }
    });
  }
  var DEFAULT_SYNC = { token: "", gistId: "", enabled: false, lastSyncAt: 0, lastError: "" };
  function getSyncConfig() {
    try {
      const raw = GM_getValue(SYNC_KEY, "");
      return { ...DEFAULT_SYNC, ...raw ? JSON.parse(raw) : {} };
    } catch {
      return { ...DEFAULT_SYNC };
    }
  }
  function setSyncConfig(patch) {
    const next = { ...getSyncConfig(), ...patch };
    GM_setValue(SYNC_KEY, JSON.stringify(next));
    return next;
  }
  function getSyncSubset() {
    const root = loadRoot();
    return { watch: root.watch, meta: root.meta };
  }
  function applySyncedData(incoming) {
    const root = loadRoot();
    const before = JSON.stringify({ watch: root.watch, meta: root.meta });
    const merged = mergeSync({ watch: root.watch, meta: root.meta }, incoming || {});
    const norm = normalizeWatchMeta(merged);
    const after = JSON.stringify({ watch: norm.watch, meta: norm.meta });
    if (after === before) return { changed: false };
    root.watch = norm.watch;
    root.meta = norm.meta;
    saveRoot(root);
    return { changed: true };
  }
  function migrateStored() {
    const root = loadRoot();
    const norm = normalizeWatchMeta({ watch: root.watch, meta: root.meta });
    if (!norm.changed) return false;
    root.watch = norm.watch;
    root.meta = norm.meta;
    saveRoot(root);
    return true;
  }

  // src/animelist.js
  var URL2 = "https://anime1.me/animelist.json";
  var TTL = 5 * 60 * 1e3;
  var cache = null;
  var cacheAt = 0;
  async function fetchLatestEpMap() {
    const now = Date.now();
    if (cache && now - cacheAt < TTL) return cache;
    try {
      const res = await fetch(URL2, { credentials: "omit" });
      if (!res.ok) return cache || {};
      const rows = await res.json();
      const map = {};
      for (const r of rows) {
        if (!Array.isArray(r) || r[0] == null) continue;
        const epText = String(r[2]);
        map[`cat:${r[0]}`] = {
          ep: parseLatestEp(epText),
          // 無一般集數 → null（renderPanel 視同無更新）
          airing: isAiring(epText),
          name: r[1] != null ? String(r[1]).trim() : "",
          year: r[3] != null ? String(r[3]) : null,
          season: r[4] != null ? String(r[4]) : null
          // 原始季欄（可能跨季/跨年斜線多值）→ seasonBuckets 解析
        };
      }
      cache = map;
      cacheAt = now;
      return map;
    } catch {
      return cache || {};
    }
  }

  // src/ui.js
  var BGM = (id) => `https://bgm.tv/subject/${id}`;
  var stylesInjected = false;
  function injectStyles() {
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
body.a1p-grid-on .a1p-grid-table .a1p-poster{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:#2a2a30}
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
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }
  var PROJECT_URL = "https://github.com/bakabaka0613/anime1-plus";
  var PROJECT_LABEL = "插件原始碼";
  function injectProjectLinks() {
    injectStyles();
    const mkLink = (textClass) => {
      const a = document.createElement("a");
      a.href = PROJECT_URL;
      a.target = "_blank";
      a.rel = "noopener";
      const txt = document.createElement("span");
      if (textClass) txt.className = textClass;
      txt.textContent = PROJECT_LABEL;
      a.appendChild(txt);
      return a;
    };
    const menu = document.getElementById("primary-menu");
    if (menu && !menu.querySelector(".a1p-nav-link")) {
      const li = document.createElement("li");
      li.className = "menu-item a1p-nav-link";
      li.appendChild(mkLink("a1p-nav-text"));
      menu.appendChild(li);
    }
    const info = document.querySelector("#colophon .site-info");
    if (info && !info.querySelector(".a1p-foot-link")) {
      const span = document.createElement("span");
      span.className = "a1p-foot-link";
      span.appendChild(document.createElement("br"));
      span.appendChild(mkLink());
      info.appendChild(span);
    }
  }
  function toastWrap() {
    let w = document.querySelector(".a1p-toast-wrap");
    if (!w) {
      w = document.createElement("div");
      w.className = "a1p-toast-wrap";
      document.body.appendChild(w);
    }
    return w;
  }
  function toast(msg, { actionLabel, onAction, actions, duration = 4e3 } = {}) {
    injectStyles();
    const el = document.createElement("div");
    el.className = "a1p-toast";
    const span = document.createElement("span");
    span.textContent = msg;
    el.appendChild(span);
    const list = actions && actions.length ? actions : actionLabel ? [{ label: actionLabel, onAction }] : [];
    for (const a of list) {
      const btn = document.createElement("button");
      btn.className = "a1p-btn";
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
  function renderCoverCard(mountEl, data, { onChange } = {}) {
    injectStyles();
    if (!mountEl) return;
    const old = document.querySelector(".a1p-card");
    if (old) old.remove();
    const card = document.createElement("div");
    card.className = "a1p-card";
    const badge = data.manual ? '<span class="a1p-badge ok">已手動確認</span>' : `<span class="a1p-badge ${data.score >= 0.6 ? "ok" : "warn"}">信心 ${Math.round((data.score || 0) * 100)}%</span>`;
    const bgmNames = [data.name_cn, data.name].filter(Boolean).join(" · ");
    card.innerHTML = `
    <img referrerpolicy="no-referrer" src="${data.cover || ""}" alt="">
    <div class="a1p-meta">
      <p class="a1p-name">${escapeHtml(data.local || data.name_cn || data.name || "")}</p>
      <p class="a1p-sub">${escapeHtml(bgmNames)}</p>
      <div>${badge}</div>
      <div style="margin-top:8px">
        <a class="a1p-btn" href="${BGM(data.subjectId)}" target="_blank" rel="noreferrer">Bangumi 條目</a>
        <button class="a1p-btn a1p-change">換一個</button>
      </div>
    </div>`;
    mountEl.parentNode.insertBefore(card, mountEl);
    card.querySelector(".a1p-change").onclick = () => onChange && onChange();
  }
  function renderCoverPicker(mountEl, ranked, parsed, onPick) {
    injectStyles();
    if (!mountEl) return;
    const old = document.querySelector(".a1p-card");
    if (old) old.remove();
    const card = document.createElement("div");
    card.className = "a1p-card";
    const opts = ranked.map((r, i) => {
      const s = r.subject;
      const cover = s.images && (s.images.medium || s.images.common || s.images.grid) || "";
      return `<div class="a1p-opt" data-i="${i}">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <span>${escapeHtml(s.name_cn || s.name || "")}</span>
      </div>`;
    }).join("");
    card.innerHTML = `
    <div class="a1p-meta" style="flex:1">
      <p class="a1p-name">無法確定封面，請手動選擇</p>
      <p class="a1p-sub">解析名稱：${escapeHtml(parsed.baseName)}${parsed.seasonNum > 1 ? `（第${parsed.seasonNum}季）` : ""}</p>
      <div class="a1p-pick">${opts || '<span class="a1p-sub">查無候選</span>'}</div>
    </div>`;
    mountEl.parentNode.insertBefore(card, mountEl);
    card.querySelectorAll(".a1p-opt").forEach((opt) => {
      opt.onclick = () => onPick(ranked[Number(opt.dataset.i)]);
    });
  }
  function markCategoryEpisodes(animeKey) {
    injectStyles();
    const titles = document.querySelectorAll(".entry-title");
    const episodes = [];
    let maxEp = 0;
    let firstAnchor = null;
    titles.forEach((h) => {
      const a = h.querySelector("a[href]");
      if (!a) return;
      const m = (a.href || a.getAttribute("href") || "").match(/anime1\.me\/(\d+)/);
      if (!m) return;
      const postId = m[1];
      if (!firstAnchor) firstAnchor = h;
      const parsed = parseTitle(h.textContent || "");
      if (parsed.ep != null) {
        episodes.push({ ep: parsed.ep, postId });
        maxEp = Math.max(maxEp, parsed.ep);
      } else if (parsed.epRaw || parsed.type !== "TV") {
        episodes.push({ ep: null, epRaw: parsed.epRaw || parsed.type, postId });
      }
      const rec = parsed.ep != null ? getEpisode(animeKey, parsed.ep) : null;
      if (rec && rec.done) {
        h.classList.add("a1p-ep-done");
      } else if (rec && rec.currentTime > 5 && rec.duration > 0) {
        const bar = document.createElement("div");
        bar.className = "a1p-ep-bar";
        bar.style.width = `${Math.min(100, rec.currentTime / rec.duration * 100)}%`;
        h.parentNode.appendChild(bar);
      }
    });
    if (episodes.length) {
      const prev = getMeta(animeKey);
      const byPost = /* @__PURE__ */ new Map();
      if (prev && Array.isArray(prev.episodes)) for (const e of prev.episodes) byPost.set(String(e.postId), e);
      for (const e of episodes) byPost.set(String(e.postId), e);
      const merged = [...byPost.values()];
      const maxEpAll = merged.reduce((mx, e) => typeof e.ep === "number" ? Math.max(mx, e.ep) : mx, 0);
      setMeta(animeKey, {
        episodes: merged,
        maxEpSeen: Math.max(maxEp, maxEpAll, prev && prev.maxEpSeen || 0),
        // 單調不退
        title: cleanTitle(document.title)
      });
    }
    return firstAnchor;
  }
  function appendPagination(bar) {
    const links = document.querySelectorAll(PAGINATION_SEL);
    if (!links.length) return;
    const sep = document.createElement("span");
    sep.className = "a1p-ep-label";
    sep.textContent = "｜其他頁：";
    bar.appendChild(sep);
    const seen = /* @__PURE__ */ new Set();
    links.forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || seen.has(href)) return;
      seen.add(href);
      const link = document.createElement("a");
      link.className = "a1p-ep-page";
      link.href = href;
      link.textContent = (a.textContent || "").trim() || "頁";
      bar.appendChild(link);
    });
  }
  var PAGINATION_SEL = ".pagination a, .nav-links a, a.page-numbers, .wp-pagenavi a, .page-nav a";
  function collapseToSinglePlayer(animeKey) {
    injectStyles();
    if (document.querySelector(".a1p-ep-selector")) return;
    const articles = Array.from(document.querySelectorAll("article")).filter(
      (a) => a.querySelector(".entry-content") && a.querySelector(".entry-title")
    );
    if (!articles.length) return;
    if (articles.length < 2 && !document.querySelector(PAGINATION_SEL)) return;
    const eps = articles.map((a) => {
      const p = parseTitle(a.querySelector(".entry-title").textContent || "");
      return { article: a, ep: p.ep, epRaw: p.epRaw, type: p.type };
    });
    const specialBase = (e) => e.epRaw || (e.type && e.type !== "TV" ? e.type : "") || "特";
    eps.sort((a, b) => {
      const na = a.ep ?? Infinity;
      const nb = b.ep ?? Infinity;
      if (na !== nb) return na - nb;
      return specialBase(a).localeCompare(specialBase(b), void 0, { numeric: true });
    });
    const baseCount = {};
    for (const e of eps) if (e.ep == null) baseCount[specialBase(e)] = (baseCount[specialBase(e)] || 0) + 1;
    const baseUsed = {};
    for (const e of eps) {
      if (e.ep != null) {
        e.label = String(e.ep);
        continue;
      }
      const base = specialBase(e);
      e.label = baseCount[base] > 1 ? `${base}${baseUsed[base] = (baseUsed[base] || 0) + 1}` : base;
    }
    const watch = getAnimeWatch(animeKey);
    const bar = document.createElement("div");
    bar.className = "a1p-ep-selector";
    const label = document.createElement("span");
    label.className = "a1p-ep-label";
    label.textContent = "選集：";
    bar.appendChild(label);
    const select = (i) => {
      eps.forEach((e, j) => {
        const hide = j !== i;
        e.article.classList.toggle("a1p-ep-hidden", hide);
        e.btn.classList.toggle("a1p-ep-active", j === i);
        if (hide) {
          const v = e.article.querySelector("video");
          if (v && !v.paused) {
            try {
              v.pause();
            } catch {
            }
          }
        }
      });
      window.dispatchEvent(new Event("resize"));
    };
    eps.forEach((e, i) => {
      const btn = document.createElement("button");
      btn.className = "a1p-ep-btn";
      btn.type = "button";
      btn.textContent = e.label;
      const rec = e.ep != null ? watch[e.ep] : null;
      if (rec && rec.done) btn.classList.add("a1p-ep-done-btn");
      btn.addEventListener("click", () => select(i));
      e.btn = btn;
      bar.appendChild(btn);
    });
    appendPagination(bar);
    articles[0].parentNode.insertBefore(bar, articles[0]);
    let defaultIdx = eps.length - 1;
    const target = resumeTarget(watch);
    if (target.mode === "resume" || target.mode === "next") {
      const idx = eps.findIndex((x) => String(x.ep) === String(target.ep));
      if (idx >= 0) defaultIdx = idx;
    }
    select(defaultIdx);
  }
  var NAV_LINK_TEXTS = ["全集連結", "上一集", "下一集", "上一話", "下一話"];
  function orderedMetaEpisodes(list) {
    return [...list].sort((a, b) => {
      const na = typeof a.ep === "number" ? a.ep : Infinity;
      const nb = typeof b.ep === "number" ? b.ep : Infinity;
      if (na !== nb) return na - nb;
      return String(a.epRaw || "").localeCompare(String(b.epRaw || ""), void 0, { numeric: true });
    });
  }
  function episodeNeighbors(animeKey, ep, epRaw, postId) {
    const meta = getMeta(animeKey);
    const eps = meta && Array.isArray(meta.episodes) ? meta.episodes : [];
    if (!eps.length) return { found: false, prev: null, next: null };
    const list = orderedMetaEpisodes(eps);
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
  function navButton(text, href, cls) {
    const a = document.createElement("a");
    a.className = href ? `a1p-btn ${cls}` : `a1p-btn ${cls} a1p-btn-disabled`;
    a.textContent = text;
    if (href) a.href = href;
    return a;
  }
  function enhanceEpisodeNav({ hide = false, animeKey = null, ep = null, epRaw = null, postId = null } = {}) {
    injectStyles();
    const rows = /* @__PURE__ */ new Set();
    for (const a of document.querySelectorAll("a")) {
      if (a.closest(".a1p-navrow, .a1p-nav-hidden")) continue;
      if (!NAV_LINK_TEXTS.includes((a.textContent || "").trim())) continue;
      if (!hide) a.classList.add("a1p-btn");
      if (a.parentNode) rows.add(a.parentNode);
    }
    for (const p of rows) {
      if (hide) {
        p.classList.add("a1p-nav-hidden");
      } else {
        p.classList.add("a1p-navrow");
        p.querySelectorAll("br").forEach((br) => br.remove());
      }
    }
    if (hide || !animeKey) return;
    const { found, prev, next } = episodeNeighbors(animeKey, ep, epRaw, postId);
    for (const p of rows) {
      if (found) {
        [...p.querySelectorAll("a")].forEach((a) => {
          if (a.classList.contains("a1p-prev-ep") || a.classList.contains("a1p-next-ep")) return;
          if ((a.textContent || "").trim() === "全集連結") return;
          a.remove();
        });
        if (!p.querySelector(".a1p-next-ep")) p.appendChild(navButton("下一集", next, "a1p-next-ep"));
      }
      const hasPrev = p.querySelector(".a1p-prev-ep") || [...p.querySelectorAll("a")].some((a) => (a.textContent || "").trim() === "上一集");
      if (!hasPrev) p.insertBefore(navButton("上一集", prev, "a1p-prev-ep"), p.firstChild);
    }
  }
  function renderLastWatched(animeKey, mountEl) {
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
    const num = String(animeKey).replace(/^cat:/, "");
    const catUrl = /^\d+$/.test(num) ? `https://anime1.me/?cat=${num}` : null;
    const findUrl = (ep) => {
      const r = watch[ep];
      if (r && (r.url || r.postId)) return r.url || postUrl(r.postId);
      const it = meta && Array.isArray(meta.episodes) ? meta.episodes.find((m) => String(m.ep) === String(ep)) : null;
      return it ? it.url || postUrl(it.postId) : null;
    };
    const target = resumeTarget(watch);
    let text;
    let link = "";
    if (target.mode === "resume") {
      text = `上次看到 <b>第 ${escapeHtml(String(lastEp))} 話</b>（看到 ${formatTime(rec.currentTime || 0)}）`;
      const u = findUrl(target.ep) || catUrl;
      if (u) link = `<a class="a1p-btn" href="${u}">▶ 繼續看</a>`;
    } else {
      text = `上次看完 <b>第 ${escapeHtml(String(lastEp))} 話</b>`;
      const u = findUrl(target.ep);
      if (u) link = `<a class="a1p-btn" href="${u}">▶ 看下一集 第 ${escapeHtml(String(target.ep))} 話</a>`;
    }
    const old = document.querySelector(".a1p-last");
    if (old) old.remove();
    const bar = document.createElement("div");
    bar.className = "a1p-last";
    bar.innerHTML = `<span>${text}</span>${link}`;
    mountEl.parentNode.insertBefore(bar, mountEl);
  }
  function mountTrackingPanel() {
    injectStyles();
    if (document.querySelector(".a1p-fab")) return;
    const fab = document.createElement("button");
    fab.className = "a1p-fab";
    fab.textContent = "📺";
    fab.title = "追番清單（Shift+點擊 或 長按 3 秒 → 管理模式）";
    document.body.appendChild(fab);
    const panel = document.createElement("div");
    panel.className = "a1p-panel a1p-hide";
    document.body.appendChild(panel);
    let pressTimer = null;
    let longPressed = false;
    fab.onclick = (e) => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      const willOpen = panel.classList.contains("a1p-hide");
      panel.classList.toggle("a1p-hide");
      if (willOpen) {
        panel.classList.toggle("a1p-del-mode", e.shiftKey);
        renderPanel(panel);
      } else {
        preview.style.display = "none";
      }
    };
    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    fab.addEventListener("pointerdown", () => {
      longPressed = false;
      cancelPress();
      pressTimer = setTimeout(() => {
        pressTimer = null;
        longPressed = true;
        panel.classList.remove("a1p-hide");
        panel.classList.add("a1p-del-mode");
        preview.style.display = "none";
        renderPanel(panel);
      }, 3e3);
    });
    fab.addEventListener("pointerup", cancelPress);
    fab.addEventListener("pointerleave", cancelPress);
    fab.addEventListener("pointercancel", cancelPress);
    fab.addEventListener("contextmenu", (e) => e.preventDefault());
    const preview = document.createElement("img");
    preview.className = "a1p-cover-preview";
    preview.referrerPolicy = "no-referrer";
    document.body.appendChild(preview);
    const isRowThumb = (el) => el && el.tagName === "IMG" && el.closest(".a1p-row") && !!el.getAttribute("src");
    panel.addEventListener("mouseover", (e) => {
      if (!isRowThumb(e.target)) return;
      preview.src = e.target.src;
      preview.style.display = "block";
      const pr = panel.getBoundingClientRect();
      const ir = e.target.getBoundingClientRect();
      const pw = preview.offsetWidth;
      const ph = preview.offsetHeight;
      let left = pr.left - pw - 10;
      if (left < 8) left = Math.min(pr.right + 10, window.innerWidth - pw - 8);
      let top = ir.top + ir.height / 2 - ph / 2;
      top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
    });
    panel.addEventListener("mouseout", (e) => {
      if (isRowThumb(e.target)) preview.style.display = "none";
    });
    panel.addEventListener("click", (e) => {
      const done = e.target.closest(".a1p-row-done");
      if (done) {
        e.preventDefault();
        e.stopPropagation();
        const name2 = done.dataset.name || "這部動畫";
        if (!confirm(`把「${name2}」標記為已看完？會把已知的每一集都設為看完。`)) return;
        markAnimeWatched(done.dataset.cat);
        renderPanel(panel);
        return;
      }
      const del = e.target.closest(".a1p-row-del");
      if (!del) return;
      e.preventDefault();
      e.stopPropagation();
      const name = del.dataset.name || "這部動畫";
      if (!confirm(`確定刪除「${name}」的觀看進度？
此刪除會同步到其他裝置並隱藏；再次觀看此動畫即可復原。`)) return;
      deleteAnimeSynced(del.dataset.cat);
      renderPanel(panel);
    });
  }
  async function renderPanel(panel) {
    const delMode = panel.classList.contains("a1p-del-mode");
    const head = `<h4>追番清單</h4>${delMode ? '<div class="a1p-panel-hint">管理模式：✓ 標記已看完、🗑 刪除該動畫進度</div>' : ""}`;
    const list = getInProgressList();
    if (!list.length) {
      panel.innerHTML = `${head}<div class="a1p-sub">還沒有觀看記錄</div>`;
      return;
    }
    sortByGroup(list);
    panel.innerHTML = `${head}${panelRowsHtml(list, delMode)}`;
    const latestMap = await fetchLatestEpMap();
    for (const x of list) {
      const info = latestMap[x.catId];
      x.newEps = caughtUpNewEpisodes(info ? info.ep : null, x.episodes, x.meta && x.meta.maxEpSeen);
      x.airing = !!(info && info.airing);
    }
    sortByGroup(list);
    panel.innerHTML = `${head}${panelRowsHtml(list, delMode)}`;
  }
  function sortByGroup(list) {
    list.sort(
      (a, b) => (isCaughtUp(a.episodes, a.meta && a.meta.episodes, a.newEps) ? 1 : 0) - (isCaughtUp(b.episodes, b.meta && b.meta.episodes, b.newEps) ? 1 : 0)
    );
  }
  function panelRowsHtml(list, delMode) {
    return list.map((x) => {
      const cover = x.cover && x.cover.cover ? x.cover.cover : "";
      const name = x.cover && (x.cover.local || x.cover.name_cn && toTraditional(x.cover.name_cn) || x.cover.name) || cleanTitle(x.meta && x.meta.title) || x.catId;
      const eps = x.episodes;
      const num = String(x.catId).replace(/^cat:/, "");
      const catUrl = /^\d+$/.test(num) ? `https://anime1.me/?cat=${num}` : "#";
      const epUrl = (ep) => {
        const r = eps[ep];
        if (r && (r.url || r.postId)) return r.url || postUrl(r.postId);
        const item = x.meta && Array.isArray(x.meta.episodes) ? x.meta.episodes.find((it) => String(it.ep) === String(ep)) : null;
        return item ? item.url || postUrl(item.postId) : catUrl;
      };
      const target = resumeTarget(eps);
      let lastWatchedEp = null;
      let lastAt = -1;
      for (const k of Object.keys(eps)) {
        const at = eps[k] && eps[k].watchedAt || 0;
        if (at > lastAt) {
          lastAt = at;
          lastWatchedEp = k;
        }
      }
      let link;
      if (target.mode === "resume") {
        const t = formatTime((eps[target.ep] || {}).currentTime || 0);
        link = `<a href="${epUrl(target.ep)}">繼續看 第${target.ep}集 (${t})</a>`;
      } else {
        const nextEp = target.ep;
        const nextItem = x.meta && Array.isArray(x.meta.episodes) ? x.meta.episodes.find((it) => String(it.ep) === String(nextEp)) : null;
        if (nextItem) {
          link = `<a href="${nextItem.url || postUrl(nextItem.postId)}">看下一集 第${nextEp}集</a>`;
        } else if (x.newEps) {
          link = `<a href="${catUrl}">看新集 第${nextEp}集</a>`;
        } else {
          const label = x.airing ? "已到最新進度" : "已看完";
          const u = lastWatchedEp != null ? epUrl(lastWatchedEp) : null;
          const epTxt = /^\d+$/.test(String(lastWatchedEp)) ? `第${lastWatchedEp}集` : String(lastWatchedEp || "");
          link = u ? `<a class="a1p-row-term" href="${u}">${label}${epTxt ? `（回看${epTxt}）` : ""}</a>` : `<span class="a1p-sub">${label}</span>`;
        }
      }
      const badge = x.newEps ? `<span class="a1p-row-badge">+${x.newEps} 新集</span>` : "";
      const caughtUp = isCaughtUp(eps, x.meta && x.meta.episodes, x.newEps);
      const actions = delMode ? `<div class="a1p-row-actions">${caughtUp ? "" : `<button class="a1p-row-done" type="button" title="標記為已看完" data-cat="${escapeHtml(x.catId)}" data-name="${escapeHtml(name)}">✓</button>`}<button class="a1p-row-del" type="button" title="刪除此動畫進度" data-cat="${escapeHtml(x.catId)}" data-name="${escapeHtml(name)}">🗑</button></div>` : "";
      return `<div class="a1p-row${x.newEps ? " a1p-row-new" : ""}">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <div><div class="a1p-rname">${escapeHtml(name)}${badge}</div>${link}</div>
        ${actions}
      </div>`;
    }).join("");
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // src/progress.js
  var DONE_RATIO = 0.9;
  var MIN_DONE_SEC = 30;
  function computeDone(cur, dur, threshold) {
    return dur > 60 && cur >= MIN_DONE_SEC && cur / dur >= (threshold || DONE_RATIO);
  }
  function activeVideo() {
    const vids = Array.from(document.querySelectorAll("video"));
    const visible = vids.filter((v) => v.getClientRects().length > 0);
    const pool = visible.length ? visible : vids;
    return pool.find((v) => !v.paused) || pool.find((v) => v.currentTime > 0) || pool[0] || null;
  }
  var seekHotkeyBound = false;
  function setupSeekHotkey() {
    if (seekHotkeyBound) return;
    seekHotkeyBound = true;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (!getSettings().shortcuts) return;
        const tag = e.target && e.target.tagName || "";
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
        const v = activeVideo();
        if (!v) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const sec = e.shiftKey ? 10 : Number(getSettings().seekSeconds) || 5;
        const d = e.key === "ArrowLeft" ? -sec : sec;
        try {
          v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
        } catch {
        }
      },
      true
    );
  }
  var rateHotkeyBound = false;
  function setupRateHotkey() {
    if (rateHotkeyBound) return;
    rateHotkeyBound = true;
    window.addEventListener(
      "keydown",
      (e) => {
        if (!getSettings().shortcuts) return;
        let delta = 0;
        if (e.key === "+" || e.key === "=") delta = 0.25;
        else if (e.key === "-" || e.key === "_") delta = -0.25;
        else return;
        const tag = e.target && e.target.tagName || "";
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
        const v = activeVideo();
        if (!v) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const r = Math.max(0.25, Math.min(4, (v.playbackRate || 1) + delta));
        try {
          v.playbackRate = r;
        } catch {
        }
        toast(`速度 ${r}x`, { duration: 1200 });
      },
      true
    );
  }
  var playPauseHotkeyBound = false;
  function setupPlayPauseHotkey() {
    if (playPauseHotkeyBound) return;
    playPauseHotkeyBound = true;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== " " && e.code !== "Space") return;
        if (!getSettings().shortcuts) return;
        if (e.repeat) return;
        const tag = e.target && e.target.tagName || "";
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
        const v = activeVideo();
        if (!v) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        try {
          v.paused ? v.play() : v.pause();
        } catch {
        }
      },
      true
    );
  }
  var webFullHotkeyBound = false;
  function webFullBox(video) {
    return video.closest(".video-js") || video.parentElement;
  }
  function exitWebFull(box) {
    box.classList.remove("a1p-webfull");
    document.body.classList.remove("a1p-webfull-lock");
  }
  function enterWebFull(box) {
    document.querySelectorAll(".a1p-webfull").forEach(exitWebFull);
    box.classList.add("a1p-webfull");
    document.body.classList.add("a1p-webfull-lock");
  }
  function toggleWebFull(box) {
    if (box.classList.contains("a1p-webfull")) exitWebFull(box);
    else enterWebFull(box);
  }
  function toggleWebFullCurrent() {
    const cur = document.querySelector(".a1p-webfull");
    if (cur) {
      exitWebFull(cur);
      return;
    }
    const vids = Array.from(document.querySelectorAll("video"));
    const target = vids.find((v) => !v.paused) || vids[0];
    if (target) enterWebFull(webFullBox(target));
  }
  function addWebFullButton(video) {
    const box = webFullBox(video);
    if (!box || box.querySelector(".a1p-webfull-btn")) return;
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    const btn = document.createElement("button");
    btn.className = "a1p-webfull-btn";
    btn.type = "button";
    btn.title = "網頁全螢幕 (W)";
    btn.textContent = "⛶";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleWebFull(box);
    });
    box.appendChild(btn);
  }
  function setupWebFullHotkey() {
    if (webFullHotkeyBound) return;
    webFullHotkeyBound = true;
    window.addEventListener("keydown", (e) => {
      const tag = e.target && e.target.tagName || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
      if (e.key === "w" || e.key === "W") {
        toggleWebFullCurrent();
      } else if (e.key === "Escape") {
        const cur = document.querySelector(".a1p-webfull");
        if (cur) exitWebFull(cur);
      }
    });
  }
  function epForVideo(video) {
    const req = parseApiReq(video) || parseApiReq(video.closest("[data-apireq]"));
    if (req && req.e != null) {
      const n = parseFloat(String(req.e));
      if (!Number.isNaN(n)) return n;
    }
    const article = video.closest("article");
    const title = article && article.querySelector(".entry-title");
    return title ? parseTitle(title.textContent || "").ep : null;
  }
  function nextEpisodeUrl(animeKey, ep) {
    const meta = getMeta(animeKey);
    if (!meta || !Array.isArray(meta.episodes) || ep == null) return null;
    const later = meta.episodes.filter((e) => typeof e.ep === "number" && e.ep > ep).sort((a, b) => a.ep - b.ep);
    return later.length ? later[0].url || postUrl(later[0].postId) : null;
  }
  async function initEpisodePage(ctx) {
    const video = await waitForVideo();
    if (!video) return;
    const settings = getSettings();
    const { animeKey, ep } = ctx;
    addWebFullButton(video);
    setupWebFullHotkey();
    setupSeekHotkey();
    setupRateHotkey();
    setupPlayPauseHotkey();
    if (settings.resume && ep != null) {
      const rec = getEpisode(animeKey, ep);
      if (rec && !rec.done && rec.currentTime > 5) {
        const seekTo = rec.currentTime;
        const doSeek = () => {
          try {
            if (video.currentTime < 2) video.currentTime = seekTo;
          } catch {
          }
        };
        if (video.readyState >= 1) doSeek();
        else video.addEventListener("loadedmetadata", doSeek, { once: true });
        toast(`已續播到 ${formatTime(seekTo)}`, {
          actionLabel: "從頭播放",
          onAction: () => {
            try {
              video.currentTime = 0;
            } catch {
            }
          }
        });
      }
    }
    const persist = (done) => {
      if (ep == null) return;
      const dur = video.duration || 0;
      const cur = video.currentTime || 0;
      if (cur < 1 && !done) return;
      setEpisodeProgress(animeKey, ep, {
        currentTime: cur,
        duration: dur,
        done: done ?? computeDone(cur, dur, settings.autoNextThreshold),
        postId: postIdFromPath()
        // 跨分頁「繼續看」用；網址由 postId 重建
      });
    };
    const persistThrottled = throttle(() => persist(), 5e3);
    video.addEventListener("timeupdate", persistThrottled);
    video.addEventListener("pause", () => persist());
    window.addEventListener("pagehide", () => persist());
    if (settings.rememberRate) {
      if (settings.playbackRate && settings.playbackRate !== 1) {
        try {
          video.playbackRate = settings.playbackRate;
        } catch {
        }
      }
      video.addEventListener("ratechange", () => setSettings({ playbackRate: video.playbackRate }));
    }
    video.addEventListener("ended", () => {
      persist(true);
      if (!settings.autoNext) return;
      const url = nextEpisodeUrl(animeKey, ep);
      if (!url) return;
      let cancelled = false;
      toast("即將播放下一集…", {
        duration: 5e3,
        actions: [
          {
            label: "立即播放",
            onAction: () => {
              cancelled = true;
              location.href = url;
            }
          },
          { label: "取消", onAction: () => {
            cancelled = true;
          } }
        ]
      });
      setTimeout(() => {
        if (!cancelled) location.href = url;
      }, 5e3);
    });
    if (settings.shortcuts) bindShortcuts(video, ctx);
  }
  function initCategoryPlayback(animeKey) {
    const settings = getSettings();
    const bound = /* @__PURE__ */ new WeakSet();
    const refreshUI = () => {
      const h1 = getContentH1();
      if (h1) renderLastWatched(animeKey, h1);
    };
    const playNextVideo = (video) => {
      const bar = document.querySelector(".a1p-ep-selector");
      if (bar) {
        const btns = Array.from(bar.querySelectorAll(".a1p-ep-btn"));
        const idx = btns.findIndex((b) => b.classList.contains("a1p-ep-active"));
        const next2 = btns[idx + 1];
        if (!next2) return;
        next2.click();
        setTimeout(() => {
          const v = document.querySelector("article:not(.a1p-ep-hidden) video");
          if (v) {
            v.scrollIntoView({ behavior: "smooth", block: "center" });
            try {
              v.play();
            } catch {
            }
          }
        }, 150);
        return;
      }
      const vids = Array.from(document.querySelectorAll("video"));
      const next = vids[vids.indexOf(video) + 1];
      if (!next) return;
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      try {
        next.play();
      } catch {
      }
    };
    const bind = (video) => {
      if (bound.has(video)) return;
      const ep = epForVideo(video);
      if (ep == null) return;
      bound.add(video);
      addWebFullButton(video);
      const a = video.closest("article");
      const epHref = (a && a.querySelector('.entry-title a, a[rel="bookmark"]') || {}).href || "";
      const epPostId = postIdFromUrl(epHref);
      if (settings.resume) {
        const rec = getEpisode(animeKey, ep);
        if (rec && !rec.done && rec.currentTime > 5) {
          const seekTo = rec.currentTime;
          const doSeek = () => {
            try {
              if (video.currentTime < 2) video.currentTime = seekTo;
            } catch {
            }
          };
          if (video.readyState >= 1) doSeek();
          else video.addEventListener("loadedmetadata", doSeek, { once: true });
        }
      }
      const persist = (done) => {
        const dur = video.duration || 0;
        const cur = video.currentTime || 0;
        if (cur < 1 && !done) return;
        setEpisodeProgress(animeKey, ep, {
          currentTime: cur,
          duration: dur,
          done: done ?? computeDone(cur, dur, settings.autoNextThreshold),
          postId: epPostId
          // 網址由 postId 重建（分類頁就地播放時取自集連結）
        });
      };
      const persistThrottled = throttle(() => persist(), 5e3);
      video.addEventListener("timeupdate", persistThrottled);
      video.addEventListener("play", () => {
        persist();
        refreshUI();
      });
      video.addEventListener("pause", () => {
        persist();
        refreshUI();
      });
      video.addEventListener("ended", () => {
        persist(true);
        refreshUI();
        if (settings.autoNext) playNextVideo(video);
      });
      if (settings.rememberRate) {
        if (settings.playbackRate && settings.playbackRate !== 1) {
          try {
            video.playbackRate = settings.playbackRate;
          } catch {
          }
        }
        video.addEventListener("ratechange", () => setSettings({ playbackRate: video.playbackRate }));
      }
    };
    const scan = () => document.querySelectorAll("video").forEach(bind);
    scan();
    setupWebFullHotkey();
    setupSeekHotkey();
    setupRateHotkey();
    setupPlayPauseHotkey();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => document.querySelectorAll("video").forEach((v) => {
      const ep = epForVideo(v);
      if (ep != null) {
        const dur = v.duration || 0;
        const cur = v.currentTime || 0;
        if (cur > 0) setEpisodeProgress(animeKey, ep, { currentTime: cur, duration: dur, done: computeDone(cur, dur, settings.autoNextThreshold) });
      }
    }));
  }
  function bindShortcuts(video, ctx) {
    window.addEventListener("keydown", (e) => {
      const tag = e.target && e.target.tagName || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
      switch (e.key) {
        // ←/→ 由全域 setupSeekHotkey 處理（秒數可調）
        // 空白鍵由全域 setupPlayPauseHotkey 處理（capture，分類頁/單集頁共用）
        case "f":
        case "F":
          if (document.fullscreenElement) document.exitFullscreen();
          else (video.requestFullscreen ? video : video.parentElement).requestFullscreen?.();
          break;
        case "n":
        case "N": {
          const url = nextEpisodeUrl(ctx.animeKey, ctx.ep);
          if (url) location.href = url;
          break;
        }
        // +/- 調速由全域 setupRateHotkey 處理
        default:
          break;
      }
    });
  }

  // src/bangumi.js
  var UA = "anime1-plus/0.1 (https://github.com/bakabaka0613/anime1-plus)";
  function gmFetch({ method, url, headers, data }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        timeout: 15e3,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout"))
      });
    });
  }
  async function searchV0(keyword, limit) {
    const res = await gmFetch({
      method: "POST",
      url: `https://api.bgm.tv/v0/search/subjects?limit=${limit}`,
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      data: JSON.stringify({ keyword, filter: { type: [2] } })
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`v0 status ${res.status}`);
    const json = JSON.parse(res.responseText);
    return Array.isArray(json.data) ? json.data : [];
  }
  async function searchLegacy(keyword, limit) {
    const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(keyword)}?type=2&responseGroup=large&max_results=${limit}`;
    const res = await gmFetch({ method: "GET", url, headers: { Accept: "application/json", "User-Agent": UA } });
    if (res.status < 200 || res.status >= 300) throw new Error(`legacy status ${res.status}`);
    const json = JSON.parse(res.responseText);
    const list = Array.isArray(json.list) ? json.list : [];
    return list.map((s) => ({
      id: s.id,
      name: s.name,
      name_cn: s.name_cn,
      date: s.air_date || s.date,
      images: s.images,
      rating: s.rating
    }));
  }
  async function searchOnce(keyword, limit) {
    try {
      return await searchV0(keyword, limit);
    } catch (e) {
      try {
        return await searchLegacy(keyword, limit);
      } catch (e2) {
        console.warn("[anime1-plus] Bangumi 搜尋失敗", e, e2);
        return [];
      }
    }
  }
  async function searchAnime(keyword, limit = 10) {
    if (!keyword || !keyword.trim()) return [];
    const simp = toSimplified(keyword);
    const variants = simp !== keyword ? [simp, keyword] : [keyword];
    const seen = /* @__PURE__ */ new Set();
    const merged = [];
    for (const kw of variants) {
      const res = await searchOnce(kw, limit);
      for (const s of res) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          merged.push(s);
        }
      }
    }
    return merged;
  }
  async function getSubjectAliases(id) {
    try {
      const res = await gmFetch({
        method: "GET",
        url: `https://api.bgm.tv/v0/subjects/${id}`,
        headers: { Accept: "application/json", "User-Agent": UA }
      });
      if (res.status < 200 || res.status >= 300) return [];
      const json = JSON.parse(res.responseText);
      const out = [];
      if (json.name) out.push(json.name);
      if (json.name_cn) out.push(json.name_cn);
      if (Array.isArray(json.infobox)) {
        for (const f of json.infobox) {
          if (!/别名|別名|中文名|英文名|英文|日文|罗马|羅馬/.test(f.key || "")) continue;
          const v = f.value;
          if (typeof v === "string") out.push(v);
          else if (Array.isArray(v)) v.forEach((it) => out.push(it && (it.v || it.value) || it));
        }
      }
      return out.filter((s) => typeof s === "string" && s.trim());
    } catch {
      return [];
    }
  }
  function coverUrl(subject) {
    const img = subject && subject.images;
    if (!img) return null;
    return img.large || img.common || img.medium || img.grid || img.small || null;
  }

  // src/match.js
  var W_NAME = 0.7;
  var W_YEAR = 0.2;
  var W_SEASON = 0.1;
  var CONFIDENT_SCORE = 0.6;
  var CONFIDENT_MARGIN = 0.1;
  var CONFIDENT_NAME = 0.5;
  function subjectYear(subject) {
    const m = String(subject.date || subject.air_date || "").match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }
  function leadTitleSegment(s) {
    const seg = String(s || "").split(/[\s　:：]/)[0].trim();
    return seg;
  }
  function nameScore(parsed, subject) {
    const scores = [];
    for (const raw of [subject.name_cn, subject.name]) {
      if (!raw) continue;
      const candBase = parseTitle(raw).baseName || raw;
      scores.push(similarity(parsed.baseName, candBase));
      const lead = leadTitleSegment(raw);
      if (lead && lead !== raw) scores.push(similarity(parsed.baseName, parseTitle(lead).baseName || lead));
    }
    return scores.length ? Math.max(...scores) : 0;
  }
  function seasonScore(parsed, subject) {
    const candName = subject.name_cn || subject.name || "";
    const candSeason = parseTitle(candName).seasonNum;
    return candSeason === parsed.seasonNum ? 1 : 0;
  }
  function yearScore(parsed, subject, anime1Year) {
    if (!anime1Year) return 0.5;
    const sy = subjectYear(subject);
    if (!sy) return 0.5;
    const diff = Math.abs(sy - anime1Year);
    if (diff === 0) return 1;
    if (diff === 1) return 0.5;
    return 0;
  }
  function scoreCandidate(parsed, anime1Year, subject) {
    const name = nameScore(parsed, subject);
    const year = yearScore(parsed, subject, anime1Year);
    const season = seasonScore(parsed, subject);
    const score = name * W_NAME + year * W_YEAR + season * W_SEASON;
    return { subject, score, breakdown: { name, year, season } };
  }
  function rankCandidates(parsed, anime1Year, subjects) {
    const ranked = (subjects || []).map((s) => scoreCandidate(parsed, anime1Year, s)).sort((a, b) => b.score - a.score);
    if (!ranked.length) {
      return { ranked, best: null, confident: false, needConfirm: true };
    }
    const best = ranked[0];
    const second = ranked[1];
    const margin = second ? best.score - second.score : Infinity;
    const confident = best.score >= CONFIDENT_SCORE && best.breakdown.name >= CONFIDENT_NAME && margin >= CONFIDENT_MARGIN;
    return { ranked, best, confident, needConfirm: !confident };
  }

  // src/coverQueue.js
  var TIERS = ["visible", "tracking", "recheck"];
  var GAP = { visible: 500, tracking: 500, recheck: 5e3 };
  var MAX_RETRIES = 2;
  var q = { visible: [], tracking: [], recheck: [] };
  var selectors = {};
  var pumping = false;
  var lastRunAt = 0;
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function enqueue(tier, run, key) {
    q[tier].push({ run, retries: 0, key });
    pump();
  }
  function setSelector(tier, fn) {
    selectors[tier] = fn;
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    while (TIERS.some((t) => q[t].length)) {
      const tier = TIERS.find((t) => q[t].length);
      const wait = Math.max(0, GAP[tier] - (Date.now() - lastRunAt));
      if (wait) {
        await sleep(Math.min(wait, 250));
        continue;
      }
      const jobs = q[tier];
      let idx = 0;
      if (selectors[tier]) {
        const i = selectors[tier](jobs);
        if (Number.isInteger(i) && i >= 0 && i < jobs.length) idx = i;
      }
      const job = jobs.splice(idx, 1)[0];
      lastRunAt = Date.now();
      let ok = false;
      try {
        ok = await job.run();
      } catch {
        ok = false;
      }
      if (!ok && job.retries < MAX_RETRIES) {
        job.retries++;
        q[tier].push(job);
      }
    }
    pumping = false;
  }

  // src/cover.js
  var ALIAS_CHECK_LIMIT = 10;
  var STRONG_SCORE = 0.8;
  async function matchByAlias(parsed, subjects) {
    const targets = [toSimplified(parsed.baseName), ...titleSearchSegments(parsed.baseName).map((s) => toSimplified(s))];
    for (const subject of subjects.slice(0, ALIAS_CHECK_LIMIT)) {
      const aliases = await getSubjectAliases(subject.id);
      for (const al of aliases) {
        for (const piece of [al, ...splitAliasNames(al)]) {
          const cand = toSimplified(parseTitle(piece).baseName || piece);
          if (targets.some((t) => similarity(t, cand) >= 0.9)) {
            return { subject, score: 1, breakdown: { name: 1, year: 0.5, season: 1 } };
          }
        }
      }
    }
    return null;
  }
  function toCoverData(scored, manual = false) {
    const s = scored.subject;
    return {
      subjectId: s.id,
      cover: coverUrl(s),
      name: s.name,
      name_cn: s.name_cn,
      rating: s.rating && s.rating.score || null,
      // Bangumi 用戶評分（0–10），0/無 → null
      score: scored.score,
      // 注意：這是我們的比對信心分數，非 Bangumi 評分
      manual
    };
  }
  async function lookupCover({ animeKey, title, year, deep = false }) {
    const parsed = parseTitle(title);
    const cached = getCover(animeKey);
    if (cached && !cached.tentative) return { cached: true, parsed, data: cached, ranked: [], confident: true };
    const subjects = await searchAnime(parsed.baseName);
    let { ranked, best, confident } = rankCandidates(parsed, year, subjects);
    if (deep) {
      let pool = subjects;
      if (!confident) {
        const segs = titleSearchSegments(parsed.baseName);
        if (segs.length) {
          const seen = new Set(subjects.map((s) => s.id));
          const merged = [...subjects];
          for (const seg of segs) {
            for (const s of await searchAnime(seg)) {
              if (!seen.has(s.id)) {
                seen.add(s.id);
                merged.push(s);
              }
            }
          }
          if (merged.length > subjects.length) {
            pool = merged;
            ({ ranked, best, confident } = rankCandidates(parsed, year, merged));
          }
        }
      }
      if ((!confident || best && best.score < STRONG_SCORE) && pool.length) {
        const aliasHit = await matchByAlias(parsed, pool);
        if (aliasHit && (!confident || aliasHit.subject.id === best.subject.id)) {
          best = aliasHit;
          confident = true;
          ranked = [aliasHit, ...ranked.filter((r) => r.subject.id !== aliasHit.subject.id)];
        }
      }
    }
    return { cached: false, parsed, data: confident && best ? toCoverData(best) : null, ranked, confident };
  }
  async function resolveCover({ animeKey, title, year, mountEl }) {
    if (!mountEl) return;
    const res = await lookupCover({ animeKey, title, year, deep: true });
    const { parsed } = res;
    const local = title;
    const showPicker = (ranked) => {
      renderCoverPicker(mountEl, ranked.slice(0, 6), parsed, (chosen) => {
        const data = { ...toCoverData(chosen, true), local };
        setCover(animeKey, data);
        renderCoverCard(mountEl, data, { onChange: () => showPicker(ranked) });
      });
    };
    const refetchAndPick = async () => {
      const subjects = await searchAnime(parsed.baseName);
      showPicker(rankCandidates(parsed, year, subjects).ranked);
    };
    if (res.cached) {
      renderCoverCard(mountEl, { ...res.data, local: res.data.local || local }, { onChange: refetchAndPick });
    } else if (res.data) {
      const data = { ...res.data, local };
      setCover(animeKey, data);
      renderCoverCard(mountEl, data, { onChange: () => showPicker(res.ranked) });
    } else {
      showPicker(res.ranked);
    }
  }
  var recheckQueued = /* @__PURE__ */ new Set();
  var onCoverUpgrade = null;
  setSelector("recheck", (jobs) => pickByHint(jobs, getRecheckHint()));
  var TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  var RECHECK_LEASE_TTL = 12e3;
  function claimRecheckLease() {
    const { owns, lease } = evaluateRecheckLease(getRecheckLease(), TAB_ID, Date.now(), RECHECK_LEASE_TTL);
    if (owns) setRecheckLease(lease);
    return owns;
  }
  function setCoverUpgradeHook(fn) {
    onCoverUpgrade = fn;
  }
  function enqueueRecheck(catId, { background = false } = {}) {
    if (recheckQueued.has(catId)) return;
    const cover = getCover(catId);
    if (!shouldRecheck(cover, Date.now())) return;
    recheckQueued.add(catId);
    enqueue("recheck", async () => {
      if (background && !claimRecheckLease()) return true;
      const fresh = getCover(catId);
      if (!shouldRecheck(fresh, Date.now())) return true;
      const meta = (await fetchLatestEpMap())[catId];
      const title = meta && meta.name || fresh.local || fresh.name;
      if (!title) return true;
      const res = await lookupCover({ animeKey: catId, title, year: meta ? meta.year : null, deep: true });
      if (res.data) {
        const data = { ...res.data, local: title };
        setCover(catId, data);
        if (onCoverUpgrade) onCoverUpgrade(catId, data);
        notifyCoverUpgrade(catId);
        console.info("[anime1-plus] 封面複查轉正：", title);
      } else {
        setCover(catId, { ...fresh, deepTried: Date.now() });
      }
      return true;
    }, catId);
  }
  var resweepTimer = null;
  var RESWEEP_MS = 15e3;
  async function recheckTentativeCovers({ orderHint } = {}) {
    const now = Date.now();
    let targets = getTentativeCovers().filter((c) => shouldRecheck(c, now) && !recheckQueued.has(c.catId));
    if (!targets.length) return;
    if (!claimRecheckLease()) {
      if (!resweepTimer) {
        resweepTimer = setTimeout(() => {
          resweepTimer = null;
          recheckTentativeCovers({ orderHint });
        }, RESWEEP_MS);
      }
      return;
    }
    const order = [...getRecheckHint() || [], ...Array.isArray(orderHint) ? orderHint : []];
    if (order.length) {
      const rank = /* @__PURE__ */ new Map();
      order.forEach((k, i) => {
        if (!rank.has(k)) rank.set(k, i);
      });
      const near = [];
      const rest = [];
      for (const c of targets) (rank.has(c.catId) ? near : rest).push(c);
      near.sort((a, b) => rank.get(a.catId) - rank.get(b.catId));
      targets = [...near, ...rest];
    }
    for (const c of targets) enqueueRecheck(c.catId, { background: true });
  }

  // src/list.js
  var currentDt = null;
  var initialLen = null;
  var activeBucket = null;
  var bucketMap = null;
  var nodeCatId = /* @__PURE__ */ new WeakMap();
  var filterTable = null;
  var predicatePushed = false;
  var updateBucketEdges = () => {
  };
  function animeRef(a) {
    const href = a.getAttribute("href") || "";
    let dec = href;
    try {
      dec = decodeURIComponent(href);
    } catch {
    }
    if (/\/category\/[^/]+\/[^/?#]+/.test(dec)) {
      return { key: animeKeyFromCategoryPath(href), year: yearFromText(dec) };
    }
    const m = href.match(/[?&]cat=(\d+)/);
    if (m) return { key: `cat:${m[1]}`, year: null };
    return null;
  }
  function markCover(img, data) {
    const box = img && img.parentNode;
    if (!box) return;
    const uncertain = !!(data && data.tentative);
    let tag = box.querySelector(".a1p-cover-uncertain");
    if (uncertain && !tag) {
      tag = document.createElement("span");
      tag.className = "a1p-cover-uncertain";
      tag.textContent = "? 待確認";
      tag.title = "封面比對信心較低，點擊進入該動畫可重新比對或手動選擇";
      box.appendChild(tag);
    } else if (!uncertain && tag) {
      tag.remove();
    }
  }
  function markRating(img, data) {
    const box = img && img.parentNode;
    if (!box) return;
    const score = data && data.rating;
    let tag = box.querySelector(".a1p-rating-badge");
    if (score) {
      if (!tag) {
        tag = document.createElement("span");
        tag.className = "a1p-rating-badge";
        box.appendChild(tag);
      }
      tag.textContent = `★ ${Number(score).toFixed(1)}`;
    } else if (tag) {
      tag.remove();
    }
  }
  function initListPage() {
    injectStyles();
    const seen = /* @__PURE__ */ new WeakSet();
    let trackingPrefetched = false;
    onCoverUpgradeEvent((catId) => {
      const cover = getCover(catId);
      if (cover && cover.cover) repaintCard(catId, cover);
    });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          if (e.target._a1pJob) enqueue("visible", () => resolve(e.target._a1pJob));
        }
      },
      { rootMargin: "400px" }
    );
    async function resolve({ img, key, name, year }) {
      const paint = (data) => {
        if (!img) return;
        img.src = data.cover || "";
        img.classList.remove("a1p-thumb-unknown");
        markCover(img, data);
        markRating(img, data);
      };
      const res = await lookupCover({ animeKey: key, title: name, year });
      if (res.cached) {
        paint(res.data);
        return true;
      }
      if (res.data) {
        const data = { ...res.data, local: name };
        setCover(key, data);
        paint(data);
        return true;
      }
      const top = res.ranked && res.ranked[0];
      if (top && top.subject) {
        const data = toCoverData(top);
        if (data.cover) {
          data.tentative = true;
          data.local = name;
          setCover(key, data);
          paint(data);
          enqueueRecheck(key);
        }
        return true;
      }
      if (img) img.classList.add("a1p-thumb-unknown");
      return false;
    }
    async function prefetchTrackingCovers() {
      if (trackingPrefetched) return;
      trackingPrefetched = true;
      const need = getInProgressList().filter((x) => !(x.cover && x.cover.cover));
      if (!need.length) return;
      const infoMap = await fetchLatestEpMap();
      for (const x of need) {
        const info = infoMap[x.catId];
        const name = info && info.name || cleanTitle(x.meta && x.meta.title) || null;
        if (!name) continue;
        const job = { key: x.catId, name, year: info ? info.year : null };
        enqueue("tracking", () => resolve(job));
      }
    }
    function enhanceRow(tr) {
      if (seen.has(tr)) return;
      const nameTd = tr.querySelector("td");
      if (!nameTd) return;
      const a = nameTd.querySelector("a[href]");
      if (!a) return;
      const ref = animeRef(a);
      if (!ref) return;
      const name = (a.textContent || "").trim();
      if (!name) return;
      seen.add(tr);
      tr.classList.add("a1p-card-row");
      const epTd = nameTd.nextElementSibling;
      const latestEp = epTd ? parseLatestEp(epTd.textContent) : null;
      const newCount = pendingNewEpisodes(latestEp, getAnimeWatch(ref.key));
      if (newCount) {
        const badge = document.createElement("span");
        badge.className = "a1p-update-badge";
        badge.textContent = `+${newCount}`;
        badge.title = `已更新至第 ${latestEp} 話，有 ${newCount} 集未看`;
        tr.appendChild(badge);
      }
      const img = document.createElement("img");
      img.className = "a1p-poster";
      img.referrerPolicy = "no-referrer";
      img.alt = name;
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        window.location.href = a.href;
      });
      const wrap = document.createElement("div");
      wrap.className = "a1p-poster-wrap";
      wrap.appendChild(img);
      nameTd.insertBefore(wrap, nameTd.firstChild);
      const cached = getCover(ref.key);
      if (cached && cached.cover) {
        img.src = cached.cover;
        markCover(img, cached);
        markRating(img, cached);
        if (cached.tentative) enqueueRecheck(ref.key);
        return;
      }
      img._a1pJob = { img, key: ref.key, name, year: ref.year };
      io.observe(img);
    }
    function scanTable() {
      const table = document.querySelector("table.tablepress") || document.querySelector("table");
      if (!table) return;
      table.classList.add("a1p-grid-table");
      table.querySelectorAll("tbody tr").forEach(enhanceRow);
    }
    document.body.classList.toggle("a1p-grid-on", getSettings().gridView !== false);
    scanTable();
    new MutationObserver(scanTable).observe(document.body, { childList: true, subtree: true });
    mountToolbar();
    setupInfiniteScroll();
    initBucketFilter();
    prefetchTrackingCovers();
    const publishHint = throttle(() => setRecheckHint(viewportCatOrder().slice(0, 30)), 1e3);
    publishHint();
    window.addEventListener("scroll", publishHint, { passive: true });
  }
  function viewportCatOrder() {
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const center = vh / 2;
    const rows = [];
    for (const row of document.querySelectorAll(".a1p-card-row")) {
      const a = row.querySelector("a[href]");
      if (!a) continue;
      const ref = animeRef(a);
      if (!ref) continue;
      const r = row.getBoundingClientRect();
      rows.push({ key: ref.key, dist: Math.abs((r.top + r.bottom) / 2 - center) });
    }
    rows.sort((p, q2) => p.dist - q2.dist);
    return rows.map((x) => x.key);
  }
  function repaintCard(catId, data) {
    for (const row of document.querySelectorAll(".a1p-card-row")) {
      const a = row.querySelector("a[href]");
      if (!a) continue;
      const ref = animeRef(a);
      if (!ref || ref.key !== catId) continue;
      const img = row.querySelector("img.a1p-poster");
      if (!img) return;
      if (data.cover) img.src = data.cover;
      img.classList.remove("a1p-thumb-unknown");
      markCover(img, data);
      markRating(img, data);
      return;
    }
  }
  var SEASON_ORD = { 冬: 0, 春: 1, 夏: 2, 秋: 3 };
  function compareBuckets(a, b) {
    const ya = +a.slice(0, 4);
    const yb = +b.slice(0, 4);
    if (ya !== yb) return yb - ya;
    return (SEASON_ORD[b[4]] ?? -1) - (SEASON_ORD[a[4]] ?? -1);
  }
  function bucketPredicate(settings, _searchData, dataIndex) {
    if (filterTable && settings.nTable !== filterTable) return true;
    if (!activeBucket) return true;
    const node = settings.aoData[dataIndex] && settings.aoData[dataIndex].nTr;
    if (!node) return true;
    let catId = nodeCatId.get(node);
    if (catId === void 0) {
      const a = node.querySelector("a[href]");
      const ref = a ? animeRef(a) : null;
      catId = ref ? ref.key : null;
      nodeCatId.set(node, catId);
    }
    if (!catId) return false;
    const bs = bucketMap && bucketMap[catId] || [];
    return bs.includes(activeBucket);
  }
  function ensureBucketPredicate(tries = 0) {
    if (predicatePushed) return;
    const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const $ = w.jQuery || w.$;
    if ($ && $.fn && $.fn.dataTable && $.fn.dataTable.ext) {
      $.fn.dataTable.ext.search.push(bucketPredicate);
      predicatePushed = true;
      return;
    }
    if (tries < 48) setTimeout(() => ensureBucketPredicate(tries + 1), 250);
  }
  function redrawFilter() {
    const dt = currentDt || getDataTable();
    if (dt) {
      try {
        dt.draw(false);
      } catch {
      }
    }
  }
  function selectBucket(bucket, wrap) {
    activeBucket = bucket;
    for (const chip of wrap.querySelectorAll(".a1p-bucket-chip")) {
      chip.setAttribute("aria-pressed", String(chip.dataset.bucket === bucket));
    }
    const clear = document.querySelector(".a1p-bucket-clear");
    if (clear) clear.hidden = !bucket;
    redrawFilter();
  }
  async function initBucketFilter() {
    const wrap = document.querySelector(".a1p-tb-buckets");
    if (!wrap || wrap.dataset.filled) return;
    const map = await fetchLatestEpMap();
    bucketMap = {};
    const all = /* @__PURE__ */ new Set();
    for (const [catId, info] of Object.entries(map)) {
      const bs = seasonBuckets(info.year, info.season);
      if (!bs.length) continue;
      bucketMap[catId] = bs;
      for (const b of bs) all.add(b);
    }
    filterTable = document.querySelector("table.tablepress") || document.querySelector("table");
    ensureBucketPredicate();
    const buckets = [...all].sort(compareBuckets);
    const frag = document.createDocumentFragment();
    for (const b of buckets) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "a1p-bucket-chip";
      chip.textContent = b;
      chip.dataset.bucket = b;
      chip.setAttribute("aria-pressed", "false");
      chip.onclick = () => selectBucket(b === activeBucket ? null : b, wrap);
      frag.appendChild(chip);
    }
    wrap.appendChild(frag);
    wrap.dataset.filled = "1";
    updateBucketEdges();
  }
  function mountToolbar() {
    if (document.querySelector(".a1p-toolbar")) return;
    injectStyles();
    const bar = document.createElement("div");
    bar.className = "a1p-toolbar";
    const search = document.createElement("div");
    search.className = "a1p-tb-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "搜尋動畫…";
    input.className = "a1p-tb-input";
    input.oninput = () => {
      const native = document.querySelector(
        '.dataTables_filter input, .dataTables_wrapper input[type="search"], .dataTables_wrapper input[type="text"]'
      );
      if (native) {
        native.value = input.value;
        native.dispatchEvent(new Event("input", { bubbles: true }));
        native.dispatchEvent(new Event("keyup", { bubbles: true }));
      } else if (currentDt) {
        try {
          currentDt.search(input.value).draw();
        } catch {
        }
      }
    };
    search.appendChild(input);
    const viewBtn = document.createElement("button");
    viewBtn.className = "a1p-tb-btn";
    const refresh = () => {
      const on = document.body.classList.contains("a1p-grid-on");
      viewBtn.textContent = on ? "▦" : "☰";
      viewBtn.title = on ? "切換為原始列表" : "切換為卡片檢視";
    };
    viewBtn.onclick = () => {
      const on = !document.body.classList.contains("a1p-grid-on");
      document.body.classList.toggle("a1p-grid-on", on);
      setSettings({ gridView: on });
      refresh();
      if (on) window.dispatchEvent(new Event("scroll"));
      else if (currentDt && initialLen != null) {
        try {
          currentDt.page.len(initialLen).draw(false);
        } catch {
        }
      }
    };
    refresh();
    const sizeWrap = document.createElement("label");
    sizeWrap.className = "a1p-tb-size";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "140";
    range.max = "360";
    range.step = "10";
    range.value = String(getSettings().cardWidth || 250);
    const applyWidth = (w) => {
      document.documentElement.style.setProperty("--a1p-card-w", `${w}px`);
      const pct = (Number(w) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100;
      range.style.setProperty("--a1p-range-fill", `${pct}%`);
    };
    applyWidth(range.value);
    range.oninput = () => {
      applyWidth(range.value);
      setSettings({ cardWidth: Number(range.value) });
    };
    sizeWrap.append(range);
    const buckets = document.createElement("div");
    buckets.className = "a1p-tb-buckets";
    buckets.addEventListener(
      "wheel",
      (e) => {
        if (!e.deltaY) return;
        e.preventDefault();
        buckets.scrollLeft += e.deltaY;
      },
      { passive: false }
    );
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "a1p-bucket-clear";
    clearBtn.textContent = "✕";
    clearBtn.title = "清除";
    clearBtn.hidden = true;
    clearBtn.onclick = () => selectBucket(null, buckets);
    const scroll = document.createElement("div");
    scroll.className = "a1p-tb-scroll";
    const arrowL = document.createElement("span");
    arrowL.className = "a1p-tb-arrow l";
    arrowL.textContent = "‹";
    const arrowR = document.createElement("span");
    arrowR.className = "a1p-tb-arrow r";
    arrowR.textContent = "›";
    updateBucketEdges = () => {
      const max = buckets.scrollWidth - buckets.clientWidth;
      arrowL.classList.toggle("show", buckets.scrollLeft > 2);
      arrowR.classList.toggle("show", buckets.scrollLeft < max - 2);
    };
    buckets.addEventListener("scroll", updateBucketEdges, { passive: true });
    window.addEventListener("resize", updateBucketEdges, { passive: true });
    scroll.append(buckets, arrowL, arrowR);
    const bucketWrap = document.createElement("div");
    bucketWrap.className = "a1p-tb-bucketwrap";
    bucketWrap.append(clearBtn, scroll);
    bar.append(search, sizeWrap, viewBtn, bucketWrap);
    const anchor = document.querySelector("#primary, .content-area, #main, #content") || document.body;
    anchor.insertBefore(bar, anchor.firstChild);
    setupStickyToolbar(bar);
  }
  function setupStickyToolbar(bar) {
    const MAX_W = 1152;
    const FADE = 26;
    const spacer = document.createElement("div");
    bar.parentNode.insertBefore(spacer, bar);
    const mask = document.createElement("div");
    mask.className = "a1p-toolbar-mask";
    document.body.appendChild(mask);
    let fixed = false;
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
        bar.classList.add("a1p-toolbar-fixed");
        mask.classList.add("on");
        applyGeom();
        fixed = true;
      } else if (fixed && top >= 0) {
        spacer.style.height = "0";
        bar.classList.remove("a1p-toolbar-fixed");
        mask.classList.remove("on");
        bar.style.left = bar.style.width = "";
        fixed = false;
      } else if (fixed) {
        applyGeom();
      }
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
  function getDataTable() {
    const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const $ = w.jQuery || w.$;
    const table = document.querySelector("table.tablepress") || document.querySelector("table");
    if (!$ || !$.fn || !$.fn.DataTable || !table) return null;
    if (!$.fn.DataTable.isDataTable(table)) return null;
    try {
      return $(table).DataTable();
    } catch {
      return null;
    }
  }
  function setupInfiniteScroll() {
    const STEP = 60;
    let tries = 0;
    const timer = setInterval(() => {
      const dt = getDataTable();
      if (dt) {
        clearInterval(timer);
        attach(dt);
      } else if (++tries > 48) {
        clearInterval(timer);
      }
    }, 250);
    function attach(dt) {
      currentDt = dt;
      try {
        initialLen = dt.page.info().length;
        dt.page(0);
      } catch {
      }
      let loading = false;
      const onScroll = () => {
        if (loading) return;
        if (!document.body.classList.contains("a1p-grid-on")) return;
        let info;
        try {
          info = dt.page.info();
        } catch {
          return;
        }
        if (!info || info.length < 0) return;
        if (info.length >= info.recordsDisplay) return;
        const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
        if (!nearBottom) return;
        loading = true;
        try {
          dt.page.len(info.length + STEP).draw(false);
        } catch {
        }
        setTimeout(() => {
          loading = false;
          onScroll();
        }, 250);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  // src/sync.js
  var GIST_FILENAME = "anime1-plus-sync.json";
  var GIST_DESC = "anime1-plus 追番進度同步（請勿手動編輯）";
  var PUSH_DEBOUNCE = 4e3;
  function gmGist({ method, path, token, body }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `https://api.github.com${path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        data: body ? JSON.stringify(body) : void 0,
        timeout: 2e4,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error("網路錯誤")),
        ontimeout: () => reject(new Error("逾時"))
      });
    });
  }
  function parseOrThrow(res, ctx) {
    if (res.status < 200 || res.status >= 300) {
      let msg = `${ctx} HTTP ${res.status}`;
      try {
        const j = JSON.parse(res.responseText);
        if (j && j.message) msg += `（${j.message}）`;
      } catch {
      }
      throw new Error(msg);
    }
    return JSON.parse(res.responseText);
  }
  async function createGist(token) {
    const res = await gmGist({
      method: "POST",
      path: "/gists",
      token,
      body: {
        description: GIST_DESC,
        public: false,
        files: { [GIST_FILENAME]: { content: '{"_v":1,"watch":{},"meta":{}}' } }
      }
    });
    return parseOrThrow(res, "建立 gist").id;
  }
  async function findExistingGist(token) {
    const res = await gmGist({ method: "GET", path: "/gists?per_page=100", token });
    const list = parseOrThrow(res, "列出 gist");
    const hit = Array.isArray(list) ? list.find((g) => g.files && g.files[GIST_FILENAME]) : null;
    return hit ? hit.id : null;
  }
  async function gistReachable(token, gistId) {
    const res = await gmGist({ method: "GET", path: `/gists/${gistId}`, token });
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 404) return false;
    parseOrThrow(res, "讀取 gist");
  }
  async function resolveGistId(token, existingId, deps = {}) {
    const { reachable = gistReachable, find = findExistingGist, create = createGist } = deps;
    if (existingId && await reachable(token, existingId)) return existingId;
    return await find(token) || await create(token);
  }
  async function pullGist(token, gistId) {
    const res = await gmGist({ method: "GET", path: `/gists/${gistId}`, token });
    const gist = parseOrThrow(res, "讀取 gist");
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file || !file.content) return { watch: {}, meta: {} };
    if (file.truncated) throw new Error("同步資料過大（>1MB），暫不支援");
    const obj = JSON.parse(file.content);
    return { watch: obj.watch || {}, meta: obj.meta || {} };
  }
  async function pushGist(token, gistId, subset) {
    const content = JSON.stringify({ _v: 1, watch: subset.watch || {}, meta: subset.meta || {} });
    const res = await gmGist({
      method: "PATCH",
      path: `/gists/${gistId}`,
      token,
      body: { files: { [GIST_FILENAME]: { content } } }
    });
    parseOrThrow(res, "寫入 gist");
  }
  var syncing = false;
  var pushTimer = null;
  async function syncNow({ silent = false } = {}) {
    const cfg = getSyncConfig();
    if (!cfg.enabled || !cfg.token || !cfg.gistId) return { ok: false, reason: "not-configured" };
    if (syncing) return { ok: false, reason: "busy" };
    syncing = true;
    try {
      const remote = await pullGist(cfg.token, cfg.gistId);
      const { changed } = applySyncedData(remote);
      const subset = getSyncSubset();
      const remoteStr = JSON.stringify({ watch: remote.watch || {}, meta: remote.meta || {} });
      const localStr = JSON.stringify({ watch: subset.watch || {}, meta: subset.meta || {} });
      if (localStr !== remoteStr) await pushGist(cfg.token, cfg.gistId, subset);
      setSyncConfig({ lastSyncAt: Date.now(), lastError: "" });
      if (changed && !silent) toast("已同步追番進度，部分頁面重新整理後更新", { duration: 3500 });
      return { ok: true, changed };
    } catch (e) {
      setSyncConfig({ lastError: e.message });
      if (!silent) toast(`同步失敗：${e.message}`, { duration: 5e3 });
      return { ok: false, reason: e.message };
    } finally {
      syncing = false;
    }
  }
  function schedulePush() {
    if (syncing) return;
    const cfg = getSyncConfig();
    if (!cfg.enabled || !cfg.token || !cfg.gistId) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      syncNow({ silent: true });
    }, PUSH_DEBOUNCE);
  }
  function initSync() {
    onDataChange(schedulePush);
    const cfg = getSyncConfig();
    if (cfg.enabled && cfg.token && cfg.gistId) syncNow({ silent: true });
  }
  async function configureSync() {
    const cfg = getSyncConfig();
    const input = prompt(
      "貼上 GitHub Personal Access Token\n（fine-grained，只需勾選 Gist 讀寫權限）。\n留空並確定＝刪除 token 並停用同步：",
      cfg.token || ""
    );
    if (input === null) return;
    const token = input.trim();
    if (!token) {
      setSyncConfig({ token: "", enabled: false });
      toast("已刪除 token 並停用多端同步", { duration: 3e3 });
      return;
    }
    setSyncConfig({ token });
    toast("正在設定同步…", { duration: 2e3 });
    try {
      const gistId = await resolveGistId(token, cfg.gistId);
      setSyncConfig({ gistId, enabled: true, lastError: "" });
      const r = await syncNow({ silent: true });
      if (r.ok) toast("同步已啟用並完成首次同步 ✓", { duration: 3500 });
      else toast(`同步已設定，但首次同步失敗：${r.reason}`, { duration: 5e3 });
    } catch (e) {
      setSyncConfig({ lastError: e.message });
      toast(`設定同步失敗：${e.message}`, { duration: 5e3 });
    }
  }

  // src/main.js
  var currentAnimeKey = null;
  function initCategoryPage() {
    const path = decodeURIComponent(location.pathname);
    const catId = getCategoryId();
    const animeKey = catId ? `cat:${catId}` : animeKeyFromCategoryPath(location.pathname);
    currentAnimeKey = animeKey;
    const year = yearFromText(path);
    const firstAnchor = markCategoryEpisodes(animeKey);
    const h1 = getContentH1();
    const mountEl = h1 || firstAnchor;
    if (!mountEl) return;
    const animeName = getAnimeTitle();
    renderLastWatched(animeKey, mountEl);
    resolveCover({ animeKey, title: animeName, year, mountEl });
    collapseToSinglePlayer(animeKey);
    enhanceEpisodeNav({ hide: true });
    initCategoryPlayback(animeKey);
    const pageTitle = document.querySelector(".page-title");
    if (pageTitle) pageTitle.style.display = "none";
  }
  function initEpisodePageRoute() {
    const cat = getCategoryInfo();
    const titleEl = document.querySelector(SEL.entryTitle);
    const parsed = parseTitle(titleEl ? titleEl.textContent : document.title);
    const catId = getCategoryId();
    const animeKey = catId ? `cat:${catId}` : cat ? cat.animeKey : `post:${postIdFromPath()}`;
    currentAnimeKey = animeKey;
    const year = cat ? cat.year : null;
    initEpisodePage({ animeKey, ep: parsed.ep, title: parsed.raw });
    if (cat && titleEl) resolveCover({ animeKey, title: cat.name, year, mountEl: titleEl });
    enhanceEpisodeNav({ animeKey, ep: parsed.ep, epRaw: parsed.epRaw, postId: postIdFromPath() });
  }
  function downloadJson(text, filename) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function importViaPaste() {
    injectStyles();
    const overlay = document.createElement("div");
    overlay.className = "a1p-modal-overlay";
    overlay.innerHTML = `
    <div class="a1p-modal">
      <h4>貼上 JSON 匯入</h4>
      <textarea class="a1p-modal-ta" placeholder="貼上匯出的 JSON…"></textarea>
      <div class="a1p-modal-btns">
        <button class="a1p-btn a1p-modal-cancel">取消</button>
        <button class="a1p-btn a1p-modal-ok">匯入</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const ta = overlay.querySelector(".a1p-modal-ta");
    overlay.querySelector(".a1p-modal-cancel").onclick = close;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".a1p-modal-ok").onclick = () => {
      const text = (ta.value || "").trim();
      if (!text) return;
      try {
        importAll(text, { merge: true });
        close();
        toast("匯入完成，重新整理後生效", { duration: 4e3 });
      } catch (e) {
        toast(`匯入失敗：${e.message}`, { duration: 5e3 });
      }
    };
    ta.focus();
  }
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand(
      "匯出資料 (JSON)",
      () => downloadJson(exportAll(), `anime1-plus-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`)
    );
    GM_registerMenuCommand("匯入資料 (JSON)", importViaPaste);
    const sync = getSyncConfig();
    if (sync.enabled && sync.gistId) {
      GM_registerMenuCommand("☁️ 立即同步", async () => {
        toast("同步中…", { duration: 1500 });
        const r = await syncNow({ silent: true });
        if (r.ok) toast(r.changed ? "同步完成，部分頁面重新整理後更新" : "已是最新進度 ✓", { duration: 3e3 });
        else toast(`同步失敗：${r.reason}`, { duration: 5e3 });
      });
      GM_registerMenuCommand("☁️ 同步設定（變更 token）…", configureSync);
      GM_registerMenuCommand("✓ 多端同步（點此停用）", () => {
        setSyncConfig({ enabled: false });
        toast("已停用多端同步（選單下次開啟更新）", { duration: 2500 });
      });
    } else {
      GM_registerMenuCommand("☁️ 設定多端同步（GitHub Gist）…", configureSync);
    }
    GM_registerMenuCommand(`⏩ 方向鍵快進秒數（目前 ${getSettings().seekSeconds || 5}s）`, () => {
      const cur = getSettings().seekSeconds || 5;
      const v = prompt("方向鍵快進/後退秒數（1–120）：", String(cur));
      if (v == null) return;
      const n = parseInt(v, 10);
      if (n >= 1 && n <= 120) {
        setSettings({ seekSeconds: n });
        toast(`快進秒數已設為 ${n} 秒`, { duration: 2500 });
      } else {
        toast("請輸入 1–120 的數字", { duration: 2500 });
      }
    });
    const toggles = [
      ["autoNext", "看完自動下一集"],
      ["resume", "自動續播"],
      ["shortcuts", "鍵盤快捷鍵"],
      ["rememberRate", "記憶播放速度"]
    ];
    for (const [key, label] of toggles) {
      const on = getSettings()[key];
      GM_registerMenuCommand(`${on ? "✓" : "✗"} ${label}`, () => {
        setSettings({ [key]: !getSettings()[key] });
        toast(`${label}：${!on ? "開啟" : "關閉"}（選單下次開啟更新）`, { duration: 2500 });
      });
    }
    GM_registerMenuCommand("🧹 清除資料…", openClearMenu);
  }
  function openClearMenu() {
    const opts = [];
    if (currentAnimeKey) {
      opts.push(["清除此動畫的觀看記錄", () => clearAnime(currentAnimeKey)]);
      opts.push(["清除此動畫封面快取", () => clearCover(currentAnimeKey)]);
    } else {
      opts.push(["清除所有封面快取", clearCovers]);
    }
    opts.push(["清除追番記錄（所有觀看進度）", clearWatch]);
    opts.push(["還原所有設定為預設", clearSettings]);
    opts.push(["清除所有資料（完全重置）", clearAll]);
    const menu = opts.map(([label2], i) => `${i + 1}. ${label2}`).join("\n");
    const v = prompt(`輸入數字選擇要清除的資料：

${menu}`, "");
    if (v == null) return;
    const n = parseInt(String(v).trim(), 10);
    if (!(n >= 1 && n <= opts.length)) {
      toast("未選擇有效項目", { duration: 2500 });
      return;
    }
    const [label, action] = opts[n - 1];
    if (!confirm(`確定要「${label}」？此動作無法復原。`)) return;
    action();
    toast(`已${label}，重新整理生效`, { duration: 3e3 });
  }
  function main() {
    migrateStored();
    injectStyles();
    injectProjectLinks();
    mountTrackingPanel();
    const type = getPageType();
    if (type === "list" || type === "category" || type === "episode") {
      document.body.classList.add("a1p-stick-footer");
    }
    if (type === "category") initCategoryPage();
    else if (type === "episode") initEpisodePageRoute();
    else if (type === "list") {
      if (getSettings().listThumbs) initListPage();
    }
    registerMenu();
    initSync();
    if (type === "list") setCoverUpgradeHook(repaintCard);
    recheckTentativeCovers(type === "list" ? { orderHint: viewportCatOrder() } : {});
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
