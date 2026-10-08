---
trigger: always_on
---

# 🛡️ SecurePhotos Application & Portable Vault Architecture Rules

## 1. Primary Target: 100% Self-Contained External Disk Vault
- **Primary Deployment Target**:
  - SecurePhotos is engineered primarily to live, execute, and store all user assets directly on an **external portable drive** (high-speed portable SSD, external hard disk, or USB 3.2 drive).
  - The entire application—including GUI binaries, engine sidecar, SQLite database, sharded thumbnail trees, display previews, AI model weights, and encrypted zero-trust vaults—must reside on the external drive.
- **Strict Host Machine Isolation (Zero Host Pollution)**:
  - **CRITICAL**: The application must **NEVER** write or leave user media, SQLite databases, thumbnails, encryption keys, or private artifacts on the host machine's `C:\` drive, `%APPDATA%`, `%LOCALAPPDATA%`, `C:\Users\<user>\AppData`, or user home directories (`~/.securephotos_data`).
  - When the drive is unplugged, **zero trace** of the user's media collection, database records, search history, or decryption state must remain on the host computer.
  - All temporary files, encoding scratch buffers, and thumbnail caches must be written strictly to `<drive>/data/tmp/` or relative application scratch directories.

---

## 2. Universal Multi-Device Plug-and-Play & Dynamic Drive Letter Independence
- **Seamless Multi-PC Mobility**:
  - The external drive is expected to be plugged into multiple different machines (e.g. Work PC, Home Desktop, Laptop, Azure VM, offline workstations).
  - The application must execute instantly on any host machine simply by launching the executable directly from the external drive root or application folder without prior system setup.
