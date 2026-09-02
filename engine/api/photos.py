"""Photos & Media API Router for SecurePhotos Engine."""

from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services.ingestion_service import ingest_single_photo

router = APIRouter(prefix="/api/photos", tags=["Photos"])


class PhotoResponse(BaseModel):
    """Media item response payload."""
    id: int
    filename: str = ""
    filepath: str
    file_size: int
    mime_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    taken_at: Optional[str] = None
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None
    is_favorite: bool
    is_encrypted: bool
    is_optimized: bool
    is_enhanced: bool
    caption: Optional[str] = None
    thumbnail_path: Optional[str] = None
    preview_path: Optional[str] = None


class ImportRequest(BaseModel):
    """Payload to trigger batch ingestion."""
    source_directory: str
    mode: str = "managed"          # "managed" (copy/move) or "scan" (in-place)
    delete_source: bool = False


class ImportResponse(BaseModel):
    """Summary of batch ingestion."""
    total_found: int
    imported: int
    skipped: int


@router.get("", response_model=List[PhotoResponse], status_code=status.HTTP_200_OK)
async def list_photos(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    year: Optional[str] = None,
    favorite_only: bool = False,
    is_encrypted: bool = False,
) -> List[PhotoResponse]:
    """Retrieves paginated photo items with optional year or favorite filtering."""
    conn = await get_db_connection()
    
    query = """
        SELECT id, filename, filepath, file_size, mime_type, width, height,
               taken_at, camera_make, camera_model, is_favorite, is_encrypted,
               is_optimized, is_enhanced, caption, thumbnail_path, preview_path
        FROM photos
        WHERE is_encrypted = ? AND trashed_at IS NULL
    """
    params = [1 if is_encrypted else 0]

    if favorite_only:
        query += " AND is_favorite = 1"

    if year and year != "All Years":
        query += " AND strftime('%Y', taken_at) = ?"
        params.append(year)

    query += " ORDER BY taken_at DESC LIMIT ? OFFSET ?;"
    params.extend([limit, offset])

    async with conn.execute(query, params) as cursor:
        rows = await cursor.fetchall()
        results = [
            PhotoResponse(
                id=row["id"],
                filename=row["filename"],
                filepath=row["filepath"],
                file_size=row["file_size"],
                mime_type=row["mime_type"],
                width=row["width"],
                height=row["height"],
                taken_at=row["taken_at"],
                camera_make=row["camera_make"],
                camera_model=row["camera_model"],
                is_favorite=bool(row["is_favorite"]),
                is_encrypted=bool(row["is_encrypted"]),
                is_optimized=bool(row["is_optimized"]),
                is_enhanced=bool(row["is_enhanced"]),
                caption=row["caption"],
                thumbnail_path=row["thumbnail_path"],
                preview_path=row["preview_path"],
            )
            for row in rows
        ]

    await conn.close()
    return results


@router.get("/{photo_id}/thumbnail")
async def get_photo_thumbnail(photo_id: int):
    """Streams the 256px WebP micro-thumbnail for a photo."""
    conn = await get_db_connection()
    async with conn.execute("SELECT thumbnail_path, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
        row = await cursor.fetchone()
        if not row or not row["thumbnail_path"]:
            await conn.close()
            raise HTTPException(status_code=404, detail="Thumbnail not found")

        if row["is_encrypted"]:
            await conn.close()
            raise HTTPException(status_code=403, detail="Encrypted thumbnail requires vault authentication")

        thumb_path = Path(row["thumbnail_path"])
        await conn.close()

        if not thumb_path.exists():
            raise HTTPException(status_code=404, detail="Thumbnail file missing on disk")

        return FileResponse(thumb_path, media_type="image/webp")


@router.get("/{photo_id}/preview")
async def get_photo_preview(photo_id: int):
    """Streams the 2K/4K display proxy for Lightbox rendering."""
    conn = await get_db_connection()
    async with conn.execute("SELECT preview_path, filepath, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
        row = await cursor.fetchone()
        if not row:
            await conn.close()
            raise HTTPException(status_code=404, detail="Photo not found")

        if row["is_encrypted"]:
            await conn.close()
            raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

        preview_path = Path(row["preview_path"]) if row["preview_path"] else Path(row["filepath"])
        await conn.close()

        if not preview_path.exists():
            raise HTTPException(status_code=404, detail="Preview file missing on disk")

        return FileResponse(preview_path, media_type="image/webp")


@router.post("/{photo_id}/favorite", status_code=status.HTTP_200_OK)
async def toggle_favorite(photo_id: int) -> dict:
    """Toggles the favorite star status of a photo."""
    conn = await get_db_connection()
    await conn.execute("UPDATE photos SET is_favorite = NOT is_favorite WHERE id = ?;", (photo_id,))
    await conn.commit()
    await conn.close()
    return {"status": "ok", "photo_id": photo_id}


@router.post("/import", response_model=ImportResponse, status_code=status.HTTP_201_CREATED)
async def import_folder(payload: ImportRequest) -> ImportResponse:
    """Recursively ingests media files from a directory into the library."""
    source_dir = Path(payload.source_directory)
    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=400, detail="Invalid source directory path")

    conn = await get_db_connection()
    total_found = 0
    imported = 0
    skipped = 0

    for file_path in source_dir.rglob("*"):
        if file_path.is_file():
            total_found += 1
            try:
                photo_id = await ingest_single_photo(
                    conn,
                    file_path,
                    mode=payload.mode,
                    delete_source=payload.delete_source,
                )
                if photo_id:
                    imported += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1

    await conn.close()
    return ImportResponse(total_found=total_found, imported=imported, skipped=skipped)
