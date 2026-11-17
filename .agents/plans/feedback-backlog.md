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
| 1 | No "Connect existing library": photos always live in the app's folder; two apps on one database breaks the design | Next phase | Recommendation: keep it, renamed "Move to a new computer / restore a backup" (the library is locked against two apps). Owner to confirm. |
| 2 | Choosing files/folders again replaced the earlier selection; allow adding more (large imports?) | Next phase | "Add more" adds to the list; total photos and size shown before Import. |
| 3 | After import, no signal that new photos are still being prepared | Next phase | Part of the ordered after-import process (per-photo "preparing" mark, summary). |
| 4 | Activity count showed 2 while photo and video ran, then only the photo count | Done (A8) | Header now counts what the ring counts; videos and photos waiting shown as group tiles. |
| 5 | Blank Stories screen looks weird | Next phase | Proper empty state / stories made after import. Round 2 screenshot now shows Collage ideas. |
| 6 | Activity ring showed only photo count, not videos | Done (A8) | Same as 4. |
| 7 | Activity looks vacant; only old-photo work shows thumbnails; be consistent | Done (A8) | Every card shows the photo/video being worked on. |
| 8 | A text image ("PROMPT:") was picked as black-and-white to colour | Done (A8) | Owner: improve documents/drawings too, but always keep both. Text screenshots detected; a coloured-pencil drawing is not (kept anyway while Keep original is on). |
| 9 | File names are GUIDs; don't show them anywhere | Done (A8) | Device-made names hidden everywhere; person-written names still show. |
| 10 | Improved + original: avoid duplicates in the library | Done (A8) | One tile per pair (improved in front); choose Keep improved / both / original. |
| 11 | Already-improved photos: don't show the improvement options | Done (A8) | No "…" improvements on an original that has a copy. "Redo improvement" not built yet (Next phase if wanted). |
| 12 | Are improved photos 8K too? What happened to the 8K tag on others? | Done (P2) | Old-photo fix first (scan's own size), then 8K for the copy and the original (owner D3). |
| 13 | Year bar on the right: show the year with its months under it | Next phase | |
| 14 | Pause on battery only below 20%, configurable | Done (A8) | Settings → Photos & AI: Below 20% / Below 50% / Always / Never. |
| 15 | "Everything runs on this computer…" line in Activity is rogue | Done (A8) | Removed. |
| 16 | Activity header hides when scrolling | Next phase | Sticky headers on every screen (with 19). |
| 17 | Albums screen: Favourites and Saved stories need fixed default covers | Next phase | |
| 18 | (same as 16) Album header hides on scroll; same for all screens | Next phase | |
| 19 | Storage section doesn't look good; more interactive design | Next phase | With the Dashboard revamp (round 2, #6). |
| 20 | Do we need "Finished today"? | Done (A8) | Replaced by "Needs attention" (problems only). |
| 21 | Face detection wasn't started after import | Done (P1) | After-import process finds faces for new photos straight away (no restart), newest first. |
| 22 | "Looking for faces" works but doesn't show as working until all faces are done | Done (P1) | People's progress and Activity's "Getting photos ready · Finding faces" card update per photo. |
| 23 | Naming a person: no way to pick the relationship | Next phase | |
| 24 | "Same person?" isn't clear; faces too small to compare | Next phase | Bigger faces, 3-4 examples per side. |
| 25 | Documents were imported but none recognised; Documents tab empty | Done (P1) | Text is read on import and documents are found (receipt test: 0.17 s). |
| 26 | Plan all the after-import processes so no photo misses one | Next phase | Ordered steps per photo with a record of what's done; one Activity card. |

## Round 2: after A8 fixes (2026-11-17)

| # | Feedback | Status | Notes / where |
|---|----------|--------|---------------|
| 1 | Loading takes too long; should be smooth; think deeply | Done, part (A8) + Next phase | Measured: library queries < 0.2 ms (not the cause). Fixed: (a) every start rebuilt all thumbnails, decoding each 8K photo and video while the grid loaded; now only missing/old ones. (b) The viewer decoded the full 8K photo (~735 ms) on every view; now a 2560 px preview (~100 ms), made once, the cached thumbnail shown at once, neighbours preloaded, full 8K only when zoomed. Next phase: background AI jobs (8K, old photos, faces) run side by side and compete for the CPU; one scheduler in the ordered after-import process. Dev mode also spends ~8 s compiling the page on first start (not in the installed app). |
| 2 | Activity is the wrong place to decide "what to keep"; a page like Duplicates | Done (A8) | Dashboard → What to keep (pairs side by side; Keep improved / Both / Original; for all). |
| 3 | Photos tab pill: "what to keep" (shorter name) and duplicates | Done (A8) | "12 improved" and "3 duplicates" pills open those pages; Back returns to Photos. |
| 4 | Dashboard needs a complete revamp; looks like a settings page | Next phase | Design board first (owner approval). |
| 5 | Documents → "Find in photos" brought all the images | Done (A8) | 20 phone photos flagged because "1040" (a US tax form) sat inside their timestamp names; OCR never ran (relative path). Now whole words only, device-made names ignored, real text needed; OCR fixed; wrong marks went back to Photos (migration). |
| 6 | Background music belongs in Settings, with a page to import, manage and play | Next phase | |
| 7 | Photo quality slider doesn't show what's set or which is Balanced; restrict it | Next phase | Recommendation: three choices (Best, Balanced, Smaller) instead of a slider. |
| 8 | Stories screen UI is very raw, not engaging or beautiful (screenshot: plain text rows for For you / Saved, Collage ideas below) | Next phase (design) | Redesign with a concept board first, together with the round 1 empty-Stories item (#5). Ideas: a big "For you" hero story with motion, Saved as cover cards, collages as a mosaic, a warm empty state that makes the first stories. |
