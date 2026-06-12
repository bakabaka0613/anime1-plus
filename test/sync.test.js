import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSync } from '../src/util.js';
import { resolveGistId } from '../src/sync.js';

// mergeSync(local, remote) → { watch, meta }：逐集（per-episode）按 watchedAt 合併 watch，
// meta 的 maxEpSeen 取 max。用於 GitHub Gist 多端同步，避免淺合併整包覆蓋。

// ---- watch：逐集合併 ----
test('catId 不重疊 → 聯集兩邊', () => {
  const local = { watch: { a: { 1: { watchedAt: 10 } } }, meta: {} };
  const remote = { watch: { b: { 1: { watchedAt: 20 } } }, meta: {} };
  const { watch } = mergeSync(local, remote);
  assert.deepEqual(watch, { a: { 1: { watchedAt: 10 } }, b: { 1: { watchedAt: 20 } } });
});

test('同 catId、不同集 → 聯集集數', () => {
  const local = { watch: { a: { 1: { watchedAt: 10 } } }, meta: {} };
  const remote = { watch: { a: { 2: { watchedAt: 20 } } }, meta: {} };
  const { watch } = mergeSync(local, remote);
  assert.deepEqual(watch.a, { 1: { watchedAt: 10 }, 2: { watchedAt: 20 } });
});

test('同 catId 同集 → 取 watchedAt 較大者（含 done/currentTime 一併採用）', () => {
  const local = { watch: { a: { 1: { watchedAt: 100, done: false, currentTime: 50 } } }, meta: {} };
  const remote = { watch: { a: { 1: { watchedAt: 200, done: true, currentTime: 1400 } } }, meta: {} };
  const { watch } = mergeSync(local, remote);
  assert.deepEqual(watch.a[1], { watchedAt: 200, done: true, currentTime: 1400 });
});

test('同集：local 較新 → 保留 local 整筆', () => {
  const local = { watch: { a: { 1: { watchedAt: 300, done: true } } }, meta: {} };
  const remote = { watch: { a: { 1: { watchedAt: 200, done: false } } }, meta: {} };
  const { watch } = mergeSync(local, remote);
  assert.deepEqual(watch.a[1], { watchedAt: 300, done: true });
});

test('缺 watchedAt 視為 0 → 有 watchedAt 的一方勝', () => {
  const local = { watch: { a: { 1: { done: false } } }, meta: {} };
  const remote = { watch: { a: { 1: { watchedAt: 5, done: true } } }, meta: {} };
  const { watch } = mergeSync(local, remote);
  assert.deepEqual(watch.a[1], { watchedAt: 5, done: true });
});

test('兩邊同集 watchedAt 相等 → 不丟資料（取其一即可，採 remote）', () => {
  const local = { watch: { a: { 1: { watchedAt: 100, done: false } } }, meta: {} };
  const remote = { watch: { a: { 1: { watchedAt: 100, done: true } } }, meta: {} };
  const { watch } = mergeSync(local, remote);
  assert.equal(watch.a[1].watchedAt, 100);
  assert.equal(watch.a[1].done, true);
});

// ---- 空輸入 ----
test('空 local → 取 remote', () => {
  const remote = { watch: { a: { 1: { watchedAt: 20 } } }, meta: { a: { maxEpSeen: 3 } } };
  const merged = mergeSync({ watch: {}, meta: {} }, remote);
  assert.deepEqual(merged.watch, remote.watch);
  assert.deepEqual(merged.meta, remote.meta);
});

test('空 remote → 取 local', () => {
  const local = { watch: { a: { 1: { watchedAt: 20 } } }, meta: { a: { maxEpSeen: 3 } } };
  const merged = mergeSync(local, { watch: {}, meta: {} });
  assert.deepEqual(merged.watch, local.watch);
  assert.deepEqual(merged.meta, local.meta);
});

test('缺漏欄位（undefined watch/meta）→ 不報錯、回空物件', () => {
  const merged = mergeSync({}, {});
  assert.deepEqual(merged, { watch: {}, meta: {} });
});

// ---- meta：maxEpSeen 取 max ----
test('meta.maxEpSeen 取兩邊較大', () => {
  const local = { watch: {}, meta: { a: { maxEpSeen: 8, title: '舊' } } };
  const remote = { watch: {}, meta: { a: { maxEpSeen: 11, title: '新' } } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.maxEpSeen, 11);
});

test('meta.maxEpSeen：local 較大 → 取 local，title/episodes 採 maxEpSeen 大的一邊', () => {
  const local = { watch: {}, meta: { a: { maxEpSeen: 12, title: 'L', episodes: [1, 2] } } };
  const remote = { watch: {}, meta: { a: { maxEpSeen: 5, title: 'R', episodes: [9] } } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.maxEpSeen, 12);
  assert.equal(meta.a.title, 'L');
  assert.deepEqual(meta.a.episodes, [1, 2]);
});

