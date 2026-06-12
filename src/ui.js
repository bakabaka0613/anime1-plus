// 所有畫面注入：樣式、toast、封面卡 / 候選選擇、分類頁集數標記、追番面板。
import { getInProgressList, getEpisode, setMeta, getAnimeWatch, getMeta, getSettings, setSettings } from './store.js';
import { formatTime } from './util.js';
import { parseTitle } from './parse.js';

const BGM = (id) => `https://bgm.tv/subject/${id}`;

let stylesInjected = false;
export function injectStyles() {
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
`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

// ---- toast ----
function toastWrap() {
  let w = document.querySelector('.a1p-toast-wrap');
  if (!w) {
    w = document.createElement('div');
    w.className = 'a1p-toast-wrap';
    document.body.appendChild(w);
  }
  return w;
}
export function toast(msg, { actionLabel, onAction, duration = 4000 } = {}) {
  injectStyles();
  const el = document.createElement('div');
  el.className = 'a1p-toast';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'a1p-btn';
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

// ---- 封面卡 ----
export function renderCoverCard(mountEl, data, { onChange } = {}) {
  injectStyles();
  if (!mountEl) return;
  const old = document.querySelector('.a1p-card');
  if (old) old.remove();
  const card = document.createElement('div');
  card.className = 'a1p-card';
  const badge = data.manual
    ? '<span class="a1p-badge ok">已手動確認</span>'
    : `<span class="a1p-badge ${data.score >= 0.6 ? 'ok' : 'warn'}">信心 ${Math.round((data.score || 0) * 100)}%</span>`;
  const bgmNames = [data.name_cn, data.name].filter(Boolean).join(' · ');
  card.innerHTML = `
    <img referrerpolicy="no-referrer" src="${data.cover || ''}" alt="">
    <div class="a1p-meta">
      <p class="a1p-name">${escapeHtml(data.local || data.name_cn || data.name || '')}</p>
      <p class="a1p-sub">${escapeHtml(bgmNames)}</p>
      <div>${badge}</div>
      <div style="margin-top:8px">
        <a class="a1p-btn" href="${BGM(data.subjectId)}" target="_blank" rel="noreferrer">Bangumi 條目</a>
        <button class="a1p-btn a1p-change">換一個</button>
      </div>
    </div>`;
  mountEl.parentNode.insertBefore(card, mountEl);
  card.querySelector('.a1p-change').onclick = () => onChange && onChange();
}

// ---- 低信心候選選擇 ----
export function renderCoverPicker(mountEl, ranked, parsed, onPick) {
  injectStyles();
  if (!mountEl) return;
  const old = document.querySelector('.a1p-card');
  if (old) old.remove();
  const card = document.createElement('div');
  card.className = 'a1p-card';
  const opts = ranked
    .map((r, i) => {
      const s = r.subject;
      const cover = (s.images && (s.images.medium || s.images.common || s.images.grid)) || '';
      return `<div class="a1p-opt" data-i="${i}">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <span>${escapeHtml(s.name_cn || s.name || '')}</span>
      </div>`;
    })
    .join('');
  card.innerHTML = `
    <div class="a1p-meta" style="flex:1">
      <p class="a1p-name">無法確定封面，請手動選擇</p>
      <p class="a1p-sub">解析名稱：${escapeHtml(parsed.baseName)}${parsed.seasonNum > 1 ? `（第${parsed.seasonNum}季）` : ''}</p>
      <div class="a1p-pick">${opts || '<span class="a1p-sub">查無候選</span>'}</div>
    </div>`;
  mountEl.parentNode.insertBefore(card, mountEl);
  card.querySelectorAll('.a1p-opt').forEach((opt) => {
    opt.onclick = () => onPick(ranked[Number(opt.dataset.i)]);
  });
}

// ---- 分類頁：標記每集已看狀態，並建立集數清單存入 meta ----
export function markCategoryEpisodes(animeKey) {
  injectStyles();
  // 每集標題是 <h2 class="entry-title"><a href="/{postId}">名稱 [NN]</a></h2>
  const titles = document.querySelectorAll('.entry-title');
  const episodes = [];
  let maxEp = 0;
  let firstAnchor = null;
  titles.forEach((h) => {
    const a = h.querySelector('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const m = href.match(/anime1\.me\/(\d+)/);
    if (!m) return;
    const postId = m[1];
    if (!firstAnchor) firstAnchor = h;
    const parsed = parseTitle(h.textContent || '');
    if (parsed.ep != null) {
      episodes.push({ ep: parsed.ep, postId, url: `https://anime1.me/${postId}` });
      maxEp = Math.max(maxEp, parsed.ep);
    }
    const rec = parsed.ep != null ? getEpisode(animeKey, parsed.ep) : null;
    if (rec && rec.done) {
      h.classList.add('a1p-ep-done');
    } else if (rec && rec.currentTime > 5 && rec.duration > 0) {
      const bar = document.createElement('div');
      bar.className = 'a1p-ep-bar';
      bar.style.width = `${Math.min(100, (rec.currentTime / rec.duration) * 100)}%`;
      h.parentNode.appendChild(bar);
    }
  });
  if (episodes.length) setMeta(animeKey, { episodes, maxEpSeen: maxEp, title: document.title });
  return firstAnchor;
}

