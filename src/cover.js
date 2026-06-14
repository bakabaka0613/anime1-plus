// 封面解析協調：解析標題 → Bangumi 搜尋 → 嚴謹匹配 → 快取 → 渲染。
import { searchAnime, coverUrl, getSubjectAliases, getSubjectMeta } from './bangumi.js';
import { rankCandidates } from './match.js';
import { parseTitle } from './parse.js';
import {
  similarity,
  toSimplified,
  shouldRecheck,
  titleSearchSegments,
  splitAliasNames,
  evaluateRecheckLease,
  pickByHint,
  dateToBucket,
  buildCoverTags,
  needsCoverMeta,
  seasonBuckets,
} from './util.js';
// 提醒：相似度比對主用完整 baseName；分段（titleSearchSegments）僅供別名比對補強，見 matchByAlias。
import {
  getCover,
  setCover,
  getTentativeCovers,
  getRecheckLease,
  setRecheckLease,
  notifyCoverUpgrade,
  getRecheckHint,
} from './store.js';
import { fetchLatestEpMap } from './animelist.js';
import { enqueue, setSelector } from './coverQueue.js';
import { renderCoverCard, renderCoverPicker } from './ui.js';

// 深度比對：用「Bangumi 搜尋 relevance 前幾名」（非我重排後）抓別名，若與解析名高度相符則採用。
// 因為正確條目的 name/name_cn 可能是日文或不同譯名（nameScore 低被排後），但 Bangumi relevance 會排前。
// 檢查前 ALIAS_CHECK_LIMIT 名：當 anime1 標題只對得上「別名」（name_cn 是另一種譯名，
// 如「白猪贵族」對 Bangumi 的「白豚贵族」），且該譯名與一票同類作品撞詞、relevance 被排到很後面
// （實測排第 9）時，6 名窗口會漏掉 → 放寬到 10。命中即早退，故常見情況不會真的打滿 10 次請求。
const ALIAS_CHECK_LIMIT = 10;
// 已 confident 但分數低於此 → 仍跑別名比對，想用「完全相符別名」把信心升到 1.0（脫離「待確認」徽章）。
// 取 0.8：真正的名稱命中（name≈1）多落在 0.85↑，0.6–0.8 屬靠年份/季度補起來的勉強命中，值得用別名複核。
const STRONG_SCORE = 0.8;
async function matchByAlias(parsed, subjects) {
  // 比對目標＝完整 baseName ＋ 各主/尾段（titleSearchSegments）：正確條目的別名常只對得上
  // 標題的「主名段」而非完整名（如「WONDANCE—熱舞青春—」別名 Wondance 只對 WONDANCE 段，
  // 含中文副標的完整名會被稀釋過不了 0.9）。分段比對用 0.9 高門檻 → 風險低。
  const targets = [toSimplified(parsed.baseName), ...titleSearchSegments(parsed.baseName).map((s) => toSimplified(s))];
  for (const subject of subjects.slice(0, ALIAS_CHECK_LIMIT)) {
    const aliases = await getSubjectAliases(subject.id);
    for (const al of aliases) {
      // 整條 + 拆開逐一都比、取較高：整條保住「名稱本身含頓號」的完全相符（如
      // 「单人房、日照一般、附天使。」），拆開解「多名併一條」（如「醜男真戰士、丑男真战士」）。
      for (const piece of [al, ...splitAliasNames(al)]) {
        const cand = toSimplified(parseTitle(piece).baseName || piece);
        if (targets.some((t) => similarity(t, cand) >= 0.9)) {
          return { subject, score: 1, breakdown: { name: 1, year: 0.5, season: 1 } };
        }
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
    // 放送日／放送季桶／標籤：v0 搜尋結果本就帶 date/tags/meta_tags，順手存進快取，零額外請求。
    // tags/metaTags 經 buildCoverTags 清洗（轉繁＋去重＋過濾時間/泛用/重疊）。
    date: s.date || s.air_date || null,
    bucket: dateToBucket(s.date || s.air_date),
    ...buildCoverTags(s.tags, s.meta_tags),
    manual,
  };
}

/**
 * 純查詢（不渲染）：回傳快取或經搜尋匹配的封面資料，供卡片與列表縮圖共用。
 * @returns {Promise<{cached:boolean, parsed:object, data:object|null, ranked:Array, confident:boolean}>}
 */
export async function lookupCover({ animeKey, title, year, deep = false, buckets }) {
  const parsed = parseTitle(title);
  const cached = getCover(animeKey);
  // tentative 是列表頁的低信心暫定封面 → 分類頁不直接採用，重新嚴謹判斷
  if (cached && !cached.tentative) return { cached: true, parsed, data: cached, ranked: [], confident: true };
  const subjects = await searchAnime(parsed.baseName);
  // buckets（anime1 年+季桶）：相符候選獲小幅加分（純加不減），有則傳、無則 undefined（行為不變）。
  let { ranked, best, confident } = rankCandidates(parsed, year, subjects, buckets);
  // 信心不足時的補救都只在分類頁 deep 模式做（避免列表頁大量請求；列表頁待確認交由背景複查 deep 再挖）。
  if (deep) {
    let pool = subjects;
    // (a) 標題分段補搜（只在不 confident 時做召回）：完整名常被前綴 franchise（「銀魂 …」）或
    //     破折號副標（「… -That's Journey-」）稀釋而在 Bangumi 全文搜尋漏掉正確條目；用主段/尾段各補搜一次撈回。
    if (!confident) {
      const segs = titleSearchSegments(parsed.baseName);
      if (segs.length) {
        const seen = new Set(subjects.map((s) => s.id));
        const merged = [...subjects];
        for (const seg of segs) {
          for (const s of await searchAnime(seg)) {
            if (!seen.has(s.id)) {
              seen.add(s.id);
              merged.push(s);
            }
          }
        }
        if (merged.length > subjects.length) {
          pool = merged;
          ({ ranked, best, confident } = rankCandidates(parsed, year, merged, buckets));
        }
      }
    }
    // (b) 別名深比對：不 confident（找正解）；或 confident 但分數偏低（用「完全相符的別名」把信心升到 1.0，
    //     如「单人房…」name_cn 是別的譯名只給 0.65）。confident 時只允許「同條目升級」，不讓別名搶換已定的選擇。
    if ((!confident || (best && best.score < STRONG_SCORE)) && pool.length) {
      const aliasHit = await matchByAlias(parsed, pool);
      if (aliasHit && (!confident || aliasHit.subject.id === best.subject.id)) {
        best = aliasHit;
        confident = true;
        ranked = [aliasHit, ...ranked.filter((r) => r.subject.id !== aliasHit.subject.id)];
      }
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
  // anime1 年+季桶（animeKey 為 cat:NN，與 fetchLatestEpMap 同 key 空間）→ 相符候選獲小幅加分。
  const listMeta = (await fetchLatestEpMap())[animeKey];
  const buckets = listMeta ? seasonBuckets(listMeta.year, listMeta.season) : undefined;
  const res = await lookupCover({ animeKey, title, year, deep: true, buckets });
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
    showPicker(rankCandidates(parsed, year, subjects, buckets).ranked);
  };

  if (res.cached) {
    // 舊快取可能沒有 local → 用當前頁面的繁體名補上
    if (needsCoverMeta(res.data, Date.now())) enqueueMetaBackfill(animeKey); // 既有快取缺 tags/放送日 → 背景補抓
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

// recheck 層改用「依當前視窗 hint 挑最近的待確認」而非 FIFO：邊捲動 H 會即時重發 hint，
// worker（本分頁或別分頁）每次取下一個 job 時讀最新 hint → 捲到哪就先複查哪。無 hint 時退回 FIFO。
setSelector('recheck', (jobs) => pickByHint(jobs, getRecheckHint()));

// 本分頁唯一 id 與背景複查租約 TTL（ms）。租約用來讓多分頁只有一個跑背景複查。
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const RECHECK_LEASE_TTL = 12000;
// 嘗試取得/續租背景複查租約。owns=true 表示本分頁可跑；false 表示別分頁正持新鮮租約 → 本分頁略過。
// 每個 recheck job 執行時呼叫一次：持有者藉此續租（延長 TTL），其餘分頁則退讓。
function claimRecheckLease() {
  const { owns, lease } = evaluateRecheckLease(getRecheckLease(), TAB_ID, Date.now(), RECHECK_LEASE_TTL);
  if (owns) setRecheckLease(lease);
  return owns;
}

// 由頁面模組註冊「升級轉正後就地重繪」的 hook。複查 job 在執行時讀取，故設定時機晚於排入也無妨。
export function setCoverUpgradeHook(fn) {
  onCoverUpgrade = fn;
}

/**
 * 把單一「待確認」(tentative) 封面排入背景深比對複查（共享佇列最低優先層，5s/部）：
 * 重跑與分類頁相同的 deep:true 別名比對，配到就升級轉正（脫 tentative）並即時重繪、
 * 仍配不到就標 deepTried（7 天內不重試）。去重 + shouldRecheck 雙重守門。
 * @param {boolean} [background] true＝全量補底（受跨分頁租約節制，只一個分頁跑）；
 *   false（預設）＝前景渲染驅動（使用者眼前的卡片）→ 由所在分頁自行複查、即時重繪，不讓給別分頁。
 */
export function enqueueRecheck(catId, { background = false } = {}) {
  if (recheckQueued.has(catId)) return;
  const cover = getCover(catId);
  if (!shouldRecheck(cover, Date.now())) return;
  recheckQueued.add(catId);
  enqueue('recheck', async () => {
    // 只有「全量背景補底」受租約節制（多分頁只一個跑、不超速）；前景複查是使用者眼前的卡片，
    // 由所在分頁自己做（這樣 H 會優先複查它當前載入的待確認，而非全讓給持租約的別分頁）。
    if (background && !claimRecheckLease()) return true;
    // 執行時重讀最新狀態（非排入時的舊快照）：別的分頁或稍早的 job 可能已處理過 → 免網路跳過，
    // 且絕不用舊快照覆蓋——否則會把別分頁剛升級轉正的封面又蓋回「待確認」並凍結 7 天。
    const fresh = getCover(catId);
    if (!shouldRecheck(fresh, Date.now())) return true;
    const meta = (await fetchLatestEpMap())[catId]; // 權威繁體名/年份（已 5 分快取，cat:{id} keyed）
    const title = (meta && meta.name) || fresh.local || fresh.name;
    if (!title) return true; // 無名可查 → 視為完成、不重試
    const buckets = meta ? seasonBuckets(meta.year, meta.season) : undefined; // 年+季桶 → 相符候選小幅加分
    const res = await lookupCover({ animeKey: catId, title, year: meta ? meta.year : null, deep: true, buckets });
    if (res.data) {
      const data = { ...res.data, local: title };
      setCover(catId, data); // 升級轉正（脫 tentative）
      if (onCoverUpgrade) onCoverUpgrade(catId, data); // 即時重繪眼前卡片（同分頁）
      notifyCoverUpgrade(catId); // 廣播給其他分頁（主頁海報即時重繪，不必重整）
      console.info('[anime1-plus] 封面複查轉正：', title);
    } else {
      setCover(catId, { ...fresh, deepTried: Date.now() }); // 仍配不到 → 7 天內不重試（用最新值，不覆蓋升級）
    }
    return true;
  }, catId); // 帶 catId → recheck selector 可依即時視窗 hint 挑最近者
}

const metaBackfillQueued = new Set(); // 本 session 已排入 meta 補抓的 catId（去重）

/**
 * 既有快取「補抓 tags/放送日」的渲染驅動懶補（最低優先 meta 層）：
 * 用已存的 subjectId 打 /v0/subjects/{id} 拿 date+tags+meta_tags，純補充進快取（**絕不改 subjectId/cover**），
 * 取不到 date → 戳 metaTriedAt（7 天內不重試）。去重 + needsCoverMeta 雙重守門。前景驅動、不需跨分頁租約。
 */
export function enqueueMetaBackfill(catId) {
  if (metaBackfillQueued.has(catId)) return;
  if (!needsCoverMeta(getCover(catId), Date.now())) return;
  metaBackfillQueued.add(catId);
  enqueue('meta', async () => {
    // 執行時重讀最新快照（非排入時舊值）：別的分頁/job 可能已補過 → 免網路跳過，且不覆蓋他人升級。
    const fresh = getCover(catId);
    if (!needsCoverMeta(fresh, Date.now())) return true;
    const m = await getSubjectMeta(fresh.subjectId);
    if (m && m.date) {
      setCover(catId, {
        ...fresh, // 保留既有 subjectId/cover/name/score…，僅補充下列欄位
        date: m.date,
        bucket: dateToBucket(m.date),
        ...buildCoverTags(m.tags, m.meta_tags),
      });
    } else {
      setCover(catId, { ...fresh, metaTriedAt: Date.now() }); // 取不到 → 7 天內不重試（用最新值）
    }
    return true;
  }, catId);
}

let resweepTimer = null; // 非持有分頁等待租約釋出的重掃計時器（避免堆疊多個）
const RESWEEP_MS = 15000; // > 租約 TTL（12s）：持有者關閉/過期後，本分頁這時重試即可接手

/**
 * 全量背景複查：掃 storage 中所有「待確認」封面，逐一排入背景 enqueueRecheck（補上尚未渲染的；
 * 列表頁渲染驅動的前景複查已涵蓋眼前/捲到的）。orderHint（viewportCatOrder()）讓就近者排前面。
 *
 * 跨分頁：背景補底受租約節制——**在 sweep 層**取租約。取不到（別分頁正在跑）→ 不排 job，改排程稍後重試；
 * 等持有者關閉/過期後本分頁接手。一旦所有待確認都被補完（共享 storage，targets 變空）重試自然停止。
 * 這樣 H+C+C+C 中持租約的分頁被關掉時，剩餘補底會由其他分頁接續，不必等重整。
 */
export async function recheckTentativeCovers({ orderHint } = {}) {
  const now = Date.now();
  let targets = getTentativeCovers().filter((c) => shouldRecheck(c, now) && !recheckQueued.has(c.catId));
  if (!targets.length) return; // 沒有待補底 → 不需重試排程
  if (!claimRecheckLease()) {
    // 別分頁持有新鮮租約 → 本分頁先不排背景 job，稍後重試（避免排了卻被逐一略過、又卡在 recheckQueued）。
    if (!resweepTimer) {
      resweepTimer = setTimeout(() => {
        resweepTimer = null;
        recheckTentativeCovers({ orderHint });
      }, RESWEEP_MS);
    }
    return;
  }
  // 排序：先用「別分頁(通常是主頁)廣播的視窗就近順序」，再用本分頁的 orderHint（自己是主頁時）。
  // 這樣即使持租約的是 category 分頁（本身沒 orderHint），也會先複查使用者在主頁眼前的那批待確認。
  const order = [...(getRecheckHint() || []), ...(Array.isArray(orderHint) ? orderHint : [])];
  if (order.length) {
    const rank = new Map();
    order.forEach((k, i) => {
      if (!rank.has(k)) rank.set(k, i);
    });
    const near = [];
    const rest = [];
    for (const c of targets) (rank.has(c.catId) ? near : rest).push(c); // rest 保持原插入順序(穩定)
    near.sort((a, b) => rank.get(a.catId) - rank.get(b.catId));
    targets = [...near, ...rest];
  }
  for (const c of targets) enqueueRecheck(c.catId, { background: true }); // 本分頁持租約 → 排入全部背景補底
}
