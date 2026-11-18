# After-import process · joint test (P5) before merging to master

Run together in the real desktop app on the test library (`C:\Sumit\Code\SecurePhotos-JointTest`,
via `data_location.txt`). Import with **Copy**, never Move. Tick each box; note what went wrong.

## 0 · Set-up
- [ ] Restart the dev app (`scripts\run-desktop-app.ps1`) so the engine runs the new code from a clean start.
- [ ] Settings → Photos & AI: check "Pause background work on battery" (it was reset to Below 20% overnight; see the note below).

## 1 · Straight after an import (P1, P4)
- [ ] Import a few scans and phone photos (and a receipt or ID photo if you have one).
- [ ] The import panel: "Add files" / "Add a folder" add to the first choice; totals and size update; "Clear" starts again.
- [ ] Activity shows one card "Getting N photos ready" with the step (Reading text → Finding faces → Checking old prints → Looking for duplicates → Enhancing to 8K) and the photo.
- [ ] New photos show a quiet dot in the grid until they're done; the dot goes away by itself.
- [ ] People fills in without pressing anything; "Looking for faces" shows progress.
- [ ] Documents: a receipt/ID is found by itself; ordinary photos are not documents.
- [ ] When the quick steps are done: "Your new photos are ready: … added · … people · … documents · … old photos improved".

## 2 · Order and speed (P2)
- [ ] With "Add colour" on Automatically: a grey scan is coloured first, then the improved copy and the original both get 8K (copy first). Original/Improved compare like for like.
- [ ] Only one heavy job at a time: the app stays smooth while work runs; something you ask for in the viewer starts next.
- [ ] Quick wins: in a mixed import, the plain photos are all done (8K) before the old prints are coloured.
- [ ] Below the battery level: everything waits; plugged in, it carries on.

## 3 · Duplicates and stories (P3)
- [ ] Importing a near-identical shot makes the "N duplicates" pill appear.
- [ ] Stories → For you: about 6 suggestions, including "This week, N years ago"; after the import, its trip/event and "Old photos, brought back".
- [ ] Deleting a suggestion: it never comes back after "Make new stories".
- [ ] No documents, screenshots or restored scans in dated stories.

## 4 · Feedback fixed on this branch (rounds 1-3, 2026-11-18)
- [ ] Delete an improved photo (or select all and delete): the original goes too; Trash → Restore brings both back.
- [ ] People → a wrong face: "See this face in its photo" → **Not a face**; it doesn't come back after a rescan. The box label says "This face".
- [ ] Tile tags, bottom left (translucent black, neon): fix icons on improved photos, "8K" on enhanced ones (both when both); videos show "4K"/"HD" above "▶ Video" and their length to the right. The select circle top-left is free.
- [ ] Viewer: Zoom out / Fit / Zoom in buttons; zooming in keeps the photo on screen while the full photo loads.
- [ ] Settings → Photos & AI: photo quality is Best / Balanced / Smaller.
- [ ] Headers stay at the top while scrolling (Activity, Albums, an album, Stories, People, Documents, Trash, Dashboard).
- [ ] Photos year bar: years, with the months of the year you're in under it.
- [ ] Albums: Favourites, Saved stories and Collages have fixed covers.
- [ ] People: "Same person?" shows big faces side by side; naming a new person offers a Relationship.
- [ ] Settings → Storage: "Moved to a new computer, or restoring a backup?" (don't press it on the test library).
- [ ] Settings → Music: switch, add/play/mood/remove songs; the Stories music button opens it.
- [ ] Stories: the stage at the top, tagged cards, Saved row, collage mosaic; Hide and Save work from the stage.
- [ ] The app's name "SecurePhotos" shows at the top left; the window still drags from there.
- [ ] Dashboard: the library sentence (each number opens its screen), the storage map (point at rows / bar; rows open their place), Worth doing.

## After the test
- [ ] Fixes on this branch; PR `feature/after-import` → `master`; CI green; owner approves.

## Note from the overnight session (2026-11-18)
A test script of mine wrongly ran against this test library once (it read `data_location.txt`
before being pointed at its throwaway folder). It imported one copy of a scan thumbnail
(photo 99), coloured it (photo 100, job 24), and saved two settings. All of it was removed
again (2 photos, 4 files, 1 job); "Add colour" kept its value (Automatically); "Pause on
battery" had been set to Never and was put back to the default (Below 20%): please check it.
Your `photos/` originals were never involved (checksums verified).
