# Backlog

Owner feedback and open tasks, kept until done. New feedback is added the same day; an item is
removed once its fix is merged (the commit and pull request keep the details). Standing
decisions are in `.agents/decisions.md`.

Status: **Next** (to do now), **Owner decision**, **Release blocker**, **Later**.

## Next phase (owner, 2026-11-21)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T31 | Graphics card support | Next phase | The engine ships CPU-only ONNX Runtime, so DirectML is never used. Plan: onnxruntime-directml, per-computer speed test (GPU vs CPU) with CPU fallback, shown in Settings; then AI video enhancement on capable GPUs. Needs a PC with a graphics card to test. |

## Found during the release review (2026-11-20)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T18 | The in-app updater has never had an update to install | In progress | Owner chose a new key (2026-11-22): owner creates it and adds the two secrets; branch `feat/updater-signing` adds `createUpdaterArtifacts`, writes `latest.json` in the release build and stops an unsigned release. Waiting for the new public key. |
| T10 | Owner re-check after restarting the desktop app | Next | The one-engine fix needs a fresh start of the app. Then re-check People ("Who is this?" cards stay closed) and the last round of fixes. |
| T11 | `data_location.txt` points the dev app at the JointTest library | Later | Remove it once joint testing is over. It is ignored by git. |

## Later

| # | Task | Status | Notes |
|---|------|--------|-------|
| T13 | Windows Hello quick unlock | Later | Owner: not now. Optional, per PC, on top of the master password. |
| T14 | "Redo improvement" on a photo that already has an improved copy | After this release (owner, 2026-11-21) | Today the "…" menu hides improvements once a photo has a copy; the workaround is What to keep → Keep original, then improve again. Planned: "Try again…" in the viewer's "…" menu on an improved photo: re-runs the improvement on the original with other settings (e.g. the other colour style) and replaces the copy only if the new result is kept. |
