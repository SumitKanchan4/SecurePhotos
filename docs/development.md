# Developer guide

This guide explains how SecurePhotos is put together, how to run it locally, how to test a change and how a release is built. For what the app does from a user's point of view, see the [README](../README.md).

## How the app is built

SecurePhotos has three parts that run on the user's computer:

```
┌──────────────────────────────────────────────────────────────┐
│ Desktop shell (Tauri 2, Rust)                                │
│  Opens the window (WebView2), picks a free local port,       │
│  creates a random access token and starts the engine with it │
└──────────────────────────────┬───────────────────────────────┘
                               │ 127.0.0.1, token or session cookie
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌─────────────────────────────┐   ┌─────────────────────────────────┐
│ App (React 19, TypeScript)  │   │ Photo engine (Python 3.12)      │
│  Screens, photo grid,       │   │  FastAPI, SQLite (WAL, FTS5),   │
│  viewer; state in Zustand   │   │  import, AI on the CPU (ONNX),  │
│                             │   │  vault encryption, workers      │
└─────────────────────────────┘   └─────────────────────────────────┘
```

- **Desktop shell:** Tauri 2 with the Windows WebView2 runtime. It owns the window, native dialogs and the engine's lifetime.
- **App:** React 19, TypeScript, Vite, Zustand and Lucide icons. The photo grid does its own windowing, so only the tiles near the screen exist.
- **Photo engine:** Python 3.12 with FastAPI, Uvicorn and SQLite through `aiosqlite`. It reads and writes the library, runs the AI models and does all background work.
- **AI:** ONNX Runtime. Everything is designed to run on an ordinary CPU; DirectML is used for face recognition when it's available. The models are YuNet (finding faces, MIT), SFace (recognising faces, Apache-2.0), Real-ESRGAN (BSD-3-Clause), and for old photos DDColor, GFPGAN, LaMa and the "Bringing Old Photos Back to Life" scratch detector. Text is read with the OCR built into Windows. Licences are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- **Encryption:** AES-256-GCM in chunks, keys from Argon2id, and random numbers from the operating system (the `getrandom` crate in the shell).

[architecture.md](architecture.md) goes deeper into each part.

## What you need

| Tool | Version | Check with |
| --- | --- | --- |
| Node.js | 20 or 22 | `node -v` |
| Python | 3.12 | `python --version` |
| Rust | 1.80 or later, MSVC toolchain | `rustc --version` |
| WebView2 | Evergreen runtime | Included in Windows 10 and 11 |
| FFmpeg and FFprobe | Any recent build | Needed for videos: put them in `bin/` in the repository root, or on your `PATH` |

