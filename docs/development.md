# 🛠️ SecurePhotos: Developer & Engineering Guide

> **Comprehensive architectural blueprint, environment setup, local development workflows, testing guidelines, and packaging procedures for the SecurePhotos engineering team.**

Looking for the end-user overview and user guide? See [README.md](../README.md).

---

## 🏛️ System Architecture Overview

SecurePhotos is engineered as a local-first, zero-cloud desktop application combining a high-performance **Tauri 2.0 (Rust)** shell with an autonomous **Python 3.12 Engine (FastAPI)** sidecar and a reactive **React 18 / TypeScript** user interface.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tauri 2.0 Desktop Host (Rust)                   │
│  - Native Window Lifecycle & Webview2 Hosting                          │
│  - Ephemeral Port Allocation (127.0.0.1:0)                             │
│  - Windows OS CSPRNG Token Generation (BCryptGenRandom)                │
│  - Child Process Lifetime & Sidecar Process Supervision                │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Local Loopback (CSPRNG Authenticated)
       ┌─────────────────────────────┴─────────────────────────────┐
       ▼                                                           ▼
┌─────────────────────────────────────────┐   ┌────────────────────────────────────────┐
│        Frontend Client (React 18)       │   │        Backend Engine (Python 3.12)    │
│  - TanStack Virtualized Grid (60fps)    │   │  - FastAPI REST Endpoints & Streaming  │
│  - Pure CSS Liquid-Glass Design Tokens  │   │  - SQLite WAL Database & FTS5 Search   │
│  - Centralized apiFetch & Cookie Client │   │  - On-Device AI: ONNX Face / OCR / CLIP│
│  - Zustand State Isolation Store        │   │  - AES-256-GCM Zero-Trust Crypto Vault │
└─────────────────────────────────────────┘   └────────────────────────────────────────┘
```

### Core Technologies
- **Desktop Host**: Tauri 2.0 (Rust) using Windows WebView2 runtime.
- **Backend Runtime**: Python 3.12, FastAPI, Uvicorn, SQLite 3 (WAL mode + FTS5 full-text indexing), `aiosqlite`.
- **AI & Acceleration**: ONNX Runtime with DirectML hardware acceleration, MobileCLIP, CodeFormer / Real-ESRGAN, YOLOv8-Face.
- **Frontend Framework**: React 18, TypeScript, Vite, `@tanstack/react-virtual`, Lucide React icons.
- **Cryptography**: AES-256-GCM chunked streaming, Argon2id key derivation, Windows OS CSPRNG (`BCryptGenRandom`).

---

## 📋 Prerequisites & Toolchain Setup

Ensure the following runtimes and build tools are installed on your workstation:

| Dependency | Required Version | Verification Command | Purpose |
| :--- | :--- | :--- | :--- |
| **Node.js** | v20.x or v22.x LTS | `node -v` & `npm -v` | Frontend build tooling & package management |
| **Python** | v3.11+ or v3.12+ | `python --version` | Backend engine runtime and AI pipelines |
| **Rust & Cargo** | 1.80+ (MSVC target) | `rustc --version` & `cargo --version` | Tauri desktop shell & CSPRNG host binary |
| **WebView2** | Evergreen Runtime | Built into Windows 10/11 | Desktop rendering runtime |

---

## ⚡ Local Development Workflows

SecurePhotos provides 1-click startup automation scripts in the `scripts/` directory:

### 1. Launch Full Desktop App (Recommended)
Spawns the backend engine, starts the Vite development server, and launches the native Tauri desktop window:
```powershell
.\scripts\run-desktop-app.ps1
```

### 2. Standalone Frontend Development
Starts only the Vite dev server with hot module replacement (HMR) at [http://localhost:1420](http://localhost:1420):
```powershell
.\scripts\run-frontend.ps1
```

### 3. Standalone Backend Development
Initializes the Python virtual environment and launches FastAPI with auto-reload at [http://127.0.0.1:8000](http://127.0.0.1:8000):
```powershell
.\scripts\run-backend.ps1
```
> 📍 **Interactive OpenAPI Docs**: Explore Swagger UI at **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**.

---

## 🔒 Local IPC Security Architecture

To prevent unauthorized local processes, rogue scripts, or third-party browser tabs from accessing private media or manipulating the database via loopback, SecurePhotos enforces a zero-trust Inter-Process Communication (IPC) barrier:

1. **Dynamic Ephemeral Port Allocation**:
   - The Tauri host binds to `127.0.0.1:0`.
   - The operating system assigns an available, unassigned port at runtime, avoiding fixed-port collisions with developer servers.
2. **CSPRNG Shared Secret**:
   - Rust generates a 256-bit cryptographically secure token using Windows native `BCryptGenRandom` (`BCRYPT_USE_SYSTEM_PREFERRED_RNG`).
   - The token is passed to the Python sidecar via the `SECUREPHOTOS_IPC_SECRET` environment variable.
3. **Defense-in-Depth Middleware ([auth_middleware.py](../engine/middleware/auth_middleware.py))**:
   - Outermost Starlette middleware validates `X-SecurePhotos-Token` headers and `securephotos_ipc` cookies via constant-time comparison (`hmac.compare_digest`).
   - Unauthorized requests immediately receive `403 Forbidden`.
4. **Media Streaming Handshake ([auth.py](../engine/api/auth.py))**:
   - On frontend startup, `performHandshake()` calls `POST /api/auth/handshake` to obtain an `HttpOnly; SameSite=Lax` cookie.
   - Standard HTML `<img>`, `<video>`, and `<audio>` tags stream authenticated media seamlessly without exposing tokens in URL query strings.

---

## 🧪 Testing & Verification

All contributions must pass automated tests and typechecks before merging.

### Backend Automated Tests (Pytest)
Run the full test suite covering database operations, volume tracking, face identification, zero-trust crypto, and IPC auth:
```powershell
.venv\Scripts\python.exe -m pytest engine/tests -v
```
To run only the IPC authentication test suite:
```powershell
.venv\Scripts\python.exe -m pytest engine/tests/test_ipc_auth.py -v
```

### Frontend Typechecking & Compilation
Run the TypeScript compiler and Vite production build:
```powershell
npm run build
```

### Rust Host Verification
Verify Tauri Rust crates offline without network overhead:
```powershell
cd src-tauri
cargo check --offline
cd ..
```

---

## 📦 Building Standalone Production Releases

The production build pipeline generates a self-contained, offline-ready Windows NSIS installer that packages the compiled Python engine, ONNX models, and WebView2 runtime loader.

### Step 1: Compile the Python Engine Sidecar
Freezes the Python engine into a standalone Windows executable (`securephotos-engine.exe`) using PyInstaller:
```powershell
python scripts/build-engine.py
```
This produces the standalone sidecar in `src-tauri/binaries/` with all required dependencies, hidden imports, and ONNX models bundled.

### Step 2: Build the Native Desktop Installer (NSIS)
Compiles the final installer executable (`SecurePhotos_0.1.0_x64-setup.exe`):
```powershell
npm run tauri build
```
Output artifacts are located in:
`src-tauri/target/release/bundle/nsis/`

---

## 🚀 CI/CD & Automated Release Pipeline

SecurePhotos uses a **manual-trigger only** GitHub Actions workflow (`.github/workflows/pipeline.yml`) to eliminate unwanted CI runs and prevent unverified releases from being published.

### Triggering via GitHub Actions Web UI
1. Navigate to **Actions** &rarr; **SecurePhotos CI/CD Pipeline**.
2. Click **Run workflow**.
3. Choose the branch to build from.
4. Select the **Version Bump Type**:
   - `patch`: Increments patch component (e.g. `0.1.0` &rarr; `0.1.1`).
   - `minor`: Increments minor component (e.g. `0.1.0` &rarr; `0.2.0`).
   - `major`: Increments major component (e.g. `0.1.0` &rarr; `1.0.0`).
5. Select the **Distribution Mode**:
   - `test_build` *(Default)*: Compiles the full installer and uploads it to **GitHub Actions Run Artifacts**. **Nothing is published to GitHub Releases**, keeping public feeds clean while allowing developers to download and test the full installation lifecycle.
   - `public_release`: Packages the installer, tags the repository with `v<version>`, and publishes an official release on GitHub with release notes. *(Enforced Guard: Can **only** be triggered from the repository's default branch `master`. Triggering on any topic branch will immediately abort the run).*

### Local Version Detection & Sync CLI
You can test SemVer calculation or update manifests locally using:
```bash
# Preview next version calculation
python scripts/release_version.py detect --bump patch

