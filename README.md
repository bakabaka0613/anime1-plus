# Anime1.me Plus

為 [anime1.me](https://anime1.me/) 打造的瀏覽器增強油猴腳本：自動封面圖、觀看記錄與續播、PLEX 風海報列表。

## 安裝

1. 瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）。
2. 點此安裝（Tampermonkey 會跳出安裝頁）：
   **<https://raw.githubusercontent.com/bakabaka0613/anime1-plus/main/dist/anime1-plus.user.js>**
3. 安裝時若提示 `unsafeWindow` 等權限請允許（列表無限滾動需要）。打開任一動畫頁即生效。

**自動更新**：腳本已設定 `@updateURL` / `@downloadURL`，Tampermonkey 會定期自動檢查並更新；也可在儀表板對腳本手動「檢查更新」。

## 功能

### 封面圖（嚴謹匹配）
- 解析 anime1 標題（去集數/字幕組、辨識「第X季」「Ⅱ」「2nd Season」「劇場版」「OVA」等），到 [Bangumi](https://bgm.tv) 搜尋，用「名稱相似度 + 年份 + 季度」三維評分。
- **信心不足不靜默對錯**，改列候選讓你手選，選擇會記住。
- 封面卡主標用 **anime1 原始繁體名**（Bangumi 中文常為簡體），副標附 Bangumi 中／日文名。
- 動畫以穩定的 `categoryID` 為 key，分類頁／單集頁／列表頁共用同一份資料。

### 觀看記錄 + 續播
- 在**分類頁就地內嵌播放器**看時（anime1 實際的觀看方式），自動用播放器的 `data-apireq` 精準辨識第幾話並記錄進度；單集頁 `/{postId}` 也支援。
- 重看自動跳回上次位置；確實播到 ≥90% 才標記「看完」（並防止播放器重載瞬間的 0 覆蓋進度）。
- 分類頁每集標示「已看 ✓ / 進度條」，頂部橫幅顯示**「上次看到第幾話」**並可一鍵繼續看。
- **自動下一集**：看完倒數 5 秒自動播放下一集（可取消、可關閉）。

### 列表頁（PLEX 風海報網格）
- 首頁 `/` 的動畫列表重排成**海報卡片網格**：封面在上、標題＋集數在下；封面 lazy + 限流 + 失敗重試載入。
- **懸浮工具列**（下滾黏頂）：搜尋框、卡片大小滑桿、**卡片 ⇄ 原始列表切換**。
- **下滾無限載入**：捲到底自動載入更多（透過 DataTables API）。
- 點封面或標題都可進入該動畫。

### 其他
- **鍵盤快捷鍵**：`←/→` 快退/快轉 10 秒、`空白` 播放暫停、`N` 下一集、`F` 全螢幕、`+/-` 調速。
- **播放速度記憶**、**追番清單浮動面板**（右下 📺，列未看完的動畫並可繼續看，名稱用繁體）。
- **右側欄折疊**（搜尋/近期更新等 widget，預設折疊讓內容更寬）。
- **油猴選單**：JSON 匯出／匯入、清除此動畫記錄、清除所有資料、開關各功能。

## 開發

```bash
npm install
npm test          # 純函式單元測試（parse / match）
npm run build     # 產出 dist/anime1-plus.user.js
```

原始碼拆分於 `src/`：

| 檔案 | 職責 |
| --- | --- |
| `parse.js` | 標題解析（季度/集數/類型）|
| `match.js` | Bangumi 候選嚴謹評分 |
| `bangumi.js` | Bangumi 搜尋（GM_xmlhttpRequest）|
| `cover.js` | 封面查詢/渲染協調 |
| `store.js` | GM storage（記錄/設定/匯出匯入）|
| `progress.js` | 觀看記錄、續播、自動下一集、快捷鍵 |
| `list.js` | 列表頁卡片網格、工具列、無限滾動 |
| `ui.js` | 樣式與各 UI 元件 |
| `dom.js` | anime1 DOM 選擇器與 helper（改版優先看這）|
| `main.js` | 依頁面類型分派、油猴選單 |

由 esbuild（`build.mjs`）打包成單檔。**發布更新流程**：改 `src` → 在 `build.mjs` bump `VERSION` → `npm run build` → `git commit` + `git push`；版本號務必往上加，否則 Tampermonkey 不會偵測到更新。

## 已知限制

- Bangumi 公開 API 有速率限制 → 結果快取、列表 lazy + 限流。
- 列表無限滾動需透過頁面的 DataTables 實例（`unsafeWindow`）；若拿不到，會保留原生分頁。
- 播放器若改為非原生 `<video>`，續播/記錄會自動略過（不報錯）。
- 新番更新提醒列為後續迭代。
