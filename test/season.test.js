import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonBuckets } from '../src/util.js';

// ---- seasonBuckets：animelist.json 的 year(r[3])/season(r[4]) → 年+季桶 ----

test('單值：單年單季', () => {
  assert.deepEqual(seasonBuckets('2024', '夏'), ['2024夏']);
});

test('形態1 年份前綴：三段各自帶年（Dr.STONE SCIENCE FUTURE）', () => {
  assert.deepEqual(seasonBuckets('2025/2026', '2025冬/2025夏/2026春'), ['2025冬', '2025夏', '2026春']);
});

test('形態1 年份前綴：跨年兩段（鬼燈的冷徹 第二季）', () => {
  assert.deepEqual(seasonBuckets('2017/2018', '2017秋/2018春'), ['2017秋', '2018春']);
});

test('形態2 同年多季：單年配兩季（賽馬娘 灰髮灰姑娘）', () => {
  assert.deepEqual(seasonBuckets('2025', '春/秋'), ['2025春', '2025秋']);
});

test('形態2 位置配對：兩年兩季按播出序配對（尼爾：自動人形 Ver1.1a）', () => {
  assert.deepEqual(seasonBuckets('2023/2024', '冬/夏'), ['2023冬', '2024夏']);
});

test('形態2 run-over：季少於年 → 取首年（嘆氣的亡靈想隱退）', () => {
  assert.deepEqual(seasonBuckets('2024/2025', '秋'), ['2024秋']);
});

test('防呆：r4 無季字 → 空陣列', () => {
  assert.deepEqual(seasonBuckets('2024', ''), []);
  assert.deepEqual(seasonBuckets('2024', null), []);
});

test('防呆：r3 無年份 → 空陣列', () => {
  assert.deepEqual(seasonBuckets('', '春'), []);
});

test('桶格式恆為 YYYY季', () => {
  for (const b of seasonBuckets('2020/2022', '2020秋/2022冬')) {
    assert.match(b, /^\d{4}[春夏秋冬]$/);
  }
});
