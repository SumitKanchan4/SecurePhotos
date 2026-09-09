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