# Synchronize version across all configuration files
python scripts/release_version.py sync --version 0.1.1
```

---

## 📁 Directory Structure Reference

```
SecurePhotos/
├── engine/                       # Python 3.12 Backend Engine
│   ├── api/                      # FastAPI Route Controllers (Photos, Albums, Vault, etc.)
│   ├── database/                 # SQLite Connection, Schema, FTS5 & Migrations
│   ├── middleware/               # Local IPC Authentication & Security Middleware
│   ├── services/                 # Business Logic (Ingestion, Crypto, AI, Thumbnails)
│   ├── tests/                    # Automated Pytest Test Suites (117+ tests)
│   ├── config.py                 # Pydantic Settings & Directory Resolution
│   └── main.py                   # FastAPI Application Entrypoint
├── src/                          # React 18 / TypeScript Desktop Frontend
│   ├── assets/                   # Static Icons & Artwork
│   ├── components/               # UI Views (Grid, Lightbox, People, Vault, Albums, etc.)
│   ├── services/                 # Centralized apiFetch & Media URL Client
│   ├── store/                    # Zustand Global Application State
│   ├── types/                    # Shared TypeScript Type Definitions
│   └── App.tsx                   # Main Root Desktop Layout & Router
├── src-tauri/                    # Tauri 2.0 Host Shell (Rust)
│   ├── binaries/                 # Pre-compiled Sidecar Executables
│   ├── src/lib.rs                # Host Engine State, Port Allocation & Window Setup
│   ├── tauri.conf.json           # Tauri Desktop Configuration & Resource Mappings
│   └── Cargo.toml                # Rust Dependencies & Build Configuration
├── docs/                         # Technical Documentation & Specifications
│   ├── architecture.md           # System Architecture & Pipelines
│   ├── database_schema.md        # SQLite WAL Schema & Indexing Model
│   ├── design_system.md          # UI Tokens & Glassmorphism Design System
│   ├── development.md            # This Developer & Engineering Guide
│   └── roadmap.md                # Community Product Roadmap
├── scripts/                      # Developer Helper & Build Scripts
└── README.md                     # End-User Product Showcase & Guide
```

---

## 🛡️ Enterprise Engineering Guidelines

When contributing to SecurePhotos, strictly adhere to the project standards defined in `.agents/rules/strict-approval-and-standards.md`:
1. **Branch Protection**: Never commit directly to `master`/`main`. Always use dedicated topic branches (`feature/*`, `fix/*`, `chore/*`) and immediately push commits to `origin`.
2. **Approval Gate**: Propose concrete implementation plans with problem breakdown, root cause, and verification steps before modifying code.
3. **UI/UX Header Standard**: All view headers must use the frosted liquid-glass floating container with balanced 3-column flex layout and inline capsule badges.
4. **Code Quality**: Google-style Python docstrings and comprehensive TypeScript JSDoc comments are mandatory on all public symbols.
5. **Living Registry**: Every functional addition or decision point must be registered in `.agents/history/features_and_functional_decisions.md`.
