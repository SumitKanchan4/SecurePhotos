import datetime
import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.config import settings, resolve_media_path
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.collage_service import (
    render_collage,
    compute_mosaic_boxes,
    compute_hero_boxes,
    compute_treemap_boxes,
    determine_collage_taken_at,
    select_optimal_collage_layout,
    generate_intelligent_collages,
)
from engine.services.thumbnail_service import calculate_file_hash


async def create_collage_test_photo(
    tmp_path: Path, filename: str, color=(120, 80, 200), taken_at: str = None
) -> int:
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
            is_encrypted, is_optimized, is_enhanced, taken_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?)
        RETURNING id;
        """,
        (filename, str(img_path), file_hash, img_path.stat().st_size, "image/jpeg", 300, 200, taken_at),
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


def test_determine_collage_taken_at_smart_clustering():
    """Validates the smart hybrid dating logic for collages."""
    d1 = datetime.datetime(2025, 7, 10, 10, 0, 0)
    d2 = datetime.datetime(2025, 7, 12, 12, 0, 0)
    d3 = datetime.datetime(2025, 7, 14, 15, 30, 0)
    old_date = datetime.datetime(2021, 1, 1, 9, 0, 0)

    # 1. Cohesive single-event cluster (<30 days apart) -> inherits newest photo date
    result_smart = determine_collage_taken_at([d1, d2, d3], date_mode="smart")
    assert result_smart == d3

    # 2. Multi-year throwback cluster (>30 days apart) -> defaults to current time
    now_before = datetime.datetime.now()
    result_multiyear = determine_collage_taken_at([old_date, d3], date_mode="smart")
    now_after = datetime.datetime.now()
    assert now_before <= result_multiyear <= now_after

    # 3. Undated source photos (empty list) -> defaults to current time (never None)
    result_undated = determine_collage_taken_at([], date_mode="smart")
    assert now_before <= result_undated <= now_after

    # 4. Explicit 'now' mode override
    result_now = determine_collage_taken_at([d1, d2], date_mode="now")
    assert now_before <= result_now <= now_after

    # 5. Explicit 'event' mode override across multi-year
    result_event = determine_collage_taken_at([old_date, d3], date_mode="event")
    assert result_event == d3

    # 6. Explicit custom_date override
    custom = datetime.datetime(2023, 5, 20, 8, 0, 0)
    result_custom = determine_collage_taken_at([d1], custom_date=custom)
    assert result_custom == custom


@pytest.mark.asyncio
async def test_create_collage_endpoint_and_album():
    """Validates POST /api/creatives/collage end-to-end including smart dating and Collages album placement."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_collage_test_photo(tmp_path, "c_p1.jpg", (255, 50, 50), taken_at="2025-07-10 10:00:00")
        p2 = await create_collage_test_photo(tmp_path, "c_p2.jpg", (50, 255, 50), taken_at="2025-07-12 12:00:00")
        p3 = await create_collage_test_photo(tmp_path, "c_p3.jpg", (50, 50, 255), taken_at="2025-07-14 15:30:00")
        p_old = await create_collage_test_photo(tmp_path, "c_old.jpg", (10, 10, 10), taken_at="2020-01-01 00:00:00")
        collage_photo_id = None
        collage_multi_id = None
        collage_file_path = None
        collage_multi_path = None
        try:
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

                # 3. Successful 3-photo collage creation with smart event dating
                res = await client.post(
                    "/api/creatives/collage",
                    json={
                        "photo_ids": [p1, p2, p3],
                        "layout": "hero_grid",
                        "title": "Summer Trip",
                        "date_mode": "smart",
                    },
                )
                assert res.status_code == 201
                data = res.json()
                assert data["status"] == "ok"
                assert data["taken_at"] == "2025-07-14 15:30:00"
                collage_photo_id = data["photo_id"]
                album_id = data["album_id"]

                # 4. Verify the collage exists in the photos table with correct taken_at date (not Undated)
                conn = await get_db_connection()
                async with conn.execute(
                    "SELECT filepath, width, height, taken_at FROM photos WHERE id = ?;", (collage_photo_id,)
                ) as cur:
                    photo_row = await cur.fetchone()
                assert photo_row is not None
                collage_file_path = resolve_media_path(photo_row["filepath"])
                assert collage_file_path.exists()
                assert photo_row["width"] == 3840
                assert photo_row["height"] == 2160
                assert photo_row["taken_at"] == "2025-07-14 15:30:00"

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

                # 6. Test multi-year collage falls back to current date
                res_multi = await client.post(
                    "/api/creatives/collage",
                    json={
                        "photo_ids": [p_old, p3],
                        "layout": "mosaic",
                        "title": "Through The Years",
                        "date_mode": "smart",
                    },
                )
                assert res_multi.status_code == 201
                data_multi = res_multi.json()
                collage_multi_id = data_multi["photo_id"]
                assert data_multi["taken_at"] is not None
                # Assert multi-year is dated in current year
                assert str(datetime.datetime.now().year) in data_multi["taken_at"]

                async with conn.execute(
                    "SELECT filepath, taken_at FROM photos WHERE id = ?;", (collage_multi_id,)
                ) as cur:
                    multi_row = await cur.fetchone()
                assert multi_row["taken_at"] is not None
                collage_multi_path = resolve_media_path(multi_row["filepath"])
                assert collage_multi_path.exists()

                await conn.close()
        finally:
            # Clean up all created database records and generated collage files
            conn = await get_db_connection()
            try:
                all_ids = [p1, p2, p3, p_old]
                for cid in (collage_photo_id, collage_multi_id):
                    if cid:
                        all_ids.append(cid)
                        await conn.execute("DELETE FROM creative_assets WHERE filepath LIKE ?;", (f"%{cid}%",))
                for pid in all_ids:
                    await conn.execute("DELETE FROM photo_album WHERE photo_id = ?;", (pid,))
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (pid,))
                await conn.commit()
            finally:
                await conn.close()

            for p in (collage_file_path, collage_multi_path):
                if p and p.exists():
                    try:
                        p.unlink()
                    except OSError:
                        pass


