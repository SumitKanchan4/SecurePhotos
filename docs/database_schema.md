# Database

SecurePhotos keeps everything about a library in one SQLite database inside the library folder (`database/securephotos.db`). This document explains how the database is set up, the indexes that keep large libraries fast, and how search works.

The tables themselves are defined in [engine/database.py](../engine/database.py), together with every migration. That file is the single source of truth; [architecture.md](architecture.md#4-the-database) has a short guide to the main tables.

## 1. Connection settings

Every connection runs these settings first (`PRAGMAS` in `engine/database.py`):

```sql
PRAGMA journal_mode = WAL;        -- readers keep working while a background worker writes
PRAGMA synchronous = NORMAL;      -- safe with WAL, without a disk flush on every write
PRAGMA cache_size = -64000;       -- a 64 MB page cache
PRAGMA temp_store = MEMORY;       -- sorting and temporary indexes in memory
PRAGMA mmap_size = 268435456;     -- 256 MB of memory-mapped reads
PRAGMA busy_timeout = 30000;      -- wait up to 30 s for a lock before giving up
PRAGMA foreign_keys = ON;         -- enforce the links between tables
PRAGMA secure_delete = ON;        -- overwrite deleted data, so vault details don't linger in free pages
```

## 2. Rules every query follows

- **Paths are relative** to the library folder (`to_db_path` to store, `resolve_stored_path` to read), so the library can move with its drive.
- **Trash and the vault are left out** of every library view: `trashed_at IS NULL` and `is_encrypted = 0`, unless the query is for Trash or the vault itself.
- **One tile per original and its copies.** An improved copy points at its original with `derived_from_id`; library queries use `stack_top()` (`engine/services/photo_versions.py`) so only the newest copy shows.
- **Each after-import step is recorded on the photo:** `ocr_text` (NULL means not read yet, an empty string means read and empty), `faces_scanned`, `restore_checked`, `phash` and `is_optimized`. `PREPARING` and `PREPARING_STEP` in `engine/services/after_import.py` turn these into "still being prepared" and "on step N".
- **Migrations only add.** A new column is added in `run_migrations` with a safe default, and existing rows are given the value that keeps their behaviour.

## 3. Indexes

These indexes keep the busiest queries from scanning whole tables:

```sql
-- The photo timeline, newest first, leaving out trash and the vault
CREATE INDEX IF NOT EXISTS ix_photos_active_taken
ON photos (is_encrypted, trashed_at, taken_at DESC);

-- Favourites
CREATE INDEX IF NOT EXISTS ix_photos_fav_taken
ON photos (is_favorite, is_encrypted, trashed_at, taken_at DESC);

-- Finding a library's drive again after it was reconnected
CREATE INDEX IF NOT EXISTS ix_photos_volume_uuid
ON photos (volume_uuid);

-- Photos still waiting for enhancement (never vault photos)
CREATE INDEX IF NOT EXISTS ix_photos_opt_pending
ON photos (is_optimized, is_enhanced, is_encrypted, trashed_at) WHERE is_encrypted = 0;

-- Close ones first on the People page
CREATE INDEX IF NOT EXISTS ix_persons_affinity
ON persons (is_close_one, affinity_score DESC);

-- Stories and their photos
CREATE INDEX IF NOT EXISTS ix_stories_person_id
ON stories (person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_story_items_story_id
ON story_items (story_id, sort_order ASC);

-- The vault's sections
CREATE INDEX IF NOT EXISTS ix_photos_vault_type
ON photos (is_encrypted, vault_type, created_at DESC);

-- The Trash purge
CREATE INDEX IF NOT EXISTS ix_photos_trash_expires
ON photos (trash_expires_at) WHERE trash_expires_at IS NOT NULL;

-- Exact duplicates (SHA-256) and similar photos (dHash)
CREATE INDEX IF NOT EXISTS ix_photos_file_hash ON photos (file_hash);
CREATE INDEX IF NOT EXISTS ix_photos_phash ON photos (phash) WHERE phash IS NOT NULL;

-- Links between tables
CREATE INDEX IF NOT EXISTS ix_faces_photo_id ON faces (photo_id);
CREATE INDEX IF NOT EXISTS ix_faces_person_id ON faces (person_id);
CREATE INDEX IF NOT EXISTS ix_faces_cluster_id ON faces (cluster_id);
CREATE INDEX IF NOT EXISTS ix_photo_album_album_id ON photo_album (album_id);
CREATE INDEX IF NOT EXISTS ix_import_items_task_id ON import_items (task_id);
CREATE INDEX IF NOT EXISTS ix_opt_items_task_id ON optimization_items (task_id);
```

`engine/database.py` has a few more for smaller lookups. Before adding a query on a large table, check it uses an index (`EXPLAIN QUERY PLAN`).

## 4. Search

Search uses SQLite's full-text index, FTS5. It covers the file name, the folder name, the caption, tags and the text read from the photo, so a receipt can be found by the words printed on it.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
    filename,
    folder_name,
    caption,
    content_tags,
    ocr_text,
    content='photos',
    content_rowid='id'
);
```

Triggers keep the index in step with the `photos` table. Vault photos are never added to it, and a photo moved into the vault is taken out, so nothing about vault contents can be found through search. The triggers only run when a searchable column changes, so routine updates (a thumbnail, a favourite) don't touch the index.

Search finds words, not meaning. Searching by what is in a photo ("beach at sunset") is not built.
