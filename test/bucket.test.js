import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateToBucket, pickTagNames, needsCoverMeta, buildCoverTags } from '../src/util.js';

test('dateToBucket：各季月份邊界', () => {
  assert.equal(dateToBucket('2023-01-10'), '2023冬');
  assert.equal(dateToBucket('2023-02-28'), '2023冬');
  assert.equal(dateToBucket('2023-03-01'), '2023春');
  assert.equal(dateToBucket('2023-05-31'), '2023春');
  assert.equal(dateToBucket('2023-06-01'), '2023夏');
  assert.equal(dateToBucket('2023-08-31'), '2023夏');
  assert.equal(dateToBucket('2023-09-29'), '2023秋'); // 葬送的芙莉蓮
  assert.equal(dateToBucket('2023-11-30'), '2023秋');
});

test('dateToBucket：12 月歸入隔年冬', () => {
  assert.equal(dateToBucket('2023-12-15'), '2024冬');
  assert.equal(dateToBucket('2025-12-01'), '2026冬');
});

test('dateToBucket：無效輸入 → null', () => {
  assert.equal(dateToBucket(''), null);
  assert.equal(dateToBucket(null), null);
  assert.equal(dateToBucket(undefined), null);
  assert.equal(dateToBucket('2023'), null);
  assert.equal(dateToBucket('2023-13-01'), null); // 月份越界
});

test('pickTagNames：依 count 取前 n 名', () => {
  const tags = [
    { name: '治愈', count: 7837 },
    { name: '奇幻', count: 6209 },
    { name: 'MADHouse', count: 6086 },
  ];
  assert.deepEqual(pickTagNames(tags, 2), ['治愈', '奇幻']);
  assert.deepEqual(pickTagNames(tags), ['治愈', '奇幻', 'MADHouse']);
});

test('pickTagNames：未排序輸入會先排序；過濾空白/非法', () => {
  const tags = [
    { name: 'b', count: 1 },
    { name: 'a', count: 99 },
    { name: '  ', count: 50 },
    { foo: 'x' },
  ];
  assert.deepEqual(pickTagNames(tags), ['a', 'b']);
});

test('pickTagNames：非陣列 → []', () => {
  assert.deepEqual(pickTagNames(null), []);
  assert.deepEqual(pickTagNames(undefined), []);
});

test('needsCoverMeta：有 subjectId 且尚無 date → 需補', () => {
  assert.equal(needsCoverMeta({ subjectId: 1 }, 1000), true);
});

test('needsCoverMeta：已有 date → 不補', () => {
  assert.equal(needsCoverMeta({ subjectId: 1, date: '2023-09-29' }, 1000), false);
});

test('needsCoverMeta：無 subjectId → 不補', () => {
  assert.equal(needsCoverMeta({ cover: 'x' }, 1000), false);
  assert.equal(needsCoverMeta(null, 1000), false);
});

test('needsCoverMeta：metaTriedAt 在 7 天內 → 不重試；超過 → 再試', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  assert.equal(needsCoverMeta({ subjectId: 1, metaTriedAt: now - 3 * day }, now), false);
  assert.equal(needsCoverMeta({ subjectId: 1, metaTriedAt: now - 8 * day }, now), true);
});

// 註：node 測試無 OpenCC，toTraditional 為 no-op → 用已繁化輸入驗證去重/過濾/重疊/時間邏輯。
test('buildCoverTags：metaTags 去重 + 去掉 TV/日本', () => {
  const r = buildCoverTags([], ['TV', 'TV', '日本', '日本', '奇幻', '奇幻', '穿越']);
  assert.deepEqual(r.metaTags, ['奇幻', '穿越']);
});

test('buildCoverTags：tags 過濾時間/TV/與 meta_tags 重疊；與 metaTags 互斥', () => {
  const rawTags = [
    { name: '2026年4月', count: 100 },
    { name: 'TV', count: 90 },
    { name: 'WITSTUDIO', count: 80 },
    { name: '奇幻', count: 70 },
    { name: '2026', count: 60 },
    { name: '穿越', count: 50 },
    { name: '日本', count: 40 },
    { name: '種田', count: 30 },
  ];
  const r = buildCoverTags(rawTags, ['TV', '日本', '奇幻', '穿越']);
  assert.deepEqual(r.metaTags, ['奇幻', '穿越']);
  assert.deepEqual(r.tags, ['WITSTUDIO', '種田']); // 時間(2026年4月/2026)、TV、奇幻/穿越/日本(meta_tags)全濾掉
});

test('buildCoverTags：tags 自身去重', () => {
  const r = buildCoverTags(
    [
      { name: '異世界', count: 9 },
      { name: '異世界', count: 8 },
      { name: '冒險', count: 7 },
    ],
    [],
  );
  assert.deepEqual(r.tags, ['異世界', '冒險']);
});

test('buildCoverTags：tags 取前 n 名', () => {
  const raw = Array.from({ length: 15 }, (_, i) => ({ name: `t${i}`, count: 100 - i }));
  assert.equal(buildCoverTags(raw, [], 5).tags.length, 5);
});

test('buildCoverTags：接受 string[]（既有快取重清用）且 idempotent', () => {
  const once = buildCoverTags(
    [
      { name: '2026年4月', count: 100 },
      { name: 'TV', count: 90 },
      { name: 'WITSTUDIO', count: 80 },
      { name: '奇幻', count: 70 },
    ],
    ['TV', '日本', '奇幻'],
  );
  // 對輸出（string[]）再跑一次 → 結果不變（idempotent）
  const twice = buildCoverTags(once.tags, once.metaTags);
  assert.deepEqual(twice.tags, once.tags);
  assert.deepEqual(twice.metaTags, once.metaTags);
  assert.deepEqual(once.tags, ['WITSTUDIO']);
  assert.deepEqual(once.metaTags, ['奇幻']);
});
