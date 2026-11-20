"""Trash Management API Endpoints for SecurePhotos 2.0.

Provides endpoints for listing trashed media, restoring soft-deleted media to the
active library, and permanently purging files from disk and SQLite.
"""

import datetime
import logging
from typing import List, Optional
from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from engine.database import get_db_connection
from engine.services.face_recognition_service import get_face_thumbnails_dir

logger = logging.getLogger("securephotos.api.trash")

router = APIRouter(prefix="/api/trash", tags=["Trash"])

# Items stay in the trash this long, then are permanently deleted (owner decision).
TRASH_RETENTION_DAYS = 30


class TrashedPhotoItem(BaseModel):
    """Represents a soft-deleted photo currently in the trash."""
    id: int
    filename: str
    filepath: str
    file_size: int
    formatted_size: str
    trashed_at: str
    days_remaining: int
    # Vault items in the trash keep their privacy: no name, no path (redesign R7a).
    is_vault_item: bool = False
    mime_type: Optional[str] = None


class RestorePhotosRequest(BaseModel):
    """Payload to restore photos from trash back into active library."""
    photo_ids: List[int] = Field(..., description="List of photo IDs to restore")


class PermanentDeleteRequest(BaseModel):
    """Payload to permanently delete specific photos from disk and database."""
    photo_ids: List[int] = Field(..., description="List of photo IDs to permanently purge")


def _format_file_size(size_bytes: int) -> str:
    """Formats bytes into human-readable MB / KB string."""
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    elif size_bytes >= 1024:
        return f"{size_bytes / 1024:.0f} KB"
    return f"{size_bytes} B"


@router.get("", response_model=List[TrashedPhotoItem], status_code=status.HTTP_200_OK)
async def list_trashed_photos() -> List[TrashedPhotoItem]:
    """Retrieves all soft-deleted photos currently in trash ordered by deletion timestamp."""
    conn = await get_db_connection()
    try:
        query = """
            SELECT id, filename, filepath, file_size, trashed_at, is_encrypted, mime_type
            FROM photos
            WHERE trashed_at IS NOT NULL
            ORDER BY trashed_at DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()

        now = datetime.datetime.now(datetime.timezone.utc)
        items: List[TrashedPhotoItem] = []

        for r in rows:
            trashed_raw = r["trashed_at"]
            days_left = TRASH_RETENTION_DAYS
            if trashed_raw:
                try:
                    # SQLite CURRENT_TIMESTAMP is in format "YYYY-MM-DD HH:MM:SS" (UTC)
                    dt = datetime.datetime.fromisoformat(trashed_raw.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=datetime.timezone.utc)
                    elapsed = (now - dt).days
                    days_left = max(0, TRASH_RETENTION_DAYS - elapsed)
                except Exception:
                    days_left = TRASH_RETENTION_DAYS

            is_vault_item = bool(r["is_encrypted"])
            items.append(
                TrashedPhotoItem(
                    id=r["id"],
                    filename="Private Vault item" if is_vault_item else r["filename"],
                    filepath="" if is_vault_item else r["filepath"],
                    is_vault_item=is_vault_item,
                    mime_type=None if is_vault_item else r["mime_type"],
                    file_size=r["file_size"],
                    formatted_size=_format_file_size(r["file_size"]),
                    trashed_at=trashed_raw or "",
                    days_remaining=days_left,
                )
            )

        return items
    finally:
        await conn.close()


@router.post("/restore", status_code=status.HTTP_200_OK)
async def restore_photos(payload: RestorePhotosRequest) -> dict:
    """Restores soft-deleted photos by setting trashed_at to NULL."""
    if not payload.photo_ids:
        return {"status": "ok", "restored_count": 0}

    conn = await get_db_connection()
    try:
        # A group deleted together (original + improved copies) comes back together.
        from engine.services.photo_versions import restore_with_versions

        restored_count = await restore_with_versions(conn, payload.photo_ids)
        await conn.commit()
        return {"status": "ok", "restored_count": restored_count}
    finally:
        await conn.close()


def _sweep_unused_files_soon() -> None:
    """After deleting for good, also remove thumbnails/previews nothing uses (owner, 2026-11-19)."""
    import asyncio
    import os

    if os.environ.get("PYTEST_CURRENT_TEST"):
        return  # Tests call the sweep themselves.
    from engine.services.storage_cleanup import sweep_unused_files

    asyncio.get_running_loop().create_task(sweep_unused_files())


async def purge_photos(conn, photo_ids: List[int]) -> int:
    """Permanently deletes photos: database rows first, then their files.

    Order matters for crash safety: once the rows are committed the photos are
    gone from the app; if the process dies before the files are removed, only
    orphaned files remain (wasted space), never entries pointing at missing files.
    Files are located with the safe lookup (relative to the data folder; never
    "any file with the same name"), so the right files are deleted (backlog M7).

    Args:
        conn: Open connection with no uncommitted changes.
        photo_ids: Photos to delete permanently.

    Returns:
        Number of photo rows deleted.
    """
    from engine.services.media_paths import resolve_stored_path

    if not photo_ids:
        return 0
    placeholders = ",".join("?" for _ in photo_ids)
    async with conn.execute(
        f"SELECT filepath, thumbnail_path, preview_path FROM photos WHERE id IN ({placeholders});", photo_ids
    ) as cur:
        rows = await cur.fetchall()
    async with conn.execute(f"SELECT id FROM faces WHERE photo_id IN ({placeholders});", photo_ids) as cur:
        face_ids = [r["id"] for r in await cur.fetchall()]

    files = []
    for r in rows:
        for key in ("filepath", "thumbnail_path", "preview_path"):
            found = resolve_stored_path(r[key])
            if found is not None:
                files.append(found)
    faces_dir = get_face_thumbnails_dir()
    files += [faces_dir / f"{face_id}.webp" for face_id in face_ids]

    await conn.execute(f"DELETE FROM video_processing_queue WHERE photo_id IN ({placeholders});", photo_ids)
    await conn.execute(f"DELETE FROM photo_album WHERE photo_id IN ({placeholders});", photo_ids)
    cursor = await conn.execute(f"DELETE FROM photos WHERE id IN ({placeholders});", photo_ids)
    deleted = cursor.rowcount
    # People and stories left without any face are removed (existing behaviour).
    await conn.execute("DELETE FROM persons WHERE id NOT IN (SELECT DISTINCT person_id FROM faces WHERE person_id IS NOT NULL);")
    await conn.execute("DELETE FROM stories WHERE person_id IS NOT NULL AND person_id NOT IN (SELECT id FROM persons);")
    await conn.commit()

    for path in files:
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            logger.warning("Could not delete %s: %s", path, e)
    return deleted


async def purge_expired_trash(retention_days: int = TRASH_RETENTION_DAYS) -> int:
    """Permanently deletes items that have been in the trash longer than ``retention_days``."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            "SELECT id FROM photos WHERE trashed_at IS NOT NULL AND trashed_at <= datetime('now', ?);",
            (f"-{int(retention_days)} days",),
        ) as cur:
            ids = [r["id"] for r in await cur.fetchall()]
        deleted = await purge_photos(conn, ids)
    finally:
        await conn.close()
    if deleted:
        logger.info("Trash: permanently deleted %d item(s) older than %d days.", deleted, retention_days)
    return deleted


