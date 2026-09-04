# 🚀 SecurePhotos — Future Enhancements & Architectural Roadmap

This document captures high-value architectural improvements, user experience features, and cryptographic safeguards planned for future iterations of SecurePhotos.

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
