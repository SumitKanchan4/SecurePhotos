"""Tests for Video Ingestion Classification, Resilient Queue Service, and Disconnection Safety."""

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


def test_video_size_setting_decides_how_far_videos_are_enlarged():
    """Owner, 2026-11-19: Settings → Video size, separate from Photo size, never above 4K."""
    vintage = {"width": 640, "height": 480, "codec": "h264", "file_size": 15_000_000}
    phone = {"width": 1920, "height": 1080, "codec": "hevc", "file_size": 20_000_000}
    uhd = {"width": 3840, "height": 2160, "codec": "hevc", "file_size": 250_000_000}
    # As recorded: the old clip isn't enlarged.
    assert classify_video_for_ingestion(vintage, "original")["action"] == "none"
    # HD (default): only the old clip is enlarged, to 1080p.
    assert classify_video_for_ingestion(vintage, "hd")["target_height"] == 1080
    assert classify_video_for_ingestion(phone, "hd")["action"] == "none"
    # 2K: everything below 1440p is enlarged to 1440p; a 1440p+ video goes on to the usual checks.
    assert classify_video_for_ingestion(phone, "2k")["target_height"] == 1440
    assert classify_video_for_ingestion({**phone, "width": 2560, "height": 1440}, "2k")["action"] == "none"
    # 4K: everything below 4K is enlarged to 4K; 4K stays as it is (nothing goes above 4K).
    assert classify_video_for_ingestion(vintage, "4k")["target_height"] == 2160
    assert classify_video_for_ingestion(phone, "4k")["target_height"] == 2160
    assert classify_video_for_ingestion(uhd, "4k")["action"] == "none"


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
async def test_video_queue_disconnection_safety(monkeypatch):
    """Verify that when source storage is disconnected (file missing), queue safely marks job paused without crashing."""
    from engine.services import video_queue_service as vq

    async def no_photos_waiting():
        return False

    # Videos wait for photos (2026-11-19); other tests leave photos "being prepared".
    monkeypatch.setattr(vq, "_photos_waiting", no_photos_waiting)
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



def test_videos_are_enlarged_by_their_shorter_side():
    """A portrait phone video made 4K is 2160 px wide (2026-11-19); landscape: 2160 px tall."""
    from engine.services.video_service import video_scale_filter

    assert video_scale_filter(720, 1280, 2160) == "scale=2160:-2:flags=lanczos"
    assert video_scale_filter(1920, 1080, 2160) == "scale=-2:2160:flags=lanczos"
    assert video_scale_filter(0, 0, 1440) == "scale=-2:1440:flags=lanczos"


@pytest.mark.asyncio
async def test_automatic_video_jobs_wait_until_no_photo_is_being_prepared():
    """Owner, 2026-11-19: video work comes after the photos (an import's 2K video took the slot first)."""
    import uuid

    from engine.database import get_db_connection, run_migrations
    from engine.services import video_queue_service as vq

    await run_migrations()
    tag = uuid.uuid4().hex[:8]
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, is_optimized) VALUES (?, ?, 1, 'image/jpeg', 0);",
            (f"wait_{tag}.jpg", f"originals/wait_{tag}.jpg"),
        )
        photo_id = cur.lastrowid
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES (?, ?, 1, 'video/mp4');",
            (f"wait_{tag}.mp4", f"originals/wait_{tag}.mp4"),
        )
        video_id = cur.lastrowid
        await conn.execute("INSERT INTO video_processing_queue (photo_id, action, target_height) VALUES (?, 'enhance', 1440);", (video_id,))
        await conn.commit()
    finally:
        await conn.close()
    try:
        assert await vq._photos_waiting()
        assert await vq._process_next_video_job() is False
        conn = await get_db_connection()
        try:
            async with conn.execute("SELECT status, retry_count FROM video_processing_queue WHERE photo_id = ?;", (video_id,)) as cur:
                assert tuple(await cur.fetchone()) == ("queued", 0)  # Untouched: it waits its turn.
        finally:
            await conn.close()
    finally:
        conn = await get_db_connection()
        await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (video_id,))
        await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (photo_id, video_id))
        await conn.commit()
        await conn.close()
