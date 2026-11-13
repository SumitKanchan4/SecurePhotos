# SecurePhotos Remediation Backlog

Source: full project review on 2026-11-10, plus the owner's replies to it.
Purpose: each item has enough context to start a fresh session on it without re-running the review.

## Working agreement

- One branch per item (`fix/<id>-<slug>`), created from `master`. Items that touch the same code may share a branch only if the owner agrees in the item's briefing.
- **Before starting any item**, post a briefing and wait for the owner to confirm:
  1. What it is about
  2. Current implementation (file:line, as it actually behaves today)
  3. Impact (what goes wrong, for whom, how likely)
  4. Proposed solution, with alternatives
  5. Open questions or decisions needed
  6. How it will be verified (tests)
- The last merge mixed older and newer approaches. Before changing behaviour, check `.agents/history/features_and_functional_decisions.md` to find out which approach is the current intent, and say which one in the briefing.
- Every functional decision is recorded in the history doc (rule §5).

Status: `todo` · `needs-decision` · `in-progress` · `review` · `done` · `dropped`

---

## Critical

### C1 · Make the single-version enhancement pipeline safe and honour its settings — `done` (merged 2026-11-11, history §102)
- **Follow-ups:** (1) blurry-face restoration is built but OFF (`AUTO_FACE_RESTORE_ENABLED`) until H9 clears CodeFormer or replaces it; (2) `BLURRY_FACE_SHARPNESS_THRESHOLD = 100` must be calibrated on real photos before enabling; (3) owner kept default quality 80, which measured only ~9% smaller than a 12 MP phone JPEG (quality 70 ≈ 23%, 60 ≈ 38%).
- **Decisions:**
  - Every import is always enhanced; there is no option to keep the original. Remove the misleading `enable_space_saver` toggle.
  - Keep 8K enlargement (the owner accepts the larger files).
  - Face restoration only on faces measured as blurry; sharp faces are left untouched.
  - Save enhanced photos as **AVIF**, keeping EXIF (date, GPS, camera).
  - Connect the quality slider (`quality_crf`) to AVIF quality for future imports, with a visually lossless default.
  - Make `pause_on_battery` work: pause on battery, resume when plugged in.
  - Use `resolve_media_path` and relative paths.
- **Found during C5 (confidence medium-high, not yet confirmed on an installed build):** managed imports store relative paths, but the optimizer checks `Path(filepath).exists()` (`photos.py:166`, also `:305`) relative to the engine's working directory. The bundled engine does not set one, so the file is usually "not found" and the photo is **marked `is_optimized = 1` without being enhanced** (`photos.py:211-217`). Confirm on an installed build first. The fix must also re-queue photos wrongly marked as optimized.
- **Agreed intent:** keep one version of each photo; the enhanced file replaces the imported original (history §14). This is *not* being reversed.
- **Current:** [engine/api/photos.py](../../engine/api/photos.py) `run_background_optimization()` runs on every engine start (`main.py:50`) and after every import (`photos.py:1038`). It calls `upscale_and_optimize_to_8k(..., destination_path=None)` in [super_resolution_service.py](../../engine/services/super_resolution_service.py), then `restore_faces_in_image` (CodeFormer) on the same file.
- **Problems found:**
  - The AI settings `enable_space_saver`, `quality_crf` and `pause_on_battery` (`system.py:553-555`, `AISettings.tsx`) are saved but **never read**. The toggles do nothing.
  - Photos with a long edge under 7680px are upscaled to 8K, which makes files *larger*. That works against the space-saving goal.
  - JPEGs are re-encoded at q=85 with a 160% unsharp mask. This loss cannot be undone, and the user has no way to opt out.
  - CodeFormer is generative and permanently replaces real facial detail. Because only one version is kept, a bad result cannot be undone.
  - It uses `Path(filepath)` instead of `resolve_media_path`, so it breaks when the drive letter changes.
