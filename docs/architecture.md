# 📐 SecurePhotos: System Architecture & Technical Design

---

## 1. Architectural Philosophy & Core Principles

SecurePhotos is designed as an **offline-first, zero-cloud personal media vault**. The system prioritizes:
1. **Data Sovereignty**: No telemetry and no uploads. The AI models ship with the app; the only automatic network call is the update check (GitHub's latest-version file).
2. **High Scale & Low Latency**: Fast access across libraries of 100,000+ photos and videos; heavy work runs off the engine's request loop (H7).
3. **Defense-in-Depth Cryptography**: Vault files use AES-256-GCM (SPENC03, per-file keys); keys are derived with Argon2id; viewing decrypts in memory.
4. **Drive Portability**: Database, media, thumbnails and models live in one library folder with paths stored relative to it, so it can travel on an external drive.

---

## 2. High-Level System Architecture

```mermaid
graph TB
    subgraph UI_Layer ["Presentation Tier (Tauri 2 / React 19)"]
        ReactUI["React 19 SPA (Vite, TypeScript, Zustand)<br/>• Pure CSS Design Tokens<br/>• Virtualized Grids (@tanstack/react-virtual)<br/>• Lightbox & Keyboard Shortcuts"]
        TauriShell["Tauri 2 Native Shell (Rust)<br/>• WebView2, strict CSP<br/>• Spawns the engine with a random token<br/>• Native dialogs, tray, updater"]
        TauriShell --> ReactUI
    end

    subgraph Service_Layer ["Application Tier (FastAPI Engine sidecar)"]
        FastAPIApp["FastAPI on 127.0.0.1 (dynamic port)"]
        AuthMiddleware["Engine login: IPC token header or session cookie"]
        subgraph Domain_Routers ["Domain Routers"]
            PhotosR["Photos, import & enhancement"]
            VaultR["Private vault"]
            PeopleR["Faces & People"]
            DocsR["Documents & OCR"]
            DupR["Duplicates"]
            StoriesR["Stories, collages & videos"]
            TrashR["Trash"]
            SearchR["Search (FTS5)"]
        end
        FastAPIApp --> AuthMiddleware
        AuthMiddleware --> Domain_Routers
    end

    subgraph Background_Workers ["Background Workers"]
        Enhancer["Photo enhancer (AVIF, battery guard)"]
        VaultEnhancer["Vault enhancer (only while unlocked)"]
        FaceWorker["Face scan (YuNet + SFace)"]
        VideoWorker["Video queue (ffmpeg)"]
        TrashWorker["Trash purge (startup, then every 6 h; 30-day retention)"]
    end

    subgraph Storage_Tier ["Library folder (portable)"]
        DB[(SQLite, WAL)]
        Originals["originals/ (dated folders, collages/YYYY/MM)"]
        ThumbStore["thumbnails/, previews/ (hash-sharded)"]
        EncryptedVault["Vault files *.enc (SPENC03)"]
        ModelsDir["models/ (bundled, SHA-256 verified ONNX)"]
    end

    ReactUI -->|HTTP + token / cookie| FastAPIApp
    TauriShell -->|Spawns & monitors| FastAPIApp
    Domain_Routers --> DB
    Domain_Routers --> Originals
    Domain_Routers --> ThumbStore
    Domain_Routers --> EncryptedVault
    Background_Workers --> DB
    Background_Workers --> ModelsDir
    Background_Workers --> Originals
```

---

## 3. Subsystem Workflows & Flowcharts

### 3.1 Photo Import Pipeline

```mermaid
flowchart TD
    Pick([User picks files or a folder]) --> Ext{Supported type?}
    Ext -- No --> Skip[Skip]
    Ext -- Yes --> Hash[SHA-256 of the source]
    Hash --> Dup{Same hash already in library?}
    Dup -- Yes --> Skip
    Dup -- No --> Meta[Read EXIF: date, GPS, camera]
    Meta --> Copy["Copy into originals/YYYY/MM/DD<br/>temp file, verify hash, atomic rename"]
    Copy --> Thumb["Thumbnail (hash-sharded)"]
    Thumb --> Row[(Insert row, relative paths)]
    Row --> Optional{Move instead of copy?}
    Optional -- Yes --> DelSrc[Delete the source only now]
```

- Imports always copy into the library; there is no in-place mode (M4). One import batch runs at a time and file work runs off the request loop (H7). Each photo is enhanced afterwards (§3.4).

---

### 3.2 Search

```mermaid
flowchart LR
    UserQuery["Search: 'electric bill'"] --> FTS["SQLite FTS5<br/>file name, folder name, caption, tags, OCR text"]
    FTS --> Filters["Type filter: all, photos, videos, documents, favourites"]
    Filters --> Results[Results]
```

- Search is lexical (FTS5) plus filters. There is no vector or AI search today; see the `sqlite-vector-search` skill for future ideas.

---

### 3.3 Encrypted Vault Security Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI (Vault Page)
    participant API as Vault API
    participant State as In-memory session (master key)
    participant Crypto as crypto_vault / vault_storage
    participant Disk as Library folder

    Note over User,Disk: 1. Unlock
    User->>UI: Master password (or PIN after a normal lock, or the emergency card)
    UI->>API: POST /api/vault/unlock (engine token / cookie)
    API->>Crypto: Argon2id(password, salt) -> unwrap master key (AES-256-GCM)
    API->>State: Keep the master key in memory; auto-lock after the configured idle time

    Note over User,Disk: 2. Move a photo into the vault
    User->>UI: Select photo -> "Move to Vault"
    UI->>API: POST /api/vault/photos/lock
    API->>Crypto: Journal, then encrypt (off the request loop, one vault job at a time)
    Crypto->>Crypto: Per-file key = HKDF(master key, random file salt); 64 KB chunks, AES-256-GCM
    Crypto->>Disk: Write SPENC03 (temp, fsync, replace) and verify it decrypts
    Crypto->>Disk: Commit the row, then delete the original; seal OCR text + GPS
    API-->>UI: 200 OK

    Note over User,Disk: 3. View a vault photo / video
    User->>UI: Open vault thumbnail / lightbox
    UI->>API: GET /api/vault/stream/{id}
    API->>Crypto: decrypt_file_chunked_stream(file.enc, master key)
    Crypto->>Disk: Read chunks, verify each tag; reject missing last chunk, extra data or old formats
    Crypto-->>UI: Stream decrypted bytes (no decrypted file on disk)
```

#### Vault key in memory (what is and isn't protected)

- **Protected:** the master vault key is never written to disk by the app; the vault files on disk are useless without it. While the vault is open, the key lives in one session buffer. When the vault fully locks (no PIN set, or the PIN is locked out), that buffer is overwritten with zeros and dropped. With a PIN set, a normal lock keeps the key in memory so the PIN can reopen the vault until the app closes. When the app closes, the app shell ends the engine process and Windows clears that process's memory before reusing it; on a graceful engine shutdown (e.g. in development) the engine also overwrites the key itself first.
- **Not guaranteed:** Python and the cryptography library make short-lived copies of the key (one per request, plus the cipher's own copy). Python cannot overwrite those; they stay in freed memory until it is reused. Windows may also write memory to the page file or hibernation file.
- **So:** someone who can read this PC's memory or its page file while the app is running could find the key. Lock the vault when stepping away, and use full-disk encryption (e.g. BitLocker) so the page file and hibernation file are encrypted too.

---

### 3.4 Single-Version Photo Enhancement Pipeline

```mermaid
flowchart LR
    Import[Photo Import] --> Queue[Background Enhancer]
    Queue --> Battery{On battery and guard on?}
    Battery -- yes --> Wait[Pause until plugged in]
    Battery -- no --> Enhance[Upright + sharpen / enlarge to 8K in memory]
    Enhance --> Save[Save one AVIF: temp, fsync, verify, atomic replace]
    Save --> DB[(Row points at the AVIF)]
    DB --> Delete[Delete the old file]
```

- Every imported photo is enhanced once and the AVIF replaces the original (one version per photo). Camera details are kept; quality follows the Settings slider.
- No AI model is used in this pipeline. Blurry-face restoration was removed (no permissively licensed model); see `THIRD_PARTY_NOTICES.md`.
- Details: `.agents/history/features_and_functional_decisions.md` §102.

---

### 3.5 Soft-Delete Trash & Retention Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Lightbox as Lightbox / Grid UI
    participant API as FastAPI photos.py
    participant DB as SQLite WAL
    participant Purge as Trash purge (startup, then every 6 h)

    User->>Lightbox: Press Delete/Backspace or Click Trash
    Lightbox->>API: DELETE /api/photos/{id} (or POST /batch-trash)
    API->>DB: UPDATE photos SET trashed_at = CURRENT_TIMESTAMP, trash_expires_at = NOW + 30 Days
    API-->>Lightbox: 200 OK
    Lightbox->>Lightbox: Advance to adjacent photo or close

    Note over DB,Purge: 30-Day TTL Background Cleanup
    Purge->>DB: Delete rows trashed more than 30 days ago (rows first)
    Purge->>Purge: Then delete their files (originals, thumbnails, previews)
```

- **Query Isolation**: All library grids, searches, albums, and facial clusters enforce `WHERE trashed_at IS NULL`.
- **Restoration Guarantee**: Photos remain safely restorable for 30 days before permanent file system unlinking.

---

## 4. Database Schema (Entity-Relationship Model)

```mermaid
erDiagram
    PHOTO ||--o{ PHOTO_ALBUM : contains
    ALBUM ||--o{ PHOTO_ALBUM : groups
    PHOTO ||--o{ FACE : contains
    PERSON ||--o{ FACE : identifies
    PHOTO ||--o{ PHOTO_DOC_FOLDER : categorized_in
    DOCUMENT_FOLDER ||--o{ PHOTO_DOC_FOLDER : contains
    PHOTO ||--o{ DUPLICATE_GROUP : member_of
    SCAN_PATH ||--o{ IMPORT_TASK : triggers
    IMPORT_TASK ||--o{ IMPORT_ITEM : tracks

    PHOTO {
        int id PK
        string filename
        string filepath UK
        int file_size
        datetime created_at
        datetime taken_at
        string camera_make
        string camera_model
        float latitude
        float longitude
        int iso
        float aperture
        string shutter_speed
        float focal_length
        boolean is_favorite
        boolean is_encrypted
        string vault_type
        string thumbnail_path
        float blur_score
        string phash
        boolean is_document
        boolean faces_scanned
        boolean is_managed
        string file_hash
        datetime trashed_at
        datetime trash_expires_at
    }

    ALBUM {
        int id PK
        string name
        string description
        datetime created_at
        int cover_photo_id FK
        boolean is_vault
        string vault_type
        boolean is_favorite
    }

    PERSON {
        int id PK
        string name
        string reference_embedding
        datetime created_at
    }

    FACE {
        int id PK
        int photo_id FK
        int person_id FK
        float box_x
        float box_y
        float box_w
        float box_h
        string embedding
    }

    DOCUMENT_FOLDER {
        int id PK
        string name
        datetime created_at
    }

    SCAN_PATH {
        int id PK
        string path UK
        string volume_uuid
        string mode
        datetime last_scanned
        boolean is_active
        boolean is_scanning
    }

    VAULT_CONFIG {
        int id PK
        string vault_type
        string mvk_wrapped_password
        string mvk_wrapped_recovery
        string mvk_wrapped_card_cells
        string pin_verifier
        string password_hint
        boolean is_configured
    }

    APP_SETTINGS {
        int id PK
        string key UK
        string value
        datetime updated_at
    }
```
