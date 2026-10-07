"""Tests for Video Ingestion Classification, Resilient Queue Service, and Disconnection Safety."""

import os
import uuid
import pytest
from httpx import AsyncClient, ASGITransport

from engine.main import app
from engine.services.video_service import classify_video_for_ingestion
from engine.services.video_queue_service import (
    init_video_queue_db,
    enqueue_video_for_processing,
    get_queue_status,
    pause_video_queue,
    resume_video_queue,
    _process_next_video_job,
)
from engine.database import get_db_connection


@pytest.mark.asyncio
async def test_classify_video_for_ingestion_4k():
    """Verify that native 4K UHD video is recognized as already optimized and never re-encoded."""
    meta_4k = {
        "width": 3840,
        "height": 2160,
        "codec": "hevc",
        "file_size": 250_000_000,
    }
    result = classify_video_for_ingestion(meta_4k)
    assert result["is_already_optimized"] is True
    assert result["action"] == "none"
    assert "4K UHD" in result["reason"]


@pytest.mark.asyncio
async def test_classify_video_for_ingestion_vintage():
    """Verify that low-res/vintage clips (<720p) are scheduled for AI upscaling to 1080p."""
    meta_vintage = {
        "width": 640,
        "height": 480,
        "codec": "h264",
        "file_size": 15_000_000,
    }
    result = classify_video_for_ingestion(meta_vintage)
    assert result["is_already_optimized"] is False
    assert result["action"] == "enhance"
    assert result["target_height"] == 1080


@pytest.mark.asyncio
async def test_classify_video_for_ingestion_heavy():
    """Verify that large legacy H.264 clips (>35MB) are scheduled for H.265 compression."""
    meta_heavy = {
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "file_size": 120_000_000,
    }
    result = classify_video_for_ingestion(meta_heavy)
    assert result["is_already_optimized"] is False
    assert result["action"] == "compress"


@pytest.mark.asyncio
async def test_video_queue_lifecycle():
    """Verify queue database initialization, enqueueing, and state reporting."""
    await init_video_queue_db()

    # Create dummy photo entry with unique filepath
    conn = await get_db_connection()
    unique_path = f"dummy_path_{uuid.uuid4().hex[:8]}.mp4"
    try:
        cursor = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, width, height)
            VALUES ('test_vid.mp4', ?, 50000000, 'video/mp4', 640, 480);
            """,
            (unique_path,),
        )
        photo_id = cursor.lastrowid
        await conn.commit()
    finally:
        await conn.close()

    try:
        # Enqueue
        success = await enqueue_video_for_processing(photo_id, action="enhance", target_height=1080)
        assert success is True

        status = await get_queue_status()
        assert (status.get("queued", 0) + status.get("processing", 0) + status.get("paused", 0)) >= 1
        assert status["total"] >= 1

        # Pause and resume
        pause_video_queue()
        assert (await get_queue_status())["is_paused"] is True
        resume_video_queue()
        assert (await get_queue_status())["is_paused"] is False
    finally:
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (photo_id,))
            await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            await conn.commit()
        finally:
            await conn.close()


@pytest.mark.asyncio
async def test_video_queue_disconnection_safety():
    """Verify that when source storage is disconnected (file missing), queue safely marks job paused without crashing."""
    await init_video_queue_db()

    conn = await get_db_connection()
    unique_missing_path = f"Z:\\non_existent_drive\\vid_{uuid.uuid4().hex[:8]}.mp4"
    try:
        cursor = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, width, height)
            VALUES ('disconnected_drive_video.mp4', ?, 80000000, 'video/mp4', 640, 480);
            """,
            (unique_missing_path,),
        )
        photo_id = cursor.lastrowid
        await conn.commit()
    finally:
        await conn.close()

    try:
        # Clear any leftover pending queue items from prior tests to ensure strict isolation
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM video_processing_queue WHERE status IN ('queued', 'processing');")
            await conn.commit()
        finally:
            await conn.close()

        await enqueue_video_for_processing(photo_id, action="enhance", target_height=1080)

        # Process next job (unpause first since autouse fixture isolates tests with pause_video_queue)
        resume_video_queue()
        try:
            processed = await _process_next_video_job()
            assert processed is False

            # Verify job status transitioned to paused
            status = await get_queue_status()
            assert status["paused"] >= 1
        finally:
            pause_video_queue()
    finally:
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (photo_id,))
            await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            await conn.commit()
        finally:
            await conn.close()