Create the Python environment once:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r engine/requirements-dev.txt
npm install
```

## Running it

| Command | What it starts |
| --- | --- |
| `.\scripts\run-desktop-app.ps1` | The whole app: engine, Vite and the desktop window. Use this most of the time. |
| `.\scripts\run-frontend.ps1` | Only the app in Vite, at http://localhost:1420 |
| `.\scripts\run-backend.ps1` | Only the engine, with auto-reload, at http://127.0.0.1:8000 (API docs at `/docs`) |

**The library folder.** By default the app keeps its library next to the program. To test against another folder, put `path=C:\Some\Folder` in a `data_location.txt` file in the repository root (it is ignored by git), or set the `SECUREPHOTOS_DATA_DIR` environment variable. Any script that imports engine code must set `SECUREPHOTOS_DATA_DIR` before its first engine import, or it will work on the folder named in `data_location.txt`.

**Auto-reload.** The engine started by these scripts restarts whenever an engine file changes. A restart forgets the image login (see below), and the app logs in again by itself within a few seconds.

## How the app and the engine trust each other

The engine only listens on 127.0.0.1, but other programs on the same computer could still try to reach it. So:

1. **A port chosen at start-up.** The shell asks Windows for a free port, so there is no fixed port to guess or collide with.
2. **A random access token.** The shell creates a 256-bit token from the operating system's random source (`src-tauri/src/token.rs`) and passes it to the engine in `SECUREPHOTOS_IPC_SECRET`. If it can't create one, the engine is not started.
3. **Every request is checked.** [auth_middleware.py](../engine/middleware/auth_middleware.py) accepts a request only with the token in the `X-SecurePhotos-Token` header or a valid session cookie, compared in constant time. Anything else gets `403`.
4. **Images use a session cookie.** `<img>` and `<video>` can't send headers, so at start-up the app calls `POST /api/auth/handshake` ([auth.py](../engine/api/auth.py)) and gets an `HttpOnly` cookie holding a separate random value. That cookie lasts until the engine restarts. When an image is refused afterwards, `src/services/mediaSession.ts` logs in again and reloads the broken images.

## Testing a change

Every change must pass the same checks the pull-request check runs:

```powershell
.venv\Scripts\python.exe -m ruff check .            # Python lint
.venv\Scripts\python.exe -m pytest engine/tests     # engine tests
npm test                                            # app tests (Vitest)
npm run build                                       # type check and production build
cargo check --manifest-path src-tauri/Cargo.toml    # desktop shell
```

- **Engine tests** use their own throwaway library folder, never yours.
- **App tests** sit next to the code they test (`src/**/*.test.ts` and `.tsx`) and run in a simulated browser. Always start them with `npm test`: it launches Vitest from the upper-case form of the folder path, because Vitest fails every file when started from a lower-case drive letter (some VS Code terminals use `c:\`).
- **Checking on screen:** run the app against a throwaway library, or use Playwright with Microsoft Edge against `npx vite` and answer the engine's requests with sample data.

## Building a release

The installer is a Windows NSIS setup that contains the app, the engine as one program, and the smaller AI models. The old-photo models (about 2.7 GB) are too big to include: the installer downloads them, and if that fails the app offers the download before the first feature that needs them.

1. **Fetch and check the bundled models:**
   ```powershell
   python scripts/fetch_models.py build/models
   ```
   Every file must match its pinned SHA-256, or the build stops.
2. **Build the engine program** (PyInstaller, into `src-tauri/binaries/`):
   ```powershell
   python scripts/build-engine.py
   ```
3. **Build the installer:**
   ```powershell
   npm run tauri build
   ```
   The installer is written to `src-tauri/target/release/bundle/nsis/`.

The old-photo models are served from this repository's GitHub release `models-v1`. That download only works for other people once the repository is public. How the models are made: [scripts/model_export/README.md](../scripts/model_export/README.md).

## Continuous integration

- **Quality Gate** (`.github/workflows/quality.yml`) runs on every pull request: ruff, the engine tests, an npm audit, the app tests, the production build and the Rust checks.
- **SecurePhotos CI/CD Pipeline** (`.github/workflows/pipeline.yml`) only runs when started by hand from the **Actions** tab. Choose the branch, the version bump (`patch`, `minor` or `major`) and what to do with the result:
  - `test_build` (the default) builds the installer and attaches it to the run. Nothing is published.
  - `public_release` builds the installer, tags the commit `v<version>` and publishes a GitHub release. It only runs from `master`. It first checks that the old-photo models can be downloaded without a login, and the release notes are taken from `CHANGELOG.md` (the version's own section, or Unreleased) by `scripts/ci/release_notes.py`, so update the changelog before releasing.

To preview or apply a version number locally:

```powershell
python scripts/release_version.py detect --bump patch
python scripts/release_version.py sync --version 0.2.0
```

## Where things are

```
SecurePhotos/
├── engine/                 Photo engine (Python)
│   ├── api/                HTTP endpoints, one file per area (photos, vault, people...)
│   ├── middleware/         The access check for every request
│   ├── services/           The work itself: import, after-import steps, AI, vault, workers
│   ├── tests/              Engine tests (pytest)
│   ├── config.py           Settings and the library folder
│   ├── database.py         Schema and migrations
│   └── main.py             Start-up and background workers
├── src/                    App (React, TypeScript)
│   ├── components/         Screens and shared pieces
│   ├── hooks/              Engine connection, settings, background progress
│   ├── services/           Talking to the engine
│   ├── store/              App state (Zustand)
│   └── utils/              Pure helpers, unit-tested
├── src-tauri/              Desktop shell (Rust), installer settings and hooks
├── scripts/                Run, build, release and model-export scripts
└── docs/                   Developer documentation
```

## Conventions

- Work on a branch and merge to `master` through a pull request ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- Python: Google-style docstrings on public functions. Slow work (images, files, AI) runs off the engine's request loop with `asyncio.to_thread`.
- TypeScript: no `any`; pure logic goes in `utils` or a `*Format.ts` file with its own tests.
- Paths in the database are stored relative to the library folder (`to_db_path`, `resolve_stored_path`), so a library can move with its drive.
- Words on screen: plain, short and friendly. [design_system.md](design_system.md) has the visual rules and the keyboard shortcuts.
