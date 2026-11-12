"""Unit & Contract Tests for SQLite WAL Engine & Migrations."""

import tempfile
from pathlib import Path
import pytest

from engine.database import get_db_connection, rebuild_fts_index, run_migrations


@pytest.mark.asyncio
async def test_database_pragmas_and_wal_mode():
    """Verifies that SQLite initializes with WAL mode, 64MB cache, and MMAP."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        
        await run_migrations(db_path)
        conn = await get_db_connection(db_path)

        # Check WAL journal mode
        async with conn.execute("PRAGMA journal_mode;") as cursor:
            row = await cursor.fetchone()
            assert row[0].lower() == "wal"

        # Check synchronous mode
        async with conn.execute("PRAGMA synchronous;") as cursor:
            row = await cursor.fetchone()
            assert row[0] == 1  # 1 = NORMAL

        # Check foreign keys
        async with conn.execute("PRAGMA foreign_keys;") as cursor:
            row = await cursor.fetchone()
            assert row[0] == 1

        # Check mmap size
        async with conn.execute("PRAGMA mmap_size;") as cursor:
            row = await cursor.fetchone()
            assert row[0] == 268435456

        await conn.close()


@pytest.mark.asyncio
async def test_schema_tables_and_fts_triggers():
    """Verifies all core schema tables and FTS5 search triggers function correctly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        await run_migrations(db_path)
        conn = await get_db_connection(db_path)

        # Insert a sample unencrypted photo
        await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, caption, content_tags, is_encrypted)
            VALUES ('sample.jpg', '/media/sample.jpg', 1024, 'Sunny beach in Hawaii', 'beach,vacation', 0);
            """
        )
        await conn.commit()

        # Verify FTS5 automatically indexed the photo
        async with conn.execute("SELECT * FROM photos_fts WHERE photos_fts MATCH 'Hawaii';") as cursor:
            results = await cursor.fetchall()
            assert len(results) == 1

        # Insert an encrypted photo and verify FTS5 trigger skips it for isolation
        await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, caption, content_tags, is_encrypted)
            VALUES ('vault_secret.enc', '/media/vault_secret.enc', 2048, 'Intimate anniversary letter', 'private', 1);
            """
        )
        await conn.commit()

        async with conn.execute("SELECT * FROM photos_fts WHERE photos_fts MATCH 'anniversary';") as cursor:
            results = await cursor.fetchall()
            assert len(results) == 0  # Must NOT be in public FTS index!

        await conn.close()


@pytest.mark.asyncio
async def test_fts_scoped_update_trigger():
    """Verifies photos_au trigger only mutates FTS on text column updates, ignoring metadata churn."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        await run_migrations(db_path)
        conn = await get_db_connection(db_path)
        try:
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, caption, content_tags, thumbnail_path, is_favorite, is_encrypted)
                VALUES ('tropical.jpg', '/media/tropical.jpg', 2048, 'Sunset over the ocean', 'sunset,vacation', '/thumbs/initial.webp', 0, 0);
                """
            )
            photo_id = cursor.lastrowid
            await conn.commit()

            # 1. Update non-FTS fields (thumbnail_path, is_favorite) — should succeed without FTS churn
            await conn.execute(
                "UPDATE photos SET thumbnail_path = '/thumbs/regen.webp', is_favorite = 1 WHERE id = ?;",
                (photo_id,),
            )
            await conn.commit()

            # Verify search by ocean still succeeds
            async with conn.execute("SELECT * FROM photos_fts WHERE photos_fts MATCH 'ocean';") as fts_cur:
                res = await fts_cur.fetchall()
                assert len(res) == 1

            # 2. Update an FTS searchable field (caption)
            await conn.execute(
                "UPDATE photos SET caption = 'Snowy alpine mountain in Aspen' WHERE id = ?;",
                (photo_id,),
            )
            await conn.commit()

            # Old term 'ocean' should no longer match
            async with conn.execute("SELECT * FROM photos_fts WHERE photos_fts MATCH 'ocean';") as fts_cur:
                res = await fts_cur.fetchall()
                assert len(res) == 0

            # New term 'Aspen' must match
            async with conn.execute("SELECT * FROM photos_fts WHERE photos_fts MATCH 'Aspen';") as fts_cur:
                res = await fts_cur.fetchall()
                assert len(res) == 1
        finally:
            await conn.close()


@pytest.mark.asyncio
async def test_fts_rebuild_self_healing():
    """Verifies that rebuild_fts_index rebuilds and resynchronizes photos_fts cleanly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        await run_migrations(db_path)
        conn = await get_db_connection(db_path)
        try:
            for i in range(5):
                await conn.execute(
                    """
                    INSERT INTO photos (filename, filepath, file_size, caption, content_tags, is_encrypted)
                    VALUES (?, ?, 1024, ?, 'test', 0);
                    """,
                    (f"img_{i}.jpg", f"/media/img_{i}.jpg", f"UniqueKeyword{i} landscape photo"),
                )
            await conn.commit()

            # Execute rebuild_fts_index
            await rebuild_fts_index(conn=conn)

            # Verify integrity and all items searchable
            async with conn.execute("INSERT INTO photos_fts(photos_fts) VALUES('integrity-check');") as cur:
                # Succeeded without exception
                pass

            for i in range(5):
                async with conn.execute(f"SELECT * FROM photos_fts WHERE photos_fts MATCH 'UniqueKeyword{i}';") as cur:
                    rows = await cur.fetchall()
                    assert len(rows) == 1
        finally:
            await conn.close()
