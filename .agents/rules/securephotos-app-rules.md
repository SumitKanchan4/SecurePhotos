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
- The installer suggests `<drive>:\SecurePhotos` when a removable drive is plugged in and asks
  once before installing on the computer's own drive. The window's browser profile is kept in
  `data\webview` (`src-tauri/src/library.rs`). Updates install into the folder the app runs
  from, so they replace the copy on the drive on any computer.
- On the computer where the installer ran, Windows keeps a Start-menu entry, a desktop shortcut
  and the uninstall entry; they hold nothing about the library.
- Settings are stored in the database (`app_settings`), so they travel with the drive.

## 2. Any PC, any drive letter
- Paths in SQLite are relative to the library folder: write with `media_paths.to_db_path`,
  read with `media_paths.resolve_stored_path`. Never store a drive letter.
- Nothing has to be installed on the PC first: the engine is installed unpacked in `engine/` (PyInstaller, one folder; it never unpacks into the PC's temp folder), FFmpeg
  and FFprobe are in `bin/`, the small models in `data/models/`, and `WebView2Loader.dll` is
  next to the app. The Visual C++ runtime is linked into the shell and carried by the engine.
  WebView2 itself comes with Windows 10 and 11.
- Every computer the drive has been plugged into is listed in the library (`computers` table,
  `engine/services/computers.py`) with its choice: always does the background work, asks each
  time, or only views. The first time, the app asks once ("Yes, and remember this computer",
  "Just this time", "No, only view here"); Settings → Storage changes it or forgets the
  computer. On a computer that doesn't do the work, heavy automatic work (8K, automatic old-photo
  fixes, automatic videos, vault enhancing) waits. Only a scrambled form of Windows' computer ID
  is stored, and nothing is written to the computer.

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
- The engine runs in a kill-on-close Windows Job Object held by the shell
  (`src-tauri/src/job.rs`), so it stops whenever the app ends, even by a crash or a forced
  close, together with any FFmpeg it started. The engine also watches the app's process
  (`SECUREPHOTOS_PARENT_PID`, `engine/services/parent_watch.py`) and shuts down when it is gone.
  Nothing may be left holding files open on the drive.

## 8. Updates never touch the library
- An update replaces only the program files. The installer and uninstaller never delete
  `data/`; the installer stops a running app and engine before replacing files.

## 9. Drives formatted exFAT or NTFS
- Don't rely on NTFS-only features (alternate data streams, ACLs, hard links).
- Keep file names free of `: * ? " < > |` and keep paths short (sharded folders such as
  `thumbnails/ab/cd/…`) to stay under 260 characters.