TRASH_PURGE_INTERVAL_SECONDS = 6 * 3600


async def run_trash_purge_loop() -> None:
    """Purges expired trash at engine start and every 6 hours."""
    import asyncio

    while True:
        try:
            await purge_expired_trash()
        except Exception as e:
            logger.error("Trash purge failed; will retry later: %s", e, exc_info=True)
        await asyncio.sleep(TRASH_PURGE_INTERVAL_SECONDS)


@router.post("/permanent", status_code=status.HTTP_200_OK)
@router.delete("/permanent", status_code=status.HTTP_200_OK)
async def permanently_delete_selected(payload: PermanentDeleteRequest) -> dict:
    """Permanently deletes the selected photos, but only those that are in the trash."""
    if not payload.photo_ids:
        return {"status": "ok", "deleted_count": 0}
    conn = await get_db_connection()
    try:
        placeholders = ",".join("?" for _ in payload.photo_ids)
        async with conn.execute(
            f"SELECT id FROM photos WHERE trashed_at IS NOT NULL AND id IN ({placeholders});", payload.photo_ids
        ) as cur:
            ids = [r["id"] for r in await cur.fetchall()]
        deleted = await purge_photos(conn, ids)
    finally:
        await conn.close()
    _sweep_unused_files_soon()
    return {"status": "ok", "deleted_count": deleted}


@router.delete("/empty", status_code=status.HTTP_200_OK)
async def empty_trash_permanently() -> dict:
    """Permanently deletes everything in the trash (files and database rows)."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT id FROM photos WHERE trashed_at IS NOT NULL;") as cur:
            ids = [r["id"] for r in await cur.fetchall()]
        deleted = await purge_photos(conn, ids)
    finally:
        await conn.close()
    _sweep_unused_files_soon()
    return {"status": "ok", "deleted_count": deleted}
