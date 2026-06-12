// Bangumi (bgm.tv) 搜尋封裝。透過 GM_xmlhttpRequest 跨域，避開 CORS。
/* global GM_xmlhttpRequest */
import { toSimplified } from './util.js';

const UA = 'anime1-plus/0.1 (https://github.com/bakabaka0613/anime1-plus)';

// Promise 化的 GM_xmlhttpRequest
function gmFetch({ method, url, headers, data }) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url,
      headers,
      data,
      timeout: 15000,
      onload: (res) => resolve(res),
      onerror: () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}

// 新版 v0 搜尋（POST）。type 2 = 動畫。回傳 subject 陣列。
async function searchV0(keyword, limit) {
  const res = await gmFetch({
    method: 'POST',
    url: `https://api.bgm.tv/v0/search/subjects?limit=${limit}`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    data: JSON.stringify({ keyword, filter: { type: [2] } }),
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`v0 status ${res.status}`);
  const json = JSON.parse(res.responseText);
  return Array.isArray(json.data) ? json.data : [];
}

// 舊版搜尋（GET）作為 fallback。回傳結構正規化成與 v0 相近。
async function searchLegacy(keyword, limit) {
  const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(keyword)}?type=2&responseGroup=large&max_results=${limit}`;
  const res = await gmFetch({ method: 'GET', url, headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status < 200 || res.status >= 300) throw new Error(`legacy status ${res.status}`);
  const json = JSON.parse(res.responseText);
  const list = Array.isArray(json.list) ? json.list : [];
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    name_cn: s.name_cn,
    date: s.air_date || s.date,
    images: s.images,
    rating: s.rating,
  }));
}

/**
 * 搜尋動畫。先試 v0，失敗再退回舊 API。回傳正規化 subject 陣列。
 * subject: { id, name, name_cn, date, images:{large,common,medium,grid} }
 */
async function searchOnce(keyword, limit) {
  try {
    return await searchV0(keyword, limit);
  } catch (e) {
    try {
      return await searchLegacy(keyword, limit);
    } catch (e2) {
      console.warn('[anime1-plus] Bangumi 搜尋失敗', e, e2);
      return [];
    }
  }
}

export async function searchAnime(keyword, limit = 10) {
  if (!keyword || !keyword.trim()) return [];
  // 合併簡體+繁體結果（去重）：多數條目索引為簡體，但有些別名是繁體（簡體搜不到）；
  // 兩者都收，交給後續評分與別名比對挑出正確的。簡體在前（多數情況更準）。
  const simp = toSimplified(keyword);
  const variants = simp !== keyword ? [simp, keyword] : [keyword];
  const seen = new Set();
  const merged = [];
  for (const kw of variants) {
    const res = await searchOnce(kw, limit);
    for (const s of res) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        merged.push(s);
      }
    }
  }
  return merged;
}

// 取某條目的所有名稱別名（infobox 的「别名/中文名/英文名」+ name/name_cn），供深度匹配
export async function getSubjectAliases(id) {
  try {
    const res = await gmFetch({
      method: 'GET',
      url: `https://api.bgm.tv/v0/subjects/${id}`,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (res.status < 200 || res.status >= 300) return [];
    const json = JSON.parse(res.responseText);
    const out = [];
    if (json.name) out.push(json.name);
    if (json.name_cn) out.push(json.name_cn);
    if (Array.isArray(json.infobox)) {
      for (const f of json.infobox) {
        if (!/别名|別名|中文名|英文名|英文|日文|罗马|羅馬/.test(f.key || '')) continue;
        const v = f.value;
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach((it) => out.push((it && (it.v || it.value)) || it));
      }
    }
    return out.filter((s) => typeof s === 'string' && s.trim());
  } catch {
    return [];
  }
}

// 從 subject 取最佳可用封面 URL
export function coverUrl(subject) {
  const img = subject && subject.images;
  if (!img) return null;
  return img.large || img.common || img.medium || img.grid || img.small || null;
}
