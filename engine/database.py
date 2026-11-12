"""SQLite Relational Engine & Schema Migration Runner for SecurePhotos 2.0.

This module initializes the SQLite database with high-scale WAL mode pragmas,
composite covering indexes, FTS5 full-text search triggers, and provides
an idempotent schema migration runner designed for 100,000+ media assets.
"""

import logging
from pathlib import Path
from typing import Optional
import aiosqlite

from engine.config import settings

logger = logging.getLogger("securephotos.database")

# Pragmas executed on every SQLite connection for maximum throughput & durability
PRAGMAS = [
    "PRAGMA journal_mode = WAL;",
    "PRAGMA synchronous = NORMAL;",
    "PRAGMA cache_size = -64000;",      # 64 MB dedicated page cache
    "PRAGMA temp_store = MEMORY;",       # In-memory sorting and temp indexes
    "PRAGMA mmap_size = 268435456;",     # 256 MB memory-mapped I/O
    "PRAGMA busy_timeout = 30000;",      # 30000ms wait before lock error
    "PRAGMA foreign_keys = ON;",         # Enforce relational constraints
    "PRAGMA secure_delete = ON;",       # Zero out deleted data (vault details must not linger in free pages)
]

SCHEMA_DDL = """
-- ── 1. Photos Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    volume_uuid TEXT,               -- Physical disk UUID for drive portability
    file_size INTEGER NOT NULL,
    original_file_size INTEGER,     -- Raw baseline imported size in bytes for storage savings calculation
    mime_type TEXT DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    original_width INTEGER,         -- Pre-enhancement dimensions
    original_height INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    taken_at DATETIME,
    camera_make TEXT,
    camera_model TEXT,
    latitude REAL,
    longitude REAL,
    iso INTEGER,
    aperture REAL,
    shutter_speed TEXT,
    focal_length REAL,
    is_favorite BOOLEAN DEFAULT 0,
    is_encrypted BOOLEAN DEFAULT 0,
    encryption_key_id TEXT,
    vault_type TEXT,                -- 'documents' | 'private' | NULL
    thumbnail_path TEXT,            -- Sharded path: 'thumbnails/ab/ab12cd....webp' (or .enc)
    preview_path TEXT,              -- 2K/4K display proxy: 'previews/ab/ab12cd....avif' (or .enc)
    is_optimized BOOLEAN DEFAULT 0, -- 1 if compressed via AVIF/AV1/H.265
    is_enhanced BOOLEAN DEFAULT 0,  -- 1 if upscaled via AI Super-Resolution
    blur_score REAL,
    phash TEXT,
    ocr_text TEXT,                  -- Extracted text from documents/receipts
    caption TEXT,                   -- AI-generated scene description
    content_tags TEXT,              -- Comma-separated or JSON tags
    quality_score REAL,
    is_document BOOLEAN DEFAULT 0,
    is_pinned BOOLEAN DEFAULT 0,
    sensitivity_reviewed BOOLEAN DEFAULT 0,
    faces_scanned BOOLEAN DEFAULT 0,
    is_managed BOOLEAN DEFAULT 0,
    original_path TEXT,
    file_hash TEXT,                 -- SHA-256 checksum for deduplication & verification
    original_file_hash TEXT,        -- Immutable baseline SHA-256 checksum for deduplication
    folder_name TEXT,
    trashed_at DATETIME,
    trash_expires_at DATETIME
);

-- ── 2. Albums Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
    is_vault BOOLEAN DEFAULT 0,
    vault_type TEXT,
    is_favorite BOOLEAN DEFAULT 0
);

-- ── 3. Photo ↔ Album Junction ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_album (
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id, album_id)
);

-- ── 4. Persons Table (Social Affinity & Life-Stage Linked) ────────────────────
CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    reference_embedding TEXT,       -- 512-D centroid embedding
    anchor_faces_json TEXT,         -- JSON array of 3-4 representative face IDs (medoids)
    age_trajectory_json TEXT,       -- Chronological life-stage linking graph across years
    affinity_score REAL DEFAULT 0.0,-- Computed score (0.0 to 100.0)
    relationship_type TEXT,         -- 'Family' | 'Partner' | 'Friend' | 'Acquaintance'
    is_close_one BOOLEAN DEFAULT 0, -- 1 if affinity > threshold or user marked ⭐
    generate_stories BOOLEAN DEFAULT 1,
    cover_face_id INTEGER,
    confirmed_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 5. Faces Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
    cluster_id TEXT,                -- Unsupervised clustering candidate group
    box_x REAL NOT NULL,            -- Relative coordinates (0.0 to 1.0)
    box_y REAL NOT NULL,
    box_w REAL NOT NULL,
    box_h REAL NOT NULL,
    quality_score REAL DEFAULT 1.0, -- Sharpness, illumination & frontal score
    is_anchor_medoid BOOLEAN DEFAULT 0, -- 1 if chosen as a representative card face
    embedding TEXT NOT NULL          -- 512-D MobileFaceNet embedding vector
);

-- ── 6. Stories Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    story_type TEXT NOT NULL,        -- 'through_the_years' | 'duo_moments' | 'on_this_day' | 'adventure'
    vibe_mood TEXT DEFAULT 'acoustic',-- 'acoustic' | 'upbeat' | 'nostalgic' | 'cinematic'
    person_id INTEGER REFERENCES persons(id) ON DELETE CASCADE,
    cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
    music_track_path TEXT,          -- Relative path to bundled or custom soundtrack
    rendered_video_path TEXT,       -- Optional cached 4K MP4 export
    is_saved BOOLEAN DEFAULT 0,     -- Google Photos-style bookmark / permanent keep
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 7. Story Items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    transition_type TEXT DEFAULT 'crossfade', -- 'crossfade' | 'zoom_in' | 'pan_right'
    focal_x REAL DEFAULT 0.5,       -- Ken-Burns focus point (face center)
    focal_y REAL DEFAULT 0.5
);

-- ── 8. Creative Assets Table (Collages & Wallpapers) ─────────────────────────
CREATE TABLE IF NOT EXISTS creative_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_type TEXT NOT NULL,        -- 'collage' | 'wallpaper' | 'highlight_montage'
    title TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,   -- 'creatives/collages/2026/summer_collage.avif'
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    source_photo_ids TEXT,           -- JSON array of photo IDs used in asset
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 9. Document Folders Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,      -- e.g. 'Invoices', 'Passports', 'Receipts'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 10. Photo ↔ Document Folder Junction ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_document_folder (
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES document_folders(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, folder_id)
);

-- ── 11. Scan Paths Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    volume_uuid TEXT,
    mode TEXT DEFAULT 'scan',       -- 'scan' (in-place) or 'import' (managed library)
    last_scanned DATETIME,
    is_active BOOLEAN DEFAULT 1,
    is_scanning BOOLEAN DEFAULT 0,
    scan_total INTEGER DEFAULT 0,
    scan_processed INTEGER DEFAULT 0
);

-- ── 12. Transactional Import Tasks ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_path_id INTEGER REFERENCES scan_paths(id) ON DELETE SET NULL,
    scan_path TEXT,
    volume_uuid TEXT,
    status TEXT DEFAULT 'queued',   -- 'queued' | 'scanning' | 'importing' | 'paused' | 'completed' | 'failed'
    total_files INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    imported_count INTEGER DEFAULT 0,
    failed_files INTEGER DEFAULT 0,
    delete_originals BOOLEAN DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    error_message TEXT
);

-- ── 13. Import Items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
    source_path TEXT NOT NULL,
    dest_path TEXT,
    status TEXT DEFAULT 'pending',  -- 'pending' | 'imported' | 'skipped' | 'failed'
    file_hash TEXT,
    error_message TEXT
);

-- ── 14. Optimization & AI Super-Resolution Tasks ────────────────────────────
CREATE TABLE IF NOT EXISTS optimization_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL,        -- '4k_compress' | 'ai_upscale_and_compress' | 'proxy_gen'
    status TEXT DEFAULT 'queued',   -- 'queued' | 'running' | 'paused' | 'completed' | 'failed'
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    bytes_saved INTEGER DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    error_message TEXT
);

-- ── 15. Optimization Items (Atomic Swap Journal) ────────────────────────────
CREATE TABLE IF NOT EXISTS optimization_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES optimization_tasks(id) ON DELETE CASCADE,
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',  -- 'pending' | 'processing' | 'swapped' | 'failed'
    original_size INTEGER,
    new_size INTEGER,
    temp_filepath TEXT,             -- Temporary .tmp file tracking for crash recovery
    error_message TEXT
);

-- ── 16. Multi-Slot Vault Configurations Table ────────────────────────────────
CREATE TABLE IF NOT EXISTS vault_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_type TEXT NOT NULL UNIQUE,          -- 'private' or 'documents'
    mvk_wrapped_password TEXT NOT NULL,      -- Master Key encrypted with Argon2id password key
    mvk_wrapped_pin TEXT,                    -- Master Key encrypted with 4-digit PIN key
    mvk_wrapped_biometric TEXT,              -- Master Key encrypted with Windows Hello / TPM key
    mvk_wrapped_recovery TEXT NOT NULL,       -- Master Key encrypted with 24-word recovery key
    password_salt TEXT NOT NULL,             -- Randomized 16-byte salt for Argon2id
    pin_salt TEXT,                           -- Randomized 16-byte salt for Argon2id PIN key
    password_hint TEXT,
    pin_failed_attempts INTEGER DEFAULT 0,   -- Counter for brute-force rate-limiting
    has_pin BOOLEAN DEFAULT 0,               -- Flag indicating PIN is enrolled
    totp_secret_encrypted TEXT,              -- Optional encrypted secret key for RFC 6238 TOTP
    has_biometrics BOOLEAN DEFAULT 0,
    grid_card_id TEXT,                       -- Emergency Grid Card ID (e.g. SP-8492-7104)
    grid_cells_hash TEXT,                    -- Salted JSON hashes of 16 card cells for challenge verification
    grid_salt TEXT,                          -- Randomized salt for card cell verification
    is_configured BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 17. App Settings Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 18. Duplicate Groups Table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duplicate_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    match_type TEXT NOT NULL,        -- 'exact' (hash) or 'near' (phash)
    distance INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 19. Duplicate Dismissals Table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id_1 INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    photo_id_2 INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(photo_id_1, photo_id_2)
);

CREATE INDEX IF NOT EXISTS ix_dup_dismissals 
ON duplicate_dismissals (photo_id_1, photo_id_2);

-- ── Composite Covering Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_photos_active_taken 
ON photos (is_encrypted, trashed_at, taken_at DESC);

CREATE INDEX IF NOT EXISTS ix_photos_fav_taken 
ON photos (is_favorite, is_encrypted, trashed_at, taken_at DESC);

CREATE INDEX IF NOT EXISTS ix_photos_volume_uuid 
ON photos (volume_uuid);

CREATE INDEX IF NOT EXISTS ix_photos_opt_pending 
ON photos (is_optimized, is_enhanced, is_encrypted, trashed_at) WHERE is_encrypted = 0;

CREATE INDEX IF NOT EXISTS ix_persons_affinity 
ON persons (is_close_one, affinity_score DESC);

CREATE INDEX IF NOT EXISTS ix_stories_person_id 
ON stories (person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_story_items_story_id 
ON story_items (story_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS ix_photos_vault_type 
ON photos (is_encrypted, vault_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_photos_trash_expires 
ON photos (trash_expires_at) WHERE trash_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_photos_file_hash 
ON photos (file_hash);

CREATE INDEX IF NOT EXISTS ix_photos_phash 
ON photos (phash) WHERE phash IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_faces_photo_id ON faces (photo_id);
CREATE INDEX IF NOT EXISTS ix_faces_person_id ON faces (person_id);
CREATE INDEX IF NOT EXISTS ix_faces_cluster_id ON faces (cluster_id);
CREATE INDEX IF NOT EXISTS ix_photo_album_album_id ON photo_album (album_id);
CREATE INDEX IF NOT EXISTS ix_import_items_task_id ON import_items (task_id);
CREATE INDEX IF NOT EXISTS ix_opt_items_task_id ON optimization_items (task_id);
CREATE INDEX IF NOT EXISTS ix_photos_counts ON photos (is_document, mime_type, trashed_at);

-- ── Full-Text Search Table (FTS5) ───────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
    filename,
    folder_name,
    caption,
    content_tags,
    ocr_text,
    content='photos',
    content_rowid='id'
);

-- ── FTS5 Synchronization Triggers (Strictly excluding encrypted vault photos)
CREATE TRIGGER IF NOT EXISTS photos_ai AFTER INSERT ON photos WHEN new.is_encrypted = 0 BEGIN
  INSERT INTO photos_fts(rowid, filename, folder_name, caption, content_tags, ocr_text)
  VALUES (new.id, new.filename, new.folder_name, new.caption, new.content_tags, new.ocr_text);
END;

CREATE TRIGGER IF NOT EXISTS photos_ad AFTER DELETE ON photos WHEN old.is_encrypted = 0 BEGIN
  INSERT INTO photos_fts(photos_fts, rowid, filename, folder_name, caption, content_tags, ocr_text)
  VALUES('delete', old.id, old.filename, old.folder_name, old.caption, old.content_tags, old.ocr_text);
END;

CREATE TRIGGER IF NOT EXISTS photos_au AFTER UPDATE OF filename, folder_name, caption, content_tags, ocr_text, is_encrypted ON photos BEGIN
  INSERT INTO photos_fts(photos_fts, rowid, filename, folder_name, caption, content_tags, ocr_text)
  SELECT 'delete', old.id, old.filename, old.folder_name, old.caption, old.content_tags, old.ocr_text
  WHERE old.is_encrypted = 0;
  INSERT INTO photos_fts(rowid, filename, folder_name, caption, content_tags, ocr_text)
  SELECT new.id, new.filename, new.folder_name, new.caption, new.content_tags, new.ocr_text
  WHERE new.is_encrypted = 0;
END;

-- ── 20. Video Processing Queue Table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_processing_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL UNIQUE REFERENCES photos(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_height INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_video_queue_status
ON video_processing_queue (status, created_at);

-- ── 20b. Vault Operation Journal (crash recovery) ──────────────────────────
-- One row per photo while it is being moved into or out of the vault.
-- file_pairs is JSON [[plain_path, enc_path], ...] (portable relative paths).
-- On startup, engine.services.vault_storage.reconcile_pending_vault_ops keeps
-- the side the committed photos row points at and removes the leftovers.
CREATE TABLE IF NOT EXISTS vault_pending_ops (
    photo_id INTEGER PRIMARY KEY,
    operation TEXT NOT NULL,        -- 'lock' | 'unlock'
    file_pairs TEXT NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 21. Self-Healing Relational Cascade Triggers ────────────────────────────
-- Automatically purge video queue item when parent photo is deleted anywhere
CREATE TRIGGER IF NOT EXISTS trg_photos_delete_purge_video_queue
AFTER DELETE ON photos
BEGIN
    DELETE FROM video_processing_queue WHERE photo_id = OLD.id;
END;

-- Automatically cancel and purge video queue item when photo is moved to trash
CREATE TRIGGER IF NOT EXISTS trg_photos_trash_purge_video_queue
AFTER UPDATE OF trashed_at ON photos
WHEN NEW.trashed_at IS NOT NULL
BEGIN
    DELETE FROM video_processing_queue WHERE photo_id = NEW.id;
END;

-- Automatically reset album cover if cover photo is deleted
CREATE TRIGGER IF NOT EXISTS trg_photos_delete_update_album_cover
AFTER DELETE ON photos
BEGIN
    UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
END;

-- Automatically reset album cover if cover photo is moved to trash
CREATE TRIGGER IF NOT EXISTS trg_photos_trash_update_album_cover
AFTER UPDATE OF trashed_at ON photos
WHEN NEW.trashed_at IS NOT NULL
BEGIN
    UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = NEW.id;
END;
"""


