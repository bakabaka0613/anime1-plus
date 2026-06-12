// DOM 選擇器與頁面相關 helper。選擇器集中於此，anime1 改版時只改這裡。

export const SEL = {
  entryTitle: '.entry-title',
  entryContent: '.entry-content',
  // 單集頁的分類連結（WordPress 標準 rel，外加 fallback）
  categoryLink:
    'a[rel~="category"], .cat-links a, .entry-meta a[href*="/category/"], .entry-footer a[href*="/category/"], footer a[href*="/category/"]',
  // 分類頁每集連結：指向 /{postId} 且內含標題
  episodeLink: 'a[href*="anime1.me/"] h3, a[href*="anime1.me/"] h2',
};

// 判斷頁面類型
export function getPageType(loc = location) {
  const p = loc.pathname;
  if (/^\/category\//.test(p)) return 'category';
  if (/^\/\d+\/?$/.test(p)) return 'episode';
  if (p === '/' || p === '') return 'list';
  return 'other';
}

// 由單集頁 URL 取 postId
export function postIdFromPath(loc = location) {
  const m = loc.pathname.match(/^\/(\d+)\/?$/);
  return m ? m[1] : null;
}

// 正規化 category 路徑為穩定的 animeKey（同一部動畫每集相同）
export function animeKeyFromCategoryPath(path) {
  let p = path;
  try {
    p = decodeURIComponent(path);
  } catch {
    /* 保留原值 */
  }
  // 取 /category/.. 之後的部分，去分頁與尾斜線
  const m = p.match(/\/category\/.+$/);
  p = m ? m[0] : p;
  return p.replace(/\/page\/\d+\/?$/, '').replace(/\/+$/, '');
}

// 從文字（如「2023年秋季」或分類路徑）抓首播年份
export function yearFromText(text) {
  const m = String(text || '').match(/(\d{4})\s*年/);
  return m ? parseInt(m[1], 10) : null;
}

// 等待動態載入的 <video> 出現
export function waitForVideo(timeout = 20000) {
  return new Promise((resolve) => {
    const existing = document.querySelector('video');
    if (existing) return resolve(existing);
    const obs = new MutationObserver(() => {
      const v = document.querySelector('video');
      if (v) {
        obs.disconnect();
        resolve(v);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      obs.disconnect();
      resolve(document.querySelector('video'));
    }, timeout);
  });
}

// 解析播放器 div/video 上的 data-apireq（urlencoded JSON），取出 { c:動畫id, e:集數 }
export function parseApiReq(el) {
  if (!el) return null;
  const raw = el.getAttribute && el.getAttribute('data-apireq');
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

// 動畫的穩定唯一 ID。多來源（任一可用即取），讓封面/觀看記錄在分類頁、單集頁共用。
export function getCategoryId() {
  // 1) 播放器 data-apireq 的 c（任何有播放器的頁面都有，最通用）
  const req = parseApiReq(document.querySelector('[data-apireq]'));
  if (req && req.c) return String(req.c);
  // 2) body / article 的 category-NNNN class
  const cls = `${document.body.className} ${
    (document.querySelector('article[class*="category-"]') || {}).className || ''
  }`;
  const m = cls.match(/category-(\d+)/);
  if (m) return m[1];
  // 3) 全集連結 /?cat=NNNN
  const a = document.querySelector('a[href*="cat="]');
  if (a) {
    const mm = (a.getAttribute('href') || '').match(/[?&]cat=(\d+)/);
    if (mm) return mm[1];
  }
  // 4) inline script categoryID
  for (const s of document.querySelectorAll('script:not([src])')) {
    const mm = (s.textContent || '').match(/categoryID['"]?\s*[:=]\s*['"]?(\d+)/);
    if (mm) return mm[1];
  }
  return null;
}

// 動畫名（封面搜尋用）：og:title 最乾淨（如「日本三國 全集」→「日本三國」）
export function getAnimeTitle() {
  const og = document.querySelector('meta[property="og:title"]');
  if (og && og.content) return og.content.replace(/\s*全集\s*$/, '').trim();
  const h1 = getContentH1();
  if (h1) return h1.textContent.trim();
  return (document.title || '').replace(/\s*[–\-|].*$/, '').trim();
}

// 分類頁的動畫名標題元素：archive 頁是 <h1 class="page-title">；否則找內容區 h1。
export function getContentH1() {
  const pageTitle = document.querySelector('.page-title');
  if (pageTitle && pageTitle.textContent.trim()) return pageTitle;
  return (
    Array.from(document.querySelectorAll('h1')).find(
      (h) => !h.closest('#masthead, .site-header, nav, footer, aside') && h.textContent.trim(),
    ) || null
  );
}

// 取單集頁的分類連結資訊 { href, name, animeKey, year }
export function getCategoryInfo() {
  const a = document.querySelector(SEL.categoryLink);
  if (!a) return null;
  const href = a.getAttribute('href') || '';
  const name = (a.textContent || '').trim();
  const animeKey = animeKeyFromCategoryPath(href);
  return { href, name, animeKey, year: yearFromText(animeKey) };
}
