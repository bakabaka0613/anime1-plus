// 封面解析協調：解析標題 → Bangumi 搜尋 → 嚴謹匹配 → 快取 → 渲染。
import { searchAnime, coverUrl } from './bangumi.js';
import { rankCandidates } from './match.js';
import { parseTitle } from './parse.js';
import { getCover, setCover } from './store.js';
import { renderCoverCard, renderCoverPicker } from './ui.js';

export function toCoverData(scored, manual = false) {
  const s = scored.subject;
  return {
    subjectId: s.id,
    cover: coverUrl(s),
    name: s.name,
    name_cn: s.name_cn,
    score: scored.score,
    manual,
  };
}

/**
 * 純查詢（不渲染）：回傳快取或經搜尋匹配的封面資料，供卡片與列表縮圖共用。
 * @returns {Promise<{cached:boolean, parsed:object, data:object|null, ranked:Array, confident:boolean}>}
 */
export async function lookupCover({ animeKey, title, year }) {
  const parsed = parseTitle(title);
  const cached = getCover(animeKey);
  // tentative 是列表頁的低信心暫定封面 → 分類頁不直接採用，重新嚴謹判斷
  if (cached && !cached.tentative) return { cached: true, parsed, data: cached, ranked: [], confident: true };
  const subjects = await searchAnime(parsed.baseName);
  const { ranked, best, confident } = rankCandidates(parsed, year, subjects);
  return { cached: false, parsed, data: confident && best ? toCoverData(best) : null, ranked, confident };
}

/**
 * 解析並顯示封面卡。已快取則直接顯示；否則搜尋匹配，低信心時讓使用者選。
 * @param {{ animeKey:string, title:string, year:number|null, mountEl:Element }} ctx
 */
export async function resolveCover({ animeKey, title, year, mountEl }) {
  if (!mountEl) return;
  const res = await lookupCover({ animeKey, title, year });
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
