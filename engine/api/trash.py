"""Trash Management API Endpoints for SecurePhotos 2.0.

Provides endpoints for listing trashed media, restoring soft-deleted media to the
active library, and permanently purging files from disk and SQLite.
"""

import datetime
import logging
from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from engine.database import get_db_connection

logger = logging.getLogger("securephotos.api.trash")

router = APIRouter(prefix="/api/trash", tags=["Trash"])


class TrashedPhotoItem(BaseModel):
    """Represents a soft-deleted photo currently in the trash."""
    id: int
    filename: str
    filepath: str
    file_size: int
    formatted_size: str
    trashed_at: str
    days_remaining: int


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
            SELECT id, filename, filepath, file_size, trashed_at
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
            days_left = 30
            if trashed_raw:
                try:
                    # SQLite CURRENT_TIMESTAMP is in format "YYYY-MM-DD HH:MM:SS" (UTC)
                    dt = datetime.datetime.fromisoformat(trashed_raw.replace("Z", "+00:00"))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=datetime.timezone.utc)
                    elapsed = (now - dt).days
                    days_left = max(0, 30 - elapsed)
                except Exception:
                    days_left = 30

            items.append(
                TrashedPhotoItem(
                    id=r["id"],
                    filename=r["filename"],
                    filepath=r["filepath"],
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
        placeholders = ",".join("?" for _ in payload.photo_ids)
        cursor = await conn.execute(
            f"UPDATE photos SET trashed_at = NULL WHERE id IN ({placeholders}) AND trashed_at IS NOT NULL;",
            payload.photo_ids,
        )
        restored_count = cursor.rowcount
        await conn.commit()
        return {"status": "ok", "restored_count": restored_count}
    finally:
        await conn.close()


def _unlink_photo_files(filepath: str, thumbnail_path: str | None, preview_path: str | None):
    """Safely removes physical media, thumbnail, and preview files from disk."""
    for path_str in (filepath, thumbnail_path, preview_path):
        if path_str:
            try:
                p = Path(path_str)
                if p.exists() and p.is_file():
                    p.unlink(missing_ok=True)
            except Exception as e:
                logger.warning("Failed to unlink %s: %s", path_str, e)


@router.post("/permanent", status_code=status.HTTP_200_OK)
@router.delete("/permanent", status_code=status.HTTP_200_OK)
async def permanently_delete_selected(payload: PermanentDeleteRequest) -> dict:
    """Permanently purges selected trashed photos from disk and SQLite."""
    if not payload.photo_ids:
        return {"status": "ok", "deleted_count": 0}

    conn = await get_db_connection()
    try:
        placeholders = ",".join("?" for _ in payload.photo_ids)
        # Fetch filepaths for disk cleanup
        query = f"SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id IN ({placeholders});"
        async with conn.execute(query, payload.photo_ids) as cursor:
            rows = await cursor.fetchall()

        for r in rows:
            _unlink_photo_files(r["filepath"], r["thumbnail_path"], r["preview_path"])

        # Delete database records (photo_album, video_processing_queue and other FKs cascade or clean up)
        await conn.execute(f"DELETE FROM video_processing_queue WHERE photo_id IN ({placeholders});", payload.photo_ids)
        await conn.execute(f"DELETE FROM photo_album WHERE photo_id IN ({placeholders});", payload.photo_ids)
        cursor = await conn.execute(f"DELETE FROM photos WHERE id IN ({placeholders});", payload.photo_ids)
        deleted_count = cursor.rowcount
        await conn.commit()
        return {"status": "ok", "deleted_count": deleted_count}
    finally:
        await conn.close()


@router.delete("/empty", status_code=status.HTTP_200_OK)
async def empty_trash_permanently() -> dict:
    """Permanently purges ALL soft-deleted photos from disk and SQLite."""
    conn = await get_db_connection()
    try:
        query = "SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE trashed_at IS NOT NULL;"
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()

        photo_ids = [r["id"] for r in rows]
        for r in rows:
            _unlink_photo_files(r["filepath"], r["thumbnail_path"], r["preview_path"])

        if photo_ids:
            placeholders = ",".join("?" for _ in photo_ids)
            await conn.execute(f"DELETE FROM video_processing_queue WHERE photo_id IN ({placeholders});", photo_ids)
            await conn.execute(f"DELETE FROM photo_album WHERE photo_id IN ({placeholders});", photo_ids)
            cursor = await conn.execute("DELETE FROM photos WHERE trashed_at IS NOT NULL;")
            deleted_count = cursor.rowcount
            await conn.commit()
        else:
            deleted_count = 0

        return {"status": "ok", "deleted_count": deleted_count}
    finally:
        await conn.close()
