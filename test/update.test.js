import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatestEp, pendingNewEpisodes, caughtUpNewEpisodes, resumeTarget, isAiring, isCaughtUp, markEpisodesDone } from '../src/util.js';

// ---- parseLatestEp：解析首頁「集數」欄 → 最新一般集數 ----
test('連載中(N) 取括號內集數', () => {
  assert.equal(parseLatestEp('連載中(11)'), 11);
});

test('已完結 a-b 取上界', () => {
  assert.equal(parseLatestEp('1-8'), 8);
});

test('單集 N', () => {
  assert.equal(parseLatestEp('1'), 1);
});

test('小數集數 0-11.5', () => {
  assert.equal(parseLatestEp('0-11.5'), 11.5);
});

test('續編標記 +13：只取 + 前主集數段，避免把 OVA 之類算進來', () => {
  assert.equal(parseLatestEp('1-12+OVA'), 12);
  assert.equal(parseLatestEp('1-12+SP1-3'), 12);
});

test('連載中(04 EP03) 取括號內最大數字', () => {
  assert.equal(parseLatestEp('連載中(04 EP03)'), 4);
});

test('純特殊集（無一般集數）→ null', () => {
  assert.equal(parseLatestEp('劇場版'), null);
  assert.equal(parseLatestEp('OVA'), null);
  assert.equal(parseLatestEp('SP'), null);
  assert.equal(parseLatestEp('-'), null);
  assert.equal(parseLatestEp(''), null);
  assert.equal(parseLatestEp(null), null);
});

// ---- isAiring：首頁「集數」欄是否標示連載中 ----
test('連載中 → true', () => {
  assert.equal(isAiring('連載中(11)'), true);
  assert.equal(isAiring('連載中(04 EP03)'), true);
});

test('已完結／特殊集 → false', () => {
  assert.equal(isAiring('1-8'), false);
  assert.equal(isAiring('1-12+OVA'), false);
  assert.equal(isAiring('劇場版'), false);
  assert.equal(isAiring('-'), false);
  assert.equal(isAiring(''), false);
  assert.equal(isAiring(null), false);
});

// ---- pendingNewEpisodes：最新集數 vs 已完成集 → 該提醒的新增集數 ----
const done = (eps) => Object.fromEntries(eps.map((e) => [String(e), { done: true }]));

test('最新集 > 最大已完成集 → 回傳差額', () => {
  assert.equal(pendingNewEpisodes(11, done([8])), 3);
});

test('已追到最新集 → null（不提醒）', () => {
  assert.equal(pendingNewEpisodes(8, done([8])), null);
});

test('已完成集數比最新還大（資料較舊）→ null', () => {
  assert.equal(pendingNewEpisodes(8, done([10])), null);
});

test('只有看一半、沒任何已完成集 → null（觸發條件限已完成集）', () => {
  assert.equal(pendingNewEpisodes(11, { 8: { done: false, currentTime: 100 } }), null);
});

test('取最大的已完成集，而非最後一筆', () => {
  assert.equal(pendingNewEpisodes(11, done([3, 8, 5])), 3);
});

test('最新集數無法解析（null）→ null', () => {
  assert.equal(pendingNewEpisodes(null, done([8])), null);
});

test('完全沒有觀看記錄 → null', () => {
  assert.equal(pendingNewEpisodes(11, {}), null);
});

// ---- caughtUpNewEpisodes：只有「已追平當時最新集後又出新集」才回傳差額 ----
test('已追平（看完第8集、上次最新也是8）後更新第9集 → +1', () => {
  assert.equal(caughtUpNewEpisodes(9, done([1, 8]), 8), 1);
});

test('落後未追完（只看完第1集、上次已知到第8集）出第9集 → null（不置頂不標記）', () => {
  assert.equal(caughtUpNewEpisodes(9, done([1]), 8), null);
});

test('已追平但尚無新集（最新==已完成）→ null', () => {
  assert.equal(caughtUpNewEpisodes(8, done([8]), 8), null);
});

test('缺 maxEpSeen（沒進過分類頁、無法確認追平）→ null', () => {
  assert.equal(caughtUpNewEpisodes(9, done([8]), null), null);
  assert.equal(caughtUpNewEpisodes(9, done([8]), undefined), null);
});

test('沒有任何已完成集 → null', () => {
  assert.equal(caughtUpNewEpisodes(9, { 8: { done: false } }, 8), null);
});

test('一次更新多集（追平第8、現已第11）→ +3', () => {
  assert.equal(caughtUpNewEpisodes(11, done([8]), 8), 3);
});

test('最新集數無法解析（null）→ null', () => {
  assert.equal(caughtUpNewEpisodes(null, done([8]), 8), null);
});

