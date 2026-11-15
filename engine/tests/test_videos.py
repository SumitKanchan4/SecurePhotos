"""Automated Tests for Self-Contained Video Engine, Transcoding, Enhancement, and API."""

import os
import subprocess
from pathlib import Path
import pytest
import aiosqlite
from httpx import AsyncClient, ASGITransport

from engine.main import create_app, app
from engine.database import run_migrations, get_db_connection
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
from engine.services.video_queue_service import pause_video_queue
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
    if not ffmpeg or not ffprobe:
        pytest.skip("FFmpeg/FFprobe binaries not present in test environment")

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

    # Pause background video queue during direct API testing to avoid background worker race conditions
    pause_video_queue()
    try:
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
            # Dequeue from background worker to avoid simultaneous background processing during manual test
            await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?", (photo_id,))
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
            # 1.5. Test GET /api/photos/{photo_id}/thumbnail (verify 200 OK image/webp, no PIL 500 crash)
            thumb_res = await client.get(f"/api/photos/{photo_id}/thumbnail")
            assert thumb_res.status_code == 200
            assert thumb_res.headers["content-type"] == "image/webp"
            assert len(thumb_res.content) > 0

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
            assert enh_res.status_code == 200, f"Enhance failed: {enh_res.status_code} - {enh_res.text}"
            enh_data = enh_res.json()
            assert enh_data["success"] is True
            assert enh_data["height"] in (720, 1080)

            # Verify DB updated
            conn2 = await get_db_connection()
            try:
                conn2.row_factory = aiosqlite.Row
                async with conn2.execute("SELECT is_enhanced, height FROM photos WHERE id = ?", (photo_id,)) as cursor:
                    up_row = await cursor.fetchone()
                    assert up_row["is_enhanced"] == 1
                    assert up_row["height"] in (720, 1080)
            finally:
                await conn2.close()
    finally:
        if photo_id:
            conn_clean = await get_db_connection()
            try:
                await conn_clean.execute("DELETE FROM video_processing_queue WHERE photo_id = ?", (photo_id,))
                await conn_clean.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
                await conn_clean.commit()
            finally:
                await conn_clean.close()


