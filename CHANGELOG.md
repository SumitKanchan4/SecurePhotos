# 📜 Changelog

All notable changes to SecurePhotos will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### 🚀 Planned
- Dynamic multi-vault switching across multiple external drives.
- Video facial recognition with in-playback cast overlay and timestamp seeking.
- Volume-aware source cleanup wizard to safely free space on camera SD cards.
- Multi-device local network access and encrypted mobile companion app.

---

## [0.1.0] - 2026-10-08

### ✨ Initial Release

The first public open-source release of SecurePhotos, a 100% private, zero-cloud media vault for desktop and external drives.

#### 🛡️ Privacy and Encryption
- **Zero-Cloud Architecture**: Runs completely on your own machine with no telemetry, tracking, or network calls.
- **AES-256-GCM Private Vault**: Encrypts sensitive photos and documents at rest using Argon2id key derivation.
- **In-Memory Decryption**: Decrypts media only in volatile RAM during viewing, leaving zero temporary unencrypted files on disk.
- **Secure Local IPC**: Local communication between Tauri and the FastAPI engine uses ephemeral port allocation and cryptographic tokens.
- **Windows Hello and 2FA**: Optional biometric unlock and TOTP authenticator app support.

#### ⚡ Performance and Browsing
- **60fps Virtualized Grid**: Smoothly scrolls collections of 100,000+ photos and videos with zero stutter.
- **Zero Layout Shifts**: Aspect-ratio skeleton placeholders prevent jumping while thumbnails load.
- **Fluid Lightbox**: Fullscreen media viewer with EXIF metadata inspector and keyboard navigation (J, K, Space, F, L, Delete).
- **Dual Themes**: Polished Dark Obsidian and Light Titanium modes with fluid liquid-glass headers.

#### 👥 People and Family Memories
- **On-Device Face Recognition**: Identifies faces locally using lightweight ONNX vision models.
- **Name Once, Tag 1,000 Photos**: Representative face medoids allow naming a person across an entire library with one click.
- **Close Ones**: Prioritize favorite family members and friends for quick access.

#### 🔍 Search and Organization
- **Full-Text and OCR Search**: SQLite FTS5 search across photo tags, filenames, camera details, and words printed on scanned documents and receipts.
- **Custom Albums and Live Filtering**: Organize memories into albums or filter by year, month, or media type.
- **Smart Duplicate Cleaner**: Finds exact duplicates and burst shots, helping you reclaim disk space safely.
- **30-Day Trash**: Accidental deletions are protected with a 30-day recovery window.

#### 🎞️ Creative Features
- **Cinematic Stories**: Automatic beat-synced slideshows with Ken-Burns animations and mood-matched soundtracks.
- **4K Collage Maker**: Create high-resolution mosaic photo grids with face-aware cropping.

#### 💾 Drive Portability
- **External Drive Ready**: Install and run libraries on external SSDs and USB drives.
- **Volume Tracking**: Automatically detects drive serial numbers to handle shifting Windows drive letters safely.
