import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle } from '../src/parse.js';

test('普通單季：移除尾端集數', () => {
  const r = parseTitle('葬送的芙莉蓮 [28]');
  assert.equal(r.baseName, '葬送的芙莉蓮');
  assert.equal(r.ep, 28);
  assert.equal(r.seasonNum, 1);
  assert.equal(r.type, 'TV');
});

test('中文「第三季」', () => {
  const r = parseTitle('為美好的世界獻上祝福！第三季 [01]');
  assert.equal(r.baseName, '為美好的世界獻上祝福！');
  assert.equal(r.seasonNum, 3);
  assert.equal(r.ep, 1);
});

test('阿拉伯數字「第2季」', () => {
  const r = parseTitle('間諜過家家 第2季 [12]');
  assert.equal(r.baseName, '間諜過家家');
  assert.equal(r.seasonNum, 2);
  assert.equal(r.ep, 12);
});

test('羅馬數字全形 Ⅱ 緊接名稱（含副標題）', () => {
  const r = parseTitle('無職轉生Ⅱ ～到了異世界就拿出真本事～ [01]');
  assert.equal(r.seasonNum, 2);
  assert.equal(r.ep, 1);
  // baseName 應保留主標題且不含 Ⅱ
  assert.ok(r.baseName.startsWith('無職轉生'));
  assert.ok(!r.baseName.includes('Ⅱ'));
});

test('英文 2nd Season', () => {
  const r = parseTitle('鏈鋸人 2nd Season [03]');
  assert.equal(r.baseName, '鏈鋸人');
  assert.equal(r.seasonNum, 2);
});

test('Season 2 寫法', () => {
  const r = parseTitle('OVERLORD Season 4 [05]');
  assert.equal(r.seasonNum, 4);
  assert.equal(r.baseName, 'OVERLORD');
});

test('版本號 [01v2] 仍解析出集數', () => {
  const r = parseTitle('我的英雄學院 第七季 [01v2]');
  assert.equal(r.ep, 1);
  assert.equal(r.seasonNum, 7);
  assert.equal(r.baseName, '我的英雄學院');
});

test('劇場版 type = MOVIE', () => {
  const r = parseTitle('劇場版 為美好的世界獻上祝福！紅傳說 [01]');
  assert.equal(r.type, 'MOVIE');
  assert.ok(r.baseName.includes('為美好的世界獻上祝福'));
  assert.ok(!r.baseName.includes('劇場版'));
});

test('「電影版」前綴視為 MOVIE 並從 baseName 移除（避免主導搜尋）', () => {
  const r = parseTitle('電影版小林家的龍女僕：害怕寂寞的龍 [劇場版]');
  assert.equal(r.type, 'MOVIE');
  assert.equal(r.baseName, '小林家的龍女僕：害怕寂寞的龍');
  assert.ok(!r.baseName.includes('電影版'));
});

test('「電影版 」帶空格前綴也移除', () => {
  const r = parseTitle('電影版 搖曳露營△ [劇場版]');
  assert.equal(r.type, 'MOVIE');
  assert.equal(r.baseName, '搖曳露營△');
});

test('OVA type = OVA', () => {
  const r = parseTitle('某科學的超電磁砲 OVA [01]');
  assert.equal(r.type, 'OVA');
  assert.equal(r.baseName, '某科學的超電磁砲');
});

test('小數集數 [12.5]', () => {
  const r = parseTitle('某動畫 [12.5]');
  assert.equal(r.ep, 12.5);
});

test('非數字集數 [特別篇] → ep 為 null、type SP', () => {
  const r = parseTitle('某動畫 [特別篇]');
  assert.equal(r.ep, null);
  assert.equal(r.type, 'SP');
});

test('沒有集數標記也不報錯', () => {
  const r = parseTitle('某動畫名稱');
  assert.equal(r.baseName, '某動畫名稱');
  assert.equal(r.ep, null);
  assert.equal(r.seasonNum, 1);
});

test('Re:從零開始 含冒號的名稱不被破壞', () => {
  const r = parseTitle('Re:從零開始的異世界生活 第三季 [16]');
  assert.equal(r.baseName, 'Re:從零開始的異世界生活');
  assert.equal(r.seasonNum, 3);
  assert.equal(r.ep, 16);
});

test('英中混合名（Dr.STONE 新石紀 SCIENCE FUTURE）保留完整名', () => {
  const r = parseTitle('Dr.STONE 新石紀 SCIENCE FUTURE [35]');
  assert.equal(r.baseName, 'Dr.STONE 新石紀 SCIENCE FUTURE');
  assert.equal(r.ep, 35);
  assert.equal(r.seasonNum, 1);
  assert.equal(r.type, 'TV');
});

test('動畫名本身（無集數標記）解析為完整 baseName', () => {
  const r = parseTitle('Dr.STONE 新石紀 SCIENCE FUTURE');
  assert.equal(r.baseName, 'Dr.STONE 新石紀 SCIENCE FUTURE');
  assert.equal(r.ep, null);
});

test('重複季度標記（Season II 與 第2季併存）全部清除、不殘留空括號', () => {
  const r = parseTitle('這是妳與我的最後戰場，或是開創世界的聖戰 Season II ()（第2季）');
  assert.equal(r.seasonNum, 2);
  assert.equal(r.baseName, '這是妳與我的最後戰場，或是開創世界的聖戰');
  assert.ok(!/season|ii|（|）|\(|\)/i.test(r.baseName));
});

test('Final Season 視為續作（seasonNum > 1）', () => {
  const r = parseTitle('進擊的巨人 The Final Season [01]');
  assert.ok(r.seasonNum > 1);
  assert.equal(r.baseName, '進擊的巨人');
});