// ---- 分類頁：折疊重複播放器 → 上方選集、下方單一播放器 ----
function appendPagination(bar) {
  const links = document.querySelectorAll(
    '.pagination a, .nav-links a, a.page-numbers, .wp-pagenavi a, .page-nav a',
  );
  if (!links.length) return;
  const sep = document.createElement('span');
  sep.className = 'a1p-ep-label';
  sep.textContent = '｜其他頁：';
  bar.appendChild(sep);
  const seen = new Set();
  links.forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || seen.has(href)) return;
    seen.add(href);
    const link = document.createElement('a');
    link.className = 'a1p-ep-page';
    link.href = href;
    link.textContent = (a.textContent || '').trim() || '頁';
    bar.appendChild(link);
  });
}

export function collapseToSinglePlayer(animeKey) {
  injectStyles();
  if (document.querySelector('.a1p-ep-selector')) return;
  const articles = Array.from(document.querySelectorAll('article')).filter(
    (a) => a.querySelector('.entry-content') && a.querySelector('.entry-title'),
  );
  if (articles.length < 2) return; // 只有一集不需折疊

  const eps = articles.map((a) => ({
    article: a,
    ep: parseTitle(a.querySelector('.entry-title').textContent || '').ep,
  }));
  eps.sort((a, b) => (a.ep ?? 1e9) - (b.ep ?? 1e9)); // 集數升序

  const watch = getAnimeWatch(animeKey);
  const bar = document.createElement('div');
  bar.className = 'a1p-ep-selector';
  const label = document.createElement('span');
  label.className = 'a1p-ep-label';
  label.textContent = '選集：';
  bar.appendChild(label);

  const select = (i) => {
    eps.forEach((e, j) => {
      const hide = j !== i;
      e.article.classList.toggle('a1p-ep-hidden', hide);
      e.btn.classList.toggle('a1p-ep-active', j === i);
      if (hide) {
        const v = e.article.querySelector('video');
        if (v && !v.paused) {
          try {
            v.pause(); // 切走的集暫停，避免背景播放
          } catch {
            /* ignore */
          }
        }
      }
    });
    window.dispatchEvent(new Event('resize')); // 讓 video.js 重算尺寸
  };

  eps.forEach((e, i) => {
    const btn = document.createElement('button');
    btn.className = 'a1p-ep-btn';
    btn.type = 'button';
    btn.textContent = e.ep != null ? String(e.ep) : '#';
    const rec = e.ep != null ? watch[e.ep] : null;
    if (rec && rec.done) btn.classList.add('a1p-ep-done-btn');
    btn.addEventListener('click', () => select(i));
    e.btn = btn;
    bar.appendChild(btn);
  });

  appendPagination(bar);
  articles[0].parentNode.insertBefore(bar, articles[0]);

  // 預設選「上次看到的集」，否則最新集（升序最後）
  let defaultIdx = eps.length - 1;
  let lastEp = null;
  let lastAt = 0;
  for (const k of Object.keys(watch)) {
    if ((watch[k].watchedAt || 0) > lastAt) {
      lastAt = watch[k].watchedAt;
      lastEp = k;
    }
  }
  if (lastEp != null) {
    const idx = eps.findIndex((x) => String(x.ep) === String(lastEp));
    if (idx >= 0) defaultIdx = idx;
  }
  select(defaultIdx);
}