// ---- resumeTarget：追番清單「繼續看／看下一集」判定 ----
const ep = (done, watchedAt, currentTime = 0) => ({ done, watchedAt, currentTime });

test('reproducer：前集未標記看完、後集已標記看完 → 看下一集（不回頭挑前集）', () => {
  // 第1集看了但沒到門檻（!done，較早）；第2集看完（done，較晚）
  const eps = { 1: ep(false, 100), 2: ep(true, 200) };
  assert.deepEqual(resumeTarget(eps), { mode: 'next', ep: 3 });
});

test('最後觀看的集未看完 → 繼續看該集', () => {
  const eps = { 1: ep(true, 100), 3: ep(false, 300, 250) };
  assert.deepEqual(resumeTarget(eps), { mode: 'resume', ep: '3' });
});

test('全部看完 → 下一集為最後觀看集 + 1', () => {
  const eps = { 1: ep(true, 100), 2: ep(true, 200) };
  assert.deepEqual(resumeTarget(eps), { mode: 'next', ep: 3 });
});

test('回頭重看舊集且未看完 → 以最後動作為準，繼續看該舊集', () => {
  const eps = { 5: ep(true, 500), 2: ep(false, 600, 100) };
  assert.deepEqual(resumeTarget(eps), { mode: 'resume', ep: '2' });
});

test('無觀看記錄 → none', () => {
  assert.deepEqual(resumeTarget({}), { mode: 'none' });
});

// ---- isCaughtUp：追番面板分區判定（true=已看完/已到最新進度→下方區；false=有進度→置頂區）----
test('有未看完的集（resume）→ 有進度（false）', () => {
  const eps = { 1: ep(true, 100), 2: ep(false, 200, 120) };
  assert.equal(isCaughtUp(eps, [], 0), false);
});

test('全看完、meta 有下一集可看 → 有進度（false）', () => {
  const eps = { 1: ep(true, 100), 2: ep(true, 200) };
  // 下一集為 3，meta.episodes 內有 ep:3 → 還能「看下一集」
  assert.equal(isCaughtUp(eps, [{ ep: 3, url: 'u3' }], 0), false);
});

test('全看完、無下一集、但有新集（newEps>0）→ 有進度（false）', () => {
  const eps = { 1: ep(true, 100), 2: ep(true, 200) };
  assert.equal(isCaughtUp(eps, [], 2), false);
});

test('全看完、無下一集、無新集 → 終端狀態（true，已看完/已到最新進度）', () => {
  const eps = { 1: ep(true, 100), 2: ep(true, 200) };
  assert.equal(isCaughtUp(eps, [], 0), true);
});

test('newEps 為 undefined（尚未抓即時集數）視為無新集 → 終端（true）', () => {
  const eps = { 1: ep(true, 100) };
  assert.equal(isCaughtUp(eps, undefined, undefined), true);
});

// ---- markEpisodesDone：手動標記整部已看完（追番面板）----
test('meta 全集清單 → 每一集都設 done，最大集 watchedAt 最大（resumeTarget 指最高集、無下一集）', () => {
  const watch = { 1: ep(true, 100), 2: ep(false, 200, 300) };
  const metaEps = [{ ep: 1 }, { ep: 2 }, { ep: 3 }];
  const out = markEpisodesDone(watch, metaEps, 1000);
  assert.deepEqual(Object.keys(out).sort(), ['1', '2', '3']);
  assert.ok(out[1].done && out[2].done && out[3].done);
  assert.ok(out[3].watchedAt > out[1].watchedAt); // 最大集最後看
  // 標記後應落入已看完區（meta 全集都看完、無下一集）
  assert.equal(isCaughtUp(out, metaEps, 0), true);
});

test('無 meta.episodes → 只把已觀看的集設 done', () => {
  const watch = { 1: ep(true, 100), 3: ep(false, 200, 50) };
  const out = markEpisodesDone(watch, undefined, 1000);
  assert.deepEqual(Object.keys(out).sort(), ['1', '3']);
  assert.ok(out[1].done && out[3].done);
});

test('保留原有 currentTime/duration 等欄位', () => {
  const watch = { 2: { done: false, watchedAt: 5, currentTime: 600, duration: 1400 } };
  const out = markEpisodesDone(watch, [{ ep: 2 }], 1000);
  assert.equal(out[2].currentTime, 600);
  assert.equal(out[2].duration, 1400);
  assert.equal(out[2].done, true);
});

test('不改動輸入物件', () => {
  const watch = { 1: ep(false, 100, 30) };
  const copy = JSON.parse(JSON.stringify(watch));
  markEpisodesDone(watch, [{ ep: 1 }, { ep: 2 }], 1000);
  assert.deepEqual(watch, copy);
});