- **Decisions needed:** default on/off; whether to upscale at all; face restoration policy (off / opt-in / per photo); whether to keep a time-limited undo (e.g. the pre-enhancement file held in app trash for 30 days, then hard-deleted, which matches the trash model); which output format and quality actually saves space.

### C2 · The 4-digit PIN slot can be brute-forced offline — `done` (merged 2026-11-11, history §103) (decided: option A; PIN undoes any lock until the app closes; no old-format migration since nobody uses the vault yet)
- **Decision:** the PIN is a quick re-unlock only, for the current app session after a master-password unlock. Nothing PIN-derived is stored on disk. On upgrade, delete the existing `mvk_wrapped_pin`/`pin_salt` and tell the user the PIN now works after the first password unlock.
- **Current:** `vault.py:198-209` wraps the master vault key with Argon2id(PIN). The wrapped key, salt and attempt counter are all in `securephotos.db`.
- **Impact:** anyone with a copy of the drive can try all 10,000 PINs offline (minutes to hours) and decrypt the whole vault. The 5-attempt lock only applies through the API.
- **Options:**
  - **(A, recommended)** The PIN becomes a quick re-unlock only. After the first unlock with the master password in an app session, the master key is held in memory wrapped by a PIN-derived key, and nothing PIN-derived is written to disk. 5 wrong PINs wipe it and the master password is required. Stays portable.
  - (B) Bind the PIN to Windows Hello or TPM. Strong, but it **breaks multi-PC portability** (keys are tied to one machine). Could fit P12 as an optional per-PC add-on.
  - (C) A longer PIN. Still weak offline; not recommended.
- **Affects:** C3 (the reset path uses the PIN slot) and P12.

### C3 · PIN lockout can be bypassed through password reset — `done` (merged 2026-11-11, history §103)
- **Decision:** recovery is by **Emergency Card file upload OR typing all 16 card numbers**; a key slot is derived from all 16 cells with a strong KDF. Remove the 3-cell challenge, the "cells + PIN" path and the "PIN-only" reset path (`vault.py:527`, reset modal tabs `challenge` and `pin`). Migration for existing vaults: on the next password unlock, recover the cells from the stored hashes (90 candidates each), create the 16-cell slot, and delete `grid_cells_hash`. Do together with or after C2.
- **Current:** `vault.py:490-515` (reset path B: grid cells + PIN) and `crypto_vault.py:182-197`:
  - Wrong PINs on this path never increment `pin_failed_attempts` or check the lockout.
  - The server does not enforce the letters it challenged; the client can send any letters.
  - Letters are normalised *after* being used as dictionary keys, so `{"A","a"," A"}` counts as 3 cells, and one cell has only 90 possible values.
  - Different error messages show whether the cells or the PIN were wrong.
- **Proposed fix:**
  - Store the issued challenge server-side (letters + expiry, single use) and require exactly those letters.
  - Normalise before counting distinct letters.
  - All PIN paths share one counter and one lockout.
  - Give one generic error message.
  - Rate-limit the cheap SHA-256 cell check (backoff).
- **Note:** the cell hashes in the DB can be reversed offline (90 values each). That is acceptable only if this path also needs a strong secret. Revisit after C2 (under option A, the PIN slot goes away and this path needs redesign: grid card token, or cells + master-password-derived data).

### C4 · Encrypt sensitive metadata for vault items — `done` (merged 2026-11-11, history §104)
- **Decision:** protect OCR text plus its FTS rows, face data and GPS. Face data: delete embeddings and face crops on lock, rescan on unlock. Filename, caption/tags and album names stay in plaintext.
- **Agreed:** encrypt the critical metadata, not everything.
- **Current:** locking encrypts the file, thumbnail and preview only. These stay in plaintext: `filename`, `latitude/longitude`, `ocr_text` (and the FTS index), `caption`, `content_tags`, album names, **face embeddings (`faces` table) and face-crop thumbnails on disk** from scans done before locking.
- **Proposed scope to encrypt or remove:** OCR text plus its FTS rows, caption/tags, GPS, filename, face embeddings plus face crops (or delete faces on lock and rescan on unlock). Keep in plaintext: id, size, mime, width/height, dates, flags.
- **Decision:** confirm the list above.

