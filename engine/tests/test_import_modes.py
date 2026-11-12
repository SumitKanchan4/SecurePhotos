"""M4: there is no in-place import of user folders; the app only registers its own files in place."""

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.ingestion_service import IN_LIBRARY, ingest_single_photo
from engine.services.thumbnail_service import calculate_file_hash


def _photo(path, colour):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (400, 300), colour).save(path, "JPEG")
    return path


async def _count_photos():
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT COUNT(*) FROM photos;") as cur:
            return (await cur.fetchone())[0]
    finally:
        await conn.close()


async def test_import_api_rejects_in_place_scan(tmp_path):
    await run_migrations()
    user_photo = _photo(tmp_path / "Pictures" / "holiday.jpg", (10, 120, 200))
    before = await _count_photos()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        res = await client.post("/api/photos/import", json={"file_paths": [str(user_photo)], "mode": "scan"})

    assert res.status_code == 422
    assert await _count_photos() == before
    assert user_photo.exists()


async def test_in_library_registration_refuses_user_folders(tmp_path):
    await run_migrations()
    user_photo = _photo(tmp_path / "Pictures" / "holiday.jpg", (200, 120, 10))
    conn = await get_db_connection()
    try:
        with pytest.raises(ValueError, match="outside the library"):
            await ingest_single_photo(conn, user_photo, mode=IN_LIBRARY)
        with pytest.raises(ValueError, match="Unknown import mode"):
            await ingest_single_photo(conn, user_photo, mode="scan")
    finally:
        await conn.close()
    assert user_photo.exists()


async def test_in_library_registration_saves_relative_path():
    await run_migrations()
    made_by_app = _photo(settings.collages_dir / "2026" / "11" / "m4_collage.jpg", (90, 30, 160))
    conn = await get_db_connection()
    try:
        photo_id = await ingest_single_photo(conn, made_by_app, mode=IN_LIBRARY)
        async with conn.execute("SELECT filepath, is_managed FROM photos WHERE id = ?;", (photo_id,)) as cur:
            row = await cur.fetchone()
        assert row["filepath"] == "originals/collages/2026/11/m4_collage.jpg"
        await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()


async def test_collage_from_library_photos_with_relative_paths():
    """Library rows store relative paths; the collage endpoint used to look them up in the working folder."""
    await run_migrations()
    ids = []
    conn = await get_db_connection()
    try:
        for i, colour in enumerate([(220, 40, 40), (40, 200, 60)]):
            path = _photo(settings.originals_dir / "2026" / "05" / "04" / f"m4_src_{i}.jpg", colour)
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_hash, file_size, mime_type, taken_at) "
                "VALUES (?, ?, ?, ?, 'image/jpeg', '2026-05-04 10:00:00');",
                (path.name, f"originals/2026/05/04/{path.name}", calculate_file_hash(path), path.stat().st_size),
            )
            ids.append(cur.lastrowid)
        await conn.commit()
    finally:
        await conn.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        res = await client.post("/api/creatives/collage", json={"photo_ids": ids, "layout": "mosaic", "title": "M4"})

    assert res.status_code == 201, res.text
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT filepath FROM photos WHERE id = ?;", (res.json()["photo_id"],)) as cur:
            filepath = (await cur.fetchone())["filepath"]
    finally:
        await conn.close()
    assert filepath.startswith("originals/collages/2026/05/")
    assert (settings.data_dir / filepath).is_file()
