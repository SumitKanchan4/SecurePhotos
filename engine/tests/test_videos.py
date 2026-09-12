"""Automated Tests for Self-Contained Video Engine, Transcoding, Enhancement, and API."""

import os
import subprocess
import tempfile
from pathlib import Path
import shutil
import pytest
import pytest_asyncio
import aiosqlite
from httpx import AsyncClient, ASGITransport

from engine.main import create_app
from engine.database import run_migrations, get_db_connection
from engine.config import settings
from engine.services.video_runtime import (
    get_ffmpeg_path,
    get_ffprobe_path,
    is_video_runtime_available,
    probe_hardware_encoder,
)
from engine.services.video_service import (
    extract_video_metadata,
    generate_video_thumbnail,
    analyze_video_candidate,
    compress_video,
    enhance_old_video,
)
from engine.services.ingestion_service import ingest_single_photo


@pytest.fixture(scope="module")
def sample_video_clip(tmp_path_factory):
    """Generates a real, synthetic 1-second 320x240 test video with audio using FFmpeg."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg binary not available on test machine")

    tmp_dir = tmp_path_factory.mktemp("video_test")
    out_video = tmp_dir / "sample_clip.mp4"

    cmd = [
        ffmpeg,
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=1.2:size=320x240:rate=15",
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=1.2",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        str(out_video),
    ]
    res = subprocess.run(cmd, capture_output=True, timeout=10)
    assert res.returncode == 0, f"Failed to generate test video: {res.stderr.decode()}"
    assert out_video.exists() and out_video.stat().st_size > 0
    return out_video


def test_video_runtime_discovery():
    """Verifies that the video runtime correctly locates binaries and probes encoders."""
    ffmpeg = get_ffmpeg_path()
    ffprobe = get_ffprobe_path()
    assert ffmpeg is not None, "FFmpeg path must be discoverable"
    assert ffprobe is not None, "FFprobe path must be discoverable"
    assert is_video_runtime_available() is True

    enc_info = probe_hardware_encoder()
    assert "encoder" in enc_info
    assert enc_info["type"] in ("hardware", "cpu")


def test_extract_video_metadata_and_thumbnail(sample_video_clip, tmp_path):
    """Verifies stream metadata extraction and WebP frame thumbnail generation."""
    meta = extract_video_metadata(str(sample_video_clip))
    assert meta["width"] == 320
    assert meta["height"] == 240
    assert meta["duration"] >= 1.0
    assert meta["fps"] > 0
    assert meta["codec"] in ("h264", "libx264")

    thumb_path = tmp_path / "thumb.webp"
    preview_path = tmp_path / "preview.webp"
    success = generate_video_thumbnail(str(sample_video_clip), str(thumb_path), str(preview_path), timestamp_sec=0.5)
    assert success is True
    assert thumb_path.exists() and thumb_path.stat().st_size > 0
    assert preview_path.exists() and preview_path.stat().st_size > 0


def test_analyze_video_candidate():
    """Verifies candidate classification into enhanceable, compressible, and optimized."""
    # 1. Vintage low-res clip (320x240)
    low_res_rec = {
        "id": 1,
        "width": 320,
        "height": 240,
        "file_size": 5_000_000,
        "filepath": "fake.mp4",
        "is_optimized": 0,
        "is_enhanced": 0,
    }
    plan1 = analyze_video_candidate(low_res_rec)
    assert plan1["status"] == "enhanceable"

    # 2. Heavy H.264 clip (>20 MB)
    heavy_rec = {
        "id": 2,
        "width": 1920,
        "height": 1080,
        "file_size": 35_000_000,
        "filepath": "fake.mp4",
        "is_optimized": 0,
        "is_enhanced": 0,
    }
    plan2 = analyze_video_candidate(heavy_rec)
    assert plan2["status"] == "compressible"
    assert plan2["projected_savings_bytes"] > 0

    # 3. Already optimized clip
    opt_rec = {
        "id": 3,
        "width": 1920,
        "height": 1080,
        "file_size": 10_000_000,
        "filepath": "fake.mp4",
        "is_optimized": 1,
        "is_enhanced": 0,
    }
    plan3 = analyze_video_candidate(opt_rec)
    assert plan3["status"] == "already_optimized"


@pytest.mark.asyncio
async def test_video_ingestion_and_api_workflow(sample_video_clip, tmp_path):
    """Verifies full ingestion into SQLite and REST API operations."""
    await run_migrations()
    app = create_app()

    # 0. Generate unique test clip to guarantee isolated hash
    import time
    test_clip = tmp_path / "ingest_workflow_test.mp4"
    ffmpeg = get_ffmpeg_path()
    subprocess.run([
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "testsrc=duration=1.0:size=320x240:rate=15",
        "-f", "lavfi", "-i", "sine=frequency=500:duration=1.0",
        "-metadata", f"title=ingest_test_{time.time_ns()}",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(test_clip)
    ], capture_output=True, check=True)

    # 1. Ingest sample video using ingestion_service
    conn = await get_db_connection()
    try:
        photo_id = await ingest_single_photo(conn, test_clip, mode="managed")
        await conn.commit()
    finally:
        await conn.close()

    assert photo_id is not None

    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)) as cursor:
            row = await cursor.fetchone()
            assert row is not None
            assert row["mime_type"].startswith("video/")
            assert row["width"] == 320
            assert row["height"] == 240
            assert row["thumbnail_path"] is not None
    finally:
        await conn.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 2. Test GET /api/videos/summary
        sum_res = await client.get("/api/videos/summary")
        assert sum_res.status_code == 200
        summary = sum_res.json()
        assert summary["runtime_available"] is True
        assert summary["total_videos"] >= 1

        # 3. Test GET /api/videos/candidates
        cand_res = await client.get("/api/videos/candidates")
        assert cand_res.status_code == 200
        candidates = cand_res.json()
        assert any(c["id"] == photo_id for c in candidates)

        # 4. Test POST /api/videos/{photo_id}/enhance (Upscale 240p -> 720p HD)
        enh_res = await client.post(f"/api/videos/{photo_id}/enhance", json={"target_height": 720})
        assert enh_res.status_code == 200
        enh_data = enh_res.json()
        assert enh_data["success"] is True
        assert enh_data["height"] == 720

        # Verify DB updated
        conn2 = await get_db_connection()
        try:
            conn2.row_factory = aiosqlite.Row
            async with conn2.execute("SELECT is_enhanced, height FROM photos WHERE id = ?", (photo_id,)) as cursor:
                up_row = await cursor.fetchone()
                assert up_row["is_enhanced"] == 1
                assert up_row["height"] == 720
        finally:
            await conn2.close()


@pytest.mark.asyncio
async def test_video_compression_workflow(tmp_path):
    """Verifies that high-bitrate video compression reduces size and saves original in trash."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg not available")

    # Generate a heavy 2-second clip with high bitrate (640x480 at ~15 Mbps)
    import time
    heavy_path = tmp_path / "heavy_clip.mp4"
    cmd = [
        ffmpeg,
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=2.0:size=640x480:rate=30",
        "-f", "lavfi",
        "-i", f"sine=frequency={int(time.time()) % 1000 + 400}:duration=2.0",
        "-metadata", f"title=heavy_test_{time.time_ns()}",
        "-c:v", "libx264",
        "-b:v", "15M",
        "-minrate", "15M",
        "-maxrate", "15M",
        "-bufsize", "15M",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        str(heavy_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)

    conn = await get_db_connection()
    try:
        photo_id = await ingest_single_photo(conn, heavy_path, mode="managed")
        await conn.commit()
    finally:
        await conn.close()

    assert photo_id is not None

    # Run compression with CRF 28
    res = await compress_video(photo_id, crf=28)
    assert res["success"] is True, f"Compress failed: {res}"
    assert res["saved_bytes"] > 0
    assert res["compressed_bytes"] < res["original_bytes"]

    # Verify original is moved to .trash folder
    trash_dir = Path(res["new_filepath"]).parent / ".trash"
    assert trash_dir.exists()
    assert len(list(trash_dir.glob("*.orig_*"))) >= 1

