# 🚀 SecurePhotos - Product Roadmap

Here is what we are planning and exploring for future versions of SecurePhotos.

---

## 1. In-App Vault Export & Guided Off-Boarding / Uninstaller Wizard

### Overview
A guided, 1-click wizard located inside **Settings &rarr; App & Storage** allowing users to safely decrypt, export, and decommission their media library or application on any machine (primary PC or secondary portable machine).

### Problem Statement
* When SecurePhotos is installed on an external drive (e.g. `E:\SecurePhotos`) and connected to a second PC, Windows Settings / Control Panel does not list the application in "Add or Remove Programs" because the registry was never written on that machine.
* Non-technical users might attempt to manually delete the application folder from the external drive without realizing that their photos inside the Vault remain AES-256 encrypted.
* Without the running application and user password, encrypted `.enc` files become permanently inaccessible.

### Proposed Capabilities
1. **1-Click Batch Vault Decryption**:
   - Prompts the user for their vault password / PIN / biometric / 24-word recovery phrase.
   - Decrypts all chunked AES-256-GCM photos back into standard unencrypted formats (JPEG, PNG, HEIC, MP4) directly into a user-selected destination directory.
   - Verifies SHA-256 checksums on all exported files to ensure zero data corruption.
2. **Selective Cache & Model Cleanup**:
   - Option to purge AI vision models (OCR, MobileCLIP, face recognition) and thumbnail/proxy caches to free up multi-gigabyte storage on external drives.
3. **Graceful Application Decommissioning**:
   - Directly executes the bundled `uninstall.exe` or performs a clean removal of application executables while confirming that the user's exported media is safe.

---

## 2. Multi-Vault Management & Dynamic External Drive Hot-Plugging

### Overview
Enable Seamless switching between multiple independent vaults across different external hard drives and local volumes.

### Capabilities
1. **Dynamic Drive Mount Listener**:
   - Native OS listeners (via Tauri `tauri-plugin-fs` or Win32 volume notification APIs) that detect when external SSDs (e.g., `Samsung_T7`, `SanDisk_Extreme`) are plugged in or unplugged.
   - Automatically pauses ingestion and AI super-resolution pipelines when the target drive is disconnected, preventing I/O corruption.
