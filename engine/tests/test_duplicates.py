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


def test_face_aware_candidate_scoring():
    """Validates that candidate scoring prioritizes front portraits and close ones over file size noise."""
    # Side photo: 0.12 MB larger, but lower quality face (0.808)
    p_side = {
        "id": 14,
        "width": 3000,
        "height": 4000,
        "is_favorite": False,
        "is_enhanced": False,
        "blur_score": 30.0,
        "quality_score": 0.0,
        "file_size": 2_169_083,  # 2.17 MB
    }
    faces_side = [
        {"quality_score": 0.8078, "is_close_one": 1, "name": "Inaaksh", "box_w": 0.14, "box_h": 0.15},
        {"quality_score": 0.5735, "is_close_one": 1, "name": "Kiaan", "box_w": 0.05, "box_h": 0.06},
    ]

    # Front portrait: slightly smaller file (2.05 MB), but crisp front face (0.969)
    p_front = {
        "id": 15,
        "width": 3000,
        "height": 4000,
        "is_favorite": False,
        "is_enhanced": False,
        "blur_score": 30.0,
        "quality_score": 0.0,
        "file_size": 2_047_456,  # 2.05 MB
    }
    faces_front = [
        {"quality_score": 0.9690, "is_close_one": 1, "name": "Inaaksh", "box_w": 0.16, "box_h": 0.17},
        {"quality_score": 0.6441, "is_close_one": 1, "name": "Kiaan", "box_w": 0.06, "box_h": 0.06},
    ]

    score_side, reason_side = score_candidate_photo(p_side, faces_side)
    score_front, reason_front = score_candidate_photo(p_front, faces_front)

    # Front portrait MUST decisively beat the side profile despite smaller file size
    assert score_front > score_side
    assert score_front - score_side > 200.0  # Decisive margin (+300+ pts)
    assert "Front Portrait (Inaaksh: 0.97)" in reason_front


@pytest.mark.asyncio
async def test_keep_both_and_persistent_dismissal():
    """Validates that 'Keep Both' records persistent dismissals and prevents duplicate re-clustering."""
    await run_migrations()
    conn = await get_db_connection()

    p1_id = None
    p2_id = None
    try:
        # Insert two photos with same phash to trigger near-duplicate clustering
        shared_phash = "a1b2c3d4e5f60718"
        cur1 = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, phash, file_size, mime_type, width, height)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id;
            """,
            ("burst_1.jpg", "test/path/burst_1.jpg", shared_phash, 300000, "image/jpeg", 1920, 1080),
        )
        p1_id = (await cur1.fetchone())[0]

        cur2 = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, phash, file_size, mime_type, width, height)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id;
            """,
            ("burst_2.jpg", "test/path/burst_2.jpg", shared_phash, 300000, "image/jpeg", 1920, 1080),
        )
        p2_id = (await cur2.fetchone())[0]
        await conn.commit()

        # Step 1: Scan and verify they form a cluster
        groups = await scan_and_cluster_duplicates(conn)
        test_group = next((g for g in groups if p1_id in [m["id"] for m in g["photos"]]), None)
        assert test_group is not None
        assert len(test_group["photos"]) == 2

        # Step 2: Resolve with keep_photo_ids=[p1_id, p2_id] ("Keep Both")
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/api/duplicates/resolve",
                json={"group_id": test_group["group_id"], "keep_photo_ids": [p1_id, p2_id]},
            )
            assert res.status_code == 200
            data = res.json()
            assert data["trashed_count"] == 0
            assert len(data["kept_photo_ids"]) == 2

        # Step 3: Verify dismissal recorded in DB and both photos remain active
        pair_min, pair_max = min(p1_id, p2_id), max(p1_id, p2_id)
        async with conn.execute(
            "SELECT COUNT(*) FROM duplicate_dismissals WHERE photo_id_1 = ? AND photo_id_2 = ?;",
            (pair_min, pair_max),
        ) as cur:
            assert (await cur.fetchone())[0] == 1

        async with conn.execute("SELECT id, trashed_at FROM photos WHERE id IN (?, ?);", (p1_id, p2_id)) as cur:
            rows = await cur.fetchall()
            for r in rows:
                assert r["trashed_at"] is None

        # Step 4: Re-scan library and verify these photos DO NOT appear again as duplicates
        groups_after = await scan_and_cluster_duplicates(conn)
        reappeared = any(
            p1_id in [m["id"] for m in g["photos"]] and p2_id in [m["id"] for m in g["photos"]]
            for g in groups_after
        )
        assert not reappeared, "Dismissed pair must not reappear as duplicates in subsequent scans"

    finally:
        if p1_id and p2_id:
            await conn.execute("DELETE FROM duplicate_dismissals WHERE photo_id_1 IN (?, ?) OR photo_id_2 IN (?, ?);", (p1_id, p2_id, p1_id, p2_id))
            await conn.execute("DELETE FROM duplicate_groups WHERE photo_id IN (?, ?);", (p1_id, p2_id))
            await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (p1_id, p2_id))
            await conn.commit()
        await conn.close()



@pytest.mark.asyncio
async def test_near_duplicates_are_found_for_photos_stored_with_library_relative_paths():
    """R7c fix: stored paths are relative to the library; the scan must resolve them to fingerprint."""
    import uuid

    from PIL import ImageDraw

    from engine.config import settings

    await run_migrations()
    folder = settings.data_dir / "originals" / f"burst_{uuid.uuid4().hex[:6]}"
    folder.mkdir(parents=True)
    base = Image.new("RGB", (640, 480), (30, 60, 90))
    draw = ImageDraw.Draw(base)
    for i in range(0, 640, 40):
        draw.rectangle((i, (i * 7) % 300, i + 25, (i * 7) % 300 + 150), fill=((i * 3) % 255, (i * 5) % 255, (i * 11) % 255))
    ids = []
    conn = await get_db_connection()
    try:
        for k, quality in enumerate((95, 80)):
            path = folder / f"shot_{k}.jpg"
            base.save(path, "JPEG", quality=quality)
            relative = path.relative_to(settings.data_dir).as_posix()
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_hash, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/jpeg') RETURNING id;",
                (path.name, relative, calculate_file_hash(path), path.stat().st_size),
            )
            ids.append((await cur.fetchone())[0])
        await conn.commit()
    finally:
        await conn.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        groups = (await client.post("/api/duplicates/scan")).json()
    grouped = [set(p["id"] for p in g["photos"]) for g in groups]
    assert any(set(ids) <= members for members in grouped)