@pytest.mark.asyncio
async def test_download_photo_endpoint():
    """Validates GET /api/photos/{photo_id}/download streams file with Content-Disposition."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_collage_test_photo(tmp_path, "download_sample.jpg", (100, 150, 200))
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.get(f"/api/photos/{p1}/download")
                assert res.status_code == 200
                assert "attachment" in res.headers.get("content-disposition", "")
                assert "download_sample.jpg" in res.headers.get("content-disposition", "")
                assert len(res.content) > 0
        finally:
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (p1,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_album_cover_self_healing_on_delete_and_trash():
    """Verify SQLite triggers and GET /api/albums self-heal when an album cover photo is deleted or trashed."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_collage_test_photo(tmp_path, "cover_sample_1.jpg", (50, 100, 150))
        p2 = await create_collage_test_photo(tmp_path, "cover_sample_2.jpg", (80, 120, 160))

        conn = await get_db_connection()
        try:
            # Create album 1 pointing to p1 as cover
            cur1 = await conn.execute(
                "INSERT INTO albums (name, cover_photo_id, is_vault) VALUES ('Self-Healing Album 1', ?, 0);",
                (p1,),
            )
            a1_id = cur1.lastrowid

            # Create album 2 pointing to p2 as cover
            cur2 = await conn.execute(
                "INSERT INTO albums (name, cover_photo_id, is_vault) VALUES ('Self-Healing Album 2', ?, 0);",
                (p2,),
            )
            a2_id = cur2.lastrowid
            await conn.commit()
        finally:
            await conn.close()

        try:
            # Test 1: Moving p1 to trash triggers trg_photos_trash_update_album_cover
            conn = await get_db_connection()
            try:
                await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ?;", (p1,))
                await conn.commit()

                async with conn.execute("SELECT cover_photo_id FROM albums WHERE id = ?;", (a1_id,)) as cur:
                    row1 = await cur.fetchone()
                    assert row1["cover_photo_id"] is None
            finally:
                await conn.close()

            # Test 2: Deleting p2 triggers trg_photos_delete_update_album_cover
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (p2,))
                await conn.commit()

                async with conn.execute("SELECT cover_photo_id FROM albums WHERE id = ?;", (a2_id,)) as cur:
                    row2 = await cur.fetchone()
                    assert row2["cover_photo_id"] is None
            finally:
                await conn.close()

            # Test 3: GET /api/albums returns null cover_photo_id and 0 photo_count for empty albums
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.get("/api/albums")
                assert res.status_code == 200
                data = res.json()
                matching_a1 = next((a for a in data if a["id"] == a1_id), None)
                assert matching_a1 is not None
                assert matching_a1["cover_photo_id"] is None
                assert matching_a1["photo_count"] == 0
        finally:
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM albums WHERE id IN (?, ?);", (a1_id, a2_id))
                await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (p1, p2))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_collages_smart_album_parity():
    """Validates that the Collages album behaves as a protected system smart album.

    Verifies:
    1. DELETE /api/albums/{collages_id} returns HTTP 400.
    2. POST /api/albums/{collages_id}/toggle-favorite returns HTTP 400.
    3. Migrations reset is_favorite = 0 for Collages.
    """
    settings.ensure_directories()
    await run_migrations()

    # 1. Ensure 'Collages' album exists
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT id, name, is_favorite FROM albums WHERE LOWER(name) = 'collages';") as cur:
            row = await cur.fetchone()
        if not row:
            cursor = await conn.execute("INSERT INTO albums (name, description) VALUES ('Collages', 'System collage collection');")
            collages_id = cursor.lastrowid
            await conn.commit()
        else:
            collages_id = row["id"]
    finally:
        await conn.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 2. Attempting to delete the Collages smart album must be rejected
        del_res = await client.delete(f"/api/albums/{collages_id}")
        assert del_res.status_code == 400
        assert "System smart albums cannot be deleted" in del_res.json()["detail"]

        # 3. Attempting to favorite the Collages smart album must be rejected
        fav_res = await client.post(f"/api/albums/{collages_id}/toggle-favorite")
        assert fav_res.status_code == 400
        assert "System smart albums cannot be favorited" in fav_res.json()["detail"]

    # 4. Verify migration self-healing resets is_favorite if it was somehow set
    conn = await get_db_connection()
    try:
        await conn.execute("UPDATE albums SET is_favorite = 1 WHERE id = ?;", (collages_id,))
        await conn.commit()
    finally:
        await conn.close()

    # Run migration sweep
    await run_migrations()

    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT is_favorite FROM albums WHERE id = ?;", (collages_id,)) as cur:
            final_row = await cur.fetchone()
            assert final_row["is_favorite"] == 0
    finally:
        await conn.close()