@pytest.mark.asyncio
async def test_video_whatsapp_filename_date_extraction(tmp_path):
    """Verifies that WhatsApp video naming patterns (VID-YYYYMMDD-WA...) extract taken_at correctly."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg not available")

    wa_clip = tmp_path / "VID-20260816-WA0002.mp4"
    subprocess.run([
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "testsrc=duration=0.5:size=160x120:rate=10",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        str(wa_clip)
    ], capture_output=True, check=True)

    from engine.services.ingestion_service import extract_exif_metadata
    meta = extract_exif_metadata(wa_clip)
    assert meta["taken_at"] is not None
    assert meta["taken_at"].startswith("2026-08-16")


async def _heavy_library_video(tmp_path):
    """A 2-second high-bitrate clip imported into the library; returns (photo_id, library file path)."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg not available")
    import time
    heavy_path = tmp_path / f"heavy_clip_{time.time_ns()}.mp4"
    cmd = [
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "testsrc=duration=2.0:size=640x480:rate=30",
        "-f", "lavfi", "-i", f"sine=frequency={int(time.time()) % 1000 + 400}:duration=2.0",
        "-metadata", f"title=heavy_test_{time.time_ns()}",
        "-c:v", "libx264", "-b:v", "15M", "-minrate", "15M", "-maxrate", "15M", "-bufsize", "15M",
        "-c:a", "aac", "-pix_fmt", "yuv420p",
        str(heavy_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    conn = await get_db_connection()
    try:
        photo_id = await ingest_single_photo(conn, heavy_path, mode="managed")
        await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (photo_id,))
        await conn.commit()
        async with conn.execute("SELECT filepath FROM photos WHERE id = ?;", (photo_id,)) as cur:
            stored = (await cur.fetchone())["filepath"]
    finally:
        await conn.close()
    assert photo_id is not None
    from engine.config import resolve_media_path
    return photo_id, resolve_media_path(stored)


@pytest.mark.asyncio
async def test_video_compression_deletes_the_original_once_checked(tmp_path):
    """R7c (owner decision): the checked smaller copy replaces the original, which is deleted (space freed)."""
    photo_id, original = await _heavy_library_video(tmp_path)
    assert original.exists()

    res = await compress_video(photo_id, crf=28)
    assert res["success"] is True, f"Compress failed: {res}"
    assert res["saved_bytes"] > 0
    assert res["compressed_bytes"] < res["original_bytes"]

    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT file_size, original_file_size FROM photos WHERE id = ?;", (photo_id,)) as cur:
            row = await cur.fetchone()
            assert row["file_size"] == res["compressed_bytes"]
            assert row["original_file_size"] == res["original_bytes"]
    finally:
        await conn.close()

    assert not original.exists()
    assert Path(res["new_filepath"]).exists()
    assert not (original.parent / ".trash").exists() or not list((original.parent / ".trash").glob(f"{original.name}.orig_*"))


@pytest.mark.asyncio
async def test_video_compression_keeps_the_original_when_the_copy_fails_the_check(tmp_path, monkeypatch):
    """A copy with the wrong length is thrown away and nothing changes."""
    photo_id, original = await _heavy_library_video(tmp_path)
    import engine.services.video_service as vs

    real = vs.extract_video_metadata

    def short_copy(path):
        meta = real(path)
        if "_transcoding_" in str(path):
            meta = {**meta, "duration": 0.5}
        return meta

    monkeypatch.setattr(vs, "extract_video_metadata", short_copy)
    res = await compress_video(photo_id, crf=28)
    assert res["success"] is False
    assert "original was kept" in res["error"]
    assert original.exists()
    assert not list(original.parent.glob("*_transcoding_*"))
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT filepath, is_optimized FROM photos WHERE id = ?;", (photo_id,)) as cur:
            row = await cur.fetchone()
    finally:
        await conn.close()
    assert not row["is_optimized"]


def test_verify_transcoded_copy_rules():
    from engine.services.video_service import verify_transcoded_copy

    ok = {"width": 640, "height": 480, "duration": 120.0}
    assert verify_transcoded_copy(ok, {**ok, "duration": 119.4}) is None
    assert verify_transcoded_copy({**ok, "duration": 3600.0}, {**ok, "duration": 3590.0}) is None  # within 1 %
    assert "long" in verify_transcoded_copy(ok, {**ok, "duration": 100.0})
    assert verify_transcoded_copy(ok, {**ok, "width": None}) == "the copy has no picture"
    assert verify_transcoded_copy({**ok, "duration": 0}, ok) == "the original's length couldn't be read"
    assert verify_transcoded_copy(ok, {**ok, "duration": 0}) == "the copy's length couldn't be read"


@pytest.mark.asyncio
async def test_video_enhance_resolution_aware_upscale(tmp_path):
    """Verifies that an already-enhanced 1080p video can be upgraded to 4K UHD, but skips if already 4K."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg not available")

    clip_path = tmp_path / "test_1080p_clip.mp4"
    cmd = [
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "testsrc=duration=0.5:size=320x240:rate=10",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        str(clip_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)

    conn = await get_db_connection()
    try:
        photo_id = await ingest_single_photo(conn, clip_path, mode="managed")
        # Artificially set is_enhanced = 1 and height = 1080
        await conn.execute("UPDATE photos SET is_enhanced = 1, height = 1080, width = 608 WHERE id = ?", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()

    try:
        # 1. Calling enhance with target_height=1080 should return already_enhanced = True
        res_hd = await enhance_old_video(photo_id, target_height=1080)
        assert res_hd["success"] is True
        assert res_hd.get("already_enhanced") is True

        # 2. Calling enhance with target_height=2160 (4K UHD) should NOT be blocked by already_enhanced
        # It should upscale to 4K
        res_4k = await enhance_old_video(photo_id, target_height=2160)
        assert res_4k["success"] is True
        assert res_4k.get("already_enhanced") is not True
        assert res_4k["height"] == 2160
        assert "_4k.mp4" in res_4k["new_filepath"]

        # 3. Now that it is 2160p, calling enhance with target_height=2160 again should report already_enhanced = True
        res_4k_again = await enhance_old_video(photo_id, target_height=2160)
        assert res_4k_again["success"] is True
        assert res_4k_again.get("already_enhanced") is True
    finally:
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
            await conn.commit()
        finally:
            await conn.close()


@pytest.mark.asyncio
async def test_video_streaming_endpoint(tmp_path):
    """Verifies that GET /api/videos/{photo_id}/stream streams video with byte-range support."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg not available")

    clip_file = tmp_path / "stream_test.mp4"
    subprocess.run([
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "testsrc=duration=0.5:size=160x120:rate=10",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(clip_file)
    ], capture_output=True, check=True)

    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, width, height, is_encrypted, is_optimized)
            VALUES (?, ?, ?, 'video/mp4', 160, 120, 0, 1)
            RETURNING id;
            """,
            (clip_file.name, str(clip_file), clip_file.stat().st_size),
        )
        row = await cur.fetchone()
        photo_id = row[0]
        await conn.commit()
    finally:
        await conn.close()

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            # 1. Full stream request
            res = await client.get(f"/api/videos/{photo_id}/stream")
            assert res.status_code == 200
            assert res.headers.get("content-type") == "video/mp4"
            assert "bytes" in res.headers.get("accept-ranges", "")

            # 2. Byte-range partial content request (Range: bytes=0-50)
            res_range = await client.get(
                f"/api/videos/{photo_id}/stream",
                headers={"Range": "bytes=0-50"},
            )
            assert res_range.status_code == 206
            assert "video/mp4" in res_range.headers.get("content-type", "")
            assert res_range.headers.get("content-length") == "51"
            assert "bytes 0-50/" in res_range.headers.get("content-range", "")
    finally:
        conn2 = await get_db_connection()
        try:
            await conn2.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
            await conn2.commit()
        finally:
            await conn2.close()


def test_video_preview_lru_pruning(tmp_path):
    """Verifies that LRU preview cache pruning enforces storage limits and evicts oldest items first."""
    from engine.api.videos import prune_video_preview_cache

    mock_video_previews = tmp_path / "videos"
    mock_video_previews.mkdir(parents=True, exist_ok=True)

    # Create 4 preview files of 1 MB each (total 4 MB)
    p1 = mock_video_previews / "101_web.mp4"
    p2 = mock_video_previews / "102_web.mp4"
    p3 = mock_video_previews / "103_web.mp4"
    p4 = mock_video_previews / "104_web.mp4"

    one_mb = b"0" * (1024 * 1024)
    for i, p in enumerate([p1, p2, p3, p4]):
        p.write_bytes(one_mb)
        # Set artificial access times: p1 is oldest, p4 is newest
        os.utime(str(p), (1000 + i * 100, 1000 + i * 100))

    # Total size = 4 MB. Prune with budget of 2.5 MB (target 80% = 2.0 MB)
    reclaimed = prune_video_preview_cache(max_bytes=int(2.5 * 1024 * 1024), target_dir=mock_video_previews)
    assert reclaimed >= 2 * 1024 * 1024

    # Oldest (p1 and p2) should be evicted
    assert not p1.exists()
    assert not p2.exists()
    # Newer (p3 and p4) should remain
    assert p3.exists()
    assert p4.exists()



