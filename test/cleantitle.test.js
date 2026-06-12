import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, normalizeWatchMeta } from '../src/util.js';

test('cleanTitle：去掉「 – Anime1.me 動畫線上看」站名後綴', () => {
  assert.equal(cleanTitle('葬送的芙莉蓮 – Anime1.me 動畫線上看'), '葬送的芙莉蓮');
});

test('cleanTitle：相容 hyphen / 直線分隔符', () => {
  assert.equal(cleanTitle('某動畫 - Anime1.me 動畫線上看'), '某動畫');
  assert.equal(cleanTitle('某動畫 | Anime1.me'), '某動畫');
});

test('cleanTitle：冪等（已乾淨的標題不受影響）', () => {
  assert.equal(cleanTitle('葬送的芙莉蓮'), '葬送的芙莉蓮');
});

test('cleanTitle：不誤刪動畫名內的破折號（後綴需接 Anime1）', () => {
  assert.equal(cleanTitle('Re：從零開始 – 異世界'), 'Re：從零開始 – 異世界');
});

test('cleanTitle：空值安全', () => {
  assert.equal(cleanTitle(null), '');
  assert.equal(cleanTitle(undefined), '');
});

test('normalizeWatchMeta：watch 舊 url → 解析 postId 並刪 url', () => {
  const r = normalizeWatchMeta({
    watch: { 'cat:12': { 1: { currentTime: 30, done: false, url: 'https://anime1.me/45678' } } },
    meta: {},
  });
  assert.equal(r.changed, true);
  assert.equal(r.watch['cat:12'][1].postId, '45678');
  assert.equal('url' in r.watch['cat:12'][1], false);
  assert.equal(r.watch['cat:12'][1].currentTime, 30); // 其餘欄位保留
});

test('normalizeWatchMeta：watch 同時有 postId 與 url → 刪 url', () => {
  const r = normalizeWatchMeta({
    watch: { 'cat:1': { 2: { postId: '999', url: 'https://anime1.me/999', done: true } } },
    meta: {},
  });
  assert.equal('url' in r.watch['cat:1'][2], false);
  assert.equal(r.watch['cat:1'][2].postId, '999');
});

test('normalizeWatchMeta：解析不到 postId 時保留 url 當退路', () => {
  const r = normalizeWatchMeta({
    watch: { 'cat:1': { 1: { url: 'https://anime1.me/?cat=1', done: false } } },
    meta: {},
  });
  assert.equal(r.watch['cat:1'][1].url, 'https://anime1.me/?cat=1');
  assert.equal('postId' in r.watch['cat:1'][1], false);
});

test('normalizeWatchMeta：meta.title 去後綴、episodes 去 url', () => {
  const r = normalizeWatchMeta({
    watch: {},
    meta: {
      'cat:7': {
        title: '葬送的芙莉蓮 – Anime1.me 動畫線上看',
        maxEpSeen: 28,
        episodes: [{ ep: 1, postId: '100', url: 'https://anime1.me/100' }],
      },
    },
  });
  assert.equal(r.changed, true);
  assert.equal(r.meta['cat:7'].title, '葬送的芙莉蓮');
  assert.equal(r.meta['cat:7'].maxEpSeen, 28);
  assert.deepEqual(r.meta['cat:7'].episodes, [{ ep: 1, postId: '100' }]);
});

test('normalizeWatchMeta：已是精簡格式 → changed=false（冪等）', () => {
  const lean = {
    watch: { 'cat:1': { 1: { currentTime: 10, done: false, postId: '5' } } },
    meta: { 'cat:1': { title: '某番', maxEpSeen: 3, episodes: [{ ep: 1, postId: '5' }] } },
  };
  const r = normalizeWatchMeta(lean);
  assert.equal(r.changed, false);
});

test('normalizeWatchMeta：不改動輸入物件', () => {
  const input = { watch: { 'cat:1': { 1: { url: 'https://anime1.me/5' } } }, meta: {} };
  normalizeWatchMeta(input);
  assert.equal(input.watch['cat:1'][1].url, 'https://anime1.me/5'); // 原物件不變
});
