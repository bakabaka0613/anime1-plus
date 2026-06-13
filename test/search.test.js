import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleSearchSegments, splitAliasNames } from '../src/util.js';

test('破折號副標：尾段去破折號雜訊，主段可單獨搜（隨興旅 -That\'s Journey-）', () => {
  assert.deepEqual(titleSearchSegments("隨興旅 -That's Journey-"), ['隨興旅', "That's Journey"]);
});

test('franchise 前綴：尾段為真名（銀魂 3年Z班銀八老師）', () => {
  assert.deepEqual(titleSearchSegments('銀魂 3年Z班銀八老師'), ['銀魂', '3年Z班銀八老師']);
});

test('em-dash 無空白分隔（WONDANCE—熱舞青春—）：切出英文主名段', () => {
  assert.deepEqual(titleSearchSegments('WONDANCE—熱舞青春—'), ['WONDANCE', '熱舞青春']);
});

test('雙語標題（GRAND BLUE 碧藍之海）：在拉丁→CJK 邊界切，不切爛含空白的英文名', () => {
  assert.deepEqual(titleSearchSegments('GRAND BLUE 碧藍之海'), ['GRAND BLUE', '碧藍之海']);
});

test('括號內為通用譯名（魔王陛下…R(重來吧，魔王大人！ R)）：取括號外與括號內各一段', () => {
  assert.deepEqual(titleSearchSegments('魔王陛下，RETRY！R(重來吧，魔王大人！ R)'), [
    '魔王陛下，RETRY！R',
    '重來吧，魔王大人！ R',
  ]);
});

test('全形括號也處理', () => {
  assert.deepEqual(titleSearchSegments('主名（別名）'), ['主名', '別名']);
});

test('無空白單段 → []（不補搜）', () => {
  assert.deepEqual(titleSearchSegments('葬送的芙莉蓮'), []);
});

test('名稱內連字號不被當分段（K-ON，無空白）', () => {
  assert.deepEqual(titleSearchSegments('K-ON!'), []);
});

test('三段以上：尾段保留其餘全部', () => {
  assert.deepEqual(titleSearchSegments('Dr.STONE 新石紀 SCIENCE FUTURE'), ['Dr.STONE', '新石紀 SCIENCE FUTURE']);
});

test('空字串 → []', () => {
  assert.deepEqual(titleSearchSegments(''), []);
});

test('splitAliasNames：頓號併名拆開（醜男真戰士、丑男真战士）', () => {
  assert.deepEqual(splitAliasNames('醜男真戰士、丑男真战士'), ['醜男真戰士', '丑男真战士']);
});

test('splitAliasNames：逗號併名拆開、去前後空白', () => {
  assert.deepEqual(splitAliasNames('Uglymug, Epicfighter'), ['Uglymug', 'Epicfighter']);
});

test('splitAliasNames：多字英文名不拆空白', () => {
  assert.deepEqual(splitAliasNames('Busamen Gachi Fighter'), ['Busamen Gachi Fighter']);
});

test('splitAliasNames：空字串 → []', () => {
  assert.deepEqual(splitAliasNames(''), []);
});
