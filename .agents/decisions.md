# Owner decisions

Decisions that later work must respect. One line each, with the date. When a decision
changes, edit its line; don't add a second one. How things work is in `docs/`; why a fix was
made is in its commit and pull request.

## The product
- The app and the whole library live on one external drive and work on any Windows PC it is plugged into (2026-11-21).
- Every computer the drive is plugged into is listed in the library with one of three choices: always does the background work, asks each time, or only views (heavy work waits for another computer). The first time, the app asks; Settings → Storage changes it or forgets the computer (2026-11-21).
- CPU only: every AI model must run well on an ordinary CPU; a graphics card is an optional speed-up (2026-11-15).
- Everything works offline; downloads are only the update check and the old-photo models (2026-11-15).
- One library open at a time. "Open a library folder" switches to another and restarts the app; there is no "connect a second library" (2026-11-17).
- The repository stays private until the app is stable; model downloads (the `models-v1` release) only work once it is public (2026-11-17).
- A release (version, installer, tag) waits for the owner's final go-ahead (2026-11-20).
- Licence: MIT, copyright Sumit Kanchan. No plan to sell; donations may come later. The installer shows a short plain page (your photos are yours, keep backups, the vault, no warranty) and the MIT text (2026-11-21).
- GFPGAN (Sharpen blurry faces) stays: the app is free and not sold, which fits its non-commercial parts and FFHQ. If SecurePhotos is ever sold, face sharpening must be reviewed first (2026-11-21).

## Photos and videos
- Imports copy into the library. "Remove the originals after importing" is off by default (2026-11-18).
- Improvements are always new copies linked to the original; the original is kept while "Keep original" is on. One tile per original and its copies; deleting the tile trashes them all (2026-11-18).
- Trash keeps items for 30 days, then deletes them for good; the Windows Recycle Bin is not used (2026-11-10).
- After an import: the quick steps (text, faces, old-print check, duplicates) for every new photo first, then 8K one photo at a time, least work first; videos after the photos (2026-11-19).
- Photo size: 2K / 4K / 8K, default 8K. Video size: as recorded / HD / 2K / 4K, default HD. Videos never go above 4K (2026-11-19).
- Photos still being prepared show their steps' icons taking turns and a ring bottom-left; tags show once done (2026-11-19).

## People
- No stricter automatic face filter: it also drops real faces. "Not a face" is remembered instead (2026-11-18).
- Groups are not merged more readily: siblings can look more alike than one person's own faces (2026-11-21).

## Vault
- The Emergency Card (image or its 16 numbers) is the only way back in after a forgotten password; there is no back door (2026-11-11).
- The 4-digit PIN reopens the vault only while the app stays open (2026-11-11).
- Windows Hello: not now (2026-11-15).

## Look and words
- Mono + acid lime design (`docs/design_system.md`). Background work is reached from the rail's ring and the header pill, not a rail item (2026-11-16).
- Plain, human words on screen and in documents; no technical terms, no marketing words, no em dashes (2026-11-20).
- The public roadmap was removed (2026-11-20).

## Housekeeping
- CI allows npm advisory GHSA-fc5q-39xc-vjpf (picomatch, dev tooling only) until 2026-12-31 (2026-11-17).