// ---- 分類頁：最後看到第幾話 ----
export function renderLastWatched(animeKey, mountEl) {
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
  const status = rec.done ? '已看完' : `看到 ${formatTime(rec.currentTime || 0)}`;

  const old = document.querySelector('.a1p-last');
  if (old) old.remove();
  const bar = document.createElement('div');
  bar.className = 'a1p-last';
  const link = item ? `<a class="a1p-btn" href="${item.url}">▶ 繼續看</a>` : '';
  bar.innerHTML = `<span>上次看到 <b>第 ${escapeHtml(String(lastEp))} 話</b>（${status}）</span>${link}`;
  mountEl.parentNode.insertBefore(bar, mountEl);
}

// ---- 右側欄折疊（搜尋/近期更新等 widget 很佔版面，預設折疊）----
export function mountSidebarToggle() {
  const aside = document.querySelector('#secondary, .widget-area');
  if (!aside || document.querySelector('.a1p-sidebar-toggle')) return;
  injectStyles();
  let open = !!getSettings().sidebarOpen;
  const btn = document.createElement('button');
  btn.className = 'a1p-sidebar-toggle';
  const apply = () => {
    document.body.classList.toggle('a1p-sidebar-collapsed', !open);
    btn.textContent = open ? '✕ 隱藏側欄' : '☰ 顯示側欄';
  };
  btn.onclick = () => {
    open = !open;
    setSettings({ sidebarOpen: open });
    apply();
  };
  document.body.appendChild(btn);
  apply();
}

// ---- 追番面板 ----
export function mountTrackingPanel() {
  injectStyles();
  if (document.querySelector('.a1p-fab')) return;
  const fab = document.createElement('button');
  fab.className = 'a1p-fab';
  fab.textContent = '📺';
  fab.title = '追番清單';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'a1p-panel a1p-hide';
  document.body.appendChild(panel);

  fab.onclick = () => {
    panel.classList.toggle('a1p-hide');
    if (!panel.classList.contains('a1p-hide')) renderPanel(panel);
  };
}

function renderPanel(panel) {
  const list = getInProgressList().filter((x) => x.anyUnfinished);
  if (!list.length) {
    panel.innerHTML = '<h4>追番清單</h4><div class="a1p-sub">還沒有觀看記錄</div>';
    return;
  }
  const rows = list
    .slice(0, 30)
    .map((x) => {
      const cover = x.cover && x.cover.cover ? x.cover.cover : '';
      const cleanTitle = (s) => String(s || '').replace(/\s*[–\-|]\s*Anime1.*$/i, '').trim();
      // 優先 anime1 原生繁體名（cover.local），其次 Bangumi 名，最後頁面標題
      const name =
        (x.cover && (x.cover.local || x.cover.name_cn || x.cover.name)) ||
        cleanTitle(x.meta && x.meta.title) ||
        x.catId;
      // 找最近一集未看完，給「繼續看」連結
      const eps = x.episodes;
      let resume = null;
      let resumeEp = null;
      for (const e of Object.keys(eps)) {
        if (!eps[e].done) {
          resume = (x.meta && x.meta.episodes && x.meta.episodes.find((it) => String(it.ep) === String(e))) || null;
          resumeEp = e;
        }
      }
      const link = resume
        ? `<a href="${resume.url}">繼續看 第${resumeEp}集 (${formatTime((eps[resumeEp] || {}).currentTime || 0)})</a>`
        : '<span class="a1p-sub">已看完</span>';
      return `<div class="a1p-row">
        <img referrerpolicy="no-referrer" src="${cover}" alt="">
        <div><div class="a1p-rname">${escapeHtml(name)}</div>${link}</div>
      </div>`;
    })
    .join('');
  panel.innerHTML = `<h4>追番清單</h4>${rows}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
