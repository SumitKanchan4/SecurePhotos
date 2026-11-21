# Backlog

Owner feedback and open tasks, kept until done. New feedback is added the same day; an item is
removed once its fix is merged (the commit and pull request keep the details). Standing
decisions are in `.agents/decisions.md`.

Status: **Next** (to do now), **Owner decision**, **Release blocker**, **Later**.

## Found during the release review (2026-11-20)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T9 | The repository must be public for the old-photo model downloads | Release blocker | The installer downloads them from the `models-v1` release; the release pipeline refuses to publish while they need a login. |
| T10 | Owner re-check after restarting the desktop app | Next | The one-engine fix needs a fresh start of the app. Then re-check People ("Who is this?" cards stay closed) and the last round of fixes. |
| T11 | `data_location.txt` points the dev app at the JointTest library | Later | Remove it once joint testing is over. It is ignored by git. |

## Later

| # | Task | Status | Notes |
|---|------|--------|-------|
| T12 | Engine auto-reload hangs in development | Later | Seen once with `tauri dev`: uvicorn logged "Reloading..." and the old engine kept answering. Not reproduced since. Likely a background task blocking shutdown; cancel them on shutdown. |
| T13 | Windows Hello quick unlock | Later | Owner: not now. Optional, per PC, on top of the master password. |
| T14 | "Redo improvement" on a photo that already has an improved copy | Later | Only if wanted. |
| T15 | CI allows npm advisory GHSA-fc5q-39xc-vjpf (picomatch) | Until 2026-12-31 | `scripts/ci/npm-audit-check.mjs`; remove the allowance once picomatch ships a fix. CI fails after the date. |
