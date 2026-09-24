"""Automated Tests for Albums Management API Subsystem."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.thumbnail_service import calculate_file_hash


async def create_album_test_photo(tmp_path: Path, filename: str) -> int:
    """Helper to insert a test photo."""
    img_path = tmp_path / filename
    img = Image.new("RGB", (150, 150), color=(80, 160, 240))
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
        (filename, str(img_path), file_hash, img_path.stat().st_size, "image/jpeg", 150, 150),
    )
    row = await cursor.fetchone()
    photo_id = row[0]
    await conn.commit()
    await conn.close()
    return photo_id


@pytest.mark.asyncio
async def test_albums_crud_lifecycle():
    """Validates album creation, photo association, retrieval, removal, and deletion."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_album_test_photo(tmp_path, "album_p1.jpg")
        p2 = await create_album_test_photo(tmp_path, "album_p2.jpg")
        album_id = None
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # 1. Create a new album
                create_res = await client.post(
                    "/api/albums",
                    json={"name": "Summer Vacation 2026", "description": "Family beach trip", "photo_ids": [p1]},
                )
                assert create_res.status_code == 201
                album_data = create_res.json()
                album_id = album_data["id"]
                assert album_data["name"] == "Summer Vacation 2026"
                assert album_data["photo_count"] == 1

                # 2. List albums
                list_res = await client.get("/api/albums")
                assert list_res.status_code == 200
                albums = list_res.json()
                assert any(a["id"] == album_id for a in albums)

                # 3. Add second photo to album
                add_res = await client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [p2]})
                assert add_res.status_code == 200
                assert add_res.json()["added_count"] == 1

                # 4. Get album details and verify both photos exist
                detail_res = await client.get(f"/api/albums/{album_id}")
                assert detail_res.status_code == 200
                detail = detail_res.json()
                assert detail["photo_count"] == 2
                photo_ids = [p["id"] for p in detail["photos"]]
                assert p1 in photo_ids
                assert p2 in photo_ids

                # 5. Remove p1 from album
                remove_res = await client.delete(f"/api/albums/{album_id}/photos/{p1}")
                assert remove_res.status_code == 200
                assert remove_res.json()["removed_photo_id"] == p1

                # Verify p1 was removed but p2 remains
                detail_res_2 = await client.get(f"/api/albums/{album_id}")
                assert detail_res_2.json()["photo_count"] == 1
                assert detail_res_2.json()["photos"][0]["id"] == p2

                # Verify original photo p1 was not deleted from library
                photo_res = await client.get("/api/photos?limit=1000")
                active_ids = [p["id"] for p in photo_res.json()]
                assert p1 in active_ids

                # 6. Set album cover photo
                cover_res = await client.post(f"/api/albums/{album_id}/cover", json={"photo_id": p2})
                assert cover_res.status_code == 200
                assert cover_res.json()["cover_photo_id"] == p2

                # Verify GET /api/albums/{album_id} detail returns cover_photo_id
                detail_res_cover = await client.get(f"/api/albums/{album_id}")
                assert detail_res_cover.status_code == 200
                assert detail_res_cover.json()["cover_photo_id"] == p2

                # Test setting non-member photo as cover fails with 400
                invalid_cover_res = await client.post(f"/api/albums/{album_id}/cover", json={"photo_id": p1})
                assert invalid_cover_res.status_code == 400

                # 7. Batch remove photos from album
                batch_rem_res = await client.post(f"/api/albums/{album_id}/photos/batch-remove", json={"photo_ids": [p2]})
                assert batch_rem_res.status_code == 200
                assert batch_rem_res.json()["removed_count"] == 1

                # Detail should now have 0 photos
                detail_after_batch = await client.get(f"/api/albums/{album_id}")
                assert detail_after_batch.json()["photo_count"] == 0

                # 8. Delete the album
                del_res = await client.delete(f"/api/albums/{album_id}")
                assert del_res.status_code == 200
                assert del_res.json()["deleted_album_id"] == album_id

                # Verify 404 after deletion
                get_deleted = await client.get(f"/api/albums/{album_id}")
                assert get_deleted.status_code == 404
        finally:
            conn = await get_db_connection()
            try:
                if album_id:
                    await conn.execute("DELETE FROM photo_album WHERE album_id = ?;", (album_id,))
                    await conn.execute("DELETE FROM albums WHERE id = ?;", (album_id,))
                await conn.execute("DELETE FROM photo_album WHERE photo_id IN (?, ?);", (p1, p2))
                await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (p1, p2))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_photo_favorite_toggle():
    """Validates toggling photo favorite status and filtering by favorites."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p = await create_album_test_photo(tmp_path, "fav_test.jpg")
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # 1. Toggle favorite ON
                toggle_1 = await client.post(f"/api/photos/{p}/toggle-favorite")
                assert toggle_1.status_code == 200
                assert toggle_1.json()["is_favorite"] is True

                # 2. Check in favorite_only list
                fav_list = await client.get("/api/photos?favorite_only=true")
                assert fav_list.status_code == 200
                assert any(item["id"] == p for item in fav_list.json())

                # 3. Toggle favorite OFF
                toggle_2 = await client.post(f"/api/photos/{p}/toggle-favorite")
                assert toggle_2.status_code == 200
                assert toggle_2.json()["is_favorite"] is False

                # 4. Check not in favorite_only list
                fav_list_2 = await client.get("/api/photos?favorite_only=true")
                assert not any(item["id"] == p for item in fav_list_2.json())
        finally:
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (p,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_album_rename_workflow():
    """Validates renaming an album via PATCH /api/albums/{id}."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create album
        create_res = await client.post(
            "/api/albums",
            json={"name": "Old Album Title", "description": "Testing rename"},
        )
        assert create_res.status_code == 201
        album_id = create_res.json()["id"]

        try:
            # 2. Rename album
            rename_res = await client.patch(
                f"/api/albums/{album_id}",
                json={"name": "Brand New Title"},
            )
            assert rename_res.status_code == 200
            assert rename_res.json()["name"] == "Brand New Title"

            # 3. Verify in detail view
            detail_res = await client.get(f"/api/albums/{album_id}")
            assert detail_res.status_code == 200
            assert detail_res.json()["name"] == "Brand New Title"

            # 4. Verify validation (empty name rejected)
            bad_res = await client.patch(
                f"/api/albums/{album_id}",
                json={"name": "   "},
            )
            assert bad_res.status_code == 400
        finally:
            await client.delete(f"/api/albums/{album_id}")



