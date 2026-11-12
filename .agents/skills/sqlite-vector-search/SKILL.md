---
name: sqlite-vector-search
description: >-
  FUTURE IDEAS for vector search - sqlite-vec is not used today; the WAL, index and FTS5 guidance applies. High-performance SQLite, FTS5 full-text indexing, and sqlite-vec vector search guidelines for 100k+ media items. Covers WAL mode tuning, composite covering indexes, hybrid Reciprocal Rank Fusion (RRF), zero-N+1 ORM queries, and batch transactional writes.
---

# ⚡ High-Scale SQLite & Vector Search Skill

> **Partly future (checked November 2026).** The app does not use `sqlite-vec` or vector search, and has no CLIP embeddings. Face embeddings (SFace, 128-D) are stored as JSON text in `faces.embedding` and compared in Python with NumPy. The SQLite parts (WAL mode, covering indexes, FTS5, batched writes) describe the current database; the vector and hybrid-ranking sections are ideas for a possible future feature.

This skill governs the database architecture, query optimization, and hybrid search pipelines to sustain sub-10ms response times across 100,000+ indexed photos, videos, and documents.

---

## 1. Engine Configuration & WAL Pragmas

Always apply these pragmas on every SQLite connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;       -- 64 MB in-memory cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;      -- 256 MB memory-mapped I/O
PRAGMA busy_timeout = 5000;
```

---

## 2. Dual-Branch Hybrid Search (Lexical + Vector)

### A. Full-Text Search (FTS5) for Exact & Token Matches
- Maintain an FTS5 virtual table synchronized with triggers:
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

### B. Vector Indexing with `sqlite-vec`
- Store 512-dimensional L2-normalized embeddings from MobileCLIP or MobileFaceNet:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_photos USING vec0(
    photo_id INTEGER PRIMARY KEY,
    embedding float[512] distance_metric=cosine
);
```

### C. Reciprocal Rank Fusion (RRF) Blending
Combine textual relevance (BM25) and semantic vector distance:
$$\text{Score}(d) = \sum_{m \in \{\text{FTS}, \text{Vector}\}} \frac{1}{60 + \text{Rank}_m(d)}$$

---

## 3. Query Anti-Patterns to Avoid

- ❌ **Never run unbounded SELECT queries**: All queries must have `LIMIT` and `OFFSET` / keyset pagination.
- ❌ **Never run N+1 loops**: Always use `joinedload()` or `selectinload()` in SQLAlchemy, or explicit `JOIN`s in SQL.
- ❌ **Never compute hashes or EXIF in the query thread**: All computational work belongs in background workers.
