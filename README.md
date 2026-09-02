# 🔒 SecurePhotos 2.0

> **Privacy-first, zero-cloud desktop photo library, 4K AI Super-Resolution engine, and encrypted digital vault with native external drive resilience and on-device AI.**

---

## 🌟 Overview

**SecurePhotos 2.0** is an offline, local-first desktop media library and digital vault designed for users who demand absolute privacy, instantaneous 60fps browsing across 100,000+ assets, 4K Super-Resolution AI upscaling, and military-grade encryption for intimate and sensitive media.

- **Zero Cloud Reliance**: 100% offline. Zero remote telemetry, zero tracking.
- **Lightweight 4K Media**: AI Super-Resolution (Real-ESRGAN ONNX) + visually lossless AVIF/AV1 (CRF 18) compression saving 50–70% disk space.
- **External Drive Portability & Resilience**: Hardware volume UUID tracking, atomic 2-phase commits (`.tmp` + `fsync` + `os.replace`), and portable models (`.securephotos_library/models/`).
- **Hierarchical Date Sharding**: Date-sharded directory structure (`originals/YYYY/MM/DD/`) (< 500 files/folder) preventing OS/filesystem hangs.
- **Zero-Trust Hardened Vault**: Multi-slot Master Key wrapping (Argon2id password, Windows Hello biometrics, 24-word emergency recovery key), RFC 6238 TOTP 2FA, encrypted thumbnails (`.enc`), and ephemeral RAM streaming.
- **Intelligent People & Stories**: Representative Medoid clustering ("Name Once, Tag 1,000 Photos"), Social Affinity Graph for Close Ones, and beat-matched Ken-Burns 4K video montages.

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
| `E` | Toggle 4K AI Before/After Comparison Split Slider | Lightbox |
| `Ctrl + I` | Toggle EXIF Metadata Info Drawer | Lightbox |
| `F` | Toggle Favorite Star | Grid / Lightbox |
| `L` | Lock Selected Photo/Album to Encrypted Vault | Grid / Lightbox / Albums |
| `Escape` | Close Lightbox / Clear Selection / Close Modal | Global |

---

## 📑 Architecture & Specifications

All detailed design documents and specifications are located in the **[`docs/`](file:///c:/Sumit%20Code/SecurePhotos/docs)** directory:
* **[docs/architecture.md](file:///c:/Sumit%20Code/SecurePhotos/docs/architecture.md)**: Flowcharts, lifecycle diagrams, and SQLite WAL database structure.
* **[docs/end_to_end_implementation_plan.md](file:///c:/Sumit%20Code/SecurePhotos/docs/end_to_end_implementation_plan.md)**: Roadmap, 4K pipeline, external drive resilience, and zero-trust vault.
* **[docs/database_schema_and_indexing.md](file:///c:/Sumit%20Code/SecurePhotos/docs/database_schema_and_indexing.md)**: SQLite schema, FTS5 triggers, and covering indexes.
* **[docs/ui_ux_design_specification.md](file:///c:/Sumit%20Code/SecurePhotos/docs/ui_ux_design_specification.md)**: Design token system, 60fps virtualization, and UX flows.
* **[docs/greenfield_enterprise_blueprint.md](file:///c:/Sumit%20Code/SecurePhotos/docs/greenfield_enterprise_blueprint.md)**: Enterprise architectural blueprint.

---

## 📄 License
Proprietary and Confidential. All rights reserved.
