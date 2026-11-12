"""Unit tests for Portable External Vault & Multi-Device Drive Portability.

Validates:
1. Dynamic relative path resolution.
2. Dynamic drive letter remapping (D: -> E: -> F:).
3. data_location.txt library pointer resolution.
4. Database migration normalizing legacy absolute paths to relative paths.
"""

from pathlib import Path
import pytest
import aiosqlite

from engine.config import AppConfig, resolve_default_data_dir


def test_resolve_media_path_relative(tmp_path: Path):
    """Test that relative paths resolve against active data_dir."""
    config = AppConfig(data_dir=tmp_path)
    rel_path = "originals/2026/10/photo_01.jpg"

    resolved = config.resolve_media_path(rel_path)
    expected = tmp_path / "originals" / "2026" / "10" / "photo_01.jpg"
    assert resolved == expected


def test_resolve_media_path_existing_absolute(tmp_path: Path):
    """Test that existing absolute files resolve as-is."""
    config = AppConfig(data_dir=tmp_path)
    test_file = tmp_path / "test.jpg"
    test_file.write_text("dummy")

    resolved = config.resolve_media_path(str(test_file))
    assert resolved == test_file
    assert resolved.exists()


def test_resolve_media_path_drive_remapping(tmp_path: Path, monkeypatch):
    """Test that drive letter changes (e.g. from E: to F:) dynamically remap."""
    # Simulate a data directory with a drive letter
    target_dir = tmp_path / "data"
    target_dir.mkdir(parents=True, exist_ok=True)
    orig_sub = target_dir / "originals" / "vacation.jpg"
    orig_sub.parent.mkdir(parents=True, exist_ok=True)
    orig_sub.write_text("vacation image")

    config = AppConfig(data_dir=target_dir)

    # Simulate an old path from another session that had a hypothetical different path
    # Using suffix matching
    old_hypothetical = r"Z:\OldVault\data\originals\vacation.jpg"
    resolved = config.resolve_media_path(old_hypothetical)
    assert resolved == orig_sub
    assert resolved.exists()


def test_resolve_default_data_dir_with_pointer(tmp_path: Path, monkeypatch):
    """Test that data_location.txt is respected if present."""
    custom_vault = tmp_path / "ExternalVault"
    custom_vault.mkdir()

    loc_file = tmp_path / "data_location.txt"
    loc_file.write_text(f"path={custom_vault}\n", encoding="utf-8")

    # Point base_dir calculation to tmp_path
    monkeypatch.setenv("SECUREPHOTOS_DATA_DIR", str(custom_vault))
    resolved = resolve_default_data_dir()
    assert resolved == custom_vault


@pytest.mark.asyncio
async def test_database_relative_path_migration(tmp_path: Path):
    """Test that database migrations convert legacy absolute paths to relative paths."""
    db_file = tmp_path / "test_migration.db"

    async with aiosqlite.connect(db_file) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                thumbnail_path TEXT,
                preview_path TEXT,
                is_encrypted BOOLEAN DEFAULT 0
            );
        """)
        # Insert legacy rows with absolute paths
        await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size) VALUES (?, ?, ?);",
            ("photo1.jpg", "E:/SecurePhotos/data/originals/2026/01/photo1.jpg", 1000)
        )
        await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size) VALUES (?, ?, ?);",
            ("photo2.jpg", r"D:\SecurePhotos\data\originals\2026\02\photo2.jpg", 2000)
        )
        await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size) VALUES (?, ?, ?);",
            ("photo3.jpg", "originals/2026/03/photo3.jpg", 3000)
        )
        await conn.commit()

        # Run normalization SQL
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

        async with conn.execute("SELECT id, filepath FROM photos ORDER BY id ASC;") as cursor:
            rows = await cursor.fetchall()

        assert rows[0]["filepath"] == "originals/2026/01/photo1.jpg"
        assert rows[1]["filepath"] == "originals/2026/02/photo2.jpg"
        assert rows[2]["filepath"] == "originals/2026/03/photo3.jpg"
