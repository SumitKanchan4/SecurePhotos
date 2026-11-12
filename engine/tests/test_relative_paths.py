"""M2: every media path is stored relative to the library folder, and same-name checks really match."""

import subprocess
import time

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.ingestion_service import ingest_single_photo
from engine.services.video_runtime import get_ffmpeg_path


async def _row(photo_id, cols="*"):
    conn = await get_db_connection()
    try:
        async with conn.execute(f"SELECT {cols} FROM photos WHERE id = ?;", (photo_id,)) as cur:
            return await cur.fetchone()
    finally:
        await conn.close()


async def _delete(*ids):
    conn = await get_db_connection()
    try:
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", ids)
        await conn.commit()
    finally:
        await conn.close()


async def test_storage_cleanup_endpoint_is_gone():
    """It read relative paths against the working folder, so one call deleted every photo."""
    await run_migrations()
    keep = settings.originals_dir / "2026" / "01" / "01" / "m2_keep.jpg"
    keep.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 64), (1, 2, 3)).save(keep, "JPEG")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        res = await client.post("/api/system/prune-orphans")

    assert res.status_code in (404, 405)
    assert keep.exists()
    keep.unlink()


async def test_import_saves_relative_thumbnail_and_no_none_text(tmp_path):
    await run_migrations()
    src = tmp_path / "m2_import.jpg"
    Image.new("RGB", (640, 480), (30, 60, 90)).save(src, "JPEG")
    conn = await get_db_connection()
    try:
        photo_id = await ingest_single_photo(conn, src, mode="managed")
    finally:
        await conn.close()
    try:
        row = await _row(photo_id, "filepath, thumbnail_path, preview_path")
        assert row["thumbnail_path"].startswith("thumbnails/")
        assert row["preview_path"] is None  # Not the text "None".
        assert (settings.data_dir / row["thumbnail_path"]).is_file()
        assert not row["filepath"].startswith(("/", "\\")) and ":" not in row["filepath"]
    finally:
        await _delete(photo_id)


async def test_startup_converts_full_thumbnail_and_preview_paths():
    await run_migrations()
    data = str(settings.data_dir)
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, file_hash, thumbnail_path, preview_path) "
            "VALUES ('m2.jpg', 'originals/m2.jpg', 1, 'image/jpeg', 'm2-a', ?, ?);",
            (data + "\\thumbnails\\ab\\abc.webp", "E:/OldDrive/data/previews/cd/cde.webp"),
        )
        full_id = cur.lastrowid
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, file_hash, thumbnail_path, preview_path) "
            "VALUES ('m2b.jpg', 'originals/m2b.jpg', 1, 'image/jpeg', 'm2-b', 'thumbnails/ef/efg.webp', 'None');"
        )
        none_id = cur.lastrowid
        await conn.commit()
    finally:
        await conn.close()
    try:
        await run_migrations()
        row = await _row(full_id, "thumbnail_path, preview_path")
        assert (row["thumbnail_path"], row["preview_path"]) == ("thumbnails/ab/abc.webp", "previews/cd/cde.webp")
        row = await _row(none_id, "thumbnail_path, preview_path")
        assert (row["thumbnail_path"], row["preview_path"]) == ("thumbnails/ef/efg.webp", None)  # Relative kept.
    finally:
        await _delete(full_id, none_id)


async def test_video_conversion_never_overwrites_another_video(tmp_path):
    """The target name (clip_opt.mp4) is taken by another library video: that video must survive."""
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip("FFmpeg not available")
    from engine.services.video_service import compress_video

    await run_migrations()
    clip = tmp_path / f"m2clip_{time.time_ns()}.mp4"
    subprocess.run([
        ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=2.0:size=640x480:rate=30",
        "-metadata", f"title=m2_{time.time_ns()}",
        "-c:v", "libx264", "-b:v", "15M", "-minrate", "15M", "-maxrate", "15M", "-bufsize", "15M",
        "-pix_fmt", "yuv420p", str(clip),
    ], capture_output=True, check=True)

    conn = await get_db_connection()
    try:
        video_id = await ingest_single_photo(conn, clip, mode="managed")
        await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (video_id,))
        stored = (await _row(video_id, "filepath"))["filepath"]
        library_clip = settings.data_dir / stored
        other = library_clip.with_name(f"{library_clip.stem}_opt.mp4")  # compress_video's target name.
        other.write_bytes(b"someone else's precious video")
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, file_hash) VALUES (?, ?, 29, 'video/mp4', ?);",
            (other.name, stored.rsplit("/", 1)[0] + "/" + other.name, f"m2-other-{time.time_ns()}"),
        )
        other_id = cur.lastrowid
        await conn.commit()
    finally:
        await conn.close()

    try:
        res = await compress_video(video_id, crf=28)
        assert res["success"] is True, res
        assert other.read_bytes() == b"someone else's precious video"
        new_path = (await _row(video_id, "filepath"))["filepath"]
        assert new_path != (await _row(other_id, "filepath"))["filepath"]
        assert (settings.data_dir / new_path).is_file()
    finally:
        await _delete(video_id, other_id)