async def get_db_connection(db_path: Optional[Path] = None) -> aiosqlite.Connection:
    """Creates and configures an asynchronous SQLite connection with WAL pragmas.

    Args:
        db_path: Optional custom path to SQLite database. Defaults to settings.database_path.

    Returns:
        Configured aiosqlite.Connection instance.
    """
    target_path = db_path or settings.database_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = await aiosqlite.connect(target_path, timeout=30.0)
    conn.row_factory = aiosqlite.Row

    # Execute all performance and durability pragmas
    for pragma in PRAGMAS:
        await conn.execute(pragma)

    return conn


async def rebuild_fts_index(
    conn: Optional[aiosqlite.Connection] = None,
    db_path: Optional[Path] = None,
) -> None:
    """Rebuilds the FTS5 full-text search index from the external photos table.

    Provides automated self-healing against SQLite external content shadow segment
    desynchronization (which manifests as 'database disk image is malformed').

    Args:
        conn: Optional active aiosqlite connection. If None, opens a new connection.
        db_path: Optional custom path to SQLite database. Defaults to settings.database_path.
    """
    should_close = False
    if conn is None:
        conn = await get_db_connection(db_path)
        should_close = True

    try:
        logger.info("Executing FTS5 index rebuild on photos_fts...")
        await conn.execute("INSERT INTO photos_fts(photos_fts) VALUES('rebuild');")
        await conn.commit()
        logger.info("FTS5 index successfully rebuilt and resynchronized.")
    except Exception as e:
        logger.error("Failed to rebuild FTS5 index: %s", e, exc_info=True)
        raise
    finally:
        if should_close:
            await conn.close()


