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
            taken_at, is_encrypted, is_optimized, is_enhanced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '2099-01-01 00:00:00', 0, 1, 1)
        RETURNING id;
        """,
        (filename, str(img_path), file_hash, img_path.stat().st_size, "image/jpeg", 400, 300),
    )
    row = await cursor.fetchone()
    photo_id = row[0]
    await conn.commit()
    await conn.close()
    return photo_id


async def cleanup_photos(*photo_ids: int):
    """Guarantees complete teardown of test photos so dev database remains clean."""
    conn = await get_db_connection()
    try:
        for pid in photo_ids:
            await conn.execute("DELETE FROM photo_album WHERE photo_id = ?;", (pid,))
            await conn.execute("DELETE FROM faces WHERE photo_id = ?;", (pid,))
            await conn.execute("DELETE FROM photos WHERE id = ?;", (pid,))
        await conn.commit()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_single_photo_delete_to_trash():
    """Verifies DELETE /api/photos/{id} soft-deletes a photo and removes it from listing."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_dummy_photo(tmp_path, "delete_target.jpg")
        try:
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
        finally:
            await cleanup_photos(photo_id)


@pytest.mark.asyncio
async def test_batch_trash_photos():
    """Verifies POST /api/photos/batch-trash soft-deletes multiple photos atomically."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        id1 = await create_dummy_photo(tmp_path, "batch_1.jpg")
        id2 = await create_dummy_photo(tmp_path, "batch_2.jpg")
        try:
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
        finally:
            await cleanup_photos(id1, id2)


@pytest.mark.asyncio
async def test_delete_nonexistent_photo():
    """Verifies DELETE /api/photos/{id} returns 404 for invalid IDs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/api/photos/9999999")
        assert res.status_code == 404


@pytest.mark.asyncio
async def test_trash_endpoints_lifecycle():
    """Verifies listing trashed photos, restoring from trash, and emptying trash permanently."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        id1 = await create_dummy_photo(tmp_path, "trash_test_1.jpg")
        id2 = await create_dummy_photo(tmp_path, "trash_test_2.jpg")
        id3 = None
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # 1. Soft-delete both photos
                await client.post("/api/photos/batch-trash", json={"photo_ids": [id1, id2]})

                # 2. GET /api/trash should list both items
                res = await client.get("/api/trash")
                assert res.status_code == 200
                trashed = res.json()
                trashed_ids = [t["id"] for t in trashed]
                assert id1 in trashed_ids
                assert id2 in trashed_ids
                for t in trashed:
                    assert "days_remaining" in t
                    assert t["days_remaining"] >= 0

                # 3. POST /api/trash/restore for id1
                restore_res = await client.post("/api/trash/restore", json={"photo_ids": [id1]})
                assert restore_res.status_code == 200
                assert restore_res.json()["restored_count"] == 1

                # Verify id1 is back in /api/photos, id2 is still in /api/trash
                active_res = await client.get("/api/photos")
                active_ids = [p["id"] for p in active_res.json()]
                assert id1 in active_ids
                assert id2 not in active_ids

                trash_res2 = await client.get("/api/trash")
                trashed_ids2 = [t["id"] for t in trash_res2.json()]
                assert id1 not in trashed_ids2
                assert id2 in trashed_ids2

                # 4. Permanent delete for id2
                perm_res = await client.post("/api/trash/permanent", json={"photo_ids": [id2]})
                assert perm_res.status_code == 200
                assert perm_res.json()["deleted_count"] == 1

                # Verify trash is now empty of id2
                trash_res3 = await client.get("/api/trash")
                assert id2 not in [t["id"] for t in trash_res3.json()]

                # 5. Create id3, trash it, and test empty_trash
                id3 = await create_dummy_photo(tmp_path, "trash_test_3.jpg")
                await client.post("/api/photos/batch-trash", json={"photo_ids": [id3]})
                empty_res = await client.delete("/api/trash/empty")
                assert empty_res.status_code == 200
                assert empty_res.json()["deleted_count"] >= 1

                trash_final = await client.get("/api/trash")
                assert len(trash_final.json()) == 0
        finally:
            ids_to_clean = [i for i in [id1, id2, id3] if i is not None]
            await cleanup_photos(*ids_to_clean)


