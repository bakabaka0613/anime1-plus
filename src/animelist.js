// 取 anime1 首頁的全站動畫清單（animelist.json），解析出每部的即時最新集數。
// 供追番面板判斷「已追平的動畫是否又出新集」。檔案與首頁表格同源 → 直接 fetch，無跨域問題。
import { parseLatestEp, isAiring } from './util.js';

const URL = 'https://anime1.me/animelist.json';
const TTL = 5 * 60 * 1000; // 5 分鐘記憶體快取，避免每次開面板都抓
let cache = null;
let cacheAt = 0;

/**
 * 回傳 { [animeKey]: { ep, airing, name, year } }，animeKey 形如 "cat:1846"。
 * ep 為最新一般集數（劇場版/OVA 等無一般集數者為 null）、airing 表首頁是否標「連載中」、
 * name/year 為首頁清單的原始繁體名與年份（供追番清單補抓封面用）。失敗時回退舊快取或空物件。
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
      // 列格式：[catId, name, 集數欄, year, season, group]
      if (!Array.isArray(r) || r[0] == null) continue;
      const epText = String(r[2]);
      map[`cat:${r[0]}`] = {
        ep: parseLatestEp(epText), // 無一般集數 → null（renderPanel 視同無更新）
        airing: isAiring(epText),
        name: r[1] != null ? String(r[1]).trim() : '',
        year: r[3] != null ? String(r[3]) : null,
      };
    }
    cache = map;
    cacheAt = now;
    return map;
  } catch {
    return cache || {};
  }
}