2. **Library / Vault Profile Switcher**:
   - Allow users to create and toggle between multiple vaults (e.g., `Family Archive (E:\)`, `Client Work (D:\)`, `Private Vault (F:\)`).
   - Each vault carries its own self-contained SQLite database and Argon2id wrapped master keys right on the drive root (`<drive>:\.securephotos_vault\`).

---

## 3. Automated Backup & Recovery Health Checks

### Overview
Proactive data preservation and disaster-recovery tooling built directly into the desktop dashboard.

### Capabilities
1. **24-Word Recovery Phrase Verification**:
   - Periodic interactive check prompting the user to re-verify their 24-word BIP-39 recovery phrase to ensure they have physically documented it.
2. **Database Integrity & WAL Snapshot Exports**:
   - Automated scheduled snapshots of `securephotos.db` with SQLite integrity checks (`PRAGMA integrity_check;`) before major updates.

---

## 4. Zero-Trust Mobile Companion App (Secure Remote Viewing & Ingestion)

### Overview
A companion mobile application (iOS & Android) that enables users to securely browse, search, and view photos served from their home desktop application over the internet with zero threat of external intruder access or network sniffing.

### Threat Model & Defense Principles
* **Threat 1: Public Internet Port Scanning & Exploitation**:
  - *Defense*: **Zero Inbound Open Ports**. The desktop never opens listening ports or uses router UPnP. Connections are established via outbound-only encrypted peer-to-peer tunnels (Noise Protocol / WireGuard or WebRTC DataChannels with STUN/TURN).
  - *Result*: The desktop remains completely invisible to automated port scanners (Shodan, Censys) and botnet attacks.
* **Threat 2: Man-in-the-Middle (MitM) & Network Interception**:
  - *Defense*: **Physical QR-Code Pairing Ceremony**. Pairing requires physically scanning an ephemeral QR code displayed on the desktop screen. Keys are exchanged via Mutual TLS (mTLS) with per-device Ed25519 cryptographic identity. No untrusted device can negotiate a connection.
* **Threat 3: Cloud Relay Breach / Compromise**:
  - *Defense*: **End-to-End Encryption (E2EE)**. Any intermediary relay or signaling server only sees opaque, authenticated ciphertext (ChaCha20-Poly1305 / AES-256-GCM). Zero photo data or metadata is ever readable in transit.
* **Threat 4: Vault Media Exposure**:
  - *Defense*: **Client-Side Zero-Knowledge Decryption**. Encrypted vault photos are streamed over the wire in their raw encrypted `.enc` chunk format. Decryption occurs strictly inside volatile RAM on the phone after local FaceID / Biometric authentication.
* **Threat 5: Stolen or Lost Mobile Device**:
  - *Defense*: **Instant Desktop Session Revocation**. The desktop application features a 1-click *"Revoke Mobile Device"* kill-switch that rotates session keys and terminates all remote access immediately.

### Additional Key Mobile Architectural Capabilities
1. **Local LAN Auto-Discovery**:
   - Automatically detects when the phone is on the same home Wi-Fi via mDNS, bypassing internet relays for maximum gigabit LAN transfer speeds.
2. **Adaptive Bandwidth & Cellular Data Guard**:
   - On cellular networks, streams lightweight on-the-fly WebP/AVIF proxies (100-300 KB). Full-resolution 4K/RAW originals stream only on explicit demand or over Wi-Fi.
3. **Screen Capture & Recording Shield**:
   - Mobile client enables OS-level privacy protections (`FLAG_SECURE` on Android, `isCaptured` shielding on iOS) to prevent other malicious mobile apps from taking screenshots of unlocked vault photos.
4. **Technology Stack**:
   - **Tauri 2.0 Mobile (React + Rust)**: Enables 90% code reuse of existing UI design tokens, virtualized photo grids (`@tanstack/react-virtual`), and cryptographic Rust primitives.

---

## 5. Video Face Recognition, In-Playback Cast Overlay & Multimodal Video Search

### Overview
Expand SecurePhotos' on-device facial recognition and semantic indexing to video media. By intelligently sampling keyframes across video streams, the system identifies all individuals appearing in each video clip, enables face-based video search, and displays an interactive, frosted liquid-glass "Cast in this Video" overlay during playback in the Lightbox.

### Architectural Blueprint & Feasibility Analysis
1. **Adaptive Temporal Keyframe Sampling (Zero CPU Melt)**:
   - *Problem*: A 1080p 60fps 5-minute home video contains 18,000 frames. Decoding and running neural face embeddings on every individual frame would freeze the machine and drain massive power.
   - *Solution*: Extract lightweight candidate frames using FFmpeg scene cut detection combined with a 2-3 second interval cap:
     ```bash
     ffmpeg -i input.mp4 -vf "select='gt(scene,0.3)+not(mod(n,75))',scale=1280:-1" -vsync vfr -q:v 2 temp_frame_%04d.jpg
     ```
   - For a 1-minute clip, this yields approximately 15-25 highly representative frames, completing face detection in under 1.5 seconds on background CPU/DirectML.
2. **Temporal Face Tagging & Database Relational Model**:
   - Enhance the `faces` table with an optional `video_timestamp_secs REAL` field indicating the exact second of appearance.
   - When a face is recognized, associate it with the parent video (`photo_id`) and assign it to the matching `person_id`.
3. **Interactive In-Playback Cast Overlay (`Lightbox.tsx`)**:
   - In the Lightbox video player, render a floating, frosted liquid-glass pill container: `[ 👥 In this video: (Avatar 1) (Avatar 2) ... ]`.
   - Hovering over an avatar reveals the person's name and confidence score.
   - Clicking an avatar automatically seeks the `<video>` player to that person's first or primary appearance timestamp (`video.currentTime = face.video_timestamp_secs`).
4. **Unified Person Search Integration (`SearchModal.tsx` & `/api/search`)**:
   - Searching a person's name (e.g., *"Mom"*, *"Alex"*, *"David"*) returns video clips featuring that person right alongside photos, with a `▶ [duration]` badge indicating a video appearance.

---

## 6. Dynamic "Live Albums" (Auto-Updating Rule-Based Smart Albums)

### Overview
Empower users to create dynamic, rule-based "Live Albums" (similar to Google Photos Live Albums / Apple Photos Smart Albums) that automatically populate and keep themselves updated whenever matching photos or videos are imported or newly recognized.

### Architectural Blueprint & Feasibility Analysis
1. **Rule Engine & Schema Extension**:
   - Add a `rules_json` column to the `albums` table:
     ```json
     {
       "type": "live",
       "match_operator": "ANY",
       "person_ids": [4, 12],
       "media_types": ["photo", "video"],
       "include_dates": { "start": null, "end": null }
     }
     ```
2. **Automatic Population via Reactive Ingestion Hooks**:
   - Whenever `face_scan_worker.py` clusters or labels a new face, or when a user renames/merges a cluster in `PeopleView.tsx`, the engine checks active Live Album rules.
   - Any newly matched photo or video is automatically inserted into `photo_album` for that album.
   - Conversely, if a photo is untagged or deleted, triggers automatically maintain synchronization.
3. **Real-Time Co-Occurrence Albums**:
   - Users can create targeted co-occurrence albums, such as *"Emma & Grandfather Together"* (`match_operator: "ALL"`), which selectively filters only media where both individuals appear in the same frame.
4. **Dynamic Editorial Cover Auto-Selection**:
   - If the user hasn't explicitly locked a custom cover photo, the Live Album dynamically sets its cover to the latest high-affinity, high-resolution portrait from the matched media.

---

## 7. Volume-Aware Source Media Cleanup & Drive Portability ("Free Up Source Space")

### Overview
Provide an intelligent, post-import storage optimization tool that enables users to delete original source files (from external hard drives, SD cards, or camera storage) to reclaim disk space after their photos and videos have been safely organized inside SecurePhotos.

### Problem Statement & Portability Challenges
* During ingestion, users frequently select standard "Copy" mode (leaving originals in place on their external drive or SD card) rather than destructive "Move" mode.
* Weeks or months later, or when preparing an external drive for a new photoshoot, the user wishes to free up space on that source device without manually cross-referencing which files were already imported.
* **Windows Drive Letter Volatility**: Windows assigns logical drive letters (`D:\`, `E:\`, `F:\`) dynamically based on plug order. An external drive that was `E:\` on Desktop-1 might mount as `F:\` on Desktop-2, or become `G:\` after a system reboot with a USB flash drive inserted.
* Blindly executing file deletions against static paths stored in `photos.original_path` risks targeting an entirely wrong drive or failing with `FileNotFoundError`.

### Architectural Blueprint & Zero-Trust Safety Pipeline
1. **Hardware Volume UUID Resolution (`engine/volume_tracker.py`)**:
   - Every imported photo, video, and document already has its physical volume serial number captured in `photos.volume_uuid` (extracted via Win32 `kernel32.GetVolumeInformationW`).
   - When source cleanup is triggered for an album, timeframe, or device, the engine calls `resolve_drive_by_serial(photo.volume_uuid)` to locate the active drive letter currently assigned to that physical device on the running machine.
   - If the drive is disconnected, the UI prompts: *"Please connect external volume [Volume Name / Serial] to proceed."*
2. **Dynamic Drive-Relative Path Reconstitution**:
   - The source path is safely split from its legacy drive root:
     `relative_path = os.path.splitdrive(photo.original_path)[1]` (e.g. `\DCIM\100CANON\IMG_0042.JPG`).
   - Recombined with the validated live drive mount:
     `live_source_path = active_drive_letter + relative_path` (e.g. `F:\DCIM\100CANON\IMG_0042.JPG`).
3. **Cryptographic Zero-Trust Pre-Deletion Validation**:
   - Deletion is strictly guarded by a 3-point check before any unlink:
     1. **Internal Storage Check**: Verify the managed file exists in `data/originals/` and matches `photo.file_hash`.
     2. **Source Integrity Check**: Verify the external candidate exists and matches the exact `photo.file_size` and SHA-256 hash.
     3. **Safe Unlink**: Unlink the external file only after cryptographic parity is verified.
4. **Telemetry & Audit Logging**:
   - Displays a live progress dialog showing reclaimed megabytes/gigabytes.
   - Retains `photos.original_path` and `photos.volume_uuid` in SQLite as historical provenance for search and auditing.

---

## 8. User Accounts, Secure Authentication & Multi-Device Access Architecture

### Overview
Enable user account management (login/logout, multi-user profiles) and expose the SecurePhotos library for secure, authorized access across multiple devices (secondary PCs, laptops, tablets, mobile browsers) while maintaining strict zero-trust cryptographic boundaries.

### User Problem & Motivation
* As a user with photos stored on an external SSD or primary computer, having to physically connect the drive to every device just to view photos is restrictive.
* Users want to log into their SecurePhotos library from other laptops, tablets, or phones on their home network or remotely.
* Multi-person households want individual user logins (e.g. personal private libraries vs. shared family albums) with access control.

### Architectural Blueprint & Core Capabilities

1. **User Authentication & Zero-Knowledge Credential Engine**:
   - **Local Master & Family Profiles**: Support for an Admin master account plus optional secondary family user profiles.
   - **Argon2id Key Derivation**: Passwords and PINs are hashed using salt + Argon2id. Keys for encrypted vaults are derived client-side so passwords are never stored in plaintext.
   - **Session & Token Management**:
     - Issues short-lived, cryptographically signed session tokens (JWT with Ed25519 or opaque bearer tokens).
     - Secure, HttpOnly, SameSite cookies for media streaming.
     - Configurable idle auto-lock (e.g., 15 minutes of inactivity).
   - **Active Session Dashboard & 1-Click Revocation**:
     - Settings view showing all currently connected devices (Device Name, IP address, OS, Last Active).
     - Global "Log out all other devices" kill-switch.

2. **Multi-Device Access Modalities**:
   - **Modal A: Local Network (LAN) Browser Hub**:
     - When enabled by the user in Settings ("Allow Local Network Access"), SecurePhotos' engine binds to the local LAN IP (`0.0.0.0` or specific LAN interface) with TLS.
     - Other devices on the same Wi-Fi (laptops, iPads, smartphones) simply navigate to `https://<host-pc-name>.local:<port>` and log in via the web client.
     - The web client reuses the exact same responsive React/Tailwind/CSS frontend bundle.
   - **Modal B: Zero-Config Peer-to-Peer Encrypted Mesh**:
     - Integration with WireGuard / Tailscale / WebRTC peer-to-peer protocols.
     - Allows secure out-of-home access without opening vulnerable router ports or requiring public static IPs.
   - **Modal C: Cross-Device Library Sync**:
     - Encrypted differential sync between multiple desktop installations sharing an external drive or network share.

3. **Privacy & Security Boundaries**:
   - **Strict Zero-Cloud Reliance**: All authentication and streaming remain 100% self-hosted on the user's hardware.
   - **Per-User Vault Isolation**: Each user's private vault remains encrypted with their unique password; other household users on the same network hub cannot decrypt or view vault assets.
   - **Brute-Force & Rate Limiting Guard**: Progressive exponential backoff (delaying responses after repeated failed login attempts) to block automated network attacks.

---

## 6. Windows Hello & Hardware Biometrics Integration (TPM Key Wrapping)

### Overview
Integrate native Windows Hello authentication (fingerprint sensors and IR facial recognition cameras) to unlock the Private Vault seamlessly without manually typing master passwords or 4-digit PINs, while preserving zero-trust cryptographic guarantees.

### Architecture & Key Capabilities
1. **Native WinRT UserConsentVerifier via Tauri**:
   - Call native Windows WinRT APIs (`windows::Security::Credentials::UI::UserConsentVerifier`) directly from the Tauri Rust layer via the `windows-rs` crate.
   - Triggers the official Windows system biometric dialog, verifying hardware presence and user consent with zero third-party drivers.
2. **Hardware TPM Master Vault Key (MVK) Wrapping**:
   - Master Vault Key (MVK) wrapping slot: When the user opts into Windows Hello, an ephemeral symmetric wrapping key is derived and protected inside the hardware Trusted Platform Module (TPM 2.0).
   - Biometric challenge verification unseals the key in volatile memory only for the duration of the active unlocked session.
   - When the inactivity timer expires, the unsealed key is securely zeroized from RAM.
3. **Multi-Tier Fallback Hierarchy**:
   - Windows Hello Biometrics (Instant Primary) &rarr; 4-Digit Quick PIN (Fast Secondary) &rarr; Master Password (Authoritative Tertiary) &rarr; 24-Word Recovery Phrase (Emergency Air-Gapped Key).




