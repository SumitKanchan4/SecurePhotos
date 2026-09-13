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
        assert status["queued"] >= 1
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
        await enqueue_video_for_processing(photo_id, action="enhance", target_height=1080)

        # Process next job
        processed = await _process_next_video_job()
        assert processed is False

        # Verify job status transitioned to paused
        status = await get_queue_status()
        assert status["paused"] >= 1
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
