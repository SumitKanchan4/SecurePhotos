"""Unused thumbnail/preview/face files are removed; everything still in use is kept (2026-11-19).

Owner report: with no photos left, Storage still showed 1.4 MB of thumbnails.
"""

import os
import secrets
import time

import pytest

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.services.media_paths import to_db_path
from engine.services.storage_cleanup import sweep_unused_files

OLD = time.time() - 3600


def _file(path, old=True, size=100):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    if old:
        os.utime(path, (OLD, OLD))
    return path


@pytest.mark.asyncio
async def test_sweep_removes_only_files_nothing_uses():
    await run_migrations()
    tag = secrets.token_hex(4)
    thumbs, previews = settings.thumbnails_dir, settings.previews_dir
    used_thumb = _file(thumbs / "a1" / f"used_{tag}.webp")
    used_preview = _file(previews / "display" / f"used_{tag}.webp")
    old_thumb = _file(thumbs / f"z{tag[:1]}" / f"old_{tag}.webp")  # Left by a rewritten photo.
    old_preview = _file(previews / "display" / f"old_{tag}.webp")
    fresh = _file(thumbs / "a1" / f"fresh_{tag}.webp", old=False)  # Being made right now.

    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, thumbnail_path, preview_path) VALUES (?, ?, 1, 'video/mp4', ?, ?);",
            (f"sweep_{tag}.mp4", f"originals/sweep_{tag}.mp4", to_db_path(used_thumb), to_db_path(used_preview)),
        )
        photo_id = cur.lastrowid
        cur = await conn.execute(
            "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding) VALUES (?, 0.1, 0.1, 0.2, 0.2, '[]');", (photo_id,)
        )
        face_id = cur.lastrowid
        await conn.commit()
    finally:
        await conn.close()
    face_kept = _file(thumbs / "faces" / f"{face_id}.webp")
    face_gone = _file(thumbs / "faces" / f"{face_id + 100000}.webp")
    video_kept = _file(previews / "videos" / f"{photo_id}_web.mp4")
    video_gone = _file(previews / "videos" / f"{photo_id + 100000}_web.mp4")

    try:
        removed, freed = await sweep_unused_files()
        assert removed >= 4 and freed >= 400
        for kept in (used_thumb, used_preview, fresh, face_kept, video_kept):
            assert kept.exists(), kept
        for gone in (old_thumb, old_preview, face_gone, video_gone):
            assert not gone.exists(), gone
        assert not old_thumb.parent.exists()  # The emptied shard folder goes too.
        assert (thumbs / "faces").exists() and (previews / "display").exists()
    finally:
        conn = await get_db_connection()
        await conn.execute("DELETE FROM faces WHERE photo_id = ?;", (photo_id,))
        await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
        await conn.commit()
        await conn.close()
        for p in (used_thumb, used_preview, fresh, face_kept, video_kept):
            p.unlink(missing_ok=True)
