// 共享封面抓取排程：單一序列佇列、限流、不並發。純調度（不含 DOM / lookup 邏輯）。
// 三個優先級共用同一條序列，才能真正限流：可見海報 > 追番補抓 > 待確認背景複查。
// 每層各自最小間隔；高優先級可在低優先的等待中插隊。
const TIERS = ['visible', 'tracking', 'recheck'];
const GAP = { visible: 500, tracking: 500, recheck: 5000 }; // 兩次請求間隔（ms）
const MAX_RETRIES = 2;
const q = { visible: [], tracking: [], recheck: [] };
const selectors = {}; // tier → (jobs) => index：自訂「取下一個」的挑選（預設 FIFO）。供 recheck 依即時視窗挑最近者。
let pumping = false;
let lastRunAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 排入一個 job。run() 回傳 boolean：false 視為失敗，重試至 MAX_RETRIES。
// key（選填）：job 對應的識別（如封面 catId），供 selector 動態挑選用。
export function enqueue(tier, run, key) {
  q[tier].push({ run, retries: 0, key });
  pump();
}

// 設定某層的「取下一個」挑選器：fn(jobs) 回傳要執行的 index。讓 recheck 層能依「當前」視窗 hint
// 動態挑最近的待確認（邊捲動邊跟著視窗走），而非固定 FIFO。回傳非法 index 時退回 FIFO（0）。
export function setSelector(tier, fn) {
  selectors[tier] = fn;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (TIERS.some((t) => q[t].length)) {
    const tier = TIERS.find((t) => q[t].length); // 永遠取最高優先非空層
    const wait = Math.max(0, GAP[tier] - (Date.now() - lastRunAt));
    if (wait) {
      await sleep(Math.min(wait, 250)); // 分段睡 → 等待中可被更高優先插隊
      continue;
    }
    const jobs = q[tier];
    let idx = 0;
    if (selectors[tier]) {
      const i = selectors[tier](jobs);
      if (Number.isInteger(i) && i >= 0 && i < jobs.length) idx = i;
    }
    const job = jobs.splice(idx, 1)[0];
    lastRunAt = Date.now();
    let ok = false;
    try {
      ok = await job.run();
    } catch {
      ok = false;
    }
    if (!ok && job.retries < MAX_RETRIES) {
      job.retries++;
      q[tier].push(job);
    }
  }
  pumping = false;
}
