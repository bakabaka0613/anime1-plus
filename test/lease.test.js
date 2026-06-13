import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecheckLease, pickByHint } from '../src/util.js';

test('無租約 → 取得', () => {
  const r = evaluateRecheckLease(null, 'A', 1000, 12000);
  assert.equal(r.owns, true);
  assert.deepEqual(r.lease, { owner: 'A', expires: 13000 });
});

test('他人新鮮租約 → 不取得（讓賢）', () => {
  const r = evaluateRecheckLease({ owner: 'B', expires: 5000 }, 'A', 1000, 12000);
  assert.equal(r.owns, false);
  assert.deepEqual(r.lease, { owner: 'B', expires: 5000 });
});

test('他人過期租約 → 接管', () => {
  const r = evaluateRecheckLease({ owner: 'B', expires: 500 }, 'A', 1000, 12000);
  assert.equal(r.owns, true);
  assert.equal(r.lease.owner, 'A');
  assert.equal(r.lease.expires, 13000);
});

test('自己持有 → 續租（更新 expires）', () => {
  const r = evaluateRecheckLease({ owner: 'A', expires: 5000 }, 'A', 1000, 12000);
  assert.equal(r.owns, true);
  assert.equal(r.lease.expires, 13000);
});

test('損壞租約（無 expires）→ 取得', () => {
  const r = evaluateRecheckLease({ owner: 'B' }, 'A', 1000, 12000);
  assert.equal(r.owns, true);
  assert.equal(r.lease.owner, 'A');
});

test('pickByHint：挑 hint 中 rank 最小（最靠近視窗）者', () => {
  const jobs = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  // hint：c 最近、a 次之、b 最遠 → 應挑 index 2(c)
  assert.equal(pickByHint(jobs, ['c', 'a', 'b']), 2);
});

test('pickByHint：部分不在 hint → 在 hint 者優先', () => {
  const jobs = [{ key: 'x' }, { key: 'b' }, { key: 'y' }];
  assert.equal(pickByHint(jobs, ['b']), 1); // 只有 b 在 hint → 挑 b
});

test('pickByHint：全不在 hint → FIFO(0)', () => {
  assert.equal(pickByHint([{ key: 'x' }, { key: 'y' }], ['a', 'b']), 0);
});

test('pickByHint：無 hint / 空 jobs → 0', () => {
  assert.equal(pickByHint([{ key: 'a' }], null), 0);
  assert.equal(pickByHint([], ['a']), 0);
});

test('pickByHint：同 rank 取先出現(穩定)', () => {
  const jobs = [{ key: 'a' }, { key: 'a' }];
  assert.equal(pickByHint(jobs, ['a']), 0);
});
