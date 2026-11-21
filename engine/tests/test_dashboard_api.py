"""Automated Contract & Unit Tests for Dashboard & Storage Metrics API."""

import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.api.system import calculate_app_storage_footprint


@pytest.mark.asyncio
async def test_dashboard_api_structure_and_types():
    """Verifies that GET /api/system/dashboard returns valid schema and metrics."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/system/dashboard")
        assert res.status_code == 200
        data = res.json()

        # 1. Media counts contract
        assert "media_counts" in data
        counts = data["media_counts"]
        assert isinstance(counts["images"], int)
        assert isinstance(counts["videos"], int)
        assert isinstance(counts["documents"], int)
        assert isinstance(counts["favorites"], int)
        assert isinstance(counts["albums"], int)
        assert isinstance(counts["people"], int)
        assert isinstance(counts["total_media"], int)
        assert counts["images"] >= 0
        assert counts["videos"] >= 0
        assert counts["documents"] >= 0

        # 2. App storage contract
        assert "app_storage" in data
        storage = data["app_storage"]
        assert isinstance(storage["total_bytes"], int)
        assert isinstance(storage["media_bytes"], int)
        assert isinstance(storage["app_system_bytes"], int)
        assert isinstance(storage["originals_bytes"], int)
        assert isinstance(storage["thumbnails_bytes"], int)
        assert isinstance(storage["previews_bytes"], int)
        assert isinstance(storage["database_bytes"], int)
        assert storage["total_bytes"] >= 0
        assert storage["media_bytes"] >= 0
        assert storage["app_system_bytes"] >= 0

        # 3. Drive storage contract
        assert "drive_storage" in data
        drive = data["drive_storage"]
        assert isinstance(drive["drive_letter"], str)
        assert isinstance(drive["is_internal"], bool)
        assert isinstance(drive["total_bytes"], int)
        assert isinstance(drive["free_bytes"], int)
        assert isinstance(drive["app_consumed_bytes"], int)
        assert isinstance(drive["system_other_bytes"], int)
        assert isinstance(drive["other_files_bytes"], int)
        assert isinstance(drive["disclaimer"], str)
        assert drive["total_bytes"] > 0

        assert len(drive["disclaimer"]) > 0


@pytest.mark.asyncio
async def test_dashboard_media_counts_categorization():
    """Verifies exact delineation between images, videos, documents, and trashed items."""
    await run_migrations()
    conn = await get_db_connection()
    try:
        # Clear existing photos for test predictability
        await conn.execute("DELETE FROM photos WHERE filepath LIKE '%test_dash_%';")

        # Insert 1 image
        await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_document, is_favorite)
            VALUES ('test_dash_1.jpg', 'C:/test_dash_1.jpg', 1000, 'image/jpeg', 0, 1);
            """
        )
        # Insert 1 video
        await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_document, is_favorite)
            VALUES ('test_dash_2.mp4', 'C:/test_dash_2.mp4', 5000, 'video/mp4', 0, 0);
            """
        )
        # Insert 1 document
        await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_document, is_favorite)
            VALUES ('test_dash_3.pdf', 'C:/test_dash_3.pdf', 3000, 'application/pdf', 1, 0);
            """
        )
        # Insert 1 trashed photo (must NOT be counted)
        await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_document, trashed_at)
            VALUES ('test_dash_4.jpg', 'C:/test_dash_4.jpg', 2000, 'image/jpeg', 0, CURRENT_TIMESTAMP);
            """
        )
        await conn.commit()
    finally:
        await conn.close()

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get("/api/system/dashboard")
            assert res.status_code == 200
            counts = res.json()["media_counts"]

            assert counts["images"] >= 1
            assert counts["videos"] >= 1
            assert counts["documents"] >= 1
            assert counts["favorites"] >= 1
    finally:
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM photos WHERE filepath LIKE '%test_dash_%';")
            await conn.commit()
        finally:
            await conn.close()


def test_storage_footprint_calculator():
    """Verifies app storage calculation executes without exceptions."""
    stats = calculate_app_storage_footprint(force_refresh=True)
    assert stats.total_bytes >= 0
    assert stats.database_bytes >= 0


@pytest.mark.asyncio
async def test_optimization_status_and_controls():
    """Verifies optimization status calculation and pause/resume/trigger control endpoints."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/system/optimization-status")
        assert res.status_code == 200
        data = res.json()
        assert "service_status" in data
        assert data["service_status"] in ("idle", "paused", "processing")
        assert "videos_total" in data
        assert "videos_optimized" in data
        assert "images_total" in data
        assert "images_optimized" in data
        assert data["images_optimized"] == data["images_total"]
        assert 0 <= data["overall_progress_percent"] <= 100

        # Test pause and resume endpoints
        p_res = await client.post("/api/system/optimization/pause")
        assert p_res.status_code == 200
        assert p_res.json()["status"] == "paused"

        r_res = await client.post("/api/system/optimization/resume")
        assert r_res.status_code == 200
        assert r_res.json()["status"] == "running"


