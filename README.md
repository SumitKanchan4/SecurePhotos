# 🔒 SecurePhotos 2.0

> **Privacy-first, zero-cloud desktop photo library, 8K ULTRA AI Super-Resolution engine, hands-free Google Photos-style face unblur, and encrypted digital vault with native external drive resilience.**

---

## 🌟 Overview

**SecurePhotos 2.0** is an offline, local-first desktop media library and digital vault designed for users who demand absolute privacy, instantaneous 60fps browsing across 100,000+ assets, 8K ULTRA Super-Resolution AI upscaling, hands-free face unblur, and military-grade encryption for intimate and sensitive media.

- **Zero Cloud Reliance**: 100% offline. Zero remote telemetry, zero tracking.
- **Hands-Free 8K ULTRA Pipeline**: Background automated face unblur (YOLOv8-Face + CodeFormer $w=0.85$) and multi-pass Lanczos acutance enhancement up to $7680 \times 4320$ (CRF 19) saving ~70% disk space with zero manual buttons.
- **Interactive Before / After Split Slider**: Instant side-by-side visual comparison between original source photos and 8K ULTRA enhanced proxies.
- **30-Day Soft-Delete Trash**: Safe single-photo and batch trashing with automatic recovery window.
- **External Drive Portability & Resilience**: Hardware volume UUID tracking, atomic 2-phase commits (`.tmp` + `fsync` + `os.replace`), and portable models (`.securephotos_library/models/`).
- **Hierarchical Date Sharding**: Date-sharded directory structure (`originals/YYYY/MM/DD/`) (< 500 files/folder) preventing OS/filesystem hangs.
- **Zero-Trust Hardened Vault**: Multi-slot Master Key wrapping (Argon2id password, Windows Hello biometrics, 24-word emergency recovery key), RFC 6238 TOTP 2FA, encrypted thumbnails (`.enc`), and ephemeral RAM streaming.
- **Intelligent People & Stories**: Representative Medoid clustering ("Name Once, Tag 1,000 Photos"), Social Affinity Graph for Close Ones, and beat-matched Ken-Burns video montages.

---

## 🚀 Quickstart: How to Run the Application

### 1. 📋 Prerequisites

* **Node.js**: v20.x or v22.x LTS (`node -v` & `npm -v`)
* **Python**: v3.11+ or v3.12+ (`python --version` or `uv python`)
* **OS**: Windows 10/11 (DirectML supported), macOS, or Linux

---

### 2. ⚡ Starting the Application (1-Click Scripts)

#### 🖥️ Launch the Native Desktop App Window (Tauri 2.0)
```powershell
.\scripts\run-desktop-app.ps1
```

#### 🌐 Launch the Frontend UI (Port 1420)
```powershell
.\scripts\run-frontend.ps1
```
> 📍 **Interactive UI**: Open **[http://localhost:1420](http://localhost:1420)** in your browser.

#### 🐍 Launch the Python Engine Sidecar (Port 8000)
```powershell
.\scripts\run-backend.ps1
```
> 📍 **API Documentation**: Open **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)** for interactive Swagger UI.

---

### 3. 🧪 Running Automated Tests

Run the full backend test suite covering SQLite WAL pragmas, volume tracking, high-speed ingestion, zero-trust cryptography, and stories:

```powershell
.venv\Scripts\python.exe -m pytest engine/tests -v
```

---

### 4. 📦 Building for Production

Compile the optimized frontend bundle:

```powershell
npm run build
```

---

## ⌨️ Desktop Keyboard Shortcuts

| Shortcut | Action | Scope |
|---|---|---|
| `T` | Toggle Theme (Dark Obsidian 🌙 / Light Titanium ☀️) | Global |
| `Ctrl + K` / `Cmd + K` | Focus Global Hybrid Search Box | Global |
| `J` / `ArrowRight` | Next Photo / Next Story Slide | Grid / Lightbox / Stories |
| `K` / `ArrowLeft` | Previous Photo / Previous Story Slide | Grid / Lightbox / Stories |
| `Space` | Quick Look / Play & Pause Story | Grid / Stories |
| `E` | Toggle 8K ULTRA Before/After Comparison Split Slider | Lightbox |
| `Ctrl + I` | Toggle EXIF Metadata Info Drawer | Lightbox |
| `F` | Toggle Favorite Star | Grid / Lightbox |
| `L` | Lock Selected Photo/Album to Encrypted Vault | Grid / Lightbox / Albums |
| `Delete` / `Backspace` | Move Photo to 30-Day Trash | Lightbox |
| `Escape` | Close Lightbox / Clear Selection / Close Modal | Global |

---

## 📑 Architecture & Specifications

All detailed design documents and specifications are located in the **[`docs/`](file:///c:/Sumit%20Code/SecurePhotos/docs)** directory:
* **[docs/8k_ultra_automated_enhancement_and_trash_architecture.md](file:///c:/Sumit/Code/SecurePhotos/docs/8k_ultra_automated_enhancement_and_trash_architecture.md)**: Exhaustive specification, flowcharts, and sequence diagrams for hands-free 8K ULTRA enhancement and 30-day soft-delete trash.
* **[docs/architecture.md](file:///c:/Sumit/Code/SecurePhotos/docs/architecture.md)**: Core system flowcharts, lifecycle diagrams, and SQLite WAL database structure.
* **[docs/end_to_end_implementation_plan.md](file:///c:/Sumit/Code/SecurePhotos/docs/end_to_end_implementation_plan.md)**: Roadmap, 8K pipeline, external drive resilience, and zero-trust vault.
* **[docs/database_schema_and_indexing.md](file:///c:/Sumit/Code/SecurePhotos/docs/database_schema_and_indexing.md)**: SQLite schema, FTS5 triggers, and covering indexes.
* **[docs/ui_ux_design_specification.md](file:///c:/Sumit/Code/SecurePhotos/docs/ui_ux_design_specification.md)**: Design token system, 60fps virtualization, and UX flows.
* **[docs/greenfield_enterprise_blueprint.md](file:///c:/Sumit/Code/SecurePhotos/docs/greenfield_enterprise_blueprint.md)**: Enterprise architectural blueprint.

---

## 📄 License
Proprietary and Confidential. All rights reserved.