### C5 · Make vault lock/unlock crash-safe — `done` (merged 2026-11-10, history §99)
- **Scope confirmed:** crash-safety, plus one shared helper replacing the 4 copies, plus relative paths for the rows it writes. Branch `fix/c5-vault-crash-safe`.
- **Current:** `lock_photos_to_vault`, `lock_album_to_vault`, `restore_photos_from_vault` and `unlock_album_from_vault` in [vault.py](../../engine/api/vault.py) encrypt the file, **delete the plaintext**, and only commit the DB at the end of the whole batch. Unlock writes plaintext directly (no temp file or fsync), then deletes the `.enc` file. The logic is copy-pasted 4 times.
- **Impact:** a crash, power loss or hot-unplug mid-batch (which rule §6 expects) leaves rows pointing at deleted files, and `.enc` files that no row references. Photos look lost.
- **Proposed fix:** one shared helper that handles one file at a time: write `.enc` (temp file, fsync, replace), verify, update the row, commit, then delete the plaintext. Unlock does the reverse. Add a reconciliation sweep at startup for leftovers. Store relative paths for the rows it writes (rule §2).

### C6 · Vault reset orphans encrypted files — `done` (merged 2026-11-11, history §101)
- **Decision:** reset permanently deletes all vault items (files plus rows) with the keys. The user types the confirmation phrase themselves and sees the item count first. The API requires the phrase (no optional body).
- **Current:** `vault.py:395-408` deletes `vault_configs` only. `.enc` files and their `photos` rows remain and can never be decrypted again. The confirmation phrase is optional in the API and hard-coded in the UI (`VaultView.tsx:399`), so it guards nothing.
- **Decision:** on reset, either (a) permanently delete all vault items and files too, or (b) refuse to reset while vault items exist. Make the confirmation phrase required and typed by the user.

### C7 · Enhance vault photos while the vault is open — `done` (merged 2026-11-11, history §106)
- **Intent (owner):** vault photos get the same single-version enhancement as library photos (AVIF, 8K, settings), but only while the vault is unlocked. While it is locked, nothing is processed and the encrypted original stays as it is.
- **Current:** `run_background_optimization` skips `is_encrypted = 1`. A photo locked before it was enhanced stays unenhanced until moved out of the vault (then it is enhanced as a library photo).
- **Constraints:** decrypt in memory, enhance in memory, encrypt the result; **never write unencrypted data to disk** (the current enhancer writes a temp file next to the photo, so it needs an in-memory variant). Stop when the vault locks (idle, Lock, L, 5 wrong PINs) and resume on the next unlock. Crash-safe replacement through the `vault_storage` journal (new `.enc` written and verified before the row changes; old `.enc` deleted after commit). Respect battery guard and quality slider. `ACTIVE_VAULT_SESSION["batch_keepalive"]` already exists for long batches; decide whether enhancement may keep the vault from auto-locking (probably not).
- **Open questions for the briefing:** should progress show in the vault screen; very large videos are out of scope (photos only, like C1).

---

## High

### H10 · Blurry-face restoration: choose a permissive model or drop the idea — `needs-decision` (from H9)
- CodeFormer (non-commercial) was removed in H9, together with C1's switched-off blurry-face step. Candidate: GFPGAN v1.4 (weights Apache-2.0, but trained on FFHQ, which is CC-BY-NC-SA; the same "permissive weights, research dataset" grey area as SFace). Needs an owner decision, then calibration of the blur threshold on real photos.

### H11 · Rare false face detections — `todo` (found in H9 rehearsal)
- YuNet finds ~15 more real background faces than the old pipeline, plus occasional non-faces (a hand, an ear/earring). Their detector score (0.67-0.84) overlaps named faces (lowest 0.68), so no safe score cut-off exists. Today they only appear as "who is this?" suggestions the user can dismiss. Possible fixes: a small face/non-face check on the crop, or hiding single-face suggestions below a quality level.

