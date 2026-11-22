# Backlog

Owner feedback and open tasks, kept until done. New feedback is added the same day; an item is
removed once its fix is merged (the commit and pull request keep the details). Standing
decisions are in `.agents/decisions.md`.

Status: **Next** (to do now), **Owner decision**, **Release blocker**, **Later**.

## Now

| # | Task | Status | Notes |
|---|------|--------|-------|
| T32 | Dashboard redesign | Next | Owner, 2026-11-22: "seems more like the settings page". Mock-up approved; branch `feat/dashboard-redesign`. |

## Next phase (owner, 2026-11-21)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T31 | Graphics card support | Next phase | The engine ships CPU-only ONNX Runtime, so DirectML is never used. Plan: onnxruntime-directml, per-computer speed test (GPU vs CPU) with CPU fallback, shown in Settings; then AI video enhancement on capable GPUs. Needs a PC with a graphics card to test. |

## Found during the release review (2026-11-20)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T18 | The in-app updater has never had an update to install | Owner decision | Releases carry only the installer: no `.sig` or `latest.json`, because the GitHub secret `TAURI_SIGNING_PRIVATE_KEY` is empty and `createUpdaterArtifacts` isn't set (same for v0.1.0). Updating by running the new installer works. Needs the private key matching the public key in `tauri.conf.json` (or a new key pair) added as a secret. |
| T10 | Owner re-check after restarting the desktop app | Next | The one-engine fix needs a fresh start of the app. Then re-check People ("Who is this?" cards stay closed) and the last round of fixes. |
| T11 | `data_location.txt` points the dev app at the JointTest library | Later | Remove it once joint testing is over. It is ignored by git. |

## Later

| # | Task | Status | Notes |
|---|------|--------|-------|
| T13 | Windows Hello quick unlock | Later | Owner: not now. Optional, per PC, on top of the master password. |
| T14 | "Redo improvement" on a photo that already has an improved copy | After this release (owner, 2026-11-21) | Today the "…" menu hides improvements once a photo has a copy; the workaround is What to keep → Keep original, then improve again. Planned: "Try again…" in the viewer's "…" menu on an improved photo: re-runs the improvement on the original with other settings (e.g. the other colour style) and replaces the copy only if the new result is kept. |
| T15 | CI allows npm advisory GHSA-fc5q-39xc-vjpf (picomatch) | Until 2026-12-31 | `scripts/ci/npm-audit-check.mjs`; remove the allowance once picomatch ships a fix. CI fails after the date. |
