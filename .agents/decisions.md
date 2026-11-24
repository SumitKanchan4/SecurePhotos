# Owner decisions

Decisions that later work must respect. One line each, with the date. When a decision
changes, edit its line; don't add a second one. How things work is in `docs/`; why a fix was
made is in its commit and pull request.

## The product
- The app and the whole library live on one external drive and work on any Windows PC it is plugged into (2026-11-21).
- Every computer the drive is plugged into is listed in the library with one of three choices: always does the background work, asks each time, or only views (heavy work waits for another computer). The first time, the app asks; Settings → Storage changes it or forgets the computer (2026-11-21).
- CPU only: every AI model must run well on an ordinary CPU; a graphics card is an optional speed-up (2026-11-15).
- Everything works offline; downloads are only the update check and the old-photo models (2026-11-15).
- The library is always the `data` folder next to the app; the app offers no way to open a library elsewhere. A backup is restored by copying its `data` folder back (2026-11-21).
- The repository is public (2026-11-21). The old-photo models are in the `models-v1` release, which must never become "latest" (the updater reads the latest release).
- Updates are signed with a new key made 2026-11-22 (the first key was lost). The owner keeps the private key and its password; they are only in the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, never in the repository. A public release stops if the installer isn't signed or `latest.json` is missing. People on 0.2.0 run the next installer by hand once.
- The installer uses our copy of Tauri's NSIS template (`src-tauri/nsis/installer.nsi`, from tauri-cli 2.11.4) only to replace the uninstaller's "Delete the application data" checkbox with a note on what stays (T34, 2026-11-24). When @tauri-apps/cli is updated, take its new template and repeat the two marked changes.
- A release (version, installer, tag) waits for the owner's final go-ahead (2026-11-20).
- Licence: MIT, copyright Sumit Kanchan. No plan to sell; donations may come later. The installer shows a short plain page (your photos are yours, keep backups, the vault, no warranty) and the MIT text (2026-11-21).
- GFPGAN (Sharpen blurry faces) stays: the app is free and not sold, which fits its non-commercial parts and FFHQ. If SecurePhotos is ever sold, face sharpening must be reviewed first (2026-11-21).

## Photos and videos
- Imports copy into the library. "Remove the originals after importing" is off by default (2026-11-18).
- Improvements are always new copies linked to the original; the original is kept while "Keep original" is on. One tile per original and its copies; deleting the tile trashes them all (2026-11-18).
- Try again (approved mock-up, 2026-11-22): redoes all of a copy's fixes from the original in one job; the person compares with the current copy and chooses "Use the new one" (the current copy goes to Trash, its favourite, caption, albums and faces carry over; Undo swaps back) or "Keep the current one". Never kept automatically; the remembered keep choice doesn't apply.
- Trash keeps items for 30 days, then deletes them for good; the Windows Recycle Bin is not used (2026-11-10).
- After an import: the quick steps (text, faces, old-print check, duplicates) for every new photo first, then 8K one photo at a time, least work first; videos after the photos (2026-11-19).
- Photo size: Auto (default) / 2K / 4K / 8K; Auto gives photos of 6 MP and up 8K and smaller ones 4K. Video size: Auto (default, = HD) / as recorded / HD / 2K / 4K; videos are resized, not AI-enlarged, and never go above 4K (2026-11-21).
- Library enhancement is a resize plus sharpen on a CPU; the 8K print-ready copy uses Real-ESRGAN. Graphics card support (and AI enhancement for the library) is a later phase (2026-11-21).
- Photos still being prepared show their steps' icons taking turns and a ring bottom-left; tags show once done (2026-11-19).

## People
- No stricter automatic face filter: it also drops real faces. "Not a face" is remembered instead (2026-11-18).
- Groups are not merged more readily: siblings can look more alike than one person's own faces (2026-11-21).

## Vault
- The Emergency Card (image or its 16 numbers) is the only way back in after a forgotten password; there is no back door (2026-11-11).
- The 4-digit PIN reopens the vault only while the app stays open (2026-11-11).
- Windows Hello: not now (2026-11-15).
- Photos can be added straight to the vault. "Remove the originals" is on by default for the vault (Settings → Vault), shown and changeable on each import (2026-11-21).

## Look and words
- Dashboard (approved mock-up, 2026-11-22): the library sentence and newest photos, one storage line (detail stays in Settings › Storage), then tiles On this day, Just added, Brought back, People, Your year, and Worth doing. On this day and Just added are left out when empty; Brought back, People and Your year then invite you to start (Add photos / Open People), and Brought back shows the improved photo alone once no original is left. Worth doing always shows its four cards in the same order, each with the space it frees or "All good" (owner, 2026-11-22).
- Mono + acid lime design (`docs/design_system.md`). Background work is reached from the rail's ring and the header pill, not a rail item (2026-11-16).
- Plain, human words on screen and in documents; no technical terms, no marketing words, no em dashes (2026-11-20).
- The public roadmap was removed (2026-11-20).

## Housekeeping
- No npm advisory exceptions in CI. The picomatch one (GHSA-fc5q-39xc-vjpf) was removed after GitHub withdrew the advisory (2026-11-22).
