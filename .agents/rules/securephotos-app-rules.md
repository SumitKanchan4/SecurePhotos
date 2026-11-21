---
trigger: always_on
---

# SecurePhotos: portable app and library rules

The idea behind the app: **the app and the whole library live on one external drive.** The
owner plugs the drive into any Windows PC and carries on viewing, importing and improving
photos. Every rule below serves that idea. Where the code does not do something yet, the rule
says so and names the task in `.agents/plans/feedback-backlog.md`; don't describe it as built.

## 1. Everything on the drive
- The app is installed into a folder on the drive, and the library sits next to it in
  `<app folder>/data` (`engine/config.py`). `SECUREPHOTOS_DATA_DIR` and `data_location.txt`
  exist for development and tests only.
- The app writes user data only inside the library: photos, the database, thumbnails, previews,
  face pictures, models, the vault and temporary files. Never `%APPDATA%`, `%LOCALAPPDATA%`,
  the user's home folder or the registry.
- **Not built yet (T2):** the installer installs for the current user and suggests a folder on
  C:, and the WebView2 profile goes to `%LOCALAPPDATA%\com.securephotos.app`. Both should be
  on the drive.
- Settings are stored in the database (`app_settings`), so they travel with the drive.

## 2. Any PC, any drive letter
- Paths in SQLite are relative to the library folder: write with `media_paths.to_db_path`,
  read with `media_paths.resolve_stored_path`. Never store a drive letter.
- Nothing has to be installed on the PC first: the engine is one program (PyInstaller), FFmpeg
  and FFprobe are in `bin/`, the small models in `data/models/`, and `WebView2Loader.dll` is
  next to the app. WebView2 itself comes with Windows 10 and 11.
- **Not built yet (T3):** on a PC the library hasn't seen, ask once whether to do background
  work there: make it the main computer, just this time, or only view (heavy work waits for the
  main computer). Known PCs are remembered in the library, never on the PC.

## 3. Offline
- Everything works without the internet. The app goes online only to check for an update and,
  if the installer couldn't, to download the old-photo models (each checked by SHA-256).
- No telemetry or analytics.

## 4. Imports copy into the library
- An import always copies into the library (`ingest_single_photo`); the original is removed
  only if the user turns on "Remove the originals after importing", and only after the copy is
  checked. Nothing outside the library is changed.

## 5. The engine is reachable only by the app
- It listens on 127.0.0.1 on a port chosen at start-up, never on the network.
- Every request needs the access token (`X-SecurePhotos-Token`) or the session cookie from
  `POST /api/auth/handshake`; anything else gets 403. The token comes from the OS random source;
  if it can't be made, the engine isn't started.

## 6. Unplugging without ejecting
- SQLite runs in WAL mode with `synchronous=NORMAL`; write transactions are short.
- The app watches the drive (`DriveStatusBanner`), shows when it is gone and carries on when it
  is back.
- Slow drives that are waking up must not make photos look missing: show loading, retry.

## 7. One engine, and it stops with the app
- Only one engine runs per library. The shell starts it under `start_lock` and never while its
  engine is still alive.
- When the window closes, the shell stops the engine, so Windows can eject the drive.
- **Not built yet (T1):** if the app crashes or is killed, the engine keeps running and holds
  files on the drive open. The engine must stop as well (Windows Job Object with
  kill-on-close in the shell, and the engine exiting when its parent process is gone).

## 8. Updates never touch the library
- An update replaces only the program files. The installer and uninstaller never delete
  `data/`; the installer stops a running app and engine before replacing files.

## 9. Drives formatted exFAT or NTFS
- Don't rely on NTFS-only features (alternate data streams, ACLs, hard links).
- Keep file names free of `: * ? " < > |` and keep paths short (sharded folders such as
  `thumbnails/ab/cd/…`) to stay under 260 characters.