### H1 · Check the vault session token on every vault request — `done` (closed 2026-11-11 by removing the unused token; history §107)
- **Owner decision:** remove rather than implement. The token was created on unlock but never sent or checked. Vault protection = engine login (hardened in H6) + vault unlocked + auto-lock; a second vault-only credential would only help against a program that already holds the engine secret.
- `get_active_mvk(token)` ignores its argument (`vault.py:47`). The vault is one global unlocked state, so any authenticated caller can use it. Fix: require `X-Session-Token` on all vault routes and compare it with `secrets.compare_digest`. Media `<img>` tags need a cookie or a short-lived signed URL; design that in the briefing.

### H2 · Encrypted file format v3: truncation protection and an authenticated header — `done` (merged 2026-11-12, history §109)
- `crypto_vault.py:239-333`. Chunks have no final-chunk flag and no associated data, so trailing chunks can be dropped without detection. The header salt is unused. Fix: a STREAM-style construction (nonce/AAD includes the chunk index and a last-chunk flag, and the header is in the AAD). Must still read `SPENC02` files, with optional background re-encryption.

### H3 · Remove TOTP leftovers — `done` (merged 2026-11-12, PR #5, history §115)
- The UI always sends `enable_totp: false` (`VaultSetupWizard.tsx:226`), but the backend still generates and verifies TOTP and stores the secret in plaintext in `totp_secret_encrypted`. Remove the backend code, `has_totp` and the store fields. Leave the DB column (migration safety).

### H4 · Make in-memory key handling honest — `done` (merged 2026-11-12, PR #9, history §119)
- `zero_memory` does nothing for `bytes`, and `get_active_mvk` returns `bytes(...)` copies. Python cannot wipe memory reliably. Reduce copies where possible and correct the docstrings and README claims ("RAM key zeroing").

### H5 · Add a Content Security Policy and trim Tauri permissions — `done` (merged 2026-11-12, history §110; owner: bundle the fonts)
- **Note:** the npm audit advisories were fixed under Q2 (0 vulnerabilities).
- `tauri.conf.json` has `"csp": null`, and `capabilities/default.json` grants `shell:default` on window `"*"`. Add a strict CSP (self + `http://127.0.0.1:*` for the engine, media from blob/engine), check whether the shell plugin is used at all, and limit capabilities to the `main` window.

### H6 · Harden IPC token handling — `done` (merged 2026-11-11, history §107)
- **Verified with Playwright on both page origins:** dev build (`http://localhost:1420`) and a production-style build (`http://tauri.localhost`, `tauri build --debug --no-bundle`): grid thumbnails, viewer, video (206, plays), vault thumbnail and vault viewer all load; no failed media requests. An NSIS installer run is still worth one manual check before release.
- **Small follow-up:** the app polls the default engine address (`127.0.0.1:8000`) before the real port is known, producing a few harmless `ERR_CONNECTION_REFUSED` console errors at startup.
- **Check while here (found in UI testing, confidence low):** the login cookie is `SameSite=Lax` and set by `127.0.0.1` for a page on another site (`tauri.localhost` in the app). In a browser on `localhost` it was rejected and every thumbnail got 403. Verify how WebView2 behaves; the redesign should not depend on cross-site cookies.
- `auth_middleware.py`: remove the `?token=` fallback; with no secret set, refuse requests in a frozen build. `auth.py`: the cookie holds the raw secret for 30 days, so issue a separate random session value instead. Covers M6.

### H7 · Move CPU-heavy work off the event loop — `done` (merged 2026-11-12, PR #7, history §117; owner: queue overlapping work)
- Argon2, whole-file encryption and decryption, PIL and ONNX run synchronously inside `async` routes. Locking a large video stalls every request. Use `asyncio.to_thread` or a process pool. Touches the same code as C5; do it after C5.

