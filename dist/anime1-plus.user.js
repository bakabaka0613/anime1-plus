// ==UserScript==
// @name         Anime1.me Plus
// @namespace    https://github.com/bakabaka0613/anime1-plus
// @version      0.3.8
// @description  Anime1.me 增強：自動封面圖、觀看記錄、續播、自動下一集、快捷鍵
// @author       bakabaka0613
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
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.bgm.tv
// @connect      lain.bgm.tv
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
    if (/劇場版|\bmovie\b/i.test(hay)) type = "MOVIE";
    else if (/OVA|OAD/i.test(hay)) type = "OVA";
    else if (/特別篇|總集篇|\bSP\b|\bspecial\b/i.test(hay)) type = "SP";
    const cleaned = rest.replace(/劇場版|\bmovie\b|OVA|OAD|特別篇|總集篇|\bSP\b|\bspecial\b/gi, "");
    return { type, rest: cleaned };
  }
  function extractSeason(rest) {
    const tries = [
      { re: /第\s*([一二三四五六七八九十\d]+)\s*[季期部]/, num: (m) => cnToNum(m[1]) },
      { re: /\b(\d+)\s*(?:st|nd|rd|th)\s+season\b/i, num: (m) => parseInt(m[1], 10) },
      { re: /\bseason\s*(\d+)\b/i, num: (m) => parseInt(m[1], 10) },
      { re: /\bpart\s*(\d+)\b/i, num: (m) => parseInt(m[1], 10) },
      { re: /\b(?:the\s+)?final\s+season\b/i, num: () => 2 },
      { re: /[ⅡⅢⅣⅤⅥ]/, num: (m) => ROMAN[m[0]] }
    ];
    for (const t of tries) {
      const m = rest.match(t.re);
      if (!m) continue;
      const n = t.num(m);
      if (!n) continue;
      return { seasonNum: n, rest: rest.slice(0, m.index) + rest.slice(m.index + m[0].length) };
    }
    return { seasonNum: 1, rest };
  }
  function normalizeSpace(s) {
    return s.replace(/\s+/g, " ").trim();
  }
  function parseTitle(raw) {
    const title = String(raw || "").trim();
    const { ep, epRaw, rest: r1 } = extractEpisode(title);
    const { type, rest: r2 } = extractType(r1, epRaw);
    const { seasonNum, rest: r3 } = extractSeason(r2);
    return { raw: title, ep, epRaw, seasonNum, type, baseName: normalizeSpace(r3) };
  }

  // src/store.js
  var ROOT_KEY = "a1p:data";
  var DEFAULT_SETTINGS = {
    autoNext: true,
    // 看完自動下一集
    autoNextThreshold: 0.9,
    // 看完判定比例
    resume: true,
    // 續播
    shortcuts: true,
    // 鍵盤快捷鍵
    seekSeconds: 10,
    // 方向鍵快進/後退秒數
    rememberRate: true,
    // 記憶播放速度
    listThumbs: true,
    // 列表頁增強（封面/卡片）
    gridView: true,
    // 列表頁卡片檢視（false = 原始列表）
    cardWidth: 250,
    // 卡片最小寬度 px
    sidebarOpen: false
    // 右側欄展開（預設折疊）
  };
  function loadRoot() {
    try {
      const raw = GM_getValue(ROOT_KEY, "");
      const obj = raw ? JSON.parse(raw) : {};
      return {
        covers: obj.covers || {},
        // { [catId]: { subjectId, cover, name, name_cn, score, manual, ts } }
        watch: obj.watch || {},
        // { [catId]: { [ep]: { currentTime, duration, done, watchedAt } } }
        meta: obj.meta || {},
        // { [catId]: { title, maxEpSeen } }
        settings: { ...DEFAULT_SETTINGS, ...obj.settings || {} }
      };
    } catch {
      return { covers: {}, watch: {}, meta: {}, settings: { ...DEFAULT_SETTINGS } };
    }
  }
  function saveRoot(root) {
    GM_setValue(ROOT_KEY, JSON.stringify(root));
  }
  function getCover(catId) {
    return loadRoot().covers[catId] || null;
  }
  function setCover(catId, data) {
    const root = loadRoot();
    root.covers[catId] = { ...data, ts: Date.now() };
    saveRoot(root);
  }
  function getAnimeWatch(catId) {
    return loadRoot().watch[catId] || {};
  }
  function getEpisode(catId, ep) {
    return (loadRoot().watch[catId] || {})[ep] || null;
  }
  function setEpisodeProgress(catId, ep, data) {
    const root = loadRoot();
    root.watch[catId] = root.watch[catId] || {};
    const prev = root.watch[catId][ep] || {};
    root.watch[catId][ep] = { ...prev, ...data, watchedAt: Date.now() };
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

  // src/util.js
  function toHalfWidth(s) {
    return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/　/g, " ");
  }
  function normalizeName(s) {
    return toHalfWidth(String(s || "")).toLowerCase().replace(/[\s]/g, "").replace(/[!?。．・:~\-—_、,「」『』()\[\]{}"'’“”…★☆※／/]/g, "");
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
  function similarity(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) {
      const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
      return 0.8 + 0.2 * ratio;
    }
    const dist = levenshtein(na, nb);
    return 1 - dist / Math.max(na.length, nb.length);
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
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60 % 60);
    const h = Math.floor(sec / 3600);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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
.a1p-fab{position:fixed;right:18px;bottom:18px;z-index:2147483600;width:46px;height:46px;border-radius:50%;
  background:#7aa2f7;color:#0b1020;font-size:22px;border:none;cursor:pointer;box-shadow:0 3px 10px #0006}
.a1p-panel{position:fixed;right:18px;bottom:74px;z-index:2147483600;width:320px;max-height:60vh;overflow:auto;
  background:#1b1b1f;border:1px solid #33343a;border-radius:10px;color:#e8e8ea;font-size:13px;padding:10px}
.a1p-panel h4{margin:2px 0 8px;font-size:14px}
.a1p-row{display:flex;gap:8px;padding:6px 0;border-top:1px solid #2a2a30;align-items:center}
.a1p-row img{width:40px;height:56px;object-fit:cover;border-radius:4px;flex:none;background:#2a2a30}
.a1p-row a{color:#9ec1ff;text-decoration:none}
.a1p-row .a1p-rname{font-weight:600}
.a1p-hide{display:none!important}
.a1p-list-thumb{width:34px;height:48px;object-fit:cover;border-radius:4px;vertical-align:middle;
  margin-right:8px;background:#2a2a30;display:inline-block}
.a1p-thumb-unknown{border:1px dashed #6a6a72}
/* PLEX 風格海報卡片網格（僅在 body.a1p-grid-on 時生效，可切換回原始列表）*/
.a1p-poster{display:none} /* 原始列表模式：封面隱藏 */
/* 懸浮工具列：搜尋 + 卡片/列表切換 + 大小調整 */
.a1p-toolbar{display:flex;gap:10px;align-items:center;
  flex-wrap:wrap;padding:8px 12px;margin:0 0 14px;background:#0d0d10ee;backdrop-filter:blur(6px);
  border:1px solid #2a2a30;border-radius:8px}
.a1p-toolbar.a1p-toolbar-fixed{position:fixed;top:0;left:0;right:0;z-index:2147483600;
  margin:0;border-radius:0;border-left:none;border-right:none}
.a1p-toolbar>*{align-self:center}
.a1p-tb-search{flex:1 1 200px;min-width:160px;display:flex;align-items:center}
.a1p-tb-input{width:100%;height:32px;box-sizing:border-box;background:#1b1b1f;border:1px solid #45464c;
  border-radius:6px;color:#e8e8ea;padding:0 10px;font-size:13px}
.dataTables_filter{display:none!important} /* 原生搜尋隱藏，由工具列的輸入框代理 */
.a1p-tb-btn{cursor:pointer;border:1px solid #45464c;background:#26272c;color:#e8e8ea;
  border-radius:6px;height:32px;padding:0 12px;font-size:13px;white-space:nowrap}
.a1p-tb-btn:hover{background:#303138}
.a1p-tb-size{display:flex;align-items:center;gap:6px;height:32px;font-size:12px;color:#9aa0a6;white-space:nowrap}
body:not(.a1p-grid-on) .a1p-tb-size{display:none} /* 原始列表模式不需大小調整 */
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
/* 右側欄折疊 */
.a1p-sidebar-toggle{position:fixed;right:18px;top:78px;z-index:2147483600;cursor:pointer;
  border:1px solid #45464c;background:#26272cdd;color:#e8e8ea;border-radius:6px;padding:6px 10px;
  font-size:13px;backdrop-filter:blur(4px)}
.a1p-sidebar-toggle:hover{background:#303138}
body.a1p-sidebar-collapsed #secondary,body.a1p-sidebar-collapsed .widget-area{display:none!important}
body.a1p-sidebar-collapsed #primary,body.a1p-sidebar-collapsed .content-area{
  width:100%!important;max-width:100%!important;flex:1 1 100%!important;float:none!important}
.a1p-last{display:flex;align-items:center;gap:10px;margin:8px 0;padding:8px 12px;
  background:#15233a;border:1px solid #2c4a6e;border-radius:8px;color:#d6e4ff;font-size:14px}
.a1p-last b{color:#fff}
/* 網頁全屏：把播放器容器放大填滿視窗（非系統全螢幕）*/
.a1p-webfull{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;
  max-width:none!important;margin:0!important;padding:0!important;border-radius:0!important;
  background:#000!important;z-index:2147483600!important}
.a1p-webfull video,.a1p-webfull .vjs-tech{width:100%!important;height:100%!important;object-fit:contain!important}
body.a1p-webfull-lock{overflow:hidden!important}
body.a1p-webfull-lock .a1p-sidebar-toggle,
body.a1p-webfull-lock .a1p-fab,
body.a1p-webfull-lock .a1p-panel{display:none!important}
.a1p-webfull-btn{position:absolute;top:8px;right:8px;z-index:10;width:34px;height:34px;border:none;
  border-radius:6px;background:#000a;color:#fff;font-size:17px;cursor:pointer;line-height:1;
  display:flex;align-items:center;justify-content:center;opacity:.65}
.a1p-webfull-btn:hover{opacity:1;background:#000c}
.a1p-webfull .a1p-webfull-btn{top:12px;right:12px}
`;
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
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
  function toast(msg, { actionLabel, onAction, duration = 4e3 } = {}) {
    injectStyles();
    const el = document.createElement("div");
    el.className = "a1p-toast";
    const span = document.createElement("span");
    span.textContent = msg;
    el.appendChild(span);
    if (actionLabel) {
      const btn = document.createElement("button");
      btn.className = "a1p-btn";
      btn.textContent = actionLabel;
      btn.onclick = () => {
        try {
          onAction && onAction();
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
      const href = a.getAttribute("href") || "";
      const m = href.match(/anime1\.me\/(\d+)/);
      if (!m) return;
      const postId = m[1];
      if (!firstAnchor) firstAnchor = h;
      const parsed = parseTitle(h.textContent || "");
      if (parsed.ep != null) {
        episodes.push({ ep: parsed.ep, postId, url: `https://anime1.me/${postId}` });
        maxEp = Math.max(maxEp, parsed.ep);
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
    if (episodes.length) setMeta(animeKey, { episodes, maxEpSeen: maxEp, title: document.title });
    return firstAnchor;
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
    const item = meta && Array.isArray(meta.episodes) ? meta.episodes.find((it) => String(it.ep) === String(lastEp)) : null;
    const status = rec.done ? "已看完" : `看到 ${formatTime(rec.currentTime || 0)}`;
    const old = document.querySelector(".a1p-last");
    if (old) old.remove();
    const bar = document.createElement("div");
    bar.className = "a1p-last";
    const link = item ? `<a class="a1p-btn" href="${item.url}">▶ 繼續看</a>` : "";
    bar.innerHTML = `<span>上次看到 <b>第 ${escapeHtml(String(lastEp))} 話</b>（${status}）</span>${link}`;
    mountEl.parentNode.insertBefore(bar, mountEl);
  }
  function mountSidebarToggle() {
    const aside = document.querySelector("#secondary, .widget-area");
    if (!aside || document.querySelector(".a1p-sidebar-toggle")) return;
    injectStyles();
    let open = !!getSettings().sidebarOpen;
    const btn = document.createElement("button");
    btn.className = "a1p-sidebar-toggle";
    const apply = () => {
      document.body.classList.toggle("a1p-sidebar-collapsed", !open);
      btn.textContent = open ? "✕ 隱藏側欄" : "☰ 顯示側欄";
    };
    btn.onclick = () => {
      open = !open;
      setSettings({ sidebarOpen: open });
      apply();
    };
    document.body.appendChild(btn);
    apply();
  }
  function mountTrackingPanel() {
    injectStyles();
    if (document.querySelector(".a1p-fab")) return;
    const fab = document.createElement("button");
    fab.className = "a1p-fab";
    fab.textContent = "📺";
    fab.title = "追番清單";
    document.body.appendChild(fab);
    const panel = document.createElement("div");
    panel.className = "a1p-panel a1p-hide";
    document.body.appendChild(panel);
    fab.onclick = () => {
      panel.classList.toggle("a1p-hide");
      if (!panel.classList.contains("a1p-hide")) renderPanel(panel);
    };
  }
  function renderPanel(panel) {
    const list = getInProgressList().filter((x) => x.anyUnfinished);
    if (!list.length) {
      panel.innerHTML = '<h4>追番清單</h4><div class="a1p-sub">還沒有觀看記錄</div>';
      return;
    }
    const rows = list.slice(0, 30).map((x) => {
      const cover = x.cover && x.cover.cover ? x.cover.cover : "";
      const cleanTitle = (s) => String(s || "").replace(/\s*[–\-|]\s*Anime1.*$/i, "").trim();
      const name = x.cover && (x.cover.local || x.cover.name_cn || x.cover.name) || cleanTitle(x.meta && x.meta.title) || x.catId;
      const eps = x.episodes;
      let resume = null;
      let resumeEp = null;
      for (const e of Object.keys(eps)) {
        if (!eps[e].done) {
          resume = x.meta && x.meta.episodes && x.meta.episodes.find((it) => String(it.ep) === String(e)) || null;
          resumeEp = e;
        }
      }
      const link = resume ? `<a href="${resume.url}">繼續看 第${resumeEp}集 (${formatTime((eps[resumeEp] || {}).currentTime || 0)})</a>` : '<span class="a1p-sub">已看完</span>';
      return `<div class="a1p-row">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <div><div class="a1p-rname">${escapeHtml(name)}</div>${link}</div>
      </div>`;
    }).join("");
    panel.innerHTML = `<h4>追番清單</h4>${rows}`;
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
    return vids.find((v) => !v.paused) || vids.find((v) => v.currentTime > 0) || vids[0] || null;
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
        const sec = e.shiftKey ? 10 : Number(getSettings().seekSeconds) || 10;
        const d = e.key === "ArrowLeft" ? -sec : sec;
        try {
          v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
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
    btn.title = "網頁全屏 (W)";
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
    return later.length ? later[0].url : null;
  }
  async function initEpisodePage(ctx) {
    const video = await waitForVideo();
    if (!video) return;
    const settings = getSettings();
    const { animeKey, ep } = ctx;
    addWebFullButton(video);
    setupWebFullHotkey();
    setupSeekHotkey();
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
        done: done ?? computeDone(cur, dur, settings.autoNextThreshold)
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
        actionLabel: "取消",
        duration: 5e3,
        onAction: () => {
          cancelled = true;
        }
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
          done: done ?? computeDone(cur, dur, settings.autoNextThreshold)
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
        case " ":
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
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
        case "+":
        case "=":
          video.playbackRate = Math.min(4, video.playbackRate + 0.25);
          toast(`速度 ${video.playbackRate}x`, { duration: 1200 });
          break;
        case "-":
        case "_":
          video.playbackRate = Math.max(0.25, video.playbackRate - 0.25);
          toast(`速度 ${video.playbackRate}x`, { duration: 1200 });
          break;
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
      images: s.images
    }));
  }
  async function searchAnime(keyword, limit = 10) {
    if (!keyword || !keyword.trim()) return [];
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
  function nameScore(parsed, subject) {
    const scores = [];
    for (const raw of [subject.name_cn, subject.name]) {
      if (!raw) continue;
      const candBase = parseTitle(raw).baseName || raw;
      scores.push(similarity(parsed.baseName, candBase));
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

  // src/cover.js
  function toCoverData(scored, manual = false) {
    const s = scored.subject;
    return {
      subjectId: s.id,
      cover: coverUrl(s),
      name: s.name,
      name_cn: s.name_cn,
      score: scored.score,
      manual
    };
  }
  async function lookupCover({ animeKey, title, year }) {
    const parsed = parseTitle(title);
    const cached = getCover(animeKey);
    if (cached && !cached.tentative) return { cached: true, parsed, data: cached, ranked: [], confident: true };
    const subjects = await searchAnime(parsed.baseName);
    const { ranked, best, confident } = rankCandidates(parsed, year, subjects);
    return { cached: false, parsed, data: confident && best ? toCoverData(best) : null, ranked, confident };
  }
  async function resolveCover({ animeKey, title, year, mountEl }) {
    if (!mountEl) return;
    const res = await lookupCover({ animeKey, title, year });
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

  // src/list.js
  var REQUEST_GAP_MS = 500;
  var MAX_RETRIES = 2;
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var currentDt = null;
  var initialLen = null;
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
  function initListPage() {
    injectStyles();
    const seen = /* @__PURE__ */ new WeakSet();
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
      { rootMargin: "400px" }
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
          else job.img.classList.add("a1p-thumb-unknown");
        }
        await sleep(REQUEST_GAP_MS);
      }
      pumping = false;
    }
    async function resolve({ img, key, name, year }) {
      const res = await lookupCover({ animeKey: key, title: name, year });
      if (res.cached) {
        img.src = res.data.cover || "";
        return true;
      }
      if (res.data) {
        setCover(key, res.data);
        img.src = res.data.cover || "";
        return true;
      }
      if (res.ranked && res.ranked.length && res.ranked[0].subject) {
        const data = toCoverData(res.ranked[0]);
        data.tentative = true;
        if (!data.cover) return false;
        setCover(key, data);
        img.src = data.cover;
        return true;
      }
      return false;
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
      const img = document.createElement("img");
      img.className = "a1p-poster";
      img.referrerPolicy = "no-referrer";
      img.alt = name;
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        window.location.href = a.href;
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
      viewBtn.textContent = document.body.classList.contains("a1p-grid-on") ? "☰ 原始列表" : "▦ 卡片檢視";
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
    const applyWidth = (w) => document.documentElement.style.setProperty("--a1p-card-w", `${w}px`);
    applyWidth(range.value);
    range.oninput = () => {
      applyWidth(range.value);
      setSettings({ cardWidth: Number(range.value) });
    };
    sizeWrap.append("卡片大小", range);
    bar.append(search, sizeWrap, viewBtn);
    const anchor = document.querySelector("#primary, .content-area, #main, #content") || document.body;
    anchor.insertBefore(bar, anchor.firstChild);
    setupStickyToolbar(bar);
  }
  function setupStickyToolbar(bar) {
    const spacer = document.createElement("div");
    bar.parentNode.insertBefore(spacer, bar);
    let fixed = false;
    const update = () => {
      const top = spacer.getBoundingClientRect().top;
      if (!fixed && top < 0) {
        spacer.style.height = `${bar.offsetHeight}px`;
        bar.classList.add("a1p-toolbar-fixed");
        fixed = true;
      } else if (fixed && top >= 0) {
        spacer.style.height = "0";
        bar.classList.remove("a1p-toolbar-fixed");
        fixed = false;
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
  function importViaFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importAll(String(reader.result), { merge: true });
          toast("匯入完成，重新整理後生效", { duration: 4e3 });
        } catch (e) {
          toast(`匯入失敗：${e.message}`, { duration: 5e3 });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand(
      "匯出資料 (JSON)",
      () => downloadJson(exportAll(), `anime1-plus-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`)
    );
    GM_registerMenuCommand("匯入資料 (JSON)", importViaFile);
    GM_registerMenuCommand(`⏩ 方向鍵快進秒數（目前 ${getSettings().seekSeconds || 10}s）`, () => {
      const cur = getSettings().seekSeconds || 10;
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
    if (currentAnimeKey) {
      GM_registerMenuCommand("🗑 清除此動畫的觀看記錄", () => {
        clearAnime(currentAnimeKey);
        toast("已清除此動畫記錄，重新整理生效", { duration: 3e3 });
      });
    }
    GM_registerMenuCommand("🧹 清除所有資料（重置）", () => {
      if (confirm("確定清除所有封面快取與觀看記錄？此動作無法復原。")) {
        importAll("{}", { merge: false });
        toast("已重置，重新整理生效", { duration: 3e3 });
      }
    });
  }
  function main() {
    injectStyles();
    mountTrackingPanel();
    mountSidebarToggle();
    const type = getPageType();
    if (type === "category") initCategoryPage();
    else if (type === "episode") initEpisodePageRoute();
    else if (type === "list") {
      if (getSettings().listThumbs) initListPage();
    }
    registerMenu();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
