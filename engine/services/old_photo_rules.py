"""Automatic old-photo improvements after import (H10 / A6).

Settings → Photos & AI → Old photos has one row per improvement, each "When I ask" (default)
or "Automatically". After an import, every new photo is looked at once, in the background:

- **Only scans of prints** (owner decision 2026-11-17): a photo with no camera exposure data
  (no ISO, aperture or shutter speed), which is how PhotoScan and flatbed scans look. Phone
  and camera photos are never changed automatically. All 19 of the owner's scans qualify.
- Grey or sepia scan  -> "Add colour" (Natural) if that row is Automatic.
- Colour scan         -> "Fix faded colours" if that row is Automatic.
- Faces: if "Sharpen blurry faces" is Automatic they are sharpened too, in the same job (one
  improved copy, not a chain of copies); if only that row is Automatic, a "Sharpen faces" job.
  With faces on "When I ask", an automatic colour fix leaves faces alone.

Jobs are queued as ``origin="auto"``: they run after anything the user asked for, wait while
the laptop is on battery, and keep their result by the "Keep original" switch (see
``restore_queue``). Vault photos, videos, documents and improved copies are skipped.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Iterable, List, Optional, Tuple

from engine.database import db_connection
from engine.services import restore_queue

logger = logging.getLogger("securephotos.old_photo_rules")

ROWS = ("colour", "fade", "faces")


def looks_like_a_scan(iso: Any, aperture: Any, shutter_speed: Any) -> bool:
    """No exposure data at all: a scan of a print, not a photo taken with a phone or camera."""
    return iso is None and aperture is None and shutter_speed is None


def plan(grey: bool, has_faces: bool, auto: Dict[str, bool]) -> Optional[Tuple[str, Dict[str, Any]]]:
    """The one job to queue for a scanned photo, or None. ``auto`` = which rows are Automatic."""
    faces = bool(auto.get("faces"))
    if grey and auto.get("colour"):
        return "colour", {"style": "natural", "faces": faces}
    if not grey and auto.get("fade"):
        return "fade", {"faces": faces}
    if faces and has_faces:
        return "faces", {}
    return None


async def automatic_rows() -> Dict[str, bool]:
    from engine.api.system import get_app_settings

    settings = (await get_app_settings())["settings"]
    return {row: settings.get(f"old_photos_{row}") == "auto" for row in ROWS}


def _look(stored: str) -> Tuple[bool, int]:
    """(grey?, number of faces) from the photo's thumbnail."""
    from engine.services import face_sharpen, photo_versions
    from engine.services.old_photo_processors import decode_rgb, is_black_and_white

    rgb = decode_rgb(photo_versions.read_photo_bytes(stored, False, None))
    try:
        faces = face_sharpen.count_faces(rgb, 10)  # Small on a 1024 px thumbnail is fine.
    except Exception:  # Face finder unavailable: colour rules still work.
        faces = 0
    return is_black_and_white(rgb), faces


async def on_imported(photo_ids: Iterable[int]) -> List[int]:
    """Queues the automatic improvements for newly imported photos. Returns the job ids."""
    auto = await automatic_rows()
    if not any(auto.values()):
        return []
    ids = list(dict.fromkeys(int(p) for p in photo_ids))
    queued: List[int] = []
    for photo_id in ids:
        async with db_connection() as conn:
            async with conn.execute(
                """SELECT thumbnail_path, filepath, iso, aperture, shutter_speed FROM photos
                   WHERE id = ? AND trashed_at IS NULL AND COALESCE(is_encrypted, 0) = 0
                     AND COALESCE(is_document, 0) = 0 AND derived_from_id IS NULL
                     AND (mime_type IS NULL OR mime_type NOT LIKE 'video/%');""",
                (photo_id,),
            ) as cur:
                row = await cur.fetchone()
        if row is None or not looks_like_a_scan(row[2], row[3], row[4]):
            continue
        try:
            grey, faces = await asyncio.to_thread(_look, row[0] or row[1])
        except Exception as err:
            logger.warning("Couldn't look at photo %s for the automatic rules: %s", photo_id, err)
            continue
        job = plan(grey, faces > 0, auto)
        if job is None:
            continue
        kind, params = job
        queued += await restore_queue.enqueue([photo_id], kind, params, origin="auto")
    return queued