### H8 · Pin model downloads and correct the offline wording — `done` (merged 2026-11-12, PR #8, history §118; owner: bundle the models in the installer)
- **Follow-ups found in H8:** (1) the bundled fonts (H5) are redistributed too, so their OFL-1.1 licence text and copyright lines should ship with the app (today `THIRD_PARTY_NOTICES.md` only points to `node_modules`). (2) The owner's real `data/models` still holds the retired models (CodeFormer, ArcFace, yoloface, ReFocus, about 630 MB); they are deleted automatically once the People migration finishes on that library (H9), worth confirming after the next app start.
- `face_recognition_service.py:27-28`, `face_restore_service.py:25-26`, `neural_sr_service.py:25`, `deblur_service.py:25` download from HuggingFace `main` branches with no hash check. Rule §3.4 says models are bundled, but CI ships a placeholder. Pin the revision and SHA-256, verify before loading, and download into `data/models` only. Reword the README: "all photo processing is on-device; models download once, updates are checked online".

### H9 · Model license audit and alternatives — `done` (merged 2026-11-11, history §105)
- **Now blocks** automatic face restoration (C1): it's implemented but disabled until this passes.
- To verify (confidence medium, from memory): CodeFormer (S-Lab 1.0, non-commercial), InsightFace ArcFace w600k (non-commercial research), `yoloface_8n` (YOLOv8 → possibly AGPL-3.0), `realesr-general-x4v3` (BSD-3, likely fine), `1x-ReFocus-Cleanly` (unknown). Find permissive alternatives that still serve the enhancement and face goals.

---

## Medium

### M1 · `resolve_media_path` falls back to the filename only — `done` (merged 2026-11-12, PR #2, history §112)
- `config.py` (last line of `resolve_media_path`) returns `data_dir / p.name`. A filename collision could serve, or trash-purge, the wrong file. Return "not found" instead.

### M2 · Store paths relative to the data folder everywhere — `done` (merged 2026-11-12, PR #4, history §114; owner: remove the storage clean-up endpoint)
- **Done:** thumbnails/previews saved relative (startup converts old rows); same-name checks fixed in import and video conversion (video conversion could overwrite another video); `prune-orphans` removed (would have deleted every photo); no more "None" text paths.
- Vault code writes `str(x.resolve())` (absolute) and builds thumbnail and preview paths with raw `Path()`. This breaks rule §2. Normalise on write, and migrate existing rows. (The vault rows touched by C5 are handled in C5.)

### M3 · Legacy migration deletes data after a best-effort copy — `done` (merged 2026-11-12, PR #2, history §112; owner: remove the migration entirely)
- `config.py` `ensure_directories()` copies `~/.securephotos_data`, then runs `shutil.rmtree` with errors swallowed. Only delete after verifying the copy, or keep the source and log.

### M4 · Remove the unused in-place "scan" import mode — `done` (merged 2026-11-12, PR #3, history §113; owner: collages in collages/YYYY/MM)
- The UI only sends `mode: "managed"` (`ImportModal.tsx:229`), but `ingestion_service.py:408` and `photos.py:50` still accept `"scan"` (in-place). Remove it so trash purge and the optimizer can never touch files outside the app folder.

### M5 · Token RNG must fail closed — `done` (merged 2026-11-12, PR #6, history §116; owner: auto-retry, then one click)
- `lib.rs` `fallback_token()` uses time + PID. Use the `getrandom` crate and abort engine start if it fails.

### M6 · Disable `/docs` and `/openapi.json` in frozen builds — `done` (merged with H6, history §107)

