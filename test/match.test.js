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
