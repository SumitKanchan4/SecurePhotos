# Plan: Restore old photos and colorize black-and-white photos (H10 + colorization)

Branch: `feature/ai-restore` (integration branch, like the redesign). Every step is a topic branch → PR into `feature/ai-restore`. Nothing reaches `master` until **the owner and I have both tested the whole feature on real photos** and the owner approves the final merge.

Research behind this plan: `.agents/research/Local photo restoration and colorization.md` (notes in `.agents/research/Local photo restoration and colorization - notes/`).

Hard constraints:
- **CPU only.** The owner and most users have no GPU. Compact ONNX models, tiled, in a background worker; GPU (DirectML) is only an optional speed-up later.
- **Fully offline.** Models are downloaded once (by the installer, or in the app after asking) and checked against SHA-256 hashes; photos never leave the computer.
- **Never destroy the original on the spot.** Every result is a new copy linked to its original; an original the user chooses not to keep goes to Trash for 30 days first.
- **Say it's AI.** Restored faces and colorized photos carry an "AI" badge in the app and IPTC `digitalSourceType` metadata in exported files (EU AI Act Art. 50).

---

## What the owner asked for (2026-11-15)

1. Local restoration of old, unclear photos (faces, scratches, blur) and on-demand colorization of B&W photos.
2. A central setting for **B&W photos**: manual per photo (asks replace or copy each time) or automatic (with or without keeping the original).
3. The same for **blurry photos**.
4. A **screen showing photos being processed** (vault photos blurred), with an indicator to reach it.
5. A plan with estimates; separate branch; testing by both of us with the owner's B&W and blurry photos before merging.

## Models (from the research)

| Step | Model | Licence (code / weights / data) | CPU time on the owner's Ryzen 7 5700U | Size |
|---|---|---|---|---|
| Colorize | DDColor (large 512 px; tiny for fast mode) | Apache-2.0 / Apache-2.0 / ImageNet (grey zone) | 0.5–3.2 s measured | 113–911 MB |
| Faces | GFPGAN v1.4 | Apache-2.0 / Apache-2.0 (secondary source) / FFHQ (grey zone) | ~1–3 s per face **estimated** | 340 MB |
| Upscale + mild denoise | Real-ESRGAN general-x4v3 (already shipped) | BSD-3 | 23 s measured | 4.9 MB |
| Scratches / creases | BOPBTL scratch detector → LaMa on damaged crops | MIT / Apache-2.0 / Places (grey zone) | 10–60 s measured | 151 + 208 MB |
| Strong grain (optional) | SCUNet | Apache-2.0 | ~100 s, 5.7 GB peak (must be tamed) | 74 MB |

Licensing (**owner decision D1, 2026-11-15: keep MIT, permissive models only**): the app stays MIT; only the permissive models above are used; the FFHQ / ImageNet training-data grey zone is documented in THIRD_PARTY_NOTICES. Non-commercial models (e.g. CodeFormer) are not used, not even as an optional download.

## Behaviour

