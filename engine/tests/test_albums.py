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
            photo_res = await client.get("/api/photos")
            active_ids = [p["id"] for p in photo_res.json()]
            assert p1 in active_ids

            # 6. Delete the album
            del_res = await client.delete(f"/api/albums/{album_id}")
            assert del_res.status_code == 200
            assert del_res.json()["deleted_album_id"] == album_id

            # Verify 404 after deletion
            get_deleted = await client.get(f"/api/albums/{album_id}")
            assert get_deleted.status_code == 404
