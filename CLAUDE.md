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
- Inline player on the **category page** is the real watch flow: identify episode via the player's
  `data-apireq`; single-episode page `/{postId}` also supported. Non-native `<video>` → silently skip
  progress (don't error).
- Mark "watched" only at **≥90%**; guard against the 0-progress flash on player reload overwriting progress.
- Overlay UI must use `!important` to beat video.js / site styles; sync auto-hide via vjs classes; fix
  focus black outline. See memory `player-ui-gotchas`.
- **Update reminders** only fire for anime that "once caught up to the then-latest episode"
  (relies on `meta.maxEpSeen`, recorded only after visiting the category page) — conservative, won't nag.
- For airing anime fully watched, show "已到最新進度"; for completed, "已看完".
- Tracking panel: **hold Shift + click 📺** to enter delete mode (🗑 per anime, removes that anime's
  progress only, keeps cover cache); plain open has no delete buttons to avoid mis-deletes.
- zh-Hant→zh-Hans (OpenCC, jsdelivr `@require`) before Bangumi search (its index is mostly Simplified);
  if name/name_cn don't match, fall back to comparing Bangumi aliases. Cover card main title uses the
  **original anime1 Traditional name** (Bangumi Chinese is often Simplified).
- Confidence-low covers: still show the image but add a "待確認" corner badge to nudge a manual pick.

## TDD

Bug fix → reproducer test first (see `test/update.test.js` for the resume/update-judgement cases).
Pure logic lives in `util.js`/`parse.js`/`match.js` so it's unit-testable without the DOM/GM layer.
