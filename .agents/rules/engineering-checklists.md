---
trigger: always_on
---

# ✅ Engineering Checklists (learned from the November 2026 remediation)

Short, checkable rules. Each one exists because breaking it caused a real bug in this
codebase (backlog item in brackets; details in `.agents/history/features_and_functional_decisions.md`).
Check the relevant list before committing.

## 1. Data safety (user photos are irreplaceable)
- [ ] A source file is deleted **only after** its copy/encrypted version is written, verified, **and** the database change is committed. Crash in between = no loss. (C5, M3)
- [ ] Deleting or changing files goes through `media_paths.resolve_stored_path`, which returns `None` when unsure. Never guess a file by name. (M1, M2)
- [ ] Startup code never copies, moves or deletes user data. (M3)
- [ ] Nothing outside the library folder is ever registered, enhanced, purged or deleted; imports always copy in (`ingest_single_photo` modes `MANAGED` / `IN_LIBRARY`). (M4)
- [ ] Bulk "clean-up" that deletes files lists what it would delete and asks first; it is never a hidden endpoint. (M2)
- [ ] No `except Exception: pass` (or log-and-continue) around a step whose failure loses or corrupts data; fail and keep the original.

## 2. Paths
- [ ] Paths stored in SQLite are relative to the library folder: write them with `media_paths.to_db_path`, read them with `resolve_stored_path` / `settings.data_dir / path`. Never `Path(stored).exists()` (that is relative to the working folder). (M2, M4)
- [ ] Same-name / collision checks compare the stored form (`to_db_path`), never a full path against a relative one. (M2)
- [ ] Never store the text `"None"`: use SQL `NULL`. (M2)

## 3. Responsiveness and concurrency
- [ ] Anything that touches whole files or images (encrypt, decrypt, copy, hash, PIL, ffmpeg/ffprobe, ONNX, Argon2) runs via `asyncio.to_thread` inside `async` code. (H7)
- [ ] Vault file work goes through `work_queues.vault_files()`, imports through `work_queues.imports()`. A repeated request must find the work done and do nothing. (H7)

## 4. Security
- [ ] Security code refuses rather than downgrades: no weaker fallback for randomness, keys or checks. (M5)
- [ ] No secret is stored in plaintext; no dead security feature is left half-wired in the backend. (H3)
- [ ] Engine access needs the IPC token or session cookie; nothing secret goes in URLs. (H1, H6)
- [ ] Vault keys: keep the session key in the `bytearray` and drop it with `purge_vault_key`; do not promise "wiped from RAM" (Python cannot guarantee it). (H4)
- [ ] Vault files use SPENC03 only (per-file key, last-chunk flag, header authenticated). (H2)

## 5. AI models and third-party files
- [ ] Every model is pinned to an upstream commit **and** SHA-256 in `engine/services/ai_models.py`; nothing unverified is loaded. (H8)
- [ ] The installer bundles `build/models` (filled by `scripts/fetch_models.py`), never the live `data/models`. (H8)
- [ ] Only permissively licensed models/fonts; every bundled one has its full licence text in `THIRD_PARTY_NOTICES.md`, which ships with the app. (H9, H8)

## 6. Docs and claims match the code
- [ ] When behaviour changes, update every claim about it: README, `SECURITY.md`, `docs/*.md`, UI copy, code comments. Search for the old wording.
- [ ] No absolute or marketing promises the code can't keep ("military-grade", "bank-grade", "100% offline" when something downloads, "securely wiped").
- [ ] Skills and rules describe what the app does today; future ideas are labelled as such.

## 7. Verification before asking to merge
- [ ] Every fix has a test that **fails on the old code** (run it against the old code, or put the bug back temporarily, then restore).
- [ ] A test that only passes by timing is not a test: make it deterministic. (H7)
- [ ] UI-visible changes are checked with Playwright against a **throwaway library** (`SECUREPHOTOS_DATA_DIR` + separate `USERPROFILE`), never the user's real `data/` folder or browser.
- [ ] Stop every server you started and confirm by process (command line + start time), not only by port: a stopped `npx vite` task can leave its `node` process running.
- [ ] `ruff check .`, the full pytest suite, `npx tsc --noEmit` and (for Rust) `cargo check` pass locally; the GitHub quality check passes on the PR.

## 8. Working with the owner
- [ ] Before starting a task: what it is about, impact, current implementation, proposed solution.
- [ ] Ask **one question at a time**, each self-contained, with options and a recommendation.
- [ ] Plain language in UI copy and in messages to the owner (rule §7 of `strict-approval-and-standards.md`).
