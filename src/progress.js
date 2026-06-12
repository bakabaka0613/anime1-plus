// 觀看進度記錄、續播、自動下一集、播放速度記憶、鍵盤快捷鍵。
// 支援兩種觀看方式：單集頁 /{postId} 與「分類頁就地內嵌多集播放器」。
import { getEpisode, setEpisodeProgress, getSettings, setSettings, getMeta } from './store.js';
import { throttle, formatTime } from './util.js';
import { waitForVideo, getContentH1, parseApiReq } from './dom.js';
import { toast, renderLastWatched } from './ui.js';
import { parseTitle } from './parse.js';

const DONE_RATIO = 0.9;
const MIN_DONE_SEC = 30; // 至少播放這麼久才可能算「看完」，避免一載入就誤標

// 「看完」需：影片夠長 + 確實播了一段 + 進度達門檻
function computeDone(cur, dur, threshold) {
  return dur > 60 && cur >= MIN_DONE_SEC && cur / dur >= (threshold || DONE_RATIO);
}

// 目前該操作的播放器：先限定可見的（排除折疊隱藏的集），再優先播放中 > 有進度 > 第一個
function activeVideo() {
  const vids = Array.from(document.querySelectorAll('video'));
  const visible = vids.filter((v) => v.getClientRects().length > 0); // display:none 的隱藏集 → 0
  const pool = visible.length ? visible : vids;
  return pool.find((v) => !v.paused) || pool.find((v) => v.currentTime > 0) || pool[0] || null;
}

// ---- 方向鍵快進/後退（秒數可調，分類頁與單集頁共用）----
let seekHotkeyBound = false;
function setupSeekHotkey() {
  if (seekHotkeyBound) return;
  seekHotkeyBound = true;
  // capture 階段：搶在 video.js 自己的方向鍵 handler 之前攔截並阻止它，避免被固定秒數蓋過
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!getSettings().shortcuts) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
      const v = activeVideo();
      if (!v) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Shift + ←/→ 固定 10 秒；單獨 ←/→ 用可調秒數
      const sec = e.shiftKey ? 10 : Number(getSettings().seekSeconds) || 5;
      const d = e.key === 'ArrowLeft' ? -sec : sec;
      try {
        v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
      } catch {
        /* ignore */
      }
    },
    true,
  );
}

// ---- +/- 調整播放速度（分類頁與單集頁共用，對正在播放的播放器）----
let rateHotkeyBound = false;
function setupRateHotkey() {
  if (rateHotkeyBound) return;
  rateHotkeyBound = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (!getSettings().shortcuts) return;
      let delta = 0;
      if (e.key === '+' || e.key === '=') delta = 0.25;
      else if (e.key === '-' || e.key === '_') delta = -0.25;
      else return;
      const tag = (e.target && e.target.tagName) || '';
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
        /* ignore */
      }
      toast(`速度 ${r}x`, { duration: 1200 });
    },
    true,
  );
}

// ---- 空白鍵播放/暫停（分類頁與單集頁共用）----
// 之前只在單集頁的 bindShortcuts 綁定、且非 capture，分類頁就地播放無空格、又依賴焦點
// （焦點在選集鈕等按鈕上時空格會觸發該按鈕而非暫停）→ 改為全域 capture，搶在 video.js 之前處理。
let playPauseHotkeyBound = false;
function setupPlayPauseHotkey() {
  if (playPauseHotkeyBound) return;
  playPauseHotkeyBound = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (!getSettings().shortcuts) return;
      if (e.repeat) return; // 長按不連續 toggle
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
      const v = activeVideo();
      if (!v) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      try {
        v.paused ? v.play() : v.pause();
      } catch {
        /* ignore */
      }
    },
    true,
  );
}

// ---- 網頁全螢幕：把播放器容器放大填滿視窗（非系統全螢幕）----
let webFullHotkeyBound = false;

function webFullBox(video) {
  return video.closest('.video-js') || video.parentElement;
}
function exitWebFull(box) {
  box.classList.remove('a1p-webfull');
  document.body.classList.remove('a1p-webfull-lock');
}
function enterWebFull(box) {
  document.querySelectorAll('.a1p-webfull').forEach(exitWebFull);
  box.classList.add('a1p-webfull');
  document.body.classList.add('a1p-webfull-lock');
}
function toggleWebFull(box) {
  if (box.classList.contains('a1p-webfull')) exitWebFull(box);
  else enterWebFull(box);
}
function toggleWebFullCurrent() {
  const cur = document.querySelector('.a1p-webfull');
  if (cur) {
    exitWebFull(cur);
    return;
  }
  const vids = Array.from(document.querySelectorAll('video'));
  const target = vids.find((v) => !v.paused) || vids[0];
  if (target) enterWebFull(webFullBox(target));
}
function addWebFullButton(video) {
  const box = webFullBox(video);
  if (!box || box.querySelector('.a1p-webfull-btn')) return;
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const btn = document.createElement('button');
  btn.className = 'a1p-webfull-btn';
  btn.type = 'button';
  btn.title = '網頁全螢幕 (W)';
  btn.textContent = '⛶';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWebFull(box);
  });
  box.appendChild(btn);
}
function setupWebFullHotkey() {
  if (webFullHotkeyBound) return;
  webFullHotkeyBound = true;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
    if (e.key === 'w' || e.key === 'W') {
      toggleWebFullCurrent();
    } else if (e.key === 'Escape') {
      const cur = document.querySelector('.a1p-webfull');
      if (cur) exitWebFull(cur);
    }
  });
}

