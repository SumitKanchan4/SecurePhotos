# Owner feedback backlog

Every piece of owner feedback, kept until it is done, so nothing is lost. Each item is either
fixed on a branch (with what to re-check), planned for this branch, or planned for a later phase.
New feedback is added here the same day. Status: **Done** (needs owner re-check), **This branch**,
**Next phase** (after H10 is merged), **Open question**.

## Housekeeping
| Item | Status | Notes |
|------|--------|-------|
| CI allows npm advisory GHSA-fc5q-39xc-vjpf (picomatch ReDoS, dev tooling only, no fix released) | Temporary until 2026-12-31 | Owner approved 2026-11-17. `scripts/ci/npm-audit-check.mjs`; remove once picomatch ships a fix (CI fails after the date). |

## Round 1: A8 joint test (2026-11-17)

| # | Feedback | Status | Notes / where |
|---|----------|--------|---------------|
| 1 | No "Connect existing library": photos always live in the app's folder; two apps on one database breaks the design | Done (after-import) | Kept as recommended. Settings → Storage: "Moved to a new computer, or restoring a backup?" with "Open a library folder…" (one library open at a time; the app restarts with the chosen one). |
| 2 | Choosing files/folders again replaced the earlier selection; allow adding more (large imports?) | Done (P4) | "Add files" / "Add a folder" add to the selection (several places in one import, a file picked twice counted once); running totals and size; a note says big imports are fine. |
| 3 | After import, no signal that new photos are still being prepared | Done (P4) | Quiet dot on photos still being prepared; one Activity card "Getting N photos ready" with its step; summary when the import is ready. |
| 4 | Activity count showed 2 while photo and video ran, then only the photo count | Done (A8) | Header now counts what the ring counts; videos and photos waiting shown as group tiles. |
| 5 | Blank Stories screen looks weird | Done (after-import) | With no stories, one welcome panel: "Your photos, told as stories" with "Make my first stories". Stories are also suggested after imports (P3). |
| 6 | Activity ring showed only photo count, not videos | Done (A8) | Same as 4. |
| 7 | Activity looks vacant; only old-photo work shows thumbnails; be consistent | Done (A8) | Every card shows the photo/video being worked on. |
| 8 | A text image ("PROMPT:") was picked as black-and-white to colour | Done (A8) | Owner: improve documents/drawings too, but always keep both. Text screenshots detected; a coloured-pencil drawing is not (kept anyway while Keep original is on). |
| 9 | File names are GUIDs; don't show them anywhere | Done (A8) | Device-made names hidden everywhere; person-written names still show. |
| 10 | Improved + original: avoid duplicates in the library | Done (A8) | One tile per pair (improved in front); choose Keep improved / both / original. |
| 11 | Already-improved photos: don't show the improvement options | Done (A8) | No "…" improvements on an original that has a copy. "Redo improvement" not built yet (Next phase if wanted). |
| 12 | Are improved photos 8K too? What happened to the 8K tag on others? | Done (P2) | Old-photo fix first (scan's own size), then 8K for the copy and the original (owner D3). |
| 13 | Year bar on the right: show the year with its months under it | Done (after-import) | Every year is listed; the year you are looking at shows its months under it (the newest at first); only years when there isn't room. |
| 14 | Pause on battery only below 20%, configurable | Done (A8) | Settings → Photos & AI: Below 20% / Below 50% / Always / Never. |
| 15 | "Everything runs on this computer…" line in Activity is rogue | Done (A8) | Removed. |
| 16 | Activity header hides when scrolling | Done (after-import) | Page headers stay at the top on every screen (Dashboard, Activity, Albums, an album, Stories, People, a person, Documents, Trash). |
| 17 | Albums screen: Favourites and Saved stories need fixed default covers | Done (after-import) | Fixed, designed covers: hearts for Favourites, story frames with a play button for Saved stories, a mosaic for Collages. Same picture whatever is inside. |
| 18 | (same as 16) Album header hides on scroll; same for all screens | Done (after-import) | See 16. |
| 19 | Storage section doesn't look good; more interactive design | Done (after-import) | One storage map on the Dashboard and in Settings → Storage: a bar of every kind of content and its rows light each other up; rows show share and size and open their place (Photos, Vault, Trash, Music…). |
| 20 | Do we need "Finished today"? | Done (A8) | Replaced by "Needs attention" (problems only). |
| 21 | Face detection wasn't started after import | Done (P1) | After-import process finds faces for new photos straight away (no restart), newest first. |
| 22 | "Looking for faces" works but doesn't show as working until all faces are done | Done (P1) | People's progress and Activity's "Getting photos ready · Finding faces" card update per photo. |
| 23 | Naming a person: no way to pick the relationship | Done (after-import) | "Who is this?": typing a new name shows a Relationship choice (Family, Friends, Relatives, Colleagues, Acquaintances). Naming someone who already exists keeps their relationship. |
| 24 | "Same person?" isn't clear; faces too small to compare | Done (after-import) | Side by side: a big face and up to three more (one per photo) for the named person and for the unnamed group; "Do these faces belong to …?"; "Yes, same person" / "Not the same". |
| 25 | Documents were imported but none recognised; Documents tab empty | Done (P1) | Text is read on import and documents are found (receipt test: 0.17 s). |
| 26 | Plan all the after-import processes so no photo misses one | Done (P1-P4) | `.agents/plans/after-import-plan.md`; joint test (P5) pending. |

## Round 2: after A8 fixes (2026-11-17)

| # | Feedback | Status | Notes / where |
|---|----------|--------|---------------|
| 1 | Loading takes too long; should be smooth; think deeply | Done (A8 + P2) | Measured: library queries < 0.2 ms (not the cause). Fixed: (a) every start rebuilt all thumbnails, decoding each 8K photo and video while the grid loaded; now only missing/old ones. (b) The viewer decoded the full 8K photo (~735 ms) on every view; now a 2560 px preview (~100 ms), made once, the cached thumbnail shown at once, neighbours preloaded, full 8K only when zoomed. Next phase: background AI jobs (8K, old photos, faces) run side by side and compete for the CPU; one scheduler in the ordered after-import process. Dev mode also spends ~8 s compiling the page on first start (not in the installed app). P2: heavy work now runs one at a time (one CPU slot), quick steps first, least work first (D6). |
| 2 | Activity is the wrong place to decide "what to keep"; a page like Duplicates | Done (A8) | Dashboard → What to keep (pairs side by side; Keep improved / Both / Original; for all). |
| 3 | Photos tab pill: "what to keep" (shorter name) and duplicates | Done (A8) | "12 improved" and "3 duplicates" pills open those pages; Back returns to Photos. |
| 4 | Dashboard needs a complete revamp; looks like a settings page | Done (after-import) | Built without a board (owner, 2026-11-18: fix everything, test in one go). Opens with the library as one sentence in big type over a strip of the newest photos, each number a way in; the storage map (round 1, #19); "Worth doing" (Duplicates, What to keep, Big videos) leading with the space each frees; enhancement progress. |
| 5 | Documents → "Find in photos" brought all the images | Done (A8) | 20 phone photos flagged because "1040" (a US tax form) sat inside their timestamp names; OCR never ran (relative path). Now whole words only, device-made names ignored, real text needed; OCR fixed; wrong marks went back to Photos (migration). |
| 6 | Background music belongs in Settings, with a page to import, manage and play | Done (after-import) | Settings → Music: "Play music in stories" and the songs (add or drop files, play, mood, remove). The music button on Stories opens it. |
| 7 | Photo quality slider doesn't show what's set or which is Balanced; restrict it | Done (after-import) | Three choices: Best, Balanced (recommended), Smaller; the description says what each means. |
| 8 | Stories screen UI is very raw, not engaging or beautiful | Done (after-import) | The newest story plays quietly as a wide stage (its photos cross-fade with a slow pan; still when motion is reduced) with Play story / Save / Hide; more stories as tall cards tagged with their kind (Trip, This week, Old photos…); Saved on a quieter row; collage ideas as a mosaic; the welcome panel (round 1, #5). |

## Round 3: after-import branch, before the joint test (2026-11-18)

| # | Feedback | Status | Notes / where |
|---|----------|--------|---------------|
| 1 | Deleting everything removed the improved (coloured) copies, but the originals came back in the app | Done (after-import) | A tile stands for its group: deleting it (grid, selection or viewer) trashes the original and every improved copy. Restoring from Trash brings back the members deleted together. "What to keep" is the way to drop only one version. |
| 2 | Identifying the person goes wrong: the box marks a sofa cushion / a shirt, not a face | Done, part | The boxes were placed right; the detector itself found a cushion, feet, an ear and blurs as faces. A stricter automatic filter was measured on the test library and would also drop real faces (children looking down, side views), so it wasn't added. Now: "Not a face" in the "see this face in its photo" window; it and the ✕ in "Who is this?" are remembered, so a rescan never adds that place again. "Target Person" → "This face". |
| 3 | Do a quick scan and do the photos needing least work first (quick wins) | Done (after-import) | Owner chose least work first. Quick steps still run for every photo first; then plain photos get 8K (~12 s each) before automatic old-print fixes (~40 s: fix, then 8K for copy and original). 8K order: plain photos, improved copies, originals; newest first within each. What the user starts still goes first; nothing waits while 8K is paused. |
| 4 | Top-left "AI" pill clashes with the select circle, and "AI" says nothing | Done (after-import) | Bottom-left "✦ Improved" tag, like Video; tooltip says what was done and that the original is kept. The still-being-prepared dot moved to the bottom-right. |
| 5 | Zoom was removed from the viewer | Done (after-import) | Zoom out / Fit / Zoom in buttons in the viewer bar (wheel, double-click and +/- still work). The preview now stays on screen until the full 8K photo has loaded, so zooming never blanks the photo. |
| 6 | No app name at the top, only the icon: how does one know the app's name? | Done (after-import) | "SecurePhotos" at the left of the window strip, small and quiet, above the rail's icon; part of the drag area. |
