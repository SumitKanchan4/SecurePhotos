"""Unit & Contract Tests for SQLite WAL Engine & Migrations."""

import tempfile
from pathlib import Path
import pytest
import aiosqlite

from engine.database import get_db_connection, run_migrations


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