// 判定某個 video 是第幾話。
// 最精準來源：video（或其播放器容器）的 data-apireq.e（如 "11b" → 11）；其次該集 article 的標題。
function epForVideo(video) {
  const req = parseApiReq(video) || parseApiReq(video.closest('[data-apireq]'));
  if (req && req.e != null) {
    const n = parseFloat(String(req.e));
    if (!Number.isNaN(n)) return n;
  }
  const article = video.closest('article');
  const title = article && article.querySelector('.entry-title');
  return title ? parseTitle(title.textContent || '').ep : null;
}

// 從 meta 的集數清單找「下一集」URL
function nextEpisodeUrl(animeKey, ep) {
  const meta = getMeta(animeKey);
  if (!meta || !Array.isArray(meta.episodes) || ep == null) return null;
  const later = meta.episodes
    .filter((e) => typeof e.ep === 'number' && e.ep > ep)
    .sort((a, b) => a.ep - b.ep);
  return later.length ? later[0].url : null;
}

/**
 * 初始化單集頁。
 * @param {{ animeKey:string, ep:number|null, title:string }} ctx
 */
export async function initEpisodePage(ctx) {
  const video = await waitForVideo();
  if (!video) return; // 找不到播放器：靜默略過，不報錯
  const settings = getSettings();
  const { animeKey, ep } = ctx;

  addWebFullButton(video);
  setupWebFullHotkey();
  setupSeekHotkey();
  setupRateHotkey();
  setupPlayPauseHotkey();

  // ---- 續播 ----
  if (settings.resume && ep != null) {
    const rec = getEpisode(animeKey, ep);
    if (rec && !rec.done && rec.currentTime > 5) {
      const seekTo = rec.currentTime;
      const doSeek = () => {
        try {
          if (video.currentTime < 2) video.currentTime = seekTo;
        } catch {
          /* ignore */
        }
      };
      if (video.readyState >= 1) doSeek();
      else video.addEventListener('loadedmetadata', doSeek, { once: true });
      toast(`已續播到 ${formatTime(seekTo)}`, {
        actionLabel: '從頭播放',
        onAction: () => {
          try {
            video.currentTime = 0;
          } catch {
            /* ignore */
          }
        },
      });
    }
  }

  // ---- 進度記錄（節流 5s）----
  const persist = (done) => {
    if (ep == null) return;
    const dur = video.duration || 0;
    const cur = video.currentTime || 0;
    // 忽略接近 0 的寫入：video.js 重載/暫停時會把 currentTime 瞬間歸零並觸發事件，
    // 不該讓這個 0 蓋掉真正的進度。
    if (cur < 1 && !done) return;
    setEpisodeProgress(animeKey, ep, {
      currentTime: cur,
      duration: dur,
      done: done ?? computeDone(cur, dur, settings.autoNextThreshold),
      url: location.href, // 單集頁網址（跨分頁「繼續看」用）
    });
  };
  const persistThrottled = throttle(() => persist(), 5000);
  video.addEventListener('timeupdate', persistThrottled);
  video.addEventListener('pause', () => persist());
  window.addEventListener('pagehide', () => persist());

  // ---- 播放速度記憶 ----
  if (settings.rememberRate) {
    if (settings.playbackRate && settings.playbackRate !== 1) {
      try {
        video.playbackRate = settings.playbackRate;
      } catch {
        /* ignore */
      }
    }
    video.addEventListener('ratechange', () => setSettings({ playbackRate: video.playbackRate }));
  }

  // ---- 自動下一集 ----
  video.addEventListener('ended', () => {
    persist(true);
    if (!settings.autoNext) return;
    const url = nextEpisodeUrl(animeKey, ep);
    if (!url) return;
    let cancelled = false;
    toast('即將播放下一集…', {
      duration: 5000,
      actions: [
        {
          label: '立即播放',
          onAction: () => {
            cancelled = true; // 防 5 秒後又跳一次
            location.href = url;
          },
        },
        { label: '取消', onAction: () => { cancelled = true; } },
      ],
    });
    setTimeout(() => {
      if (!cancelled) location.href = url;
    }, 5000);
  });

  // ---- 鍵盤快捷鍵 ----
  if (settings.shortcuts) bindShortcuts(video, ctx);
}