### Versions (new in the library)
- A result is a **new photo linked to its original** (`derived_from_id`, `ai_kind` = colorized / restored / repaired).
- In Photos, by default only one of the pair shows (per the setting); the viewer shows a **"Original / AI version" switch** and a before/after slider.
- **Metadata (owner decision 2026-11-16: same as the original, so the pair sits side by side):**
  - Copied as-is: date taken, location, camera, title/description, favourite, album memberships, named faces (face boxes stay valid; colour/face/scratch fixes don't move pixels).
  - Ordering: the improved photo sorts **directly after** its original (tie-break on `derived_from_id`).
  - Private Vault: an improved photo of a vault photo is **always created in the vault** (never in the library).
  - People / person page / Stories: the pair counts as **one** photo (the improved one shown, with the Original switch).
  - Duplicates: a linked pair is **never** offered as duplicates.
  - Its own: file hash, size, resolution, search embedding (so "red shirt" finds the colourised one), "edited on" date, and the AI label (IPTC `digitalSourceType` + app badge) on export.
- Deleting the AI version never touches the original; moving the original to Trash asks what to do with its versions.

### Settings → Photos & AI → "Old photos" (new group) — D2 (2026-11-15), simplified on the A1 board (2026-11-16)
The owner rejected the first board as too complex for a normal user (no "sepia", "scratches", speed or model words). Approved shape:
- Three plain rows, each with a small before → after picture and a **"When I ask" (default) / "Automatically"** choice:
  1. **Add colour to old grey photos** (black-and-white and brownish prints)
  2. **Fix faded or yellowed colours** (old colour prints)
  3. **Sharpen blurry faces**
  4. **Remove scratches and spots** (creases, scratches, dust on old prints) — added 2026-11-16: the owner asked that it be presented like the other improvements, not as a special tool
- One switch: **"Keep original"** (owner wording, 2026-11-16). On (default): both photos are kept and linked; from either one the viewer can switch to the other ("Original" / "Improved"). Off: once the improved photo is made, the original **moves to Trash for 30 days** (restorable, also from the viewer's "Original" switch while it is in Trash), then is deleted for good, the same as Enhance today (owner decision 2026-11-16).
- The app decides the rest: Natural colour style (Vivid only from the viewer or the sepia fallback), automatic work waits while on battery, models are managed in Storage.
- **Remove scratches and spots** follows the same flow as the others (result first, before/after, Keep both / Replace / Discard). The brush is only an optional **"Touch up"** on the result (lime shows what was removed; paint a missed scratch or erase to bring a detail back). Automatic mode repairs only marks the detector is very sure of (stricter threshold, thin-line shapes), because a false mark erases real detail.
- **When I ask:** the viewer shows the result first (before/after); then **"Keep both" / "Replace the photo" / "Discard"** with "Remember my choice". Asking after the result (not before) was proposed on the board and accepted.
- **Safety net (applies to "Replace the photo" and to "Keep original" off):** the original is never deleted on the spot. It goes to Trash for 30 days, stays linked to the improved photo, and can be brought back from the viewer ("Restore original") or from Trash; after 30 days it is deleted for good. Old family photos are irreplaceable and AI can change a face, so the 30 days are the window to notice.
- The viewer's old-photo panel appears **only after** the user picks Add colour / Fix faded colours / Sharpen faces / Remove scratches and spots from the "…" menu (each shown only when it fits the photo); the normal viewer is unchanged.

### Detection on import (cheap, CPU)
- **B&W:** colour saturation of a small thumbnail (also sepia-toned prints).
- **Blurry / faded faces:** the face scan already computes a sharpness/quality score per face; flag photos with faces below a threshold (tuned on the owner's photos).

### On-demand actions (viewer, selection bar)
- **Add colour**, **Fix faded colours**, **Sharpen faces**, **Remove scratches and spots** (result first; optional "Touch up" brush/eraser afterwards), **Enhance** (existing).
- Result appears as a new version; the viewer opens on it with before/after.
- Controls: strength slider (blends cached results, instant), colour intensity, per-face on/off; an identity check (SFace) softens a restored face that no longer looks like the same person.

### Processing screen ("Activity")
- One place for all background work: imports, video preparation, enhancing, colorizing, restoring, repairing. Each item: thumbnail, what's being done, progress, time left, Cancel; waiting items below; finished today with "Open".
- **Vault items** show a blurred/locked thumbnail and no file name.
- **Reaching it (D3, approved on the A1 board 2026-11-16):** no rail item. The rail's status dot becomes a turning lime ring with the count of items left (dashed when paused) and opens Activity; the Photos header pill ("Colorizing · 3 of 12 ›") opens it too and shows only while work runs. A photo being worked on shows a small ring on its tile.
- Pause all / resume; pauses on battery.

## Steps and estimates

Sizes: S ≈ half a day of my work, M ≈ 1 day, L ≈ 2 days (each including tests, mutation checks, UI check in both themes, docs). Calendar time also depends on review/testing turns.

| # | Step | Size | Notes |
|---|---|---|---|
| A0 ✅ | **Spike & benchmark** (done 2026-11-16; results in "Colorize recipe") on the owner's photos: GFPGAN CPU time/RAM, DDColor large vs tiny quality, B&W and blur detection thresholds, int8 vs fp32. Output: a comparison page (before/after) for the owner to judge. | M | Owner provides ~20–30 B&W and blurry photos. Runs read-only on a copy. |
| A1 ✅ | **Boards** (approved 2026-11-16 after one round: simpler settings, panel only on demand) for the Activity screen, viewer version switch + before/after, Settings "Old photos", the "replace or keep a copy" prompt, the scratch mask view. Owner approves. | M | Design first, like the redesign. |
| A2 | **Engine foundation:** model manager (download / import file / SHA-256 manifest / status in Settings → Storage), CPU ONNX session tuning (threads, tiling), a background **job queue** with progress, cancel, pause, battery rule; versions in the DB (`derived_from_id`, `ai_kind`) + IPTC labelling on export. | L | Reused by every feature. |
| A3 ✅ | **Colorize** and **Fix faded colours** on demand (built 2026-11-16, branch `feature/a3-colour`; see "A3 notes") (DDColor, Lab chroma transfer at full resolution, intensity slider, Natural/Vivid). Recipe chosen by the owner in A0 (2026-11-16), see "Colorize recipe" below. | M | First visible feature; good first joint test. |
| A4 ✅ | **Activity screen** (built 2026-11-16, branch `feature/a4-activity`) + indicator (rail + header), vault items blurred. | M | |
| A5 ✅ | **Restore faces** on demand (built 2026-11-17, branch `feature/a5-faces`; see "A5 notes") (GFPGAN, align with YuNet landmarks, feathered paste-back, strength + per-face toggles, SFace identity check). | L | |
| A6 ✅ | **Auto rules** (built 2026-11-17, branch `feature/a6-auto-rules`; see "A6 notes"): B&W and blur detection on import, Settings "Old photos" (manual / automatic, keep original), the "replace or keep a copy" prompt with remember-my-choice, hidden original + "Restore original". | M | |
| A7 ✅ | **Remove scratches and spots** (built 2026-11-17, branch `feature/a7-scratches`; see "A7 notes") (detector → LaMa on damaged crops; result first; optional Touch up with brush/eraser; strict threshold for Automatic). | L | Most UI work (Touch up editor). Could move after the first merge if the rest is ready. Needs a few scratched test photos from the owner. |
| A8 | **Full test round with the owner** on real photos; fixes; docs (design system, history, THIRD_PARTY_NOTICES, licences); then PR `feature/ai-restore` → `master` with owner approval. | M | |

Total ≈ 10–12 days of work across 9 steps; first usable piece (colorize + Activity) after A0–A4.

## Colorize recipe (from A0, owner-approved 2026-11-16)

Tested on the owner's 11 B&W/sepia photos (variants A–F). The owner judged **F** "all good" except two sepia-heavy group photos, which looked best with the 768 px variant (E).

- **Natural (default) = F:** stretch the brightness (1st–99th percentile auto-levels) before the model → DDColor **large** and **artistic** at 512 px → per pixel keep the more colourful prediction (soft blend, no seams) → put the colour on the **stretched** brightness (restores faded contrast). ~9 s per photo on the Ryzen 7 5700U.
- **Vivid = E:** the same, but the large model at **768 px**. Richer colour on crowded or sepia photos, but sometimes wrong hues (purple water and rocks, a red wall), so it is never the default. ~13 s.
- **Automatic fallback:** after Natural, if more than about two-thirds of the coloured pixels are still orange/brown (Lab hue 30–100°), also run Vivid and use it when it removes the cast. In A0 this picked exactly the two photos the owner preferred in Vivid (90% and 70% brown versus at most 64% for the others). Tune the threshold on more photos; the viewer's Natural/Vivid switch always lets the user override.
- Rejected: the baseline without contrast stretch (keeps the sepia cast), and 768 px as the default (wrong hues).
- **Faded / yellowed colour photos (owner approved "R", 2026-11-16):** no AI for the colours. Each channel's own black and white point (0.5th–99.5th percentile, gain capped at 3×) removes the cast and the fade; gentle local contrast on brightness (CLAHE, clip 1.6); colour × 1.12. Under 1 s per photo. Then faces restored (below). Rejected: AI recolouring of colour photos; it discards the real colours and guessed wrong ones (a blue pole turned red, a cream house turned blue-green). Known gap: a slight pink/purple lean on a few photos, to tune in A3.
- **Faces (A5):** GFPGAN v1.4 blended at **80%** with a feathered mask; owner confirmed the restored faces still look like the same people (2026-11-16). 2.0–3.1 s per face.
- Note: one model is loaded at a time in the app (A0 peak with all models loaded was 7.3 GB).

## A2 in detail (engine foundation) — proposed 2026-11-16, awaiting owner approval

Engine only; no visible UI yet (A3 adds the viewer panel, A4 the Activity screen). Split into two PRs into `feature/ai-restore`.

### A2a · Models and the job queue (M–L) — built 2026-11-16 (branch `feature/a2a-models-queue`)
Built as planned, with these changes: the session manager is `engine/services/onnx_sessions.py`; one DDColor file with a variable input size serves both 512 and 768 (same output, so ~2.3 GB total instead of ~3.3); the export scripts are committed without vendoring the upstream code (pinned commits instead) and rebuild the files byte-identical; the battery rule holds only automatic jobs. **GFPGAN licensing (owner decision 2026-11-16): keep it, documented.** Its StyleGAN2 part carries NVIDIA's non-commercial licence; we use only the clean pure-PyTorch architecture. Recorded in THIRD_PARTY_NOTICES; revisit before the app is ever sold or the repo goes public.

- **Model registry** (`engine/services/ai_models.py`): add the old-photo models to `MODELS` with a new `"on_demand": True` flag (not bundled in the installer: ~2–3 GB; downloaded the first time a feature is used). Same rules as today: pinned URL + SHA-256, verified before use, a bad file is never loaded. New: download with progress and cancel, and **"import from file"** (copy a downloaded `.onnx` from disk, then verify), for offline machines. `scripts/fetch_models.py` skips `on_demand` models.
  - Models: DDColor large 512, DDColor artistic 512, DDColor large 768 (Vivid; separate optional download), GFPGAN v1.4 512. Scratch models are added in A7.
  - Try one 512/768 DDColor file with a dynamic input size, to avoid a second ~1 GB download; if the decoder can't, keep two files.
  - The ONNX files are made by our own export scripts from the official Apache-2.0 weights; the scripts and the vetted model code go into `scripts/model_export/` (licence headers kept) so anyone can rebuild and check the hashes.
- **ONNX sessions** (`engine/services/onnx_runtime.py`, new): one place for CPU settings (4 threads, no spinning), **one big model loaded at a time** (A0 peak was 7.3 GB with all loaded), unloaded after the queue goes idle.
- **Job queue** (`engine/services/restore_queue.py`, new; modelled on `video_queue_service.py`):
  - Table `restore_jobs` (photo_id, kind = colour / fade / faces / scratches, params JSON, origin = manual / auto, status = queued / working / review / done / failed / cancelled, progress 0–100, result path, result_photo_id, error, timestamps).
  - One worker; groups queued jobs by model so a model loads once per batch; pause / resume; per-job cancel; waits while on battery (reuse `_wait_while_on_battery`, moved to a shared helper); after a crash `working` → `queued`; temp files cleaned on start.
  - **Vault photos:** decrypted only in memory; any result or cache file for a vault photo is written encrypted (the same vault storage as today). Nothing private ever sits in plain form on disk.
- **API** (`engine/api/restore.py`, new): queue jobs for one or many photos, list jobs (for Activity: working / waiting / finished today; vault items flagged so the UI blurs them and shows no file name), cancel, pause / resume, model status / download / import-file.

### A2b · Versions, metadata and labels (L) — built 2026-11-16 (branch `feature/a2b-versions`)
Built as planned, with these choices: an improved photo always links to the **first original** (improving a copy adds up kinds, e.g. `colour,faces`); albums are copied with the original's `added_at` so the pair also sits together in albums; vault copies re-seal the sealed details for the new photo id; the duplicate finder treats each family as **one** photo (its newest copy), because a third look-alike photo would otherwise join the pair into one group; People/Stories hide an original that has a live copy (`not_superseded`), except where an action targets one specific photo. Endpoints live under `/api/restore` (`/jobs/{id}/keep`, `/photos/{id}/versions`, `/photos/{id}/restore-original`). Timeline rows get flag `8` = AI copy.

- **DB migration** (`database.py`, one-time, recorded in `applied_migrations`): `photos.derived_from_id` (→ photos.id), `photos.ai_kind`, `photos.ai_params` (JSON), `photos.edited_at`; index on `derived_from_id`. `docs/database_schema.md` updated.
- **Versions service** (`engine/services/photo_versions.py`, new):
  - `create_version(original, result, kind, params)`: writes the file atomically (temp → fsync → verify → replace, like Enhance), makes thumbnail and preview, hashes it, and **copies the metadata** per the rules above (date, place, camera, title, favourite, albums, named faces; vault → vault).
  - Result-first flow: a manual job ends in `review` with the result staged (encrypted for vault photos); `keep_both` / `replace` / `discard` turns it into a version or deletes it. Automatic jobs go straight to a version.
  - **Keep original off / Replace:** the original goes to Trash for 30 days through the existing trash code (`trashed_at`, `trash_expires_at`), still linked. `restore_original` brings it back and links it again.
  - Deleting the improved photo never touches the original; trashing an original that has versions asks in the UI (A3), and the API refuses silent cascades.
- **Rules in existing queries:** timeline order puts the improved photo directly after its original; person pages, Stories and People counts treat a pair as one photo; the duplicate finder never pairs a photo with its own version; search indexes the improved photo on its own.
- **Settings keys** (`app_settings`): one per row (`old_photos_colour`, `old_photos_fade`, `old_photos_faces`, `old_photos_scratches` = `ask` / `auto`), `old_photos_keep_original` (default on), `old_photos_keep_choice` (`ask` / `keep_both` / `replace`). Detection on import that uses them comes in A6.
- **AI label:** exported / downloaded improved photos carry IPTC `digitalSourceType` in XMP (`compositeWithTrainedAlgorithmicMedia` for colour / faces / scratches, `algorithmicallyEnhanced` for the non-AI colour fix), and the photo API returns `ai_kind` so the UI can show the "AI" badge.

### Tests and checks (both PRs)
- Engine tests with **tiny generated ONNX models** (no GB downloads in CI): checksum refusal, import-from-file, queue order / cancel / pause / battery wait / crash recovery, one-model-at-a-time, vault results never written in plain form, metadata copy, ordering, pair-as-one in people and duplicates, Keep original off → Trash 30 days → restore, migration on an old library copy, XMP label present on export.
- Mutation checks on the new services, full engine suite, then docs: `features_and_functional_decisions.md`, `database_schema.md`, THIRD_PARTY_NOTICES (DDColor, GFPGAN, training-data note).

### Approved 2026-11-16, and where the model files live
- The owner approved this A2 plan.
- **Model hosting (owner decision 2026-11-16):** attachments on a Release of **this repo**, tag `models-v1` (files up to 2 GB, pinned by URL + SHA-256; a new model = new tag + app update). The repo stays private until it is stable, then becomes public, so until then downloads only work for the owner: development and joint testing use "import from file" / the local models folder. `scripts/create_release.py` gets a gate that refuses to build a release while any `on_demand` model URL can't be fetched without a login.
- Not in git (100 MB file limit; Git LFS free quota ~1 GB storage and bandwidth), not bundled in the installer.

## A2c ✅ · Models with the installer (owner decisions 2026-11-16; built 2026-11-17, branch `feature/a2c-models-installer`)
- **Only our models.** No "import from file" or any way for a user to point the app at another model: remove `import_model_file`, `/api/restore/models/import` and their tests/docs. A model is used only if it is the pinned file with the pinned SHA-256.
- **Small models stay inside the installer** (as today: YuNet, SFace, Real-ESRGAN).
- **Big models are downloaded by the installer** (install and upgrade), each checked by SHA-256; a model already in place and verified is skipped. If a download fails, the installer still completes and shows each model's status (ready / already up to date / couldn't download, the app will ask later).
- **In the app:** if a model is missing, a popup explains it is needed for the old-photo features and offers to download it (progress, resume). If the user cancels, **only the features that need that model are locked** (Add colour, Fix faded colours if it ever needs one, Sharpen faces, Remove scratches); pressing one shows the popup again. Everything else (import, browsing, vault, People, albums, Stories, enhancing) keeps working. The owner first suggested a view-only app; agreed on feature-level blocking after discussion.
- Engine start: checks every model (skip if verified, else mark missing) so the UI knows which features are available.
- Owner, 2026-11-17: the popup itself downloads (not only a link to somewhere else).

### A2c notes (built 2026-11-17)
- Installer: `src-tauri/nsis-hooks.nsh` (post-install) runs `securephotos-engine.exe --fetch-models "$INSTDIR\data\models"` (`engine/services/model_installer.py`, handled in `run_engine.py` before the server loads). Per model: already up to date / ready / couldn't download (the app will ask later); progress lines in the details list; a message box with the status unless the install is silent or passive (updates). Exit code always 0. A model already verified in a library kept elsewhere (`data_location.txt`) counts as up to date.
- Downloads continue after a network drop (`<file>.download` + HTTP Range); a cancelled one is removed; a damaged one is never kept.
- Verified files are remembered in `verified.json` (size, mtime, SHA-256) next to them, so a restart or an upgrade doesn't hash 2.3 GB again. A stamp with another checksum never counts.
- Models are found in the library's `data/models` or the app's own `data/models` (where the installer puts them), used in place.
- The queue never downloads by itself; `POST /jobs` answers 409 `models_missing`; `/state` lists `downloads` (bytes per locked action); `POST /models/download {kind}` fetches only what that action needs; `GET /models` gives overall progress and `result` (done / failed / cancelled).
- Removed: `import_model_file`, `/api/restore/models/import`. For the joint test (repo still private), the model files can be copied into the test library's `data/models`; they are accepted only if their SHA-256 matches.
- Found in the browser check and fixed: the old-photo dialogs (Keep, and the new popup) were 920px wide because the general dialog rule comes later in the CSS.

## A7 notes (built 2026-11-17)
- Test photos: the owner has none with scratches (phones and PhotoScan clean them), so damage was **drawn** onto copies of 8 owner scans and a public-domain picture (thin light and dark scratches, a crease, dust, a torn corner) with the exact damage map, to measure the finder. Read only; derived pages deleted after the owner's review.
- Models (permissive; owner approved running the official model code for the conversion): Microsoft BOPBTL scratch detector (MIT) and Big-LaMa (Apache-2.0), rebuilt from the official weights (`scripts/model_export/export_scratch_models.py`), byte-identical across runs, outputs equal to PyTorch. The LaMa Lightning checkpoint is read with a restricted reader that runs nothing from the file. ~360 MB together; installer total now ~2.7 GB.
- Measured (9 photos): detector at 768 px / 0.6 found 52% of the drawn damage by area with 87% of its marks right and 0.18% of a clean scan wrongly marked; adding the dust finder 55% / 79% / 0.31%; adding the coarse 256 px pass 73% / 63% / 0.61%. Light scratches are found reliably; dark lines, dust and torn corners poorly. LaMa with correct marks is near perfect.
- **Owner decision (2026-11-17): careful marks + Touch up.** Detector 768 px @ 0.6 + dust finder, no marks inside faces; fill-in at 1024 px (~40 s on a 3500 px scan, ~20-40 s on smaller ones; was ~90 s at 1536 px with the same look); only marked pixels change at full resolution. The result shows the marks in lime ("Show marks"); **Touch up** (brush / eraser / size / hide marks / undo; faces only if painted) repairs again from the original with exactly the painted marks.
- **Automatic:** scratch detector only (strict) and only when it marks >= 0.4% of the scan (clean scans averaged 0.18%); otherwise nothing is kept (Activity: "Nothing to fix"). With other rows Automatic too, scratches are repaired first in the same job (one copy, e.g. `colour,scratches`).
- Offered in the viewer for scans (no camera data) and black-and-white photos.
- Vault: the marks and a Touch-up mask are staged encrypted; result details stay in memory.
- Browser check found and fixed a real bug: Touch up's Apply stayed disabled (it depended on a ref that doesn't re-render).

## A6 notes (built 2026-11-17)
- **Only scans of prints (owner decision 2026-11-17):** "Automatically" acts only on new photos with no camera exposure data (no ISO, aperture or shutter speed) — how PhotoScan and flatbed scans look; all 19 of the owner's scans qualify (no make/model, `GooglePhotoScan`). Phone and camera photos are never changed automatically. Vault photos, videos, documents and improved copies are skipped. `engine/services/old_photo_rules.py`, called after every import.
- One job per photo: grey scan -> Add colour (Natural); colour scan -> Fix faded colours; faces are folded into that job when "Sharpen blurry faces" is Automatic too (one copy, labelled `colour,faces` / `fade,faces`), else left alone; only faces Automatic -> a Sharpen faces job for scans with faces.
- No separate "faded" detector: within scans of colour prints the colour fix is mild when a print isn't faded (per-channel levels).
- Automatic jobs run after what the user asked for, wait on battery, and keep their result by "Keep original" (existing queue rules). Verified end to end: on battery the job waited ("on_battery"); with the guard off it ran in 8 s and kept a linked `fade,faces` copy; the phone photo was untouched.
- Settings → Photos & AI → **Old photos** as on the A1 board: three rows with a small CSS before → after picture and When I ask / Automatically, the Keep original switch and the footnote. The fourth row (Remove scratches and spots) comes with A7.
- "Remember my choice" stays in the keep dialog (the board has no setting for it).

## A5 notes (built 2026-11-17)
- Recipe as approved in A0: YuNet faces (>= 24 px wide) with landmarks, similarity transform to GFPGAN's 512 px template, GFPGAN v1.4, feathered paste at 80%. `engine/services/face_sharpen.py`.
- **Identity check (owner decision 2026-11-17):** SFace similarity between the face before and after. On the owner's 19 photos (143 faces) large faces scored 0.70-0.93; tiny or motion-blurred faces (35-50 px) often 0.2-0.45, where GFPGAN was inventing a face. Rule: **below 0.45 the face is left as it was; otherwise 80%.** No 50% middle step (it looked like a ghosted double image). A face that can't be measured is left as it was. Measured read-only; the comparison page was local and deleted after the decision.
- **Fix faded colours = recipe R (owner decision 2026-11-17):** the colour fix always runs (never locked); faces are sharpened too when the face model is on the computer; otherwise the panel offers "Also sharpen faces" (download popup, then the fix runs again).
- **Per-face switch:** the sharpened 512 px faces are staged next to the result (`job_N.faces`, encrypted for vault photos), so switching a face off rebuilds the image exactly (putting the old pixels back would also undo part of a neighbour in a group photo, where the soft edges overlap). The image before sharpening is the original (Sharpen faces) or the deterministic colour fix (Fix faded colours).
- Face positions of a vault photo's result are kept in memory only (`restore_jobs.result_info` stays NULL).
- A kept faded-colour fix with sharpened faces is labelled `fade,faces` (AI-made in IPTC), with every face switched off just `fade`.
- `opencv-python-headless` was used since A3 but missing from `engine/requirements.in`; added and pinned (5.0.0.93).
- Speed on the owner's photos: about 2 s per face (a 19-face group photo ~39 s).

## A3 notes (built 2026-11-16)
- Engine: `engine/services/old_photo_processors.py` (recipe F, Vivid 768, sepia fallback, recipe Q) registered at start; `/api/restore/photos/{id}/state` (one request per opened photo: fitting actions, family, open job), `/jobs/{id}/result`, `intensity` on keep.
- Viewer: "…" menu, progress in the date line, before/after divider, side panel, keep dialog, Original / Improved switch; grid "AI" badge (timeline flag 8).
- Found while testing in the browser and fixed: (1) black-and-white detection now means **one uniform tint** (Lab a/b spread), because strong sepia prints failed the old saturation rule (owner's 19 photos: still exactly the 11 grey ones); (2) the contrast stretch is capped at 2.5x around the photo's mid-tone, because a nearly flat scan turned black (owner's prints need 1.3-1.4x, unchanged); (3) Escape in the keep dialog also closed the viewer, and arrows on the strength slider switched photos; the viewer now ignores its keys while a dialog is on top or a control has focus; (4) an AI-coloured copy no longer offers "Fix faded colours".
- Real models on 4 owner photos (read only, outputs deleted): ~10-12 s per grey photo including model swaps, ~16 s when the sepia fallback runs, under 1 s for the faded-colour fix; results match the approved A0 round.
- Not yet: Activity screen is A4. ("Import from file" was removed in A2c.)

## Testing

- Every step: unit/component tests, engine tests, mutation checks, Playwright on a throwaway library in both themes (as in the redesign).
- Real-photo testing: the owner's B&W and blurry photos in a separate test library (never the real library unless the owner says so). Comparison pages for the owner to judge quality.
- Joint test before merge: a checklist (colorize, restore, repair, auto rules, Activity, vault privacy, cancel/pause/battery, export labels, undo/delete versions).

## Decisions needed from the owner (asked one at a time)

- ~~D1~~ Licensing: decided 2026-11-15 — keep MIT, permissive models only.
- ~~D2~~ Settings: decided 2026-11-15 — Manual (default, asks replace or copy) or Automatic (keep original or not); the original is never deleted.
- ~~D3~~ Activity: decided 2026-11-16 — rail status ring + Photos header pill, no rail item.
- **D4** Order: is scratch repair (A7) needed in the first merge?
- **D5** Where to put the test photos (a folder path), and whether they may be read by the benchmark.
