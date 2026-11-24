# Backlog

Owner feedback and open tasks, kept until done. New feedback is added the same day; an item is
removed once its fix is merged (the commit and pull request keep the details). Standing
decisions are in `.agents/decisions.md`.

Status: **Next** (to do now), **Owner decision**, **Release blocker**, **Later**.

## Next phase (owner, 2026-11-21)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T31b | Graphics card part 2: AI enlarging for the library and video | Next phase | Part 1 (graphics card for the existing AI steps, per-computer speed test, Settings) is done. Real-ESRGAN measured 3.7× faster on a built-in Radeon: AI enhancement of the whole library and AI video enhancement on computers whose card is fast enough. |

## Found during the release review (2026-11-20)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T10 | Owner re-check after restarting the desktop app | Next | The one-engine fix needs a fresh start of the app. Then re-check People ("Who is this?" cards stay closed) and the last round of fixes. |
| T11 | `data_location.txt` points the dev app at the JointTest library | Later | Remove it once joint testing is over. It is ignored by git. |

## Later

| # | Task | Status | Notes |
|---|------|--------|-------|
| T13 | Windows Hello quick unlock | Later | Owner: not now. Optional, per PC, on top of the master password. |