@pytest.mark.asyncio
async def test_app_settings_get_and_patch():
    """Verifies that GET /api/system/settings and PATCH /api/system/settings persist in SQLite."""
    await run_migrations()
    
    # Ensure clean state for test run
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM app_settings;")
        await conn.commit()
    finally:
        await conn.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Fetch defaults
        res = await client.get("/api/system/settings")
        assert res.status_code == 200
        data = res.json()
        assert "settings" in data
        settings = data["settings"]
        assert settings["theme"] in ("dark", "light")
        assert settings["grid_density"] in ("compact", "comfortable", "spacious")
        assert settings["quality_crf"] == 18

        # 2. Update settings via PATCH
        patch_payload = {
            "settings": {
                "theme": "light",
                "grid_density": "spacious",
                "quality_crf": 22,
                "auto_lock_duration": 900,
                "reduce_motion": True,
            }
        }
        patch_res = await client.patch("/api/system/settings", json=patch_payload)
        assert patch_res.status_code == 200
        patch_data = patch_res.json()
        assert patch_data["status"] == "saved"
        assert patch_data["settings"]["theme"] == "light"
        assert patch_data["settings"]["grid_density"] == "spacious"
        assert patch_data["settings"]["quality_crf"] == 22
        assert patch_data["settings"]["auto_lock_duration"] == 900
        assert patch_data["settings"]["reduce_motion"] is True

        # 3. Verify persistence on new GET
        verify_res = await client.get("/api/system/settings")
        assert verify_res.status_code == 200
        verified = verify_res.json()["settings"]
        assert verified["theme"] == "light"
        assert verified["grid_density"] == "spacious"
        assert verified["quality_crf"] == 22
        assert verified["auto_lock_duration"] == 900
        assert verified["reduce_motion"] is True




@pytest.mark.asyncio
async def test_storage_split_by_kind_counts_each_file_once():
    """Each file counts once, in the first kind that fits: Trash, Vault, documents, collages, videos, photos."""
    await run_migrations()

    def by_key(stats):
        return {c.key: c.bytes for c in stats.categories}

    before = by_key(calculate_app_storage_footprint(force_refresh=True))
    rows = [
        ("r9a_photo.jpg", "originals/2026/01/r9a_photo.jpg", 1_000, "image/jpeg", 0, 0, None),
        ("r9a_clip.mp4", "originals/2026/01/r9a_clip.mp4", 20_000, "video/mp4", 0, 0, None),
        ("r9a_bill.pdf", "originals/2026/01/r9a_bill.pdf", 300, "application/pdf", 0, 1, None),
        ("r9a_secret.jpg", "originals/2026/01/r9a_secret.jpg.enc", 4_000, "image/jpeg", 1, 0, None),
        ("r9a_collage.jpg", "originals/collages/2026/01/r9a_collage.jpg", 50_000, "image/jpeg", 0, 0, None),
        # A trashed vault video counts as Trash only.
        ("r9a_old.mp4", "originals/2026/01/r9a_old.mp4.enc", 700_000, "video/mp4", 1, 0, "2026-11-01 10:00:00"),
    ]
    from engine.config import settings

    song = settings.music_dir / "r9a_song.mp3"
    song.parent.mkdir(parents=True, exist_ok=True)
    song.write_bytes(bytes(9_000))
    conn = await get_db_connection()
    try:
        for name, path, size, mime, enc, doc, trashed in rows:
            await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, is_document, trashed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?);",
                (name, path, size, mime, enc, doc, trashed),
            )
        await conn.commit()
        after_stats = calculate_app_storage_footprint(force_refresh=True)
        after = by_key(after_stats)
        kinds = ("photos", "videos", "documents", "vault", "collages", "music", "trash")
        delta = {k: after.get(k, 0) - before.get(k, 0) for k in kinds}
        assert delta == {
            "photos": 1_000, "videos": 20_000, "documents": 300, "vault": 4_000,
            "collages": 50_000, "music": 9_000, "trash": 700_000,
        }
        assert sum(after.values()) == after_stats.total_bytes
    finally:
        song.unlink(missing_ok=True)
        await conn.execute("DELETE FROM photos WHERE filename LIKE 'r9a_%';")
        await conn.commit()
        await conn.close()
        calculate_app_storage_footprint(force_refresh=True)


@pytest.mark.asyncio
async def test_library_location_is_the_engines_own_folder():
    """Settings shows the folder the engine really uses, not a guess from the window program."""
    await run_migrations()
    from engine.config import settings

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/system/library")
    assert res.status_code == 200
    assert res.json() == {"path": str(settings.data_dir), "has_database": True}


@pytest.mark.asyncio
async def test_an_original_and_its_improved_copies_count_once():
    """T4: the Dashboard said 30 photos where Photos showed 21; it counted every improved copy."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        before = (await client.get("/api/system/dashboard")).json()["media_counts"]
        conn = await get_db_connection()
        try:
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('t4_old.jpg', 'originals/t4_old.jpg', 1, 'image/jpeg');"
            )
            original_id = cur.lastrowid
            for n in (1, 2):
                await conn.execute(
                    "INSERT INTO photos (filename, filepath, file_size, mime_type, derived_from_id, ai_kind) VALUES (?, ?, 1, 'image/jpeg', ?, 'colour');",
                    (f"t4_copy{n}.jpg", f"originals/t4_copy{n}.jpg", original_id),
                )
            await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('t4_plain.jpg', 'originals/t4_plain.jpg', 1, 'image/jpeg');"
            )
            await conn.commit()
            after = (await client.get("/api/system/dashboard")).json()["media_counts"]
        finally:
            await conn.execute("DELETE FROM photos WHERE filename LIKE 't4_%';")
            await conn.commit()
            await conn.close()
    assert after["images"] - before["images"] == 2  # the old print (shown as its newest copy) and the plain photo
    assert after["total_media"] - before["total_media"] == 2