### M8 · Auto-lock time setting is ignored — `done` (merged 2026-11-12, history §108; owner removed the 'Never' option)
- **Small follow-up:** the vault screen counts mouse movement as activity, the engine only counts requests, so the engine can lock slightly before the on-screen countdown ends (the next action then shows the lock screen).
- Settings offers 1/5/15/30 min/never (`auto_lock_duration`), but the engine (`vault.py` `AUTO_LOCK_SECONDS = 300`) and `VaultView.tsx` (`AUTO_LOCK_SECONDS = 300`) hard-code 5 minutes. Either wire it up (engine is the authority) or remove the option.

### M9 · Engine auto-reload hangs in development — `todo` (found during H6)
- With `tauri dev`, uvicorn `--reload` logged "Reloading..." after a Python change and never restarted; the old engine kept answering with old code. Likely a background task (face scan, video queue, enhancer) blocking shutdown on Windows. Development-only, but it makes code changes look ineffective. Fix: cancel background tasks in the lifespan shutdown, or drop `--reload` in the dev launcher.

### M7 · Trash purge cannot find files with relative paths — `done` (merged 2026-11-12, history §108)
- **Also found:** no automatic 30-day purge existed at all (the Trash screen promised one); now implemented.
- `trash.py:120` `_unlink_photo_files` uses `Path(path_str)` directly. Managed imports store relative paths, so after 30 days the row is deleted but the original, thumbnail and preview probably **stay on disk forever** (wasted space, and "deleted" photos remain). Resolve paths against the data folder using `vault_storage.resolve_stored_path`. Also add a one-off cleanup for files already orphaned this way.

---

## Code health and standards

### Q1 · Review the `.agents` rules and skills so they prevent these issues — `done` (merged 2026-11-12, PR #10, history §120; owner: correct crypto skill, mark the other two as future)
- The rules are long and mostly about styling. They have no enforceable checks for data safety, crypto, or doc/code agreement, and they reference MCP tools (`codegraph`, `headroom`) that may not be present. Add short, testable checklists: never delete before commit; no absolute paths; no `except Exception: pass`; claims in docs must match code. Fix doc drift: README says React 18 (it is 19); architecture.md mentions JWT, bcrypt, sqlite-vec, MobileCLIP and Moondream2, none of which exist; the trash TTL is 7 vs 30 days; "secure delete" and "military/bank-grade" wording.

### Q2 · CI quality gate — `done` (merged 2026-11-12, PR #1, history §111; owner: run on pushes to master + PRs)
- `pipeline.yml` runs only on `workflow_dispatch`. Add a PR/push job with ruff, mypy, eslint, `tsc`, clippy and pytest. Use `npm ci`, pin actions to SHAs, pin Python dependencies (lock file), and move pytest out of runtime requirements.
- **Done:** `quality.yml` (ruff, pytest, npm audit, tsc + build, cargo check), pinned requirements (`requirements*.in` -> `.txt` via uv), dev tools split out, `npm ci`, actions pinned to SHAs, Python 3.12. Linter found and fixed a story-deletion crash.
- **Follow-up (not gating yet):** mypy, eslint and clippy each need a first clean-up pass before they can block merges.

### Q3 · Frontend tests — `done` (merged 2026-11-12, PR #12, history §122; owner: reduced scope before the redesign, block merges)
- **Done:** Vitest + Testing Library, `npm test` in the quality gate, tests for `api.ts` and the store. **Deferred to the redesign:** component tests (vault unlock, startup banner) against the new screens.
- There are none today. Add Vitest + Testing Library; start with `api.ts`, the store, and the vault flows.

### Q4 · Backend structure — `todo` (= review item 15)
- Remove duplication in `vault.py` (partly done in C5), add a small repository layer instead of per-route connection and dict mapping, and review the 76 broad `except Exception` blocks.

