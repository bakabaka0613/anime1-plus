// 取 anime1 首頁的全站動畫清單（animelist.json），解析出每部的即時最新集數。
// 供追番面板判斷「已追平的動畫是否又出新集」。檔案與首頁表格同源 → 直接 fetch，無跨域問題。
import { parseLatestEp } from './util.js';

const URL = 'https://anime1.me/animelist.json';
const TTL = 5 * 60 * 1000; // 5 分鐘記憶體快取，避免每次開面板都抓
let cache = null;
let cacheAt = 0;

/**
 * 回傳 { [animeKey]: latestEp }，animeKey 形如 "cat:1846"，latestEp 為最新一般集數。
 * 解析失敗或無一般集數（劇場版/OVA 等）的條目略過。失敗時回退舊快取或空物件。
 */
export async function fetchLatestEpMap() {
  const now = Date.now();
  if (cache && now - cacheAt < TTL) return cache;
  try {
    const res = await fetch(URL, { credentials: 'omit' });
    if (!res.ok) return cache || {};
    const rows = await res.json();
    const map = {};
    for (const r of rows) {
      if (!Array.isArray(r) || r[0] == null) continue;
      const ep = parseLatestEp(String(r[2]));
      if (ep != null) map[`cat:${r[0]}`] = ep;
    }
    cache = map;
    cacheAt = now;
    return map;
  } catch {
    return cache || {};
  }
}
