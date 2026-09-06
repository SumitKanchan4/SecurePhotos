"""Automated Tests for 4K Collage Generation & Universal Photo Download."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.collage_service import (
    render_collage,
    compute_mosaic_boxes,
    compute_hero_boxes,
    compute_treemap_boxes,
)
from engine.services.thumbnail_service import calculate_file_hash


async def create_collage_test_photo(tmp_path: Path, filename: str, color=(120, 80, 200)) -> int:
    """Helper to write a test image to disk and record it in the database."""
    img_path = tmp_path / filename
    img = Image.new("RGB", (300, 200), color=color)
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
        (filename, str(img_path), file_hash, img_path.stat().st_size, "image/jpeg", 300, 200),
    )
    row = await cursor.fetchone()
    photo_id = row[0]
    await conn.commit()
    await conn.close()
    return photo_id


def test_bounding_box_layouts():
    """Validates bounding box calculations across mosaic, hero_grid, and treemap layouts."""
    # Mosaic checks for 2, 4, 9 photos
    boxes_2 = compute_mosaic_boxes(2, 3840, 2160)
    assert len(boxes_2) == 2
    assert boxes_2[0][2] < boxes_2[1][0]  # Left box right edge is before right box left edge

    boxes_4 = compute_mosaic_boxes(4, 3840, 2160)
    assert len(boxes_4) == 4

    boxes_9 = compute_mosaic_boxes(9, 3840, 2160)
    assert len(boxes_9) == 9

    # Hero Grid checks
    hero_boxes = compute_hero_boxes(5, 3840, 2160)
    assert len(hero_boxes) == 5
    # First item is dominant hero occupying ~60% width
    hero_w = hero_boxes[0][2] - hero_boxes[0][0]
    assert hero_w > 2000

    # Treemap checks
    treemap_boxes = compute_treemap_boxes(4, 3840, 2160)
    assert len(treemap_boxes) == 4


def test_render_collage_bounds_validation():
    """Validates ValueError raised if fewer than 2 or greater than 9 photos."""
    with pytest.raises(ValueError, match="between 2 and 9 photos"):
        render_collage(["only_one.jpg"])

    with pytest.raises(ValueError, match="between 2 and 9 photos"):
        render_collage([f"photo_{i}.jpg" for i in range(10)])


@pytest.mark.asyncio
async def test_create_collage_endpoint_and_album():
    """Validates POST /api/creatives/collage end-to-end including Collages album placement."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_collage_test_photo(tmp_path, "c_p1.jpg", (255, 50, 50))
        p2 = await create_collage_test_photo(tmp_path, "c_p2.jpg", (50, 255, 50))
        p3 = await create_collage_test_photo(tmp_path, "c_p3.jpg", (50, 50, 255))

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Validation test: single photo rejected with 400
            bad_res = await client.post("/api/creatives/collage", json={"photo_ids": [p1], "layout": "mosaic"})
            assert bad_res.status_code == 400

            # 2. Validation test: >9 photos rejected with 400
            bad_res_many = await client.post(
                "/api/creatives/collage", json={"photo_ids": [p1] * 10, "layout": "mosaic"}
            )
            assert bad_res_many.status_code == 400

            # 3. Successful 3-photo collage creation
            res = await client.post(
                "/api/creatives/collage",
                json={"photo_ids": [p1, p2, p3], "layout": "hero_grid", "title": "Test Hero Collage"},
            )
            assert res.status_code == 201
            data = res.json()
            assert data["status"] == "ok"
            collage_photo_id = data["photo_id"]
            album_id = data["album_id"]

            # 4. Verify the collage exists in the photos table
            conn = await get_db_connection()
            async with conn.execute("SELECT filepath, width, height FROM photos WHERE id = ?;", (collage_photo_id,)) as cur:
                photo_row = await cur.fetchone()
            assert photo_row is not None
            assert Path(photo_row["filepath"]).exists()
            assert photo_row["width"] == 3840
            assert photo_row["height"] == 2160

            # 5. Verify the Collages album contains the new photo
            async with conn.execute("SELECT name FROM albums WHERE id = ?;", (album_id,)) as cur:
                album_row = await cur.fetchone()
            assert album_row["name"] == "Collages"

            async with conn.execute(
                "SELECT photo_id FROM photo_album WHERE album_id = ? AND photo_id = ?;",
                (album_id, collage_photo_id),
            ) as cur:
                link_row = await cur.fetchone()
            assert link_row is not None
            await conn.close()


@pytest.mark.asyncio
async def test_download_photo_endpoint():
    """Validates GET /api/photos/{photo_id}/download streams file with Content-Disposition."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_collage_test_photo(tmp_path, "download_sample.jpg", (100, 150, 200))

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(f"/api/photos/{p1}/download")
            assert res.status_code == 200
            assert "attachment" in res.headers.get("content-disposition", "")
            assert "download_sample.jpg" in res.headers.get("content-disposition", "")
            assert len(res.content) > 0