### Q6 · Tests run against the real library database — `done` (merged 2026-11-11, history §100)
- The tests use `settings.database_path` (the developer's real `data/` library) and only back up and restore `vault_configs`. Tests insert and delete rows in the live DB. Give pytest its own temporary data folder (`SECUREPHOTOS_DATA_DIR` set in `conftest.py` before `engine.config` is imported).
- Several vault tests call `/api/vault/reset` with no body; C6 makes the phrase required, so update those tests in C6.

### Q5 · Split oversized frontend components — `todo` (= review item 15; owner plans a frontend redesign, fold this into it)
- PeopleView (3.3k lines), AlbumsView (3.3k), StoriesView (2.2k), VaultView (2k), Lightbox and DashboardView (1.8k), App (1.7k). Split by feature with hooks.

---

## Planned features

### V1 · Vault unlock still offers a "24-word recovery phrase" — `done` (merged 2026-11-12, PR #11, history §121; owner: remove it)
- **Finding:** the mode was unreachable (nothing switched to it); only the "no vault yet" message showed the old wording.
- `VaultView.tsx` (Mode 3, ~line 1299) and `VaultUnlockModal.tsx` (~line 574) offer "Enter your 24-word recovery phrase", and the wizard header comment still describes a 24-word step. Since C3, setup creates an emergency card (card file or 16 numbers) instead, and "Forgot your password? Use your Emergency Card" already covers recovery. Decide: remove the 24-word mode, or relabel it as "card code". Backend `/unlock` still accepts `recovery_phrase` (needed only for vaults created before C3; nobody has one).

## Frontend redesign (started 2026-11-12)

Integration branch `feature/redesign` (master untouched until the end; owner decision). Concept board: https://claude.ai/artifact/XsadhwxNhBkakuUzyR8wPU. Chosen: Mono + acid lime (#C6FF00, black text on it), Archivo headings over Inter, icon rail + photo-first layout with a right-side month/year scrubber, 3D app icon "C · Frosted glass". Approved screens: Photos, Viewer, Private Vault, People, Import + Settings.

### R0 · Tokens, Archivo, app icon — `done` (merged into feature/redesign 2026-11-12, PR #13, history §123)
### R1 · App shell: 64 px icon rail replaces sidebar + title bar — `done` (merged into feature/redesign 2026-11-12, PR #14, history §124; owner: slim strip + Ctrl+K)
### R2 · Photos: whole-library timeline, justified rows (virtualised), big month headings, month/year scrubber — `done` (merged into feature/redesign 2026-11-12, PR #15, history §125; owner: one compact timeline list; also removed the old header's "Search Active" pill / "Clear Search", the year ribbon, and fixed Escape not closing the viewer)
### R3 · Viewer: dark surround, details on demand, 8K chip by the title, lime lock = Move to Vault, Trash set apart — `done` (merged into feature/redesign 2026-11-13, PR #16, history §126; download menu, filmstrip, people/albums in details via new /context endpoint; Q5 split partly done: text helpers moved out, video player and details panel still inside Lightbox.tsx)
### R4 · Vault: calm header (countdown, privacy shield, Lock now), lock card, month timeline with scrubber from 4 months; factory reset moved to Settings → Private Vault → Danger zone — `done` (merged into feature/redesign 2026-11-13, PR #17, history §127; old PhotoGrid removed)
### R5 · People: close ones, "Same person?", "Who is this?" — `done` (merged into feature/redesign 2026-11-13, PR #18, history §128; new merge-suggestion endpoints; rename moved to the person page; vault faces no longer in unnamed groups; Q5 split partly done: overview moved to people/PeopleOverview.tsx, person page still in PeopleView.tsx)
### R6 · Import + Settings — `todo`
### R7 · Not yet designed: Albums, Stories, Documents, Dashboard, Trash, Duplicates, Video optimizer — `todo` (boards first)
- Each step: component tests (deferred from Q3), Playwright on a throwaway library, remaining hard-coded colours of that screen cleaned up.

### P12 · Windows Hello quick unlock — `todo`
- Optional, per PC, on top of the portable master password. Design together with C2 (option B).

## Dropped (owner decision, 2026-11-10)
- ~~Send trash to the Windows Recycle Bin~~: app trash for 30 days, then hard delete, is the intended behaviour.
- ~~Export original / integrity check~~: there is no "export original" in the single-version model.
