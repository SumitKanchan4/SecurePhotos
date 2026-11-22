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
| T33 | First real in-app update | After the next two releases (owner, 2026-11-22) | T18 signs updates with the new key (test build v0.2.1 verified: signature, tampering refused, latest.json). People on 0.2.0 install the next release by hand. When the release after that is out, update from inside the app on the owner's PC and check it before announcing. |
| T10 | Owner re-check after restarting the desktop app | Next | The one-engine fix needs a fresh start of the app. Then re-check People ("Who is this?" cards stay closed) and the last round of fixes. |
| T11 | `data_location.txt` points the dev app at the JointTest library | Later | Remove it once joint testing is over. It is ignored by git. |

## Later

| # | Task | Status | Notes |
|---|------|--------|-------|
| T13 | Windows Hello quick unlock | Later | Owner: not now. Optional, per PC, on top of the master password. |
