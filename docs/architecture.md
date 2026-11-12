# 📐 SecurePhotos: System Architecture & Technical Design

---

## 1. Architectural Philosophy & Core Principles

SecurePhotos is designed as an **offline-first, zero-cloud personal media vault**. The system prioritizes:
1. **Data Sovereignty & Zero Trust**: No telemetry, no cloud dependencies, and zero external network calls.
2. **High Scale & Low Latency**: Lightning-fast access across libraries containing 100,000+ high-resolution photos and videos.
3. **Defense-in-Depth Cryptography**: Strong at-rest encryption (AES-256-GCM with PBKDF2/Argon2id key derivation) and ephemeral in-memory decryption.
4. **Drive Portability**: Database, caches, and thumbnails live within a self-contained directory tree that can travel with external hard drives and SSDs.

---

## 2. High-Level System Architecture

```mermaid
graph TB
    subgraph UI_Layer ["Presentation Tier (Tauri 2.0 / React 18)"]
        ReactUI["React 18 SPA (Vite)<br/>• Pure CSS Design Tokens<br/>• Virtualized Grids (@tanstack/react-virtual)<br/>• Fluid Lightbox & Keyboard Shortcuts"]
        TauriShell["Tauri 2.0 Native Shell (Rust)<br/>• OS WebView2 (30-40 MB RAM)<br/>• Native Window Controls & Menus<br/>• IPC Bridge & File Confinement"]
        
        TauriShell --> ReactUI
    end

    subgraph Service_Layer ["Application Tier (FastAPI Engine)"]
        FastAPIApp["FastAPI Web Server (Port 8000 / Dynamic)"]
        AuthMiddleware["Vault Auth & JWT Verification"]
        
        subgraph Domain_Routers ["Domain Routers"]
            PhotosR["Photos & EXIF"]
            ScanR["Scan & Watcher"]
            VaultR["AES-256-GCM Vault"]
            PeopleR["Face & People"]
            InsightsR["Duplicates & Blur"]
            ImportR["Transactional Import"]
            ThumbR["Thumbnail Stream"]
            TrashR["Trash & Purge"]
        end
        
        FastAPIApp --> AuthMiddleware
        AuthMiddleware --> Domain_Routers
    end

    subgraph Background_Workers ["Asynchronous Background Workers"]
        ScanWorker["Auto-Scan Daemon<br/>(Every 300s)"]
        AIWorker["AI & SLM Inference Daemon<br/>(MobileCLIP & Moondream2)"]
        TrashWorker["Trash Purge Daemon<br/>(Hourly 7-day TTL)"]
    end

    subgraph Storage_Tier ["Storage & Data Tier"]
        DB[(SQLite DB<br/>WAL Mode & Pragmas)]
        ThumbStore["Sharded Thumbnails<br/>(2-Char Prefix Hashing)"]
        RawPhotos["Managed / Original Photos"]
        EncryptedVault["AES-256-GCM Encrypted Files<br/>(*.enc)"]
        ModelsDir["ONNX & GGUF Models<br/>(MobileCLIP & BlazeFace)"]
    end

    ReactUI -->|Typed IPC / HTTP| FastAPIApp
    TauriShell -->|Spawns & Monitors| FastAPIApp

    Domain_Routers --> DB
    Domain_Routers --> ThumbStore
    Domain_Routers --> RawPhotos
    Domain_Routers --> EncryptedVault

    Background_Workers --> DB
    Background_Workers --> ModelsDir
    Background_Workers --> ThumbStore
```

---

## 3. Subsystem Workflows & Flowcharts

### 3.1 Photo Ingestion & Indexing Pipeline

```mermaid
flowchart TD
    StartScan([Start Directory Scan]) --> WalkDir[Traverse Filesystem via os.scandir]
    WalkDir --> FilterExt{Supported Extension?<br/>.jpg, .png, .heic, .webp, .mp4}
    
    FilterExt -- No --> NextFile[Skip File]
    FilterExt -- Yes --> ReadMeta[Read File Stat & Size]
    
    ReadMeta --> CheckDB{Filepath or File Hash<br/>in DB?}
    CheckDB -- Exists & Unchanged --> NextFile
    CheckDB -- New or Modified --> ExtractEXIF[Extract EXIF Metadata<br/>Date, GPS, Camera, ISO, F-Stop]
    
    ExtractEXIF --> GenHash[Compute SHA-256 File Hash]
    GenHash --> GenThumb[Generate Multi-Size Thumbnails<br/>Pillow Lanczos Resize]
    
    GenThumb --> ShardThumb[Store Thumbnail in Sharded Path<br/>thumbnails/ab/ab12cd34....jpg]
    ShardThumb --> InsertDB[Insert Record to 'photos' Table<br/>faces_scanned=False, trashed_at=Null]
    
    InsertDB --> BatchCommit{Batch Threshold Met?<br/>100 items}
    BatchCommit -- Yes --> CommitDB[(Commit DB Transaction)]
    BatchCommit -- No --> NextFile
    
    CommitDB --> NextFile
    NextFile --> MoreFiles{More Files?}
    MoreFiles -- Yes --> WalkDir
    MoreFiles -- No --> FinishScan([Scan Completed])
```

