"""Automated tests for Duplicate Detection, Scoring, Lightbox-ready data, and Resolution."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.thumbnail_service import calculate_file_hash
from engine.services.duplicate_service import (
    compute_image_dhash,
    hamming_distance,
    score_candidate_photo,
    scan_and_cluster_duplicates,
    get_duplicate_summary,
    resolve_duplicate_group,
    resolve_all_duplicates_best,
)


@pytest.mark.asyncio
async def test_dhash_and_hamming_distance():
    """Validates dHash calculation and distance metrics."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        img1_path = tmp_path / "img1.jpg"
        img2_path = tmp_path / "img2.jpg"
        img3_path = tmp_path / "img3.jpg"

        # img1 and img2 are identical
        img1 = Image.new("RGB", (200, 200), color=(120, 100, 80))
        img1.save(img1_path, format="JPEG")
        img1.save(img2_path, format="JPEG")

        # img3 has falling gradient across horizontal axis
        img3 = Image.new("L", (200, 200), color=255)
        for x in range(200):
            for y in range(200):
                img3.putpixel((x, y), 255 - x)
        img3.save(img3_path, format="JPEG")

        h1 = compute_image_dhash(img1_path)
        h2 = compute_image_dhash(img2_path)
        h3 = compute_image_dhash(img3_path)

        assert h1 is not None and len(h1) == 16
        assert h2 is not None and len(h2) == 16
        assert h3 is not None and len(h3) == 16

        # Identical images must have hamming distance 0
        assert hamming_distance(h1, h2) == 0
        # Different gradient image should have larger distance
        assert hamming_distance(h1, h3) > 0


def test_score_candidate_photo():
    """Validates that candidate scoring prioritizes favorites, resolution, and AI enhancements."""
    p_low = {
        "id": 1,
        "width": 800,
        "height": 600,
        "is_favorite": False,
        "is_enhanced": False,
        "blur_score": 10.0,
        "quality_score": 4.0,
        "file_size": 200_000,
    }
    p_high_res = {
        "id": 2,
        "width": 4032,
        "height": 3024,
        "is_favorite": False,
        "is_enhanced": False,
        "blur_score": 40.0,
        "quality_score": 8.0,
        "file_size": 2_500_000,
    }
    p_fav = {
        "id": 3,
        "width": 800,
        "height": 600,
        "is_favorite": True,
        "is_enhanced": False,
        "blur_score": 10.0,
        "quality_score": 4.0,
        "file_size": 200_000,
    }

    score_low, _ = score_candidate_photo(p_low)
    score_high_res, reason_high_res = score_candidate_photo(p_high_res)
    score_fav, reason_fav = score_candidate_photo(p_fav)

    assert score_high_res > score_low
    assert "4032x3024" in reason_high_res
    assert score_fav > score_high_res  # Favorite strongly outranks resolution
    assert "Marked Favorite" in reason_fav


@pytest.mark.asyncio
async def test_duplicate_scan_and_resolve_api():
    """Validates full end-to-end duplicate clustering, API retrieval, and resolution."""
    await run_migrations()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Create two identical photos (exact hash collision)
        img1_path = tmp_path / "original.jpg"
        img2_path = tmp_path / "copy.jpg"
        img = Image.new("RGB", (1000, 800), color=(50, 100, 150))
        img.save(img1_path, format="JPEG")
        img.save(img2_path, format="JPEG")

        h = calculate_file_hash(img1_path)
        dhash = compute_image_dhash(img1_path)

        conn = await get_db_connection()
        try:
            # Insert original photo (enhanced, larger logical size)
            cur1 = await conn.execute(
                """
                INSERT INTO photos (
                    filename, filepath, file_hash, phash, file_size, mime_type,
                    width, height, is_encrypted, is_favorite, is_enhanced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1)
                RETURNING id;
                """,
                ("original.jpg", str(img1_path), h, dhash, 500000, "image/jpeg", 1000, 800),
            )
            p1_id = (await cur1.fetchone())[0]

            # Insert duplicate copy (not favorite, not enhanced)
            cur2 = await conn.execute(
                """
                INSERT INTO photos (
                    filename, filepath, file_hash, phash, file_size, mime_type,
                    width, height, is_encrypted, is_favorite, is_enhanced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
                RETURNING id;
                """,
                ("copy.jpg", str(img2_path), h, dhash, 500000, "image/jpeg", 1000, 800),
            )
            p2_id = (await cur2.fetchone())[0]
            await conn.commit()

            # Scan duplicates
            groups = await scan_and_cluster_duplicates(conn)
            assert len(groups) >= 1
            exact_group = next(g for g in groups if p1_id in [m["id"] for m in g["photos"]])
            assert exact_group["suggested_best_photo_id"] == p1_id
            assert exact_group["reclaimable_bytes"] == 500000

            # Test HTTP API endpoints
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # 1. Summary endpoint
                res_sum = await client.get("/api/duplicates/summary")
                assert res_sum.status_code == 200
                data_sum = res_sum.json()
                assert data_sum["total_groups"] >= 1
                assert data_sum["reclaimable_bytes"] >= 500000

                # 2. Groups endpoint
                res_groups = await client.get("/api/duplicates/groups")
                assert res_groups.status_code == 200
                data_groups = res_groups.json()
                group_match = next(g for g in data_groups if g["group_id"] == exact_group["group_id"])
                assert group_match["suggested_best_photo_id"] == p1_id
                assert len(group_match["photos"]) == 2

                # 3. Resolve single group keeping p1_id
                res_res = await client.post(
                    "/api/duplicates/resolve",
                    json={"group_id": exact_group["group_id"], "keep_photo_id": p1_id},
                )
                assert res_res.status_code == 200
                res_data = res_res.json()
                assert res_data["trashed_count"] == 1
                assert res_data["reclaimed_bytes"] == 500000

                # Verify in DB: p1 is active, p2 is trashed
                async with conn.execute("SELECT id, trashed_at FROM photos WHERE id = ?;", (p1_id,)) as c:
                    r1 = await c.fetchone()
                    assert r1["trashed_at"] is None

                async with conn.execute("SELECT id, trashed_at FROM photos WHERE id = ?;", (p2_id,)) as c:
                    r2 = await c.fetchone()
                    assert r2["trashed_at"] is not None

        finally:
            await conn.execute("DELETE FROM duplicate_groups WHERE photo_id IN (?, ?);", (p1_id, p2_id))
            await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (p1_id, p2_id))
            await conn.commit()
            await conn.close()
