"""Removes thumbnail, preview and face-picture files nothing in the library uses any more.

Owner report 2026-11-19: with no photos left, Storage still showed 1.4 MB of thumbnails. When a
photo is rewritten (8K, a converted video) its file hash changes, a new thumbnail and preview are
made under new names, and the old ones were never removed; identical photos share a thumbnail, so
deleting at that moment isn't safe. This sweep removes only files that:

- sit in the app's own ``thumbnails`` or ``previews`` folders (never photos, never the vault's
  encrypted originals),
- are not named by any value in the database (every table is checked, not only photos),
- for face pictures (``thumbnails/faces/<id>.webp``), belong to no face,
- for web copies of videos (``previews/videos/<photo id>_web.mp4``, found by id), belong to no photo,
- and haven't changed in the last ``grace_seconds`` (a file being made right now is kept).

Empty shard folders left behind are removed too.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Set, Tuple

from engine.config import settings
from engine.database import get_db_connection

logger = logging.getLogger("securephotos.storage_cleanup")

GRACE_SECONDS = 600


def _key(path: Path) -> str:
    return os.path.normcase(os.path.normpath(str(path)))


async def _referenced() -> Tuple[Set[str], Set[str], Set[str], Set[str]]:
    """(full paths, file names) named anywhere in the database, the face ids and the photo ids."""
    paths: Set[str] = set()
    names: Set[str] = set()
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';") as cur:
            tables = [r[0] for r in await cur.fetchall()]
        for table in tables:
            try:
                async with conn.execute(f'PRAGMA table_info("{table}");') as cur:
                    columns = [r[1] for r in await cur.fetchall()]
            except Exception:  # noqa: BLE001 - virtual tables without table_info
                continue
            for column in columns:
                try:
                    async with conn.execute(
                        f'SELECT "{column}" FROM "{table}" WHERE typeof("{column}") = \'text\' '
                        f'AND ("{column}" LIKE \'%thumbnails%\' OR "{column}" LIKE \'%previews%\');'
                    ) as cur:
                        for (value,) in await cur.fetchall():
                            p = Path(value)
                            p = p if p.is_absolute() else settings.data_dir / p
                            paths.add(_key(p))
                            names.add(p.name.lower())
                except Exception:  # noqa: BLE001 - a column that can't be read is simply skipped
                    continue
        async with conn.execute("SELECT id FROM faces;") as cur:
            face_ids = {str(r[0]) for r in await cur.fetchall()}
        async with conn.execute("SELECT id FROM photos;") as cur:
            photo_ids = {str(r[0]) for r in await cur.fetchall()}
    finally:
        await conn.close()
    return paths, names, face_ids, photo_ids


async def sweep_unused_files(grace_seconds: float = GRACE_SECONDS) -> Tuple[int, int]:
    """Deletes unused thumbnail/preview/face files; returns (files removed, bytes freed)."""
    paths, names, face_ids, photo_ids = await _referenced()
    faces_dir = settings.thumbnails_dir / "faces"
    video_copies_dir = settings.previews_dir / "videos"
    cutoff = time.time() - grace_seconds
    removed, freed = 0, 0
    for root in (settings.thumbnails_dir, settings.previews_dir):
        if not root.exists():
            continue
        for dirpath, _dirs, files in os.walk(root):
            folder = Path(dirpath)
            for name in files:
                path = folder / name
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if stat.st_mtime > cutoff:
                    continue
                if folder == faces_dir:
                    keep = path.stem in face_ids
                elif folder == video_copies_dir:
                    keep = name.split("_", 1)[0] in photo_ids
                else:
                    keep = _key(path) in paths or name.lower() in names
                if keep:
                    continue
                try:
                    path.unlink()
                    removed += 1
                    freed += stat.st_size
                except OSError as err:
                    logger.warning("Couldn't remove unused file %s: %s", path, err)
        # Empty shard folders (never the roots or the faces/display folders themselves).
        for dirpath, dirs, files in os.walk(root, topdown=False):
            folder = Path(dirpath)
            if folder == root or folder.name in ("faces", "display", "videos") or files or os.listdir(folder):
                continue
            try:
                folder.rmdir()
            except OSError:
                pass
    if removed:
        logger.info("Removed %d unused thumbnail/preview files (%.1f MB).", removed, freed / 1e6)
    return removed, freed
