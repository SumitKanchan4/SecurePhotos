# Plan: one ordered after-import process (phase after H10)

Branch: `feature/after-import` (integration branch). Each step is a topic branch → PR into it;
joint test with the owner; then PR → `master` with the owner's approval.

Owner (2026-11-17): start the next phase with the ordered after-import process, so no photo
misses a step and the app stays smooth. Covers feedback backlog round 1 #2, #3, #12, #21, #22,
#25, #26 and round 2 #1 (rest of the speed work).

## Today (measured in the code, 2026-11-17)

| Work | Trigger today | Problem |
|---|---|---|
| Thumbnail, date, place, camera, hash | during import | fine |
| 8K enhance (Real-ESRGAN) | after import, and each app start | runs beside everything else |
| Old-photo automatic rules | after import | can run before or after 8K (copy may never get 8K) |
| Video preparation | queued at import | its own worker |
| **Faces** | **engine start** or People → scan | photos imported now wait until the next start |
| **Documents (read text)** | **"Find in photos" only** | new receipts/IDs never found |
| **Duplicates** | Duplicates page | new copies not noticed |
| **Stories** | "Make new stories" only | Stories screen empty after import |

Four workers (8K, old photos, faces, video) each use up to 4 threads and run at the same time:
the CPU is saturated and the app feels slow (round 2 #1). No record says which steps a photo
has been through, so a crash or a missed trigger leaves gaps no one sees.

## Goal

Every imported photo goes through the same steps, in an order that makes sense, recorded per
photo; one scheduler decides what runs, so the app stays responsive; the user always sees that
new photos are being prepared and what was found.

## The steps, in order (stills)

1. **Basics** (during import, unchanged): copy, date/place/camera, hash, thumbnail.
2. **Read text** (Windows OCR, on the thumbnail-sized image) → **document check** (A8 rules).
3. **Faces** (YuNet + SFace) → grouping. Before the old-photo fix, so an improved copy inherits
   the faces (it already copies them) and People counts the pair once.
4. **Old-photo fix** (only scans of prints, per Settings → Old photos). Before 8K: restoring at
   the scan's own size is better and 8K then runs once, on the result.
5. **8K enhance** of what the library shows (the improved copy when there is one; the original
   behind it only if both are kept) → its 2560 px viewer preview.
6. **Duplicates** check for the new photos against the library (cheap, perceptual hash).
7. **Stories**: after a batch is ready, new "For you" stories are suggested.

Videos: basics → preparation (existing queue) → duplicates. Vault items: never (unchanged).

## How it runs

- **Record per photo:** table `photo_steps(photo_id, step, state, tries, error, updated_at)`;
  state `waiting | done | skipped | failed`. Import adds the rows; old libraries are backfilled
  from today's flags (`is_optimized`, `faces_scanned`, …). A restart resumes where it stopped.
- **One scheduler** (replaces the separate triggers; the existing workers become its steps):
  - Quick steps (read text, faces: well under a second per photo) go first for the whole batch,
    so People, Documents and search are complete soon after an import.
  - Heavy steps (old-photo fix, 8K, video) run **one at a time**, newest import first;
    anything the user asked for (viewer improvements, an opened video) jumps the queue.
  - Pause all, the battery level (Settings) and the vault lock apply to all of it.
- **Seen by the user:** Activity shows one card per batch ("Getting 124 new photos ready")
  with the step it's on; new photos show a small "preparing" mark in the grid until done; the
  import ends with a summary ("124 added · 18 people found · 3 documents · 5 old photos improved").

## Steps (each a PR into `feature/after-import`)

| Step | What | Backlog |
|---|---|---|
| P1 | `photo_steps` table, backfill, the scheduler with quick steps: read text + document check, faces (on import, no restart needed) | R1 #21, #22, #25, #26 |
| P2 | Heavy steps through the scheduler, one at a time: old-photo fix before 8K, improved copy gets 8K (keeping its AI label), video; one CPU budget | R1 #12, R2 #1 |
| P3 | Duplicates for new photos; stories suggested after a batch | R1 #5 (content) |
| P4 | What the user sees: Activity batch card with steps, "preparing" mark, import summary; import "Add more" keeps the earlier selection with totals | R1 #2, #3 |
| P5 | Joint test with the owner on the test library; PR → master | |

## Decisions for the owner (asked one at a time)

- D1: Faces on documents (an ID card has a face): skip, or add to People?
- D2: Heavy work strictly one at a time (smoothest, slower overall) or two at a time?
- D3: 8K for an original stacked behind an improved copy: wait for "What to keep", or always?
- D4: Stories after an import: suggest automatically, or keep it to "Make new stories"?
- D5: Quick steps on battery: run anyway (light), or follow the battery setting like heavy ones?