/**
 * 初始化「分類頁就地播放」：監聽頁面上所有 <video>，依各自所屬集數標題記錄進度。
 * 這才是使用者實際的觀看方式（在 /category/... 內嵌播放器看，而非進單集頁）。
 * @param {string} animeKey
 */
export function initCategoryPlayback(animeKey) {
  const settings = getSettings();
  const bound = new WeakSet();

  const refreshUI = () => {
    const h1 = getContentH1();
    if (h1) renderLastWatched(animeKey, h1);
  };

  const playNextVideo = (video) => {
    // 折疊模式：切換選集列到下一集（active 按鈕的下一顆）並播放
    const bar = document.querySelector('.a1p-ep-selector');
    if (bar) {
      const btns = Array.from(bar.querySelectorAll('.a1p-ep-btn'));
      const idx = btns.findIndex((b) => b.classList.contains('a1p-ep-active'));
      const next = btns[idx + 1];
      if (!next) return; // 已是最後一集
      next.click();
      setTimeout(() => {
        const v = document.querySelector('article:not(.a1p-ep-hidden) video');
        if (v) {
          v.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            v.play();
          } catch {
            /* 自動播放可能被阻擋 */
          }
        }
      }, 150);
      return;
    }
    // 非折疊：DOM 順序下一個 video
    const vids = Array.from(document.querySelectorAll('video'));
    const next = vids[vids.indexOf(video) + 1];
    if (!next) return;
    next.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      next.play();
    } catch {
      /* 自動播放可能被瀏覽器阻擋，忽略 */
    }
  };

  const bind = (video) => {
    if (bound.has(video)) return;
    const ep = epForVideo(video);
    if (ep == null) return; // 還無法定位集數（標題未就緒）→ 不標記，待下次掃描重試
    bound.add(video);
    addWebFullButton(video);
    // 該集單集頁網址（跨分頁「繼續看」用）：article 標題連結 → /{postId}
    const a = video.closest('article');
    const epUrl =
      ((a && a.querySelector('.entry-title a, a[rel="bookmark"]')) || {}).href || location.href;

    if (settings.resume) {
      const rec = getEpisode(animeKey, ep);
      if (rec && !rec.done && rec.currentTime > 5) {
        const seekTo = rec.currentTime;
        const doSeek = () => {
          try {
            if (video.currentTime < 2) video.currentTime = seekTo;
          } catch {
            /* ignore */
          }
        };
        if (video.readyState >= 1) doSeek();
        else video.addEventListener('loadedmetadata', doSeek, { once: true });
      }
    }

    const persist = (done) => {
      const dur = video.duration || 0;
      const cur = video.currentTime || 0;
      // 同上：忽略 video.js 重置造成的 currentTime≈0，避免抹掉進度
      if (cur < 1 && !done) return;
      setEpisodeProgress(animeKey, ep, {
        currentTime: cur,
        duration: dur,
        done: done ?? computeDone(cur, dur, settings.autoNextThreshold),
        url: epUrl,
      });
    };
    const persistThrottled = throttle(() => persist(), 5000);
    video.addEventListener('timeupdate', persistThrottled);
    video.addEventListener('play', () => {
      persist();
      refreshUI();
    });
    video.addEventListener('pause', () => {
      persist();
      refreshUI();
    });
    video.addEventListener('ended', () => {
      persist(true);
      refreshUI();
      if (settings.autoNext) playNextVideo(video);
    });

    if (settings.rememberRate) {
      if (settings.playbackRate && settings.playbackRate !== 1) {
        try {
          video.playbackRate = settings.playbackRate;
        } catch {
          /* ignore */
        }
      }
      video.addEventListener('ratechange', () => setSettings({ playbackRate: video.playbackRate }));
    }
  };

  const scan = () => document.querySelectorAll('video').forEach(bind);
  scan();
  setupWebFullHotkey();
  setupSeekHotkey();
  setupRateHotkey();
  setupPlayPauseHotkey();
  // 播放器多為點擊後 JS 動態插入 <video> → 持續監聽
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => document.querySelectorAll('video').forEach((v) => {
    const ep = epForVideo(v);
    if (ep != null) {
      const dur = v.duration || 0;
      const cur = v.currentTime || 0;
      if (cur > 0) setEpisodeProgress(animeKey, ep, { currentTime: cur, duration: dur, done: computeDone(cur, dur, settings.autoNextThreshold) });
    }
  }));
}

function bindShortcuts(video, ctx) {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
    switch (e.key) {
      // ←/→ 由全域 setupSeekHotkey 處理（秒數可調）
      // 空白鍵由全域 setupPlayPauseHotkey 處理（capture，分類頁/單集頁共用）
      case 'f':
      case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else (video.requestFullscreen ? video : video.parentElement).requestFullscreen?.();
        break;
      case 'n':
      case 'N': {
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