def test_select_optimal_collage_layout():
    """Validates aspect-ratio layout selection:
    - 3 portrait photos (e.g. 1080x1920) map to 'mosaic' (3 vertical columns filling 16:9 canvas).
    - 1 landscape + 2 portraits map to 'hero_grid'.
    - 4 photos map to 'mosaic' (2x2 grid).
    - 2 photos map to 'mosaic'.
    """
    assert select_optimal_collage_layout([(1080, 1920), (1080, 1920), (1080, 1920)]) == "mosaic"
    assert select_optimal_collage_layout([(1920, 1080), (1080, 1920), (1080, 1920)]) == "hero_grid"
    assert select_optimal_collage_layout([(1920, 1080), (1920, 1080), (1920, 1080), (1920, 1080)]) == "mosaic"
    assert select_optimal_collage_layout([(1920, 1080), (1920, 1080)]) == "mosaic"


@pytest.mark.asyncio
async def test_collage_suggestions_api_and_save_endpoint():
    """Validates GET /api/creatives/suggestions and POST /api/creatives/suggestions/save:
    - Saves directly into settings.collages_dir (data/originals/collages).
    - Ingests into photos table.
    - Associates with Collages smart album.
    """
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        p1 = await create_collage_test_photo(tmp_path, "sug_1.jpg", (200, 100, 50), "2026-08-01 10:00:00")
        p2 = await create_collage_test_photo(tmp_path, "sug_2.jpg", (50, 150, 200), "2026-08-01 11:00:00")
        p3 = await create_collage_test_photo(tmp_path, "sug_3.jpg", (100, 200, 50), "2026-08-01 12:00:00")

        # Mark p1 and p2 as favorites
        conn = await get_db_connection()
        await conn.execute("UPDATE photos SET is_favorite = 1 WHERE id IN (?, ?);", (p1, p2))
        await conn.commit()
        await conn.close()

        saved_collage_id = None
        saved_file_path = None
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # 1. GET /api/creatives/suggestions
                sug_res = await client.get("/api/creatives/suggestions")
                assert sug_res.status_code == 200
                sug_data = sug_res.json()
                assert "suggestions" in sug_data
                assert len(sug_data["suggestions"]) > 0

                # 2. POST /api/creatives/suggestions/save
                save_res = await client.post(
                    "/api/creatives/suggestions/save",
                    json={
                        "photo_ids": [p1, p2, p3],
                        "layout": "mosaic",
                        "title": "Summer Adventure Burst",
                    },
                )
                assert save_res.status_code == 201
                saved_data = save_res.json()
                assert saved_data["status"] == "ok"
                saved_collage_id = saved_data["photo_id"]
                assert saved_collage_id is not None

                # 3. Verify destination folder is settings.collages_dir (data/originals/collages)
                conn = await get_db_connection()
                async with conn.execute("SELECT filepath, caption FROM photos WHERE id = ?;", (saved_collage_id,)) as cur:
                    c_row = await cur.fetchone()
                assert c_row is not None
                saved_file_path = resolve_media_path(c_row["filepath"])
                assert saved_file_path.exists()
                assert saved_file_path.parent.resolve() == settings.collages_dir.resolve()
                assert "Summer Adventure Burst" in c_row["caption"]

                # 4. Verify association with Collages album
                async with conn.execute(
                    "SELECT a.name FROM albums a JOIN photo_album pa ON a.id = pa.album_id WHERE pa.photo_id = ?;",
                    (saved_collage_id,),
                ) as cur:
                    a_row = await cur.fetchone()
                assert a_row is not None
                assert a_row["name"] == "Collages"

                await conn.close()
        finally:
            conn = await get_db_connection()
            try:
                for pid in [p1, p2, p3, saved_collage_id]:
                    if pid:
                        await conn.execute("DELETE FROM photo_album WHERE photo_id = ?;", (pid,))
                        await conn.execute("DELETE FROM photos WHERE id = ?;", (pid,))
                await conn.commit()
            finally:
                await conn.close()

            if saved_file_path and saved_file_path.exists():
                try:
                    saved_file_path.unlink()
                except OSError:
                    pass