@pytest.mark.asyncio
async def test_video_queue_api_endpoints():
    """Verify FastAPI router endpoints for video queue status, pause, and resume."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Get queue status
        res = await client.get("/api/videos/queue")
        assert res.status_code == 200
        data = res.json()
        assert "is_paused" in data
        assert "queued" in data

        # 2. Pause queue
        res_pause = await client.post("/api/videos/queue/pause")
        assert res_pause.status_code == 200
        assert res_pause.json()["status"] == "paused"

        # 3. Resume queue
        res_resume = await client.post("/api/videos/queue/resume")
        assert res_resume.status_code == 200
        assert res_resume.json()["status"] == "running"


@pytest.mark.asyncio
async def test_video_queue_self_healing_on_photo_deletion_and_trash():
    """Verify SQLite triggers and API watchdog automatically self-heal and purge orphaned/trashed queue items."""
    await init_video_queue_db()

    conn = await get_db_connection()
    unique_path_1 = f"dummy_self_heal_{uuid.uuid4().hex[:8]}.mp4"
    unique_path_2 = f"dummy_self_heal_{uuid.uuid4().hex[:8]}.mp4"
    try:
        # Create 2 test photos
        c1 = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, width, height) VALUES ('v1.mp4', ?, 1000, 'video/mp4', 640, 480);",
            (unique_path_1,),
        )
        pid_1 = c1.lastrowid

        c2 = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, width, height) VALUES ('v2.mp4', ?, 1000, 'video/mp4', 640, 480);",
            (unique_path_2,),
        )
        pid_2 = c2.lastrowid
        await conn.commit()
    finally:
        await conn.close()

    try:
        # Enqueue both
        await enqueue_video_for_processing(pid_1, action="enhance")
        await enqueue_video_for_processing(pid_2, action="enhance")

        # Verify both are queued in DB
        conn = await get_db_connection()
        try:
            async with conn.execute("SELECT COUNT(*) FROM video_processing_queue WHERE photo_id IN (?, ?);", (pid_1, pid_2)) as cur:
                assert (await cur.fetchone())[0] == 2

            # Self-Healing Test 1: Moving photo 1 to trash must trigger immediate deletion from queue
            await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ?;", (pid_1,))
            await conn.commit()

            async with conn.execute("SELECT COUNT(*) FROM video_processing_queue WHERE photo_id = ?;", (pid_1,)) as cur:
                # SQLite trigger trg_photos_trash_purge_video_queue immediately purges pid_1
                assert (await cur.fetchone())[0] == 0

            # Self-Healing Test 2: Deleting photo 2 entirely must trigger immediate deletion from queue
            await conn.execute("DELETE FROM photos WHERE id = ?;", (pid_2,))
            await conn.commit()

            async with conn.execute("SELECT COUNT(*) FROM video_processing_queue WHERE photo_id = ?;", (pid_2,)) as cur:
                # SQLite trigger trg_photos_delete_purge_video_queue immediately purges pid_2
                assert (await cur.fetchone())[0] == 0
        finally:
            await conn.close()

        # Self-Healing Test 3: Watchdog in GET /api/videos/optimization-progress
        # Insert a synthetic stalled job with a non-existent photo (temporarily disable FK enforcement for synthetic test)
        conn = await get_db_connection()
        try:
            await conn.execute("PRAGMA foreign_keys = OFF;")
            await conn.execute(
                "INSERT INTO video_processing_queue (photo_id, action, status, updated_at) VALUES (999999, 'enhance', 'processing', datetime('now', '-5 minutes'));"
            )
            await conn.commit()
        finally:
            await conn.close()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get("/api/videos/optimization-progress")
            assert res.status_code == 200
            data = res.json()
            # Stalled orphaned job is purged by watchdog, returning is_active: False
            assert data["is_active"] is False
            assert data["total_count"] == 0
    finally:
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM video_processing_queue WHERE photo_id IN (?, ?, 999999);", (pid_1, pid_2))
            await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (pid_1, pid_2))
            await conn.commit()
        finally:
            await conn.close()

