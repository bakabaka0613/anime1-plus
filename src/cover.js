// 封面解析協調：解析標題 → Bangumi 搜尋 → 嚴謹匹配 → 快取 → 渲染。
import { searchAnime, coverUrl, getSubjectAliases } from './bangumi.js';
import { rankCandidates } from './match.js';
import { parseTitle } from './parse.js';
import { similarity, toSimplified, shouldRecheck } from './util.js';
import { getCover, setCover, getTentativeCovers } from './store.js';
import { fetchLatestEpMap } from './animelist.js';
import { enqueue } from './coverQueue.js';
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

const recheckQueued = new Set(); // 本 session 已排入複查的 catId（去重；含失敗者，當次不重排）
let onCoverUpgrade = null; // 升級轉正後的重繪 hook（列表頁設為 repaintCard）

// 由頁面模組註冊「升級轉正後就地重繪」的 hook。複查 job 在執行時讀取，故設定時機晚於排入也無妨。
export function setCoverUpgradeHook(fn) {
  onCoverUpgrade = fn;
}

/**
 * 把單一「待確認」(tentative) 封面排入背景深比對複查（共享佇列最低優先層，5s/部）：
 * 重跑與分類頁相同的 deep:true 別名比對，配到就升級轉正（脫 tentative）並即時重繪、
 * 仍配不到就標 deepTried（7 天內不重試）。去重 + shouldRecheck 雙重守門。
 */
export function enqueueRecheck(catId) {
  if (recheckQueued.has(catId)) return;
  const cover = getCover(catId);
  if (!shouldRecheck(cover, Date.now())) return;
  recheckQueued.add(catId);
  enqueue('recheck', async () => {
    const meta = (await fetchLatestEpMap())[catId]; // 權威繁體名/年份（已 5 分快取，cat:{id} keyed）
    const title = (meta && meta.name) || cover.local || cover.name;
    if (!title) return true; // 無名可查 → 視為完成、不重試
    const res = await lookupCover({ animeKey: catId, title, year: meta ? meta.year : null, deep: true });
    if (res.data) {
      const data = { ...res.data, local: title };
      setCover(catId, data); // 升級轉正（脫 tentative）
      if (onCoverUpgrade) onCoverUpgrade(catId, data); // 即時重繪眼前卡片
      console.info('[anime1-plus] 封面複查轉正：', title);
    } else {
      setCover(catId, { ...cover, deepTried: Date.now() }); // 仍配不到 → 7 天內不重試
    }
    return true;
  });
}

/**
 * 全量背景複查：掃 storage 中所有「待確認」封面，逐一排入 enqueueRecheck（背景補底，列表頁渲染驅動
 * 已涵蓋眼前/捲到的，這裡補上尚未渲染的）。orderHint（viewportCatOrder()）讓就近者排前面（方案 B）。
 */
export async function recheckTentativeCovers({ orderHint } = {}) {
  const now = Date.now();
  let targets = getTentativeCovers().filter((c) => shouldRecheck(c, now) && !recheckQueued.has(c.catId));
  if (!targets.length) return;
  if (Array.isArray(orderHint) && orderHint.length) {
    const rank = new Map(orderHint.map((k, i) => [k, i]));
    const near = [];
    const rest = [];
    for (const c of targets) (rank.has(c.catId) ? near : rest).push(c); // rest 保持原插入順序(穩定)
    near.sort((a, b) => rank.get(a.catId) - rank.get(b.catId));
    targets = [...near, ...rest];
  }
  for (const c of targets) enqueueRecheck(c.catId);
}
