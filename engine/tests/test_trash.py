"""Automated Tests for Photo Soft-Delete and Batch-Trash API Endpoints."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.thumbnail_service import calculate_file_hash


async def create_dummy_photo(tmp_path: Path, filename: str) -> int:
    """Helper to create a temporary dummy photo in SQLite."""
    img_path = tmp_path / filename
    img = Image.new("RGB", (400, 300), color=(100, 150, 200))
    img.save(img_path, format="JPEG")

    file_hash = calculate_file_hash(img_path)
    conn = await get_db_connection()
    cursor = await conn.execute(
        """
        INSERT INTO photos (
            filename, filepath, file_hash, file_size, mime_type, width, height,
            is_encrypted, is_optimized, is_enhanced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1)
        RETURNING id;
        """,
        (filename, str(img_path), file_hash, img_path.stat().st_size, "image/jpeg", 400, 300),
    )
    row = await cursor.fetchone()
    photo_id = row[0]
    await conn.commit()
    await conn.close()
    return photo_id


@pytest.mark.asyncio
async def test_single_photo_delete_to_trash():
    """Verifies DELETE /api/photos/{id} soft-deletes a photo and removes it from listing."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_dummy_photo(tmp_path, "delete_target.jpg")

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Verify photo is in active list
            res_before = await client.get("/api/photos")
            assert res_before.status_code == 200
            active_ids = [p["id"] for p in res_before.json()]
            assert photo_id in active_ids

            # 2. Soft-delete the photo
            del_res = await client.delete(f"/api/photos/{photo_id}")
            assert del_res.status_code == 200
            assert del_res.json()["status"] == "ok"
            assert del_res.json()["photo_id"] == photo_id

            # 3. Verify photo is no longer returned in active list
            res_after = await client.get("/api/photos")
            assert res_after.status_code == 200
            active_ids_after = [p["id"] for p in res_after.json()]
            assert photo_id not in active_ids_after

            # 4. Verify database record still exists but trashed_at is set
            conn = await get_db_connection()
            async with conn.execute("SELECT trashed_at FROM photos WHERE id = ?;", (photo_id,)) as cursor:
                row = await cursor.fetchone()
                assert row is not None
                assert row["trashed_at"] is not None
            await conn.close()


@pytest.mark.asyncio
async def test_batch_trash_photos():
    """Verifies POST /api/photos/batch-trash soft-deletes multiple photos atomically."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        id1 = await create_dummy_photo(tmp_path, "batch_1.jpg")
        id2 = await create_dummy_photo(tmp_path, "batch_2.jpg")

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            batch_res = await client.post("/api/photos/batch-trash", json={"photo_ids": [id1, id2]})
            assert batch_res.status_code == 200
            assert batch_res.json()["status"] == "ok"
            assert batch_res.json()["trashed_count"] == 2

            # Verify neither appears in active list
            res = await client.get("/api/photos")
            active_ids = [p["id"] for p in res.json()]
            assert id1 not in active_ids
            assert id2 not in active_ids


@pytest.mark.asyncio
async def test_delete_nonexistent_photo():
    """Verifies DELETE /api/photos/{id} returns 404 for invalid IDs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/api/photos/9999999")
        assert res.status_code == 404
