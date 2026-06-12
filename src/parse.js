// 解析 anime1.me 的 entry-title，拆出乾淨基底名、季度、集數、類型。
// 設計目標：盡量正確抽出搜尋用 baseName，並把季度/類型獨立出來供嚴謹匹配交叉驗證。

const CN_DIGIT = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// 中文/阿拉伯數字 → number（支援「十」「十一」「二十」「二十三」等常見季度寫法）
function cnToNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  let m;
  if ((m = s.match(/^十([一二三四五六七八九])$/))) return 10 + CN_DIGIT[m[1]];
  if ((m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/))) {
    return CN_DIGIT[m[1]] * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  }
  return CN_DIGIT[s] || null;
}

const ROMAN = { Ⅱ: 2, Ⅲ: 3, Ⅳ: 4, Ⅴ: 5, Ⅵ: 6 };

// 抽尾端 [..] 集數標記。回傳 { ep, epRaw, rest }
function extractEpisode(title) {
  const m = title.match(/\[([^\]]*)\]\s*$/);
  if (!m) return { ep: null, epRaw: null, rest: title.trim() };
  const epRaw = m[1].trim();
  const n = epRaw.match(/^(\d+(?:\.\d+)?)(?:v\d+)?$/i);
  return {
    ep: n ? parseFloat(n[1]) : null,
    epRaw,
    rest: title.slice(0, m.index).trim(),
  };
}

// 判斷類型並從字串移除類型字樣。回傳 { type, rest }
function extractType(rest, epRaw) {
  const hay = `${rest} ${epRaw || ''}`;
  let type = 'TV';
  if (/劇場版|\bmovie\b/i.test(hay)) type = 'MOVIE';
  else if (/OVA|OAD/i.test(hay)) type = 'OVA';
  else if (/特別篇|總集篇|\bSP\b|\bspecial\b/i.test(hay)) type = 'SP';
  const cleaned = rest.replace(/劇場版|\bmovie\b|OVA|OAD|特別篇|總集篇|\bSP\b|\bspecial\b/gi, '');
  return { type, rest: cleaned };
}

// 抽季度並從字串移除季度標記。回傳 { seasonNum, rest }
function extractSeason(rest) {
  const tries = [
    { re: /第\s*([一二三四五六七八九十\d]+)\s*[季期部]/, num: (m) => cnToNum(m[1]) },
    { re: /\b(\d+)\s*(?:st|nd|rd|th)\s+season\b/i, num: (m) => parseInt(m[1], 10) },
    { re: /\bseason\s*(\d+)\b/i, num: (m) => parseInt(m[1], 10) },
    { re: /\bpart\s*(\d+)\b/i, num: (m) => parseInt(m[1], 10) },
    { re: /\b(?:the\s+)?final\s+season\b/i, num: () => 2 },
    { re: /[ⅡⅢⅣⅤⅥ]/, num: (m) => ROMAN[m[0]] },
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
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 解析 anime1 標題。
 * @param {string} raw 原始 entry-title
 * @returns {{ raw:string, ep:number|null, epRaw:string|null, seasonNum:number, type:string, baseName:string }}
 */
export function parseTitle(raw) {
  const title = String(raw || '').trim();
  const { ep, epRaw, rest: r1 } = extractEpisode(title);
  const { type, rest: r2 } = extractType(r1, epRaw);
  const { seasonNum, rest: r3 } = extractSeason(r2);
  return { raw: title, ep, epRaw, seasonNum, type, baseName: normalizeSpace(r3) };
}
