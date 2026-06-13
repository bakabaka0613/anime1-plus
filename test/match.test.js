import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle } from '../src/parse.js';
import { rankCandidates } from '../src/match.js';

test('挑出正確條目（名稱 + 年份吻合）並有信心', () => {
  const parsed = parseTitle('葬送的芙莉蓮 [28]');
  const subjects = [
    { id: 400602, name: '葬送のフリーレン', name_cn: '葬送的芙莉蓮', date: '2023-09-29' },
    { id: 1, name: 'べつ', name_cn: '魔法少女小圓', date: '2011-01-01' },
  ];
  const r = rankCandidates(parsed, 2023, subjects);
  assert.equal(r.best.subject.id, 400602);
  assert.equal(r.confident, true);
  assert.equal(r.needConfirm, false);
});

test('同名不同季：靠季度 + 年份選對第三季', () => {
  const parsed = parseTitle('為美好的世界獻上祝福！第三季 [01]');
  const subjects = [
    { id: 10, name: 'この素晴らしい世界に祝福を！', name_cn: '為美好的世界獻上祝福！', date: '2016-01-14' },
    { id: 30, name: 'この素晴らしい世界に祝福を！3', name_cn: '為美好的世界獻上祝福！第三季', date: '2024-04-10' },
  ];
  const r = rankCandidates(parsed, 2024, subjects);
  assert.equal(r.best.subject.id, 30);
});

test('同名不同季：選對第一季（年份較早）', () => {
  const parsed = parseTitle('為美好的世界獻上祝福！ [05]');
  const subjects = [
    { id: 10, name: 'この素晴らしい世界に祝福を！', name_cn: '為美好的世界獻上祝福！', date: '2016-01-14' },
    { id: 30, name: 'この素晴らしい世界に祝福を！3', name_cn: '為美好的世界獻上祝福！第三季', date: '2024-04-10' },
  ];
  const r = rankCandidates(parsed, 2016, subjects);
  assert.equal(r.best.subject.id, 10);
});

test('沒有夠像的候選 → 需確認', () => {
  const parsed = parseTitle('某冷門動畫 [01]');
  const subjects = [
    { id: 1, name: 'kanzen', name_cn: '完全不相關的作品', date: '2010-01-01' },
  ];
  const r = rankCandidates(parsed, 2024, subjects);
  assert.equal(r.needConfirm, true);
});

test('空候選 → best 為 null 且需確認', () => {
  const parsed = parseTitle('某動畫 [01]');
  const r = rankCandidates(parsed, null, []);
  assert.equal(r.best, null);
  assert.equal(r.needConfirm, true);
});

test('年份未知（null）也能靠名稱有信心', () => {
  const parsed = parseTitle('葬送的芙莉蓮 [28]');
  const subjects = [
    { id: 400602, name: '葬送のフリーレン', name_cn: '葬送的芙莉蓮', date: '2023-09-29' },
  ];
  const r = rankCandidates(parsed, null, subjects);
  assert.equal(r.best.subject.id, 400602);
  assert.equal(r.confident, true);
});

// 註：node 測試無 OpenCC，toSimplified 為 no-op，故這裡用「已簡化」輸入驗證 similarity 的長度加權
// （繁→簡由瀏覽器 OpenCC 另行處理）。實際情境：anime1「判處勇者刑」經 OpenCC → 「判处勇者刑」。
test('主名相符但 Bangumi name_cn 含長副標 → 仍有信心（判处勇者刑）', () => {
  const parsed = parseTitle('判处勇者刑');
  const subjects = [
    { id: 100, name: '勇者刑に処す', name_cn: '判处勇者刑 惩罚勇者9004队刑务纪录', date: '2024-10-01' },
    { id: 101, name: '勇者刑に処す 2nd', name_cn: '判处勇者刑 惩罚勇者9004队刑务纪录 第二季', date: '2025-10-01' },
  ];
  const r = rankCandidates(parsed, 2024, subjects);
  assert.equal(r.best.subject.id, 100);
  assert.equal(r.confident, true);
});

test('極短名（2 字）被長名包含 → 維持低分、不誤採', () => {
  const parsed = parseTitle('魔法');
  const subjects = [{ id: 200, name: 'X', name_cn: '魔法少女小圓 叛逆的物語', date: '2013-10-26' }];
  const r = rankCandidates(parsed, 2024, subjects);
  assert.equal(r.confident, false);
});

// 回歸守門：短主名被「無分隔副標」長名包含的不同作品，不可因長度被誤判為 confident
// （曾因 similarity 長度加權過寬而誤採 → 還原後須維持需確認）。
test('短主名被無分隔長名包含（不同作品）→ 維持需確認、不誤採', () => {
  const parsed = parseTitle('聖戰世界');
  const subjects = [{ id: 300, name: 'X', name_cn: '聖戰世界毀滅錄黑暗紀元篇章', date: '2024-01-01' }];
  const r = rankCandidates(parsed, 2024, subjects);
  assert.equal(r.confident, false);
});

// 不同中文譯名（字多半相同、僅插入/換序）：靠 LCS 比例 + 季度/年份交叉驗證仍有信心。
// 註：node 無 OpenCC，故用已簡化輸入；實際 anime1 繁體名由瀏覽器 OpenCC 先轉簡。
test('不同譯名同作品 → 靠 LCS + 季度有信心（你与我最后的战场）', () => {
  const parsed = parseTitle('这是你与我的最后战场，或是开创世界的圣战 第2季');
  const subjects = [
    { id: 400, name: 'キミと僕の最後の戦場', name_cn: '你与我最后的战场，亦或是世界起始的圣战 第二季', date: '2025-04-01' },
    { id: 401, name: 'キミと僕の最後の戦場', name_cn: '你与我最后的战场，亦或是世界起始的圣战', date: '2020-10-01' },
  ];
  const r = rankCandidates(parsed, 2025, subjects);
  assert.equal(r.best.subject.id, 400);
  assert.equal(r.confident, true);
});

test('ranked 依分數由高到低排序', () => {
  const parsed = parseTitle('間諜過家家 第2季 [12]');
  const subjects = [
    { id: 1, name: 'A', name_cn: '完全不相關', date: '2000-01-01' },
    { id: 2, name: 'SPY×FAMILY', name_cn: '間諜過家家 第2季', date: '2023-10-07' },
  ];
  const r = rankCandidates(parsed, 2023, subjects);
  assert.equal(r.ranked[0].subject.id, 2);
  assert.ok(r.ranked[0].score >= r.ranked[1].score);
});
