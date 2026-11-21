# Backlog

Owner feedback and open tasks, kept until done. New feedback is added the same day; an item is
removed once its fix is merged (the commit and pull request keep the details). Standing
decisions are in `.agents/decisions.md`.

Status: **Next** (to do now), **Owner decision**, **Release blocker**, **Later**.

## Portable app (owner, 2026-11-21)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T2 | The app installs on the external drive | Next | Today the installer installs for the current user and suggests a folder on C:; the library goes next to the program (`<app folder>/data`), so it lands on C: too. Wanted: install into a folder on the drive, library beside it. Also move the WebView2 profile from `%LOCALAPPDATA%\com.securephotos.app` into the library, so nothing is left on the PC. Check: updates still replace only the program files; the uninstaller keeps `data/`. |
| T3 | The drive is plugged into another PC | Next | Agreed with the owner (2026-11-21, revised the same day: several computers can be remembered). The first time the library is opened on a computer it doesn't know, ask once: "Do background work on this computer?" 1. "Yes, and remember this computer" (work runs here every time; any number of computers); 2. "Yes, just this time" (asks again next time); 3. "No, only view here" (viewing and importing work; heavy work such as 8K, old photos and videos waits until the drive is on a remembered computer, with a quiet note saying so). Settings → Storage lists "Computers that do the background work": each computer's name and when it was last used, "This computer" marked, and "Stop using" for each. Remembered in the library, never on the computer. Separate PR from T2. |

## Found during the release review (2026-11-20)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T4 | Dashboard counts originals and their improved copies separately | Next | 21 photos in Photos, "30 photos" on the Dashboard. Count one per tile, as the library does (`stack_top()`). |
| T5 | A foggy colour photo was taken for a faded old print | Next | The old-print check added colour to a foggy beach photo. Tighten the check; keep both versions as today. |
| T6 | A video enhanced by hand from Big videos doesn't wait for the heavy-work slot | Next | It can run beside 8K work. It should take the slot with the user's priority. |
| T7 | EULA vs MIT licence | Owner decision | The EULA grants a personal, non-transferable, revocable licence; README and LICENSE say MIT. Pick one. |
| T8 | GFPGAN licence note | Owner decision | THIRD_PARTY_NOTICES still says "revisit before the app is sold or the repository is made public" (NVIDIA non-commercial terms in its dependencies). |
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
