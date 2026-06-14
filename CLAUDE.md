# CLAUDE.md — anime1-plus

Tampermonkey userscript that enhances [anime1.me](https://anime1.me/): auto covers (Bangumi),
watch-progress + resume, poster-card list grid, tracking panel with update badges, keyboard shortcuts.
User-facing strings are Traditional Chinese; code/comments/commits are English.

## Build & release

- `src/*.js` (ESM) → bundled by esbuild (`build.mjs`) into the single file `dist/anime1-plus.user.js`.
- Release flow: edit `src` → **bump `VERSION` in `build.mjs`** → `npm run build` → `git commit` → `git push`.
  The version MUST increase or Tampermonkey won't detect the update (`@updateURL`/`@downloadURL` point at
  `dist/anime1-plus.user.js` on GitHub `main`). `dist/` is committed (it's what users install).
- Public repo: `bakabaka0613/anime1-plus`. Only commit locally; push only when the user explicitly says so.
- `npm test` runs `node --test` over pure-function unit tests (parse / match / update-judgement). Keep green.

## Module map (`src/`)

| File | Responsibility |
| --- | --- |
| `parse.js` | Title parsing (season / episode no. / type: 劇場版/OVA/第X季/Ⅱ/2nd Season) |
| `match.js` | Bangumi candidate scoring (name similarity + year + season, 3-axis); main-title-segment match |
| `bangumi.js` | Bangumi search via `GM_xmlhttpRequest` (rate-limited → cached) |
| `cover.js` | Cover lookup/render orchestration + background `tentative` recheck |
| `coverQueue.js` | Shared serial cover-fetch scheduler: 3 priority tiers, per-tier rate-limit, preempt |
| `store.js` | GM storage: progress/settings/export-import + sync config & merge-apply |
| `sync.js` | Multi-device sync via a private GitHub Gist (pull-merge-push); orchestration only |
| `progress.js` | Watch recording, resume, auto-next-episode, keyboard shortcuts |
| `list.js` | Home `/` poster grid, toolbar, infinite scroll, "待確認" badge, "+N" update badge |
| `animelist.js` | Fetch home `animelist.json` → per-anime live latest-episode count |
| `ui.js` | Styles + UI components (cover card, tracking panel, episode selector) |
| `util.js` | Pure: zh-Hant/Hans convert, similarity, ep parsing, update / resume judgement |
| `dom.js` | anime1 DOM selectors & helpers (**check here first when the site changes**) |
| `main.js` | Page-type dispatch + Tampermonkey menu |

## Conventions & gotchas

- **Anime key = stable `categoryID`** — category page / single-episode page / list page all share one record.
- **Shared cover-fetch queue** (`coverQueue.js`): ONE serial scheduler (concurrency 1) shared across all
  cover fetching so the Bangumi rate-limit actually holds. 3 priority tiers, each with its own min-gap:
  `visible` (home posters in viewport, 500ms) > `tracking` (tracking-list cover prefetch, 500ms) >
  `recheck` (background `tentative` re-match, 5000ms). `enqueue(tier, run, key?)`; `run` returns a boolean
  (false → retried ≤ MAX_RETRIES). Pump picks the highest non-empty tier and sleeps `min(gap,250)` in
  chunks so a newly-arrived higher-priority job **preempts** a low-tier's long wait (a viewport poster
  never waits behind recheck's 5s). `lastRunAt` is global → spacing is enforced across tiers.
  `setSelector(tier, fn)` overrides FIFO pick-order for a tier: the `recheck` tier uses
  `pickByHint(jobs, getRecheckHint())` so it always re-checks the tentative nearest the home viewport
  first (jobs carry `key = catId`; live, re-read each pick — see multi-tab recheck below).
- Covers are NOT synced (only watch+meta are), so a freshly-synced device has cover-less tracking rows.
  `list.js` fixes this: after the visible poster queue drains it prefetches covers for tracking-list anime
  lacking one, via the `tracking` tier (visible posters always win). Titles/years come from
  `fetchLatestEpMap` (carries `name`/`year`), falling back to `meta.title`. Self-limiting — once cached,
  `getInProgressList` no longer reports them as missing.
- **Background recheck of "待確認" covers** (`recheckTentativeCovers` / `enqueueRecheck` in `cover.js`):
  list-page tentatives are created with the cheap `deep:false` lookup (no alias match) so many stay
  uncertain. A low-priority `recheck` tier re-runs the SAME deep match the category page does
  (`lookupCover deep:true`, alias-aware); on a confident hit it upgrades the record (drops `tentative`)
  and **repaints the live card** via the `setCoverUpgradeHook` (= `list.js` `repaintCard`, finds card by
  catId) — no reload needed. On a miss it stamps `cover.deepTried = now`; `shouldRecheck` (`util.js`)
  skips re-trying within 7 days (cleared by `clearCover` since it wipes the record). **Render-driven**:
  `list.js` calls `enqueueRecheck` when a tentative card renders OR is freshly created this session — a
  one-time `main()` snapshot alone misses session-new tentatives (e.g. after "clear this cover" → reload).
  Module-level `recheckQueued` Set dedups; `main()` also does a full-storage sweep (viewport-ordered via
  `viewportCatOrder()`) as a backstop. Runs on ALL page types.
- **Multi-tab recheck coordination** (queue/lease/hint are per-tab module state, so N tabs would ×N the
  Bangumi load): `enqueueRecheck(catId, {background})` splits two kinds. **Foreground** (`background:false`,
  list.js render-driven = cards the user is looking at) is NOT leased — each tab rechecks its own viewport
  locally. **Background** (`background:true`, the full sweep) is gated by a **cross-tab lease**
  (`evaluateRecheckLease` in `util.js`; `a1p:recheck_lease` via `get/setRecheckLease`): only the lease
  owner runs the sweep, others schedule a `setTimeout` resweep (15s > 12s TTL) to take over when the owner
  closes. Lease decision is at the **sweep** level; per-job `claimRecheckLease()` just **renews**.
  A recheck job **re-reads `getCover` fresh at run time** (never write back the enqueue-time snapshot — a
  stale snapshot would clobber another tab's upgrade with `tentative + deepTried`). Upgrades broadcast via
  `notifyCoverUpgrade` (`a1p:cover_evt`) → other list tabs `onCoverUpgradeEvent` (`GM_addValueChangeListener`,
  remote-only; same-tab uses the `setCoverUpgradeHook`) repaint live. The home page publishes its viewport
  order via `setRecheckHint` (`a1p:recheck_hint`, 30 nearest, 2-min freshness); the owner orders the sweep
  by it so it prioritizes the home viewport even when the owner is a category tab.
- Inline player on the **category page** is the real watch flow: identify episode via the player's
  `data-apireq`; single-episode page `/{postId}` also supported. Non-native `<video>` → silently skip
  progress (don't error).
- **Episode selector + single-page nav** (`collapseToSinglePlayer` / `enhanceEpisodeNav` in `ui.js`):
  selector labels specials as `SP/OVA/OAD…` (from `epRaw` → `type` → 特; same-base specials get a numeric
  suffix), numbered eps first then specials. Selector shows even for a single article when the category is
  paginated (gate: single AND no `PAGINATION_SEL`). On the single-episode page the native 全集連結/下一集/上一集
  links are restyled into a `[上一集] 全集連結 [下一集]` button row; prev/next come from `episodeNeighbors`
  over the **same unified order as the selector** (numbers→specials), locating the current ep by
  ep / epRaw / postId; always shown, gray-disabled (`a1p-btn-disabled`) when no neighbor; when the ep is
  found in cache, ALL native nav links except 全集連結 are stripped (kills anime1's stray OVA / 下一集(SP)
  shortcuts), else native is kept as fallback. On the category page these native links are hidden
  (`enhanceEpisodeNav({hide:true})`).
- **`meta.episodes` is the next/prev backbone** (`{ep, postId}`, plus `{ep:null, epRaw, postId}` for
  specials): three must-dos learned the hard way — (1) `markCategoryEpisodes` stores specials too and
  reads postId from the resolved `a.href` (relative hrefs); (2) it **merges across paginated pages**
  (union by postId, monotonic `maxEpSeen`) — replacing per-page would lose other pages / wipe numbers on
  an OVA-only page; (3) `mergeSync` **unions `episodes` by postId** across devices — taking the
  maxEpSeen-bigger side wholesale let a stale/page-1-only remote overwrite the merged list (the real cause
  of "specials/page-2 never cached").
- Mark "watched" only at **≥90%**; guard against the 0-progress flash on player reload overwriting progress.
- Overlay UI must use `!important` to beat video.js / site styles; sync auto-hide via vjs classes; fix
  focus black outline. See memory `player-ui-gotchas`.
- **Update reminders** only fire for anime that "once caught up to the then-latest episode"
  (relies on `meta.maxEpSeen`, recorded only after visiting the category page) — conservative, won't nag.
- For airing anime fully watched, show "已到最新進度"; for completed, "已看完". Both terminal labels are a
  **link back to the last-watched episode** (max `watchedAt`, via `epUrl`), styled muted-gray
  (`.a1p-row-term` #9aa0a6) vs the accent-blue of the primary resume/next links.
- Tracking panel: rows are split into two sections — "in-progress" (resume / next / new ep) on top,
  "finished / caught-up" below — each ordered by last-watched desc (`isCaughtUp` in `util.js` drives both
  the sort and which terminal label shows). **Hold Shift + click 📺** to enter manage mode: per anime a
  ✓ "mark watched" button (`markAnimeWatched` → marks every known ep done so it drops to the finished
  section; hidden when already caught-up) and a 🗑 "delete progress" button. Manage mode is also reachable
  by long-pressing 📺 for 1.5s (touch devices). Plain open has no buttons to avoid mis-clicks. Hovering a
  row's small cover thumbnail pops a larger preview (floated outside the panel since it has `overflow:auto`).
- 🗑 is a SYNCED soft-delete (`deleteAnimeSynced`), not a hard delete: a hard delete gets resurrected by
  the cloud pull-merge. Instead it zeroes currentTime and stamps `meta[catId].deletedAt = now`. `isDeleted`
  (`util.js`) = `deletedAt >= max(watchedAt)`; `mergeSync` carries `deletedAt` as the max and drops it once
  a newer watch exists (re-watch wins). Tombstoned anime read as empty everywhere (`getAnimeWatch`/
  `getEpisode` return empty/null, `getInProgressList` skips them), and `setEpisodeProgress` clears the
  tombstone on the next real write → "watch it again to restore". The 0-progress-flash guard in
  `progress.js` means setEpisodeProgress only fires on genuine playback, so re-watch-clears is safe.
  (`clearAnimeWatch` is now unused — left in `store.js` as a pre-existing local hard-delete helper.)
- **Compact sync shape** (synced JSON is watch+meta only): episode URLs are NOT stored — `watch[ep]`
  keeps `postId` (and `meta.episodes[]` is `{ep, postId}`); reconstruct the single-episode URL at read
  time via `postUrl(postId)` in `dom.js` (`r.url || postUrl(r.postId)` — the `r.url` arm is legacy
  back-compat). `meta.title` is stored already-stripped of the ` – Anime1.me …` suffix (`cleanTitle` in
  `util.js`; read sites still apply it for legacy data). Old fat records (full `url`, dirty title) are
  upgraded in place by `normalizeWatchMeta` (`util.js`, pure/idempotent): `migrateStored()` runs once at
  startup (`main.js`) and `applySyncedData` re-normalizes after each merge → the next push slims the Gist
  WITHOUT needing to re-watch every episode. `setEpisodeProgress` also drops a stale `url` once `postId`
  is present. When `postId` can't be derived (e.g. an old `?cat=` URL) the `url` is kept as a fallback.
- zh-Hant→zh-Hans (OpenCC, jsdelivr `@require`) before Bangumi search (its index is mostly Simplified);
  if name/name_cn don't match, fall back to comparing Bangumi aliases. Cover card main title uses the
  **original anime1 Traditional name** (Bangumi Chinese is often Simplified). **OpenCC is absent under
  `node --test`** (`toSimplified` is a no-op there) → write Traditional-vs-Simplified matching tests with
  ALREADY-Simplified inputs; the zh-Hant→Hans step is the browser's job, not the unit's.
- **Name matching is precision-sensitive — don't blanket-loosen `similarity`.** Two real failure modes,
  each fixed at the right layer: (1) Bangumi name = `主名⎵副標` with a long subtitle (e.g. anime1
  「判处勇者刑」 vs `判处勇者刑 惩罚勇者9004队刑务纪录`) → `match.js` `nameScore` also compares the
  candidate's **leading title segment** (split on space/colon via `leadTitleSegment`); only fires when a
  separator-delimited subtitle exists, so it can't inflate arbitrary containment. (2) Different Chinese
  translation of the same work (字 mostly shared, reordered/inserted) → `util.js` `similarity` also
  computes an **LCS ratio** (`lcsLength / maxLen`) and takes the max; normalizing by the LONGER string
  means a short name contained in a long one gets `≈ length-ratio` (NOT inflated) — only near-equal-length
  translations score high. A past regression came from a length-based containment boost that ignored the
  ratio → it false-confidently mis-matched and was reverted; keep guard tests
  (`短主名被無分隔長名包含 → 需確認`). Pure `levenshtein`/`lcsLength`/`similarity` live in `util.js`.
- **Search-vs-match asymmetry + title segments.** anime1 titles dilute the Bangumi match in many ways
  (prefix franchise, dash/CJK subtitle, bilingual name, parenthetical alias, multi-name aliases). Fixed by
  `titleSearchSegments(baseName)` (`util.js`) which splits a title into segments — **parentheses first**
  (`主名(通用譯名)`), then **Latin↔CJK boundary** (`GRAND BLUE 碧藍之海`), then **first separator**
  (space / em-en dash / space-hyphen; in-name hyphens like `K-ON` survive). `cover.js` `lookupCover` runs a
  **lazy deep fallback only when not confident**: (a) re-search each segment, merge, re-rank;
  (b) `matchByAlias` over the top `ALIAS_CHECK_LIMIT`(=10) results, comparing each alias (and its
  enumeration-split pieces via `splitAliasNames`, keeping the whole too) against `[baseName, ...segments]`
  at ≥0.9. Also runs when confident-but-borderline (`<STRONG_SCORE` 0.8) to upgrade via an exact alias,
  **same-subject only**. **Key asymmetry: segments are search/alias keys only; the similarity score always
  uses the full `baseName`** — stripping a subtitle/prefix from baseName would turn an exact match into a
  diluted containment. `searchAnime` itself only does simp/trad; segment logic lives in `cover.js`.
- `parse.js` `extractSeason` removes **every** season marker (iterates all patterns, each once), not just
  the first — titles can carry redundant markers (`Season II ()（第2季）`); handles ASCII roman
  (`Season II/III/…`), **English ordinal words** (`first/…/sixth season`, e.g. `… -SECOND SEASON-`) plus the
  existing CJK/unicode-roman forms; `normalizeSpace` strips leftover empty `()`/`（）` **and stray dash runs**
  (`\s[–\-—]+(?=\s|$)`, in-name hyphens survive). `extractType` lists **both 繁 and 簡** type markers
  (劇場版/剧场版, 總集篇/总集篇, …): candidate `name_cn` is Simplified and `nameScore` parses it too, so a
  繁-only list would strip asymmetrically and dilute similarity. Keeps `baseName` clean for search+similarity.
- Confidence-low covers: still show the image but add a "待確認" corner badge to nudge a manual pick.
- **18禁 / anime1.pw covers** (`isAdultLink` in `util.js`): home-list rows whose link points to
  `anime1.pw` are adult specials (`catId=0` in `animelist.json`, name is `<a href="https://anime1.pw/…">`).
  The script only `@match`es `anime1.me`, so the list grid is the only place they appear. `list.js`
  `enhanceRow` short-circuits them: a self-contained 18禁 SVG cover (no Bangumi lookup / queue / cache),
  click still opens anime1.pw. `animeRef` returns null for pw links so they're kept out of the `?cat=`
  key space (was mis-keyed `cat:NN`), recheck hints, and bucket filtering.
- **Cover tags / air-date are cached** (`toCoverData` stores `date`, `bucket`, `tags`, `metaTags`):
  the v0 search subject already carries `date`/`tags`/`meta_tags` → zero extra request for new lookups.
  `buildCoverTags(rawTags, rawMetaTags)` (`util.js`, pure/idempotent, accepts both `[{name,count}]` and
  `string[]`) cleans them: toTraditional, dedupe (Bangumi sometimes returns doubled meta_tags), metaTags
  drop 'TV'/'日本', tags drop time-info (`isTimeTag`: year/month/season — already in `date`/`bucket`),
  'TV', and anything in meta_tags → the two lists are disjoint. Covers are NOT synced, so this is local.
  Existing confident covers never re-look-up (cover.js short-circuit) → `enqueueMetaBackfill` (cover.js)
  is a render-driven lazy backfill: lowest-priority `meta` coverQueue tier fetches `getSubjectMeta`
  (`/v0/subjects/{id}`) by the stored `subjectId`, pure-enriches (never touches subjectId/cover),
  `needsCoverMeta` + `metaTriedAt` (7-day) gate it. Triggered where covers render (list cards, tracking
  prefetch, cover card).
- **Air-date season-bucket match bonus** (`match.js`, additive, NO penalty): `rankCandidates(parsed,
  year, subjects, anime1Buckets?)` 4th optional param. A candidate whose `dateToBucket(subject.date)`
  matches anime1's season bucket gets `+BUCKET_BONUS` (0.08) — small (< name weight 0.7) and added only to
  `score`, not `breakdown.name`, so a name-mismatch can't cross the confidence gate. Buckets come from
  `bucketMap[key]` (list) or `seasonBuckets(meta.year, meta.season)` (recheck/category). Omitting the param
  = unchanged behavior. Guard tests in `test/match.test.js`.
- **Cover TAG overlay** (`attachCoverTagsOverlay` in `ui.js`): desktop **right-click** a home poster →
  overlay of metaTags-then-tags over the cover, `mouseleave` hides. Touch: **long-press ~480ms** shows,
  **tap anywhere** hides (capture-phase `click` closer that also swallows the closing tap so it can't
  navigate). `lastPointerType` splits the two so `contextmenu` doesn't double-fire on mobile; native
  long-press menu + text selection suppressed (`-webkit-touch-callout`/`user-select:none` + `selectstart`
  preventDefault + clear selection on show). Fade in/out (`a1p-tags-fade(out)`); on narrow cards tags wrap
  inside the chip (no horizontal scroll, styled thin vertical scrollbar). `getData()` is read at trigger
  time so backfilled/upgraded tags show. Wired per poster in `list.js` via `() => getCover(ref.key)`.
- **Anime-info cover card** (`renderCoverCard` in `ui.js`, the category/single-episode page card — distinct
  from the home overlay above): the same cached `data` (carries `tags`/`metaTags`/`bucket`) is rendered
  inline (0.6.51–0.6.55). Subtitle is the **JP original name only** (`data.name`) — the Simplified
  `name_cn` duplicates the Traditional main title, so it's dropped; subtitle is skipped when it equals the
  main title and `-webkit-line-clamp:2`-ed (`.a1p-card .a1p-sub`). The **air-season** `data.bucket`
  (e.g. `2024冬`) shows as a neutral `.a1p-badge.season` next to the confidence badge (only when present —
  needs `date` in cache, may await `enqueueMetaBackfill`). Tags are flat chips (`.a1p-card-tags`, reusing
  `.a1p-cover-tag`/`.meta` but smaller: 11px) **clamped to 2 rows** via `max-height:48px;overflow:hidden`
  (chip `white-space:nowrap` so the row-height math holds; the home overlay chips keep wrapping). The cover
  `<img>` is **1.5×** on desktop (`@media (min-width:769px)`, the site's Basic Shop breakpoint:
  96×136 → 144×204). All inputs are already in the cover cache — no extra request.

## TDD

Bug fix → reproducer test first (see `test/update.test.js` for the resume/update-judgement cases).
Pure logic lives in `util.js`/`parse.js`/`match.js` so it's unit-testable without the DOM/GM layer.
