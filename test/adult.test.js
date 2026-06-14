import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdultLink } from '../src/util.js';

test('anime1.pw ?cat= 連結 → 18 禁', () => {
  assert.equal(isAdultLink('https://anime1.pw/?cat=58'), true);
});

test('anime1.pw 任意路徑 → 18 禁（網域偵測，不限 ?cat=）', () => {
  assert.equal(isAdultLink('https://anime1.pw/anything'), true);
});

test('本站 anime1.me 分類連結 → 非 18 禁', () => {
  assert.equal(isAdultLink('https://anime1.me/category/2026春/xxx'), false);
});

test('本站 anime1.me 同樣 ?cat= 形式 → 不可誤判', () => {
  assert.equal(isAdultLink('https://anime1.me/?cat=58'), false);
});

test('空字串/null/undefined → 非 18 禁', () => {
  assert.equal(isAdultLink(''), false);
  assert.equal(isAdultLink(null), false);
  assert.equal(isAdultLink(undefined), false);
});
