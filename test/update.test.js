import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatestEp, pendingNewEpisodes } from '../src/util.js';

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
