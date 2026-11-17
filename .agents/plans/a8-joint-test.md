# A8 · Joint test of Old Photos (H10) before merging to master

Run together by the owner and Claude in the real desktop app, on a **separate test library**
(`C:\Sumit\Code\SecurePhotos-JointTest`, never the real one; the dev app uses it through
`data_location.txt` in the project root, which is excluded from git and removed after the test). Tick each box; write what went wrong next to it. Anything that fails is
fixed on this branch and re-tested before the PR `feature/ai-restore` → `master`.

## 0 · Set-up
- [x] Test library folder created; the app is pointed at it for the test only (`data_location.txt`, removed afterwards).
- [x] The five old-photo model files and the three small bundled ones are in the test library's `models` folder; all eight SHA-256s checked (2026-11-17).
- [ ] Owner's old scans imported into the test library with **Copy** (never Move: the originals in `photos/` must stay where they are and are only read).
- [ ] A few ordinary phone photos imported too (to check nothing happens to them automatically).

## 1 · Add colour (grey and sepia prints)
- [ ] The "…" menu offers **Add colour** only on grey or brownish photos.
- [ ] The result appears first, with the before/after slider; the date line shows progress while it works.
- [ ] Natural ↔ Vivid; Strength slider changes the preview.
- [ ] Keep both → the copy sits next to the original (same date, place, albums), with the lime "AI" badge.
- [ ] Original / Improved switch in the viewer works both ways.

## 2 · Fix faded colours (old colour prints)
- [ ] Offered only on colour photos; never on an AI-coloured copy.
- [ ] Faces are sharpened too (face model present); per-face outlines appear.
- [ ] With the face model hidden: colours still fixed; "Also sharpen faces" opens the download popup.

## 3 · Sharpen faces
- [ ] Offered when the photo has faces.
- [ ] Faces still look like the same people (approved A0 recipe, 80%).
- [ ] A face that no longer looked alike is left as it was (grey dotted outline).
- [ ] Clicking a face switches it off; the preview and the kept copy follow.

## 4 · Remove scratches and spots
- [ ] Offered for scans and black-and-white photos.
- [ ] Lime marks show what was repaired; "Show marks" hides them.
- [ ] Touch up: Brush adds a missed scratch, Eraser brings a detail back, Undo, Hide marks; Apply repairs again; Escape closes only Touch up.
- [ ] Faces are only repaired when painted.

## 5 · Keep / Replace / Discard
- [ ] Keep both, Replace the photo (original to Trash, restorable for 30 days), Discard (nothing kept).
- [ ] "Remember my choice" skips the question next time; "Restore original" brings the original back, still linked.

## 6 · Settings → Photos & AI → Old photos
- [ ] Four rows (When I ask / Automatically) and Keep original read clearly; nothing technical.
- [ ] Set rows to Automatically, import new scans: only scans are improved (phone photos untouched); one copy per photo.
- [ ] Keep original **off**: the original goes to Trash and can be restored.
- [ ] On battery, automatic work waits; plugged in, it runs. Manual work runs anyway.

## 7 · Activity
- [ ] The rail ring and the Photos header pill appear while work runs and open Activity.
- [ ] Working now / Waiting / Ready to look at / Finished today are right; Cancel works; "Nothing to fix" and "Needs a download" read clearly.
- [ ] Pause all / Resume also pauses enhancing.

## 8 · Models
- [ ] With a model file removed, the menu shows a lock and "Needs a one-time download"; Not now locks only that action; everything else works.
- [ ] (Once the repo is public) the download in the popup completes and the action starts by itself.

## 9 · Private Vault
- [ ] A vault photo can be improved while the vault is open; the copy stays in the vault.
- [ ] Activity shows it as a locked tile with no file name.
- [ ] Locking the vault mid-job: the job waits and resumes after unlock; nothing is written in plain form.

## 10 · Library rules
- [ ] People, Stories and duplicates count an original and its copy once.
- [ ] Download / export of a copy carries the AI label (IPTC digital source type).
- [ ] Deleting a copy never touches the original.

## 11 · Speed and comfort on this laptop (CPU only)
- [ ] Add colour ~10-16 s; faces ~2 s per face; scratches ~20-40 s; the app stays usable meanwhile.

## 12 · Fixes from round 1 (re-test)
Owner feedback 2026-11-17. The ordered after-import process, sticky headers, year bar, albums,
storage, stories and People are the **next phase**, not this branch.
- [ ] Photos shows one tile per improved photo (the improved one); Original / Improved in the viewer swaps the original in.
- [ ] A photo improved automatically asks "Which do you want to keep?" in the viewer; Keep improved / Keep both / Keep original do what they say (Trash for 30 days).
- [ ] Activity → Choose what to keep lists them; Keep improved for these / Keep both work; the header pill reminds when nothing else runs.
- [ ] An original that already has an improved copy offers no "…" improvements.
- [ ] Text screenshots imported as scans: improved, but the original is kept even with Keep original off.
- [ ] No GUID / IMG_ names anywhere (viewer title, Info, Activity, Trash, Duplicates, Stories, People, Videos).
- [ ] Settings → Photos & AI → Pause background work on battery: Below 20% (default), Below 50%, Always, Never.
- [ ] Activity: header count = ring count; enhancing and video cards show the photo; waiting photos/videos as one group tile; no footer line; problems under Needs attention.

## After the test
- [ ] All boxes ticked or fixed; `data_location.txt` removed; test library kept or deleted (owner's choice).
- [ ] PR `feature/ai-restore` → `master` opened; CI green; owner approves the merge.