---

### 3.2 Dual Hybrid Search Pipeline (FTS5 + Vector)

```mermaid
flowchart LR
    UserQuery["Search: 'electric bill from last winter'"] --> QueryParser[Query Analyzer]
    
    QueryParser --> TextBranch["1. SQLite FTS5 (Lexical Search)<br/>Matches OCR text, EXIF dates, filenames"]
    QueryParser --> VectorBranch["2. MobileCLIP / SigLIP Encoder<br/>Converts text query to 512-D Vector"]
    
    VectorBranch --> VectorSearch["sqlite-vec Cosine Similarity<br/>Queries pre-indexed photo/doc embeddings"]
    
    TextBranch --> RRF["Reciprocal Rank Fusion (RRF)<br/>Combines & re-ranks top 50 matches"]
    VectorSearch --> RRF
    
    RRF --> TopResults["Top Results rendered in < 8ms"]
```

---

### 3.3 Encrypted Vault Security Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI (Vault Page)
    participant Auth as Vault Controller
    participant State as In-Memory State (_vault_sessions)
    participant Crypto as Vault Crypto Engine (AES-GCM)
    participant Disk as Encrypted Storage (.enc)

    Note over User,Disk: 1. Authentication & Unlock
    User->>UI: Enter Vault Password (+ TOTP if enabled)
    UI->>Auth: POST /vault/verify {password, totp_code}
    Auth->>Auth: Validate bcrypt hash & TOTP token
    Auth->>State: Store password in-memory with session_id & 5-min TTL
    Auth->>UI: Return JWT Token {sid: session_id, exp}

    Note over User,Disk: 2. Locking a Photo into the Vault
    User->>UI: Select photo -> "Move to Vault"
    UI->>Auth: POST /photos/{id}/lock (Bearer JWT)
    Auth->>State: Verify JWT & retrieve in-memory password
    Auth->>Crypto: encrypt_file_streaming(photo.filepath, password)
    Crypto->>Crypto: Derive Key via Argon2id / PBKDF2
    Crypto->>Crypto: Per-file key = HKDF(vault key, random file salt); 64 KB chunks, AES-256-GCM
    Crypto->>Disk: Write SPENC03 header (magic + file salt) + chunks (counter + last-chunk flag in nonce, header authenticated)
    Crypto->>Disk: Securely delete unencrypted original
    Auth->>UI: Return 200 OK

    Note over User,Disk: 3. Viewing Encrypted Photo / Streaming
    User->>UI: Open Vault Thumbnail / Lightbox
    UI->>Auth: GET /photos/{id}/vault-raw (Bearer JWT)
    Auth->>State: Validate JWT session
    Auth->>Crypto: decrypt_file_stream(filepath.enc, password)
    Crypto->>Disk: Read chunks, verify each tag; reject missing last chunk, extra data or old formats
    Crypto-->>Auth: Stream decrypted chunk buffer to HTTP response
    Auth-->>UI: Image/Video renders smoothly (Zero Disk Footprint)
```

---

### 3.3 Single-Version Photo Enhancement Pipeline

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

### 3.4 Soft-Delete Trash & Retention Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Lightbox as Lightbox / Grid UI
    participant API as FastAPI photos.py
    participant DB as SQLite WAL
    participant Purge as Hourly Purge Daemon

    User->>Lightbox: Press Delete/Backspace or Click Trash
    Lightbox->>API: DELETE /api/photos/{id} (or POST /batch-trash)
    API->>DB: UPDATE photos SET trashed_at = CURRENT_TIMESTAMP, trash_expires_at = NOW + 30 Days
    API-->>Lightbox: 200 OK
    Lightbox->>Lightbox: Advance to adjacent photo or close

    Note over DB,Purge: 30-Day TTL Background Cleanup
    Purge->>DB: DELETE FROM photos WHERE trashed_at IS NOT NULL AND trash_expires_at < CURRENT_TIMESTAMP
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
        string password_hash
        string password_hint
        string totp_secret
        boolean is_configured
    }

    APP_SETTINGS {
        int id PK
        string key UK
        string value
        datetime updated_at
    }
```
