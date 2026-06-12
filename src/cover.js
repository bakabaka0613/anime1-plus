// 封面解析協調：解析標題 → Bangumi 搜尋 → 嚴謹匹配 → 快取 → 渲染。
import { searchAnime, coverUrl, getSubjectAliases } from './bangumi.js';
import { rankCandidates } from './match.js';
import { parseTitle } from './parse.js';
import { similarity, toSimplified } from './util.js';
import { getCover, setCover } from './store.js';
import { renderCoverCard, renderCoverPicker } from './ui.js';

// 深度比對：用「Bangumi 搜尋 relevance 前幾名」（非我重排後）抓別名，若與解析名高度相符則採用。
// 因為正確條目的 name/name_cn 可能是日文或不同譯名（nameScore 低被排後），但 Bangumi relevance 會排前。
async function matchByAlias(parsed, subjects) {
  const target = toSimplified(parsed.baseName);
  for (const subject of subjects.slice(0, 6)) {
    const aliases = await getSubjectAliases(subject.id);
    for (const al of aliases) {
      const cand = toSimplified(parseTitle(al).baseName || al);
      if (similarity(target, cand) >= 0.9) {
        return { subject, score: 1, breakdown: { name: 1, year: 0.5, season: 1 } };
      }
    }
  }
  return null;
}

export function toCoverData(scored, manual = false) {
  const s = scored.subject;
  return {
    subjectId: s.id,
    cover: coverUrl(s),
    name: s.name,
    name_cn: s.name_cn,
    rating: (s.rating && s.rating.score) || null, // Bangumi 用戶評分（0–10），0/無 → null
    score: scored.score, // 注意：這是我們的比對信心分數，非 Bangumi 評分
    manual,
  };
}

/**
 * 純查詢（不渲染）：回傳快取或經搜尋匹配的封面資料，供卡片與列表縮圖共用。
 * @returns {Promise<{cached:boolean, parsed:object, data:object|null, ranked:Array, confident:boolean}>}
 */
export async function lookupCover({ animeKey, title, year, deep = false }) {
  const parsed = parseTitle(title);
  const cached = getCover(animeKey);
  // tentative 是列表頁的低信心暫定封面 → 分類頁不直接採用，重新嚴謹判斷
  if (cached && !cached.tentative) return { cached: true, parsed, data: cached, ranked: [], confident: true };
  const subjects = await searchAnime(parsed.baseName);
  let { ranked, best, confident } = rankCandidates(parsed, year, subjects);
  // 信心不足時，深度比對別名（用搜尋 relevance 順序，只在分類頁 deep 模式做，避免列表頁大量請求）
  if (deep && !confident && subjects.length) {
    const aliasHit = await matchByAlias(parsed, subjects);
    if (aliasHit) {
      best = aliasHit;
      confident = true;
      ranked = [aliasHit, ...ranked.filter((r) => r.subject.id !== aliasHit.subject.id)];
    }
  }
  return { cached: false, parsed, data: confident && best ? toCoverData(best) : null, ranked, confident };
}

/**
 * 解析並顯示封面卡。已快取則直接顯示；否則搜尋匹配，低信心時讓使用者選。
 * @param {{ animeKey:string, title:string, year:number|null, mountEl:Element }} ctx
 */
export async function resolveCover({ animeKey, title, year, mountEl }) {
  if (!mountEl) return;
  const res = await lookupCover({ animeKey, title, year, deep: true });
  const { parsed } = res;
  const local = title; // anime1 原始繁體名（Bangumi 多為簡體，故另存顯示）

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
    // 舊快取可能沒有 local → 用當前頁面的繁體名補上
    renderCoverCard(mountEl, { ...res.data, local: res.data.local || local }, { onChange: refetchAndPick });
  } else if (res.data) {
    const data = { ...res.data, local };
    setCover(animeKey, data);
    renderCoverCard(mountEl, data, { onChange: () => showPicker(res.ranked) });
  } else {
    showPicker(res.ranked);
  }
}