test('meta catId 只在一邊 → 保留', () => {
  const local = { watch: {}, meta: { a: { maxEpSeen: 3 } } };
  const remote = { watch: {}, meta: { b: { maxEpSeen: 5 } } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.maxEpSeen, 3);
  assert.equal(meta.b.maxEpSeen, 5);
});

test('meta 一邊缺 maxEpSeen → 視為 -∞，取有值的一邊', () => {
  const local = { watch: {}, meta: { a: { title: 'L' } } };
  const remote = { watch: {}, meta: { a: { maxEpSeen: 7, title: 'R' } } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.maxEpSeen, 7);
  assert.equal(meta.a.title, 'R');
});

// ---- 刪除墓碑（deletedAt）：軟刪除跨端同步 ----
test('deletedAt 取兩邊較新，且刪除晚於觀看 → 保留（刪除跨端生效，不被合併還原）', () => {
  const local = { watch: { a: { 1: { watchedAt: 100 } } }, meta: { a: { deletedAt: 200 } } };
  const remote = { watch: { a: { 1: { watchedAt: 100 } } }, meta: { a: {} } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.deletedAt, 200);
});

test('某端刪除後另一端又觀看（watchedAt > deletedAt）→ 清除墓碑（復原）', () => {
  const local = { watch: { a: { 1: { watchedAt: 300 } } }, meta: { a: {} } }; // 又看了
  const remote = { watch: { a: { 1: { watchedAt: 100 } } }, meta: { a: { deletedAt: 200 } } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.deletedAt, undefined);
});

test('兩端皆有 deletedAt → 取較新者', () => {
  const local = { watch: {}, meta: { a: { deletedAt: 200 } } };
  const remote = { watch: {}, meta: { a: { deletedAt: 500 } } };
  const { meta } = mergeSync(local, remote);
  assert.equal(meta.a.deletedAt, 500);
});

test('未刪除的 meta 不應冒出 deletedAt 欄位', () => {
  const local = { watch: {}, meta: { a: { maxEpSeen: 5 } } };
  const remote = { watch: {}, meta: { a: { maxEpSeen: 8 } } };
  const { meta } = mergeSync(local, remote);
  assert.equal('deletedAt' in meta.a, false);
});

// ---- 不可變：不改動輸入 ----
test('不可變：不修改輸入物件', () => {
  const local = { watch: { a: { 1: { watchedAt: 10 } } }, meta: {} };
  const remote = { watch: { a: { 1: { watchedAt: 20 } } }, meta: {} };
  const localCopy = JSON.parse(JSON.stringify(local));
  mergeSync(local, remote);
  assert.deepEqual(local, localCopy);
});

// ---- resolveGistId：重新設定 token 時驗證舊 gistId，404 則重新解析 ----
// 對應線上 bug：刪 token 後重貼，盲信舊 gistId → 讀取 gist HTTP 404 卡死。
test('既有 gistId 仍可讀 → 直接重用，不重找不重建', async () => {
  let found = false;
  let created = false;
  const id = await resolveGistId('tok', 'G1', {
    reachable: async () => true,
    find: async () => {
      found = true;
      return 'OTHER';
    },
    create: async () => {
      created = true;
      return 'NEW';
    },
  });
  assert.equal(id, 'G1');
  assert.equal(found, false);
  assert.equal(created, false);
});

test('既有 gistId 404（已刪／換帳號無權限）→ 改接既有同名 gist', async () => {
  const id = await resolveGistId('tok', 'STALE', {
    reachable: async () => false,
    find: async () => 'FOUND',
    create: async () => 'NEW',
  });
  assert.equal(id, 'FOUND');
});

test('既有 gistId 404 且找不到既有 → 建新', async () => {
  const id = await resolveGistId('tok', 'STALE', {
    reachable: async () => false,
    find: async () => null,
    create: async () => 'NEW',
  });
  assert.equal(id, 'NEW');
});

test('沒有 gistId → 直接找既有或建新（不呼叫 reachable）', async () => {
  let checked = false;
  const id = await resolveGistId('tok', '', {
    reachable: async () => {
      checked = true;
      return true;
    },
    find: async () => null,
    create: async () => 'NEW',
  });
  assert.equal(id, 'NEW');
  assert.equal(checked, false);
});

test('既有 gistId 讀取時非 404 錯誤（401／網路）→ 往外丟，不誤建重複 gist', async () => {
  let created = false;
  await assert.rejects(
    resolveGistId('tok', 'G1', {
      reachable: async () => {
        throw new Error('讀取 gist HTTP 401');
      },
      find: async () => 'X',
      create: async () => {
        created = true;
        return 'Y';
      },
    }),
    /401/,
  );
  assert.equal(created, false);
});