async def _apply_one_time_migrations(conn: aiosqlite.Connection) -> None:
    """Runs data migrations that must happen exactly once per library.

    Each migration is recorded by name in ``applied_migrations`` and committed
    together with its changes, so it never re-runs (e.g. after an unplug).
    """
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS applied_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"
    )

    async def already_applied(name: str) -> bool:
        async with conn.execute("SELECT 1 FROM applied_migrations WHERE name = ?;", (name,)) as cur:
            return await cur.fetchone() is not None

    # C1: since paths became relative (Oct 2026), the enhancer couldn't find new imports
    # and marked them optimized without enhancing. Give those photos another pass.
    name = "2026_11_c1_requeue_skipped_enhancement"
    if not await already_applied(name):
        cur = await conn.execute(
            """
            UPDATE photos SET is_optimized = 0
            WHERE is_optimized = 1 AND is_enhanced = 0 AND is_encrypted = 0 AND trashed_at IS NULL
              AND (mime_type IS NULL OR mime_type NOT LIKE 'video/%');
            """
        )
        await conn.execute("INSERT INTO applied_migrations (name) VALUES (?);", (name,))
        await conn.commit()
        if cur.rowcount:
            logger.info("Re-queued %d photo(s) for enhancement that were skipped earlier.", cur.rowcount)

    # H9: which model produced each face embedding. NULL = legacy ArcFace (512-D).
    async with conn.execute("PRAGMA table_info(faces);") as cursor:
        face_cols = {row["name"] for row in await cursor.fetchall()}
    if "embedding_model" not in face_cols:
        await conn.execute("ALTER TABLE faces ADD COLUMN embedding_model TEXT;")
        await conn.commit()

    # H9: People moved to permissively licensed models (YuNet + SFace). Re-scan every
    # library photo once; the scanner carries names over to the new faces by position.
    # Resumable: each photo is marked scanned in the same commit as its face swap.
    name = "2026_11_h9_rescan_faces_permissive_models"
    if not await already_applied(name):
        cur = await conn.execute(
            "UPDATE photos SET faces_scanned = 0 WHERE is_encrypted = 0 AND trashed_at IS NULL;"
        )
        await conn.execute("INSERT INTO applied_migrations (name) VALUES (?);", (name,))
        await conn.commit()
        logger.info("Queued %d photo(s) to re-scan faces with the new face models.", cur.rowcount)

    # H9: the old scanner stored face boxes as numpy float32, which SQLite keeps as
    # 4-byte blobs. Convert every such box to a real number (faces that aren't
    # re-scanned, e.g. on vault photos or named faces the new model didn't find).
    name = "2026_11_h9_face_boxes_to_numbers"
    if not await already_applied(name):
        import struct

        def as_number(v):
            if isinstance(v, (bytes, bytearray)) and len(v) in (4, 8):
                return struct.unpack("<f" if len(v) == 4 else "<d", v)[0]
            return v

        async with conn.execute(
            "SELECT id, box_x, box_y, box_w, box_h FROM faces "
            "WHERE typeof(box_x) = 'blob' OR typeof(box_y) = 'blob' OR typeof(box_w) = 'blob' OR typeof(box_h) = 'blob';"
        ) as cursor:
            blob_rows = await cursor.fetchall()
        for r in blob_rows:
            await conn.execute(
                "UPDATE faces SET box_x = ?, box_y = ?, box_w = ?, box_h = ? WHERE id = ?;",
                (*(as_number(r[k]) for k in ("box_x", "box_y", "box_w", "box_h")), r["id"]),
            )
        await conn.execute("INSERT INTO applied_migrations (name) VALUES (?);", (name,))
        await conn.commit()
        if blob_rows:
            logger.info("Converted %d stored face box(es) from binary to numbers.", len(blob_rows))


