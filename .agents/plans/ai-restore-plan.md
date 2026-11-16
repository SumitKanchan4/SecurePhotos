# Plan: Restore old photos and colorize black-and-white photos (H10 + colorization)

Branch: `feature/ai-restore` (integration branch, like the redesign). Every step is a topic branch → PR into `feature/ai-restore`. Nothing reaches `master` until **the owner and I have both tested the whole feature on real photos** and the owner approves the final merge.

Research behind this plan: `.agents/research/Local photo restoration and colorization.md` (notes in `.agents/research/Local photo restoration and colorization - notes/`).

Hard constraints:
- **CPU only.** The owner and most users have no GPU. Compact ONNX models, tiled, in a background worker; GPU (DirectML) is only an optional speed-up later.
- **Fully offline.** Models are downloaded once (or imported from a file) and checked against SHA-256 hashes; photos never leave the computer.
- **Never destroy the original.** Every result is a new copy linked to its original.
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
- Deleting the AI version never touches the original; moving the original to Trash asks what to do with its versions.

### Settings → Photos & AI → "Old photos" (new group) — owner decision D2, 2026-11-15
For **black-and-white photos** and, separately, for **blurry or faded faces**:
- **How:** **Manual** (default) — only when I ask, per photo (viewer or selection bar) · **Automatic** — after import, in the background.
- **Manual:** each time it runs, the app asks **"Replace the photo" or "Keep a copy"** (with a "remember my choice" tick). "Keep a copy" adds the AI version next to the original.
- **Automatic:** a switch **"Also keep the original"** (on = keep both; off = show only the new version).
- **Safety net (applies to "Replace" and to Automatic without keeping the original):** the original is never deleted. It is kept hidden as the photo's earlier version and can be brought back from the viewer ("Show original" / "Restore original"); it is removed only if the user deletes it themselves. Old family photos are irreplaceable and AI can change a face.
- **Scratches and creases:** always manual (the user checks the marked damage first).
- **When to run (automatic):** only while plugged in (default on, like enhancing) · Speed: Balanced (default) / Best quality (slower).

