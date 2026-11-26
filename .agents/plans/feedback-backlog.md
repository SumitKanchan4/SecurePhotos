# Backlog

Owner feedback and open tasks, kept until done. New feedback is added the same day; an item is
removed once its fix is merged (the commit and pull request keep the details). Standing
decisions are in `.agents/decisions.md`.

Status: **Next** (to do now), **Owner decision**, **Release blocker**, **Later**.

## Next phase (owner, 2026-11-21)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T35 | AI enlarging for videos | Later idea (owner, 2026-11-24) | About 10–30 minutes per minute of video even on built-in graphics; only practical with a separate graphics card, which we can't test yet. Videos keep the resize to HD/2K/4K. |

## Found during the release review (2026-11-20)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T11 | `data_location.txt` points the dev app at the JointTest library | Later | Remove it once joint testing is over. It is ignored by git. |

## Later

| # | Task | Status | Notes |
|---|------|--------|-------|
| T13 | Windows Hello quick unlock | Later | Owner: not now. Optional, per PC, on top of the master password. |