- **Dynamic Drive Letter Normalization**:
  - On Windows, plugging an external drive into different PCs or different USB ports assigns dynamic, unpredictable drive letters (e.g., `D:\`, `E:\`, `F:\`, `Z:\`).
  - **MANDATORY HARD RULE**: All paths recorded in SQLite (`securephotos.db`)—including media `filepath`, `thumbnail_path`, `preview_path`, and encrypted vault items—**MUST BE STORED RELATIVE TO THE PORTABLE DRIVE ROOT** (e.g. `data/originals/2026/photo.jpg`), or dynamically remapped on application boot to the currently active volume root.
  - **NEVER hardcode absolute drive letters like `E:\data\...` into the database**. If the drive mounts as `F:\` on another PC, all assets must resolve without path breakage.

---

## 3. Fully Bundled Self-Contained Prerequisites (Zero Host Setup)
- **Zero Host Installation Requirement**:
  - A user must **NEVER** be required to install Python, Node.js, C++ build tools, Git, or administrative packages on the host machine before running SecurePhotos.
  - The external disk must bundle all required runtimes and prerequisites:
    1. **Standalone Engine Sidecar**: Frozen standalone executable (`securephotos-engine.exe`) containing the complete Python runtime, FastAPI, Uvicorn, ONNXRuntime, and dependencies.
    2. **Bundled Visual C++ Runtime DLLs**: The required MSVC runtime libraries (`vcruntime140.dll`, `msvcp140.dll`, `vcruntime140_1.dll`) must reside alongside the application executable on the drive. Because Windows checks the application folder first in its DLL search order, this guarantees the engine launches even on clean machines or Windows Server images lacking the system-wide VC++ Redistributable.
    3. **Bundled Media Binaries**: Standalone FFmpeg and FFprobe binaries in `<drive>/bin/` for transcoding, thumbnail extraction, and video streaming.
    4. **Offline AI Models**: All facial embedding vectors, OCR models, and super-resolution weights bundled directly in `<drive>/data/models/`.
    5. **Native GUI Runtime**: WebView2 loader bundled in `<drive>/WebView2Loader.dll`.

---

## 4. Universal Media Availability (Always Accessible Everywhere)
- **100% Offline Availability**:
  - Wherever the external disk is connected, all imported images, 4K videos, documents, face clusters, albums, and cinematic stories must be immediately viewable and searchable.
  - Zero cloud reliance: The application must operate with 100% functionality with zero internet connectivity.
- **Drive-Centric Media Ingestion**:
  - When media is imported from a host machine or SD card, the primary master copy must be safely ingested into the external drive's library storage (`data/originals/` or target drive folders), never left solely on the host computer.
  - The database, sharded thumbnail trees (`data/thumbnails/`), and display previews (`data/previews/`) reside strictly on the drive.

---

## 5. Zero-Trust Local IPC API Authorization (Strict Request Verification)
- **Hardened Local API Guard**:
  - The background engine must strictly bind to local loopback (`127.0.0.1`) with a dynamic ephemeral port. It must NEVER bind to `0.0.0.0` or expose ports to the local network / Wi-Fi.
  - **Only legitimate SecurePhotos application requests are authorized to receive data or stream media**:
    1. **Ephemeral Shared Secret**: On startup, Tauri Rust generates a cryptographically secure 256-bit token (`SECUREPHOTOS_IPC_SECRET`) passed in-memory to the engine process.
    2. **Mandatory Token / Handshake Validation**: The engine enforces `LocalIPCSecurityMiddleware` on all endpoints. Requests must provide either the `X-SecurePhotos-Token` header or a valid session cookie established during mutual handshake.
    3. **Rejection of Unauthorized Calls**: Any unauthorized process, external network probe, or rogue browser tab accessing the engine port must be rejected immediately with `401 Unauthorized` or `403 Forbidden`.
    4. **Zero Telemetry**: No telemetry, analytics, or pinging to external servers is permitted.

---

## 6. Hot-Unplug Safety & Transactional Durability
- **Abrupt Drive Removal Resilience**:
  - Users may disconnect external drives without ejecting.
  - SQLite must run with WAL mode (`PRAGMA journal_mode=WAL`) and controlled transaction checkpointing (`PRAGMA synchronous=NORMAL`) to protect against database corruption during unexpected removal.
  - Write transactions must be kept small and atomic. Long-running open write locks are strictly prohibited.
  - The frontend must dynamically monitor volume connectivity (`activeVolume`, `get_system_drives`):
    - If drive disconnection is detected, immediately suspend disk write queues and display a prominent, reassuring "Drive Offline" shield.
    - When the drive is reconnected, automatically re-synchronize without crashing the app.

---

## 7. In-Place Upgrades & Non-Destructive Update Guarantee (Zero Data Loss)
- **Separation of Application Binaries vs. User Vault Data**:
  - Application binaries (`SecurePhotos.exe`, `securephotos-engine.exe`, `bin/`) and user data (`data/database/`, `data/thumbnails/`, `data/originals/`, `data/vault/`) must remain strictly decoupled.
- **In-Place Non-Destructive Upgrades**:
  - Updating the app on the external disk must **NEVER** run an uninstallation flow that deletes user data or prompts to wipe folders (`RMDir /r $INSTDIR` must never wipe `data/`).
  - Upgrades must overwrite only the application binaries in-place, permanently preserving all existing databases, face tags, albums, and encrypted vault contents.
  - If the user re-installs or moves the application folder to a new path on the drive, the system must detect existing databases in `data/` and attach seamlessly rather than initializing an empty database.

---

## 8. Clean Process Termination & Eject Lock Release
- **No Background Process Hangs**:
  - When the user closes the SecurePhotos window, all background processes (`SecurePhotos.exe`, `securephotos-engine.exe`, FFmpeg workers) must terminate immediately and cleanly.
  - Open file handles on the external drive must be released within milliseconds.
  - If a process hangs open on the drive, Windows blocks ejection with *"The device is currently in use"*, forcing dirty unplugs.
- **Parent-Process Death Watch & Job Objects**:
  - The Rust Tauri host process must register the engine child process inside a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
  - The Python engine must maintain a heartbeat parent-PID monitor that immediately calls `sys.exit(0)` if the parent Tauri process exits or crashes.

---

## 9. Zero Windows Registry & Host OS Configuration Dependency
- **Portable State Persistence**:
  - The application must NEVER store critical user preferences, vault configurations, encryption salts, or library paths in the Windows Registry (`HKCU\Software\...` or `HKLM\Software\...`).
  - All configurations, user preferences, and vault metadata must be stored locally in `<drive>/data/config.json` or `securephotos.db`.
  - Moving the drive to a different machine must preserve 100% of the user's settings, pinned albums, favorites, and vault state without reconfiguration.

---

## 10. Cross-Platform File System Compatibility (exFAT, NTFS, FAT32)
- **Filesystem-Agnostic File Handling**:
  - External drives are frequently formatted as `exFAT` or `NTFS` for cross-platform portability between Windows, macOS, and Linux.
  - Code must NOT rely on NTFS-only features such as Alternate Data Streams (ADS), Windows Access Control Lists (ACLs), or hard links.
  - File and folder naming must sanitize illegal Windows characters (`:`, `*`, `?`, `"`, `<`, `>`, `|`) and maintain cross-filesystem case insensitivity.
  - Avoid exceeding Windows `MAX_PATH` (260 characters) by keeping sharded thumbnail and preview folder structures compact (e.g. `data/thumbnails/ab/cd/hash.webp`).

---

## 11. Drive Sleep & Spin-Down Latency Tolerance
- **HDD Spin-Up Resilience**:
  - External mechanical hard drives and power-saving external SSDs enter low-power sleep states after periods of inactivity.
  - When a user clicks a photo or searches after an idle period, spinning up the drive can take 2 to 5 seconds.
  - The frontend and backend must accommodate this latency gracefully with responsive loading skeletons and retry mechanisms, rather than timing out or falsely flagging assets as missing.