### Detection on import (cheap, CPU)
- **B&W:** colour saturation of a small thumbnail (also sepia-toned prints).
- **Blurry / faded faces:** the face scan already computes a sharpness/quality score per face; flag photos with faces below a threshold (tuned on the owner's photos).

### On-demand actions (viewer, selection bar)
- **Colorize**, **Restore faces**, **Repair scratches** (opens a mask view: marked damage, brush/eraser, then Repair), **Enhance** (existing).
- Result appears as a new version; the viewer opens on it with before/after.
- Controls: strength slider (blends cached results, instant), colour intensity, per-face on/off; an identity check (SFace) softens a restored face that no longer looks like the same person.

### Processing screen ("Activity")
- One place for all background work: imports, video preparation, enhancing, colorizing, restoring, repairing. Each item: thumbnail, what's being done, progress, time left, Cancel; waiting items below; finished today with "Open".
- **Vault items** show a blurred/locked thumbnail and no file name.
- **Reaching it:** the rail's status dot becomes an activity indicator (spinning ring + count while work runs) and opens Activity; the Photos header pill ("Colorizing · 3 of 12") opens it too. — design on a board for approval first.
- Pause all / resume; pauses on battery.

## Steps and estimates

Sizes: S ≈ half a day of my work, M ≈ 1 day, L ≈ 2 days (each including tests, mutation checks, UI check in both themes, docs). Calendar time also depends on review/testing turns.

| # | Step | Size | Notes |
|---|---|---|---|
| A0 ✅ | **Spike & benchmark** (done 2026-11-16; results in "Colorize recipe") on the owner's photos: GFPGAN CPU time/RAM, DDColor large vs tiny quality, B&W and blur detection thresholds, int8 vs fp32. Output: a comparison page (before/after) for the owner to judge. | M | Owner provides ~20–30 B&W and blurry photos. Runs read-only on a copy. |
| A1 | **Boards** for the Activity screen, viewer version switch + before/after, Settings "Old photos", the "replace or keep a copy" prompt, the scratch mask view. Owner approves. | M | Design first, like the redesign. |
| A2 | **Engine foundation:** model manager (download / import file / SHA-256 manifest / status in Settings → Storage), CPU ONNX session tuning (threads, tiling), a background **job queue** with progress, cancel, pause, battery rule; versions in the DB (`derived_from_id`, `ai_kind`) + IPTC labelling on export. | L | Reused by every feature. |
| A3 | **Colorize** on demand (DDColor, Lab chroma transfer at full resolution, intensity slider, Natural/Vivid). Recipe chosen by the owner in A0 (2026-11-16), see "Colorize recipe" below. | M | First visible feature; good first joint test. |
| A4 | **Activity screen** + indicator (rail + header), vault items blurred. | M | |
| A5 | **Restore faces** on demand (GFPGAN, align with YuNet landmarks, feathered paste-back, strength + per-face toggles, SFace identity check). | L | |
| A6 | **Auto rules**: B&W and blur detection on import, Settings "Old photos" (manual / automatic, keep original), the "replace or keep a copy" prompt with remember-my-choice, hidden original + "Restore original". | M | |
| A7 | **Repair scratches** (detector → editable mask → LaMa on crops). | L | Most UI work (brush editor). Could move after the first merge if the rest is ready. |
| A8 | **Full test round with the owner** on real photos; fixes; docs (design system, history, THIRD_PARTY_NOTICES, licences); then PR `feature/ai-restore` → `master` with owner approval. | M | |

Total ≈ 10–12 days of work across 9 steps; first usable piece (colorize + Activity) after A0–A4.

## Colorize recipe (from A0, owner-approved 2026-11-16)

Tested on the owner's 11 B&W/sepia photos (variants A–F). The owner judged **F** "all good" except two sepia-heavy group photos, which looked best with the 768 px variant (E).

- **Natural (default) = F:** stretch the brightness (1st–99th percentile auto-levels) before the model → DDColor **large** and **artistic** at 512 px → per pixel keep the more colourful prediction (soft blend, no seams) → put the colour on the **stretched** brightness (restores faded contrast). ~9 s per photo on the Ryzen 7 5700U.
- **Vivid = E:** the same, but the large model at **768 px**. Richer colour on crowded or sepia photos, but sometimes wrong hues (purple water and rocks, a red wall), so it is never the default. ~13 s.
- **Automatic fallback:** after Natural, if more than about two-thirds of the coloured pixels are still orange/brown (Lab hue 30–100°), also run Vivid and use it when it removes the cast. In A0 this picked exactly the two photos the owner preferred in Vivid (90% and 70% brown versus at most 64% for the others). Tune the threshold on more photos; the viewer's Natural/Vivid switch always lets the user override.
- Rejected: the baseline without contrast stretch (keeps the sepia cast), and 768 px as the default (wrong hues).
- **Faces (A5):** GFPGAN v1.4 blended at **80%** with a feathered mask; owner confirmed the restored faces still look like the same people (2026-11-16). 2.0–3.1 s per face.
- Note: one model is loaded at a time in the app (A0 peak with all models loaded was 7.3 GB).

## Testing

- Every step: unit/component tests, engine tests, mutation checks, Playwright on a throwaway library in both themes (as in the redesign).
- Real-photo testing: the owner's B&W and blurry photos in a separate test library (never the real library unless the owner says so). Comparison pages for the owner to judge quality.
- Joint test before merge: a checklist (colorize, restore, repair, auto rules, Activity, vault privacy, cancel/pause/battery, export labels, undo/delete versions).

## Decisions needed from the owner (asked one at a time)

- ~~D1~~ Licensing: decided 2026-11-15 — keep MIT, permissive models only.
- ~~D2~~ Settings: decided 2026-11-15 — Manual (default, asks replace or copy) or Automatic (keep original or not); the original is never deleted.
- **D3** Where the Activity screen lives (decided on the A1 board).
- **D4** Order: is scratch repair (A7) needed in the first merge?
- **D5** Where to put the test photos (a folder path), and whether they may be read by the benchmark.
