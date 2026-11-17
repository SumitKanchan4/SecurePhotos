# Owner feedback backlog

Every piece of owner feedback, kept until it is done, so nothing is lost. Each item is either
fixed on a branch (with what to re-check), planned for this branch, or planned for a later phase.
New feedback is added here the same day. Status: **Done** (needs owner re-check), **This branch**,
**Next phase** (after H10 is merged), **Open question**.

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
| 12 | Are improved photos 8K too? What happened to the 8K tag on others? | Next phase | Depends on timing today (8K pass vs old-photo job). Ordered process: old-photo fix first, then 8K once. |
| 13 | Year bar on the right: show the year with its months under it | Next phase | |
| 14 | Pause on battery only below 20%, configurable | Done (A8) | Settings → Photos & AI: Below 20% / Below 50% / Always / Never. |
| 15 | "Everything runs on this computer…" line in Activity is rogue | Done (A8) | Removed. |
| 16 | Activity header hides when scrolling | Next phase | Sticky headers on every screen (with 19). |
| 17 | Albums screen: Favourites and Saved stories need fixed default covers | Next phase | |
| 18 | (same as 16) Album header hides on scroll; same for all screens | Next phase | |
| 19 | Storage section doesn't look good; more interactive design | Next phase | With the Dashboard revamp (round 2, #6). |
| 20 | Do we need "Finished today"? | Done (A8) | Replaced by "Needs attention" (problems only). |
| 21 | Face detection wasn't started after import | Next phase | Ordered after-import process. |
| 22 | "Looking for faces" works but doesn't show as working until all faces are done | Next phase | Same process; Activity card for faces. |
| 23 | Naming a person: no way to pick the relationship | Next phase | |
| 24 | "Same person?" isn't clear; faces too small to compare | Next phase | Bigger faces, 3-4 examples per side. |
| 25 | Documents were imported but none recognised; Documents tab empty | Next phase | Document check runs only from its own scan today; ordered process runs it on import. |
| 26 | Plan all the after-import processes so no photo misses one | Next phase | Ordered steps per photo with a record of what's done; one Activity card. |

## Round 2: after A8 fixes (2026-11-17)

| # | Feedback | Status | Notes / where |
|---|----------|--------|---------------|
| 1 | Loading takes too long; should be smooth; think deeply | This branch (measure) → plan | Measure first (start-up, Photos grid, viewer); fix what this branch made slower; the rest becomes a performance plan. |
| 2 | Activity is the wrong place to decide "what to keep"; a page like Duplicates | This branch | Own review page next to Duplicates. |
| 3 | Photos tab pill: "what to keep" (shorter name) and duplicates | This branch | "N improved" and "N duplicates" pills open their review pages. |
| 4 | Dashboard needs a complete revamp; looks like a settings page | Next phase | Design board first (owner approval). |
| 5 | Documents → "Find in photos" brought all the images | This branch (bug) | Investigate and fix. |
| 6 | Background music belongs in Settings, with a page to import, manage and play | Next phase | |
| 7 | Photo quality slider doesn't show what's set or which is Balanced; restrict it | Next phase | Recommendation: three choices (Best, Balanced, Smaller) instead of a slider. |
| 8 | Stories screenshot: Collage ideas appear under the empty For you / Saved | Open question | Owner sent the screenshot without a note; check whether collages use both a photo and its copy. |