async def run_migrations(db_path: Optional[Path] = None) -> None:
    """Executes idempotent database schema migrations, indexes, and triggers.

    Ensures that triggers are scoped strictly to their dependent columns (e.g. photos_au
    only fires on searchable text mutations, not thumbnail/preview/favorite updates)
    and validates FTS5 index integrity.

    Args:
        db_path: Optional custom path to SQLite database. Defaults to settings.database_path.
    """
    settings.ensure_directories()
    target_path = db_path or settings.database_path
    logger.info(f"Running database schema migrations on: {target_path}")

    conn = await get_db_connection(target_path)
    try:
        await conn.executescript(SCHEMA_DDL)
        await _apply_one_time_migrations(conn)

        # Drop legacy unscoped photos_ad & photos_au triggers if present and recreate vault-safe versions
        await conn.execute("DROP TRIGGER IF EXISTS photos_ad;")
        await conn.execute("DROP TRIGGER IF EXISTS photos_au;")
        await conn.execute("""
            CREATE TRIGGER IF NOT EXISTS photos_ad AFTER DELETE ON photos WHEN old.is_encrypted = 0 BEGIN
              INSERT INTO photos_fts(photos_fts, rowid, filename, folder_name, caption, content_tags, ocr_text)
              VALUES('delete', old.id, old.filename, old.folder_name, old.caption, old.content_tags, old.ocr_text);
            END;
        """)
        await conn.execute("""
            CREATE TRIGGER IF NOT EXISTS photos_au AFTER UPDATE OF 
                filename, folder_name, caption, content_tags, ocr_text, is_encrypted 
            ON photos BEGIN
              INSERT INTO photos_fts(photos_fts, rowid, filename, folder_name, caption, content_tags, ocr_text)
              SELECT 'delete', old.id, old.filename, old.folder_name, old.caption, old.content_tags, old.ocr_text
              WHERE old.is_encrypted = 0;
              INSERT INTO photos_fts(rowid, filename, folder_name, caption, content_tags, ocr_text)
              SELECT new.id, new.filename, new.folder_name, new.caption, new.content_tags, new.ocr_text
              WHERE new.is_encrypted = 0;
            END;
        """)

        # Self-healing: Rebuild FTS index to guarantee clean synchronization with external content
        try:
            await rebuild_fts_index(conn=conn)
        except Exception as fts_err:
            logger.warning("FTS index rebuild notice during migration: %s", fts_err)

        # Mark all enhanced videos as is_optimized=1 to avoid photo 8K worker collisions
        await conn.execute("UPDATE photos SET is_optimized = 1 WHERE mime_type LIKE 'video/%' AND is_enhanced = 1;")

        # Self-healing: Purge any orphaned or trashed video processing queue rows
        await conn.execute("DELETE FROM video_processing_queue WHERE photo_id NOT IN (SELECT id FROM photos WHERE trashed_at IS NULL);")

        # Self-healing: Reset any invalid, deleted, or trashed album cover references
        await conn.execute(
            """
            UPDATE albums 
            SET cover_photo_id = NULL 
            WHERE cover_photo_id IS NOT NULL 
              AND cover_photo_id NOT IN (SELECT id FROM photos WHERE trashed_at IS NULL);
            """
        )

        # Self-healing: Ensure albums with 0 photos have cover_photo_id set to NULL
        await conn.execute(
            """
            UPDATE albums 
            SET cover_photo_id = NULL 
            WHERE id NOT IN (SELECT album_id FROM photo_album);
            """
        )

        # Smart album parity: System smart albums like Collages cannot be favorited
        await conn.execute("UPDATE albums SET is_favorite = 0 WHERE LOWER(name) = 'collages';")

        # Self-healing: Normalize legacy relationship types to streamlined 5 categories
        await conn.execute("""
            UPDATE persons 
            SET relationship_type = 'Family' 
            WHERE relationship_type IN ('Spouse', 'Child', 'Parent', 'Sibling', 'Extended Family', 'Wife', 'Husband', 'Partner', 'Son', 'Daughter', 'Mother', 'Father', 'Brother', 'Sister');
        """)
        await conn.execute("UPDATE persons SET relationship_type = 'Friends' WHERE relationship_type = 'Friend';")
        await conn.execute("UPDATE persons SET relationship_type = 'Relatives' WHERE relationship_type = 'Relative';")
        await conn.execute("UPDATE persons SET relationship_type = 'Colleagues' WHERE relationship_type = 'Colleague';")
        await conn.execute("UPDATE persons SET relationship_type = 'Acquaintances' WHERE relationship_type = 'Acquaintance';")

        # Self-healing: Purge orphaned persons with no associated face records in the database
        await conn.execute("DELETE FROM persons WHERE id NOT IN (SELECT DISTINCT person_id FROM faces WHERE person_id IS NOT NULL);")

        # Self-healing: Purge orphaned stories referencing non-existent persons
        await conn.execute("DELETE FROM stories WHERE person_id IS NOT NULL AND person_id NOT IN (SELECT id FROM persons);")

        # Multi-slot vault migrations: dynamically add PIN columns if not present
        async with conn.execute("PRAGMA table_info(vault_configs);") as cursor:
            existing_cols = {row["name"] for row in await cursor.fetchall()}
        
        if "mvk_wrapped_pin" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN mvk_wrapped_pin TEXT;")
        if "pin_salt" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN pin_salt TEXT;")
        if "pin_failed_attempts" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN pin_failed_attempts INTEGER DEFAULT 0;")
        if "has_pin" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN has_pin BOOLEAN DEFAULT 0;")
        if "grid_card_id" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN grid_card_id TEXT;")
        if "grid_cells_hash" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN grid_cells_hash TEXT;")
        if "grid_salt" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN grid_salt TEXT;")
        # C2: the PIN is only a quick re-unlock. Only an Argon2id hash of it is stored;
        # it never wraps the vault key (mvk_wrapped_pin / pin_salt are no longer written).
        if "pin_verifier" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN pin_verifier TEXT;")
        # C3: recovery slot derived from all 16 Emergency Card numbers.
        if "mvk_wrapped_card_cells" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN mvk_wrapped_card_cells TEXT;")
        if "card_cells_salt" not in existing_cols:
            await conn.execute("ALTER TABLE vault_configs ADD COLUMN card_cells_salt TEXT;")

        # Original media size migration: dynamically add original_file_size column if not present
        async with conn.execute("PRAGMA table_info(photos);") as cursor:
            existing_photo_cols = {row["name"] for row in await cursor.fetchall()}

        # C4: a vault photo's document text and GPS, encrypted with the vault key.
        if "vault_meta_enc" not in existing_photo_cols:
            await conn.execute("ALTER TABLE photos ADD COLUMN vault_meta_enc TEXT;")

        # C4: face crops (and other files) to delete once a lock has committed.
        async with conn.execute("PRAGMA table_info(vault_pending_ops);") as cursor:
            journal_cols = {row["name"] for row in await cursor.fetchall()}
        if "cleanup_paths" not in journal_cols:
            await conn.execute("ALTER TABLE vault_pending_ops ADD COLUMN cleanup_paths TEXT;")

        if "original_file_size" not in existing_photo_cols:
            await conn.execute("ALTER TABLE photos ADD COLUMN original_file_size INTEGER;")
            await conn.execute("UPDATE photos SET original_file_size = file_size WHERE original_file_size IS NULL;")
            logger.info("Migrated photos schema: added original_file_size column and backfilled baseline sizes.")

        if "original_file_hash" not in existing_photo_cols:
            await conn.execute("ALTER TABLE photos ADD COLUMN original_file_hash TEXT;")
            await conn.execute("UPDATE photos SET original_file_hash = file_hash WHERE original_file_hash IS NULL;")
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_original_file_hash ON photos(original_file_hash);")
            logger.info("Migrated photos schema: added original_file_hash column and backfilled hashes.")

        if "is_pinned" not in existing_photo_cols:
            await conn.execute("ALTER TABLE photos ADD COLUMN is_pinned BOOLEAN DEFAULT 0;")
            logger.info("Migrated photos schema: added is_pinned column.")

        await conn.execute("CREATE INDEX IF NOT EXISTS ix_photos_pinned_doc ON photos (is_pinned DESC, is_document, trashed_at);")

        # Stories lifecycle migration: dynamically add is_saved and covering indexes
        async with conn.execute("PRAGMA table_info(stories);") as cursor:
            existing_story_cols = {row["name"] for row in await cursor.fetchall()}

        if "is_saved" not in existing_story_cols:
            await conn.execute("ALTER TABLE stories ADD COLUMN is_saved BOOLEAN DEFAULT 0;")
            logger.info("Migrated stories schema: added is_saved column.")

        await conn.execute("CREATE INDEX IF NOT EXISTS idx_stories_saved_created ON stories(is_saved, created_at DESC);")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_story_items_story_id ON story_items(story_id, sort_order ASC);")

        # Self-heal encrypted photos whose thumbnail_path in DB points to unencrypted .webp while .enc exists
        async with conn.execute("SELECT id, thumbnail_path FROM photos WHERE is_encrypted = 1;") as cursor:
            enc_photos = await cursor.fetchall()

        for p in enc_photos:
            p_id = p["id"]
            t_path = p["thumbnail_path"]
            if t_path and not Path(t_path).exists():
                cand1 = Path(t_path).with_suffix(".enc")
                cand2 = Path(str(t_path) + ".enc")
                if cand1.exists():
                    await conn.execute("UPDATE photos SET thumbnail_path = ? WHERE id = ?;", (str(cand1), p_id))
                elif cand2.exists():
                    await conn.execute("UPDATE photos SET thumbnail_path = ? WHERE id = ?;", (str(cand2), p_id))

        # Dynamic Drive Portability: Normalize legacy absolute paths to relative paths
        # Ensures that moving the library or changing drive letters (D: -> E: -> F:) never breaks media
        for anchor in ("originals", "vault"):
            await conn.execute(
                f"""
                UPDATE photos 
                SET filepath = SUBSTR(filepath, INSTR(filepath, '/{anchor}/') + 1)
                WHERE filepath LIKE '%/{anchor}/%';
                """
            )
            await conn.execute(
                f"""
                UPDATE photos 
                SET filepath = REPLACE(SUBSTR(filepath, INSTR(filepath, '\\{anchor}\\') + 1), '\\', '/')
                WHERE filepath LIKE '%\\{anchor}\\%';
                """
            )

        await conn.commit()
        logger.info("Database schema migrations executed successfully.")
    except Exception as e:
        logger.error(f"Failed to execute schema migrations: {e}", exc_info=True)
        raise
    finally:
        await conn.close()
