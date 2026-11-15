"""One-off cleanup of video originals left in hidden ``.trash`` folders (owner decisions R7c2).

Before R7c, "Make smaller" moved each original into ``<folder>/.trash/<name>.orig_<timestamp>``
and Enhance into ``<folder>/.trash/<name>.vintage_<timestamp>``; nothing ever emptied them, so
the space was never freed. This runs once per library:

- an old "Make smaller" original is deleted, but only if its smaller video is still in the
  library and passes the same check as new compressions (has a picture, same length);
- an old Enhance original goes to Trash (restorable for 30 days), but only if its enhanced
  video is still in the library and passes the check;
- anything else is left alone.

The result is saved next to the library so the Dashboard can say how much space was freed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiosqlite

from engine.config import resolve_media_path, settings
from engine.database import get_db_connection
from engine.services.video_runtime import get_ffmpeg_path
from engine.services.video_service import extract_video_metadata, put_original_in_trash, verify_transcoded_copy

logger = logging.getLogger("securephotos.video_leftovers")

RESULT_FILE = "video_leftovers_cleanup.json"
_LEFTOVER = re.compile(r"^(?P<name>.+)\.(?P<kind>orig|vintage)_\d{14}$")


def result_path() -> Path:
    return settings.data_dir / RESULT_FILE


def read_result() -> Optional[Dict[str, Any]]:
    try:
        return json.loads(result_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_result(result: Dict[str, Any]) -> None:
    result_path().write_text(json.dumps(result), encoding="utf-8")


def _copy_names(original_name: str, kind: str) -> re.Pattern:
    """File names the replacement copy can have, from how compress/enhance named it."""
    stem = Path(original_name).stem
    if kind == "orig":
        bases = [f"{stem}_opt"]
    else:
        clean = stem
        for sfx in ("_enhanced", "_4k", "_opt"):
            clean = clean.replace(sfx, "")
        bases = [f"{clean}_enhanced", f"{clean}_4k"]
    alternatives = "|".join(re.escape(b) for b in bases)
    return re.compile(rf"^(?:{alternatives})(?:_[0-9a-f]{{6}})?\.mp4$", re.IGNORECASE)


def _free_name(folder: Path, name: str) -> Path:
    target = folder / name
    if not target.exists():
        return target
    p = Path(name)
    return folder / f"{p.stem}_original_{uuid.uuid4().hex[:6]}{p.suffix}"


async def clean_up_old_video_originals() -> Dict[str, Any]:
    """Finds and handles hidden leftover originals next to every library video.

    Returns:
        Counts and the space freed: removed, freed_bytes, moved_to_trash, kept.
    """
    result = {"removed": 0, "freed_bytes": 0, "moved_to_trash": 0, "kept": 0}
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT * FROM photos WHERE mime_type LIKE 'video/%' AND is_encrypted = 0;"
        ) as cur:
            rows = await cur.fetchall()

        folders: Dict[Path, List[Any]] = {}
        for r in rows:
            try:
                path = resolve_media_path(r["filepath"])
            except Exception:
                continue
            entry = folders.setdefault(path.parent, [])
            if r["trashed_at"] is None:
                entry.append((r, path))

        for folder, active in folders.items():
            hidden = folder / ".trash"
            if not hidden.is_dir():
                continue
            for leftover in sorted(hidden.iterdir()):
                m = _LEFTOVER.match(leftover.name)
                if not m or not leftover.is_file():
                    continue
                names = _copy_names(m["name"], m["kind"])
                candidates = [(r, p) for r, p in active if names.match(p.name) and p.exists()]
                checked = None
                leftover_meta = await asyncio.to_thread(extract_video_metadata, str(leftover))
                for r, p in candidates:
                    copy_meta = await asyncio.to_thread(extract_video_metadata, str(p))
                    if verify_transcoded_copy(leftover_meta, copy_meta) is None:
                        checked = r
                        break
                if checked is None:
                    result["kept"] += 1
                    logger.info("Kept %s: no checked copy in the library.", leftover)
                    continue

                size = leftover.stat().st_size
                if m["kind"] == "orig":
                    leftover.unlink()
                    result["removed"] += 1
                    result["freed_bytes"] += size
                else:
                    destination = _free_name(folder, m["name"])
                    leftover.replace(destination)
                    await put_original_in_trash(
                        conn, checked, destination, leftover_meta.get("width"), leftover_meta.get("height")
                    )
                    await conn.commit()
                    result["moved_to_trash"] += 1
            try:
                hidden.rmdir()  # only succeeds when nothing is left in it
            except OSError:
                pass
    finally:
        await conn.close()
    return result


async def run_once() -> Optional[Dict[str, Any]]:
    """Runs the cleanup the first time the engine starts with this library, then remembers it."""
    if read_result() is not None:
        return None
    if not get_ffmpeg_path():
        logger.info("Video tools missing; old video originals will be checked on a later start.")
        return None
    try:
        result = await clean_up_old_video_originals()
    except Exception as e:
        logger.error("Old video originals cleanup failed; it will be tried again next start: %s", e, exc_info=True)
        return None
    result["acknowledged"] = result["removed"] == 0 and result["moved_to_trash"] == 0
    write_result(result)
    logger.info("Old video originals cleanup: %s", result)
    return result
