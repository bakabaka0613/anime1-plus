// 嚴謹匹配：把 anime1 解析結果與 Bangumi 候選清單評分排序。
// 核心原則：名稱為主，年份與季度交叉驗證；信心不足時不靜默採用，交由使用者確認。
import { parseTitle } from './parse.js';
import { similarity } from './util.js';

const W_NAME = 0.7;
const W_YEAR = 0.2;
const W_SEASON = 0.1;

const CONFIDENT_SCORE = 0.6; // 採用門檻
const CONFIDENT_MARGIN = 0.1; // 須領先第二名的差距
const CONFIDENT_NAME = 0.5; // 名稱相似度低標

function subjectYear(subject) {
  const m = String(subject.date || subject.air_date || '').match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

// Bangumi 中文名常為「主名⎵副標」（如「判处勇者刑 惩罚勇者9004队刑务纪录」），以空白或冒號分隔。
// 取分隔前的主名段，供 nameScore 額外比對，避免長副標把相似度稀釋（精準：只在真有分隔副標時生效）。
function leadTitleSegment(s) {
  const seg = String(s || '').split(/[\s　:：]/)[0].trim();
  return seg;
}

// 取候選的中日文名，各自去季度後與 parsed.baseName 比，取較高相似度；
// 並額外比對「主名段」（分隔副標前），讓主名相符但 Bangumi 多了長副標者不致被稀釋而漏採。
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

// 候選自身的季度（從中日文名解析），與 parsed.seasonNum 比。
function seasonScore(parsed, subject) {
  const candName = subject.name_cn || subject.name || '';
  const candSeason = parseTitle(candName).seasonNum;
  return candSeason === parsed.seasonNum ? 1 : 0;
}

function yearScore(parsed, subject, anime1Year) {
  if (!anime1Year) return 0.5; // 年份未知 → 中性，不獎不罰
  const sy = subjectYear(subject);
  if (!sy) return 0.5;
  const diff = Math.abs(sy - anime1Year);
  if (diff === 0) return 1;
  if (diff === 1) return 0.5;
  return 0;
}

export function scoreCandidate(parsed, anime1Year, subject) {
  const name = nameScore(parsed, subject);
  const year = yearScore(parsed, subject, anime1Year);
  const season = seasonScore(parsed, subject);
  const score = name * W_NAME + year * W_YEAR + season * W_SEASON;
  return { subject, score, breakdown: { name, year, season } };
}

/**
 * 對候選清單評分排序並判斷是否有信心。
 * @returns {{ ranked: Array, best: object|null, confident: boolean, needConfirm: boolean }}
 */
export function rankCandidates(parsed, anime1Year, subjects) {
  const ranked = (subjects || [])
    .map((s) => scoreCandidate(parsed, anime1Year, s))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return { ranked, best: null, confident: false, needConfirm: true };
  }

  const best = ranked[0];
  const second = ranked[1];
  const margin = second ? best.score - second.score : Infinity;
  const confident =
    best.score >= CONFIDENT_SCORE &&
    best.breakdown.name >= CONFIDENT_NAME &&
    margin >= CONFIDENT_MARGIN;

  return { ranked, best, confident, needConfirm: !confident };
}
