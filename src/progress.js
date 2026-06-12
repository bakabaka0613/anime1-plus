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

// 目前該操作的播放器：優先正在播放，其次有進度，最後第一個
function activeVideo() {
  const vids = Array.from(document.querySelectorAll('video'));
  return vids.find((v) => !v.paused) || vids.find((v) => v.currentTime > 0) || vids[0] || null;
}

// ---- 方向鍵快進/後退（秒數可調，分類頁與單集頁共用）----
let seekHotkeyBound = false;
function setupSeekHotkey() {
  if (seekHotkeyBound) return;
  seekHotkeyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!getSettings().shortcuts) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;
    const v = activeVideo();
    if (!v) return;
    const sec = Number(getSettings().seekSeconds) || 10;
    const d = e.key === 'ArrowLeft' ? -sec : sec;
    try {
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
      e.preventDefault();
    } catch {
      /* ignore */
    }
  });
}

// ---- 網頁全屏：把播放器容器放大填滿視窗（非系統全螢幕）----
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
  btn.title = '網頁全屏 (W)';
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
      actionLabel: '取消',
      duration: 5000,
      onAction: () => {
        cancelled = true;
      },
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
      case ' ':
        e.preventDefault();
        video.paused ? video.play() : video.pause();
        break;
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
      case '+':
      case '=':
        video.playbackRate = Math.min(4, video.playbackRate + 0.25);
        toast(`速度 ${video.playbackRate}x`, { duration: 1200 });
        break;
      case '-':
      case '_':
        video.playbackRate = Math.max(0.25, video.playbackRate - 0.25);
        toast(`速度 ${video.playbackRate}x`, { duration: 1200 });
        break;
      default:
        break;
    }
  });
}
