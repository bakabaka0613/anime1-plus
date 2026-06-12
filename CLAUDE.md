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
| `match.js` | Bangumi candidate scoring (name similarity + year + season, 3-axis) |
| `bangumi.js` | Bangumi search via `GM_xmlhttpRequest` (rate-limited → cached) |
| `cover.js` | Cover lookup/render orchestration |
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
- Covers are NOT synced (only watch+meta are), so a freshly-synced device has cover-less tracking rows.
  `list.js` fixes this: after the visible poster queue drains it prefetches covers for tracking-list anime
  lacking one, via a low-priority `bgQueue` (visible posters always win). Titles/years come from
  `fetchLatestEpMap` (now carries `name`/`year`), falling back to `meta.title`. Self-limiting — once cached,
  `getInProgressList` no longer reports them as missing.
- Inline player on the **category page** is the real watch flow: identify episode via the player's
  `data-apireq`; single-episode page `/{postId}` also supported. Non-native `<video>` → silently skip
  progress (don't error).
- Mark "watched" only at **≥90%**; guard against the 0-progress flash on player reload overwriting progress.
- Overlay UI must use `!important` to beat video.js / site styles; sync auto-hide via vjs classes; fix
  focus black outline. See memory `player-ui-gotchas`.
- **Update reminders** only fire for anime that "once caught up to the then-latest episode"
  (relies on `meta.maxEpSeen`, recorded only after visiting the category page) — conservative, won't nag.
- For airing anime fully watched, show "已到最新進度"; for completed, "已看完".
- Tracking panel: rows are split into two sections — "in-progress" (resume / next / new ep) on top,
  "finished / caught-up" below — each ordered by last-watched desc (`isCaughtUp` in `util.js` drives both
  the sort and which terminal label shows). **Hold Shift + click 📺** to enter manage mode: per anime a
  ✓ "mark watched" button (`markAnimeWatched` → marks every known ep done so it drops to the finished
  section; hidden when already caught-up) and a 🗑 "delete progress" button. Manage mode is also reachable
  by long-pressing 📺 for 3s (touch devices). Plain open has no buttons to avoid mis-clicks. Hovering a
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
  **original anime1 Traditional name** (Bangumi Chinese is often Simplified).
- Confidence-low covers: still show the image but add a "待確認" corner badge to nudge a manual pick.

## TDD

Bug fix → reproducer test first (see `test/update.test.js` for the resume/update-judgement cases).
Pure logic lives in `util.js`/`parse.js`/`match.js` so it's unit-testable without the DOM/GM layer.
