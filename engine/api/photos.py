import asyncio
import logging
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services.ingestion_service import ingest_single_photo

logger = logging.getLogger("securephotos.api.photos")

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
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    iso: Optional[int] = None
    aperture: Optional[float] = None
    shutter_speed: Optional[str] = None
    focal_length: Optional[float] = None
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


class OptimizationProgressResponse(BaseModel):
    """Payload reflecting real-time 8K optimization progress."""
    is_active: bool
    active_photo_id: Optional[int] = None
    active_filename: Optional[str] = None
    item_progress: int = 0
    completed_count: int = 0
    total_count: int = 0
    last_completed_photo_id: Optional[int] = None


# Global in-memory progress tracker
optimization_state = {
    "is_active": False,
    "active_photo_id": None,
    "active_filename": None,
    "item_progress": 0,
    "completed_count": 0,
    "total_count": 0,
    "last_completed_photo_id": None,
}

_optimization_lock = asyncio.Lock()


async def run_background_optimization():
    """Sequentially processes unoptimized photos to 8K ULTRA in background with progress."""
    global optimization_state
    if optimization_state["is_active"]:
        return

    async with _optimization_lock:
        optimization_state["is_active"] = True
        optimization_state["last_completed_photo_id"] = None
        try:
            conn = await get_db_connection()
            try:
                async with conn.execute(
                    "SELECT id, filename, filepath, preview_path FROM photos WHERE is_optimized = 0 AND trashed_at IS NULL ORDER BY id ASC;"
                ) as cursor:
                    unoptimized = await cursor.fetchall()
            finally:
                await conn.close()

            if not unoptimized:
                optimization_state["is_active"] = False
                return

            optimization_state["total_count"] = len(unoptimized)
            optimization_state["completed_count"] = 0

            from engine.services.super_resolution_service import upscale_and_optimize_to_8k

            for idx, row in enumerate(unoptimized):
                photo_id = row["id"]
                filename = row["filename"]
                filepath = row["filepath"]
                preview_path = row["preview_path"]

                optimization_state["active_photo_id"] = photo_id
                optimization_state["active_filename"] = filename
                optimization_state["item_progress"] = 25

                await asyncio.sleep(0.4)
                optimization_state["item_progress"] = 60

                try:
                    target_file = Path(filepath)
                    dest_file = Path(preview_path) if preview_path else None
                    if target_file.exists():
                        upscale_and_optimize_to_8k(target_file, destination_path=dest_file)
                    
                    optimization_state["item_progress"] = 90
                    
                    # Update database entry to mark optimized
                    conn = await get_db_connection()
                    try:
                        await conn.execute(
                            "UPDATE photos SET is_optimized = 1, is_enhanced = 1 WHERE id = ?;",
                            (photo_id,)
                        )
                        await conn.commit()
                    finally:
                        await conn.close()

                except Exception as err:
                    logger.warning(f"Could not optimize photo {filename}: {err}")

                optimization_state["item_progress"] = 100
                optimization_state["completed_count"] = idx + 1
                optimization_state["last_completed_photo_id"] = photo_id
                await asyncio.sleep(0.3)

        finally:
            optimization_state["is_active"] = False
            optimization_state["active_photo_id"] = None
            optimization_state["active_filename"] = None
            optimization_state["item_progress"] = 0
            optimization_state["last_completed_photo_id"] = None


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
               taken_at, camera_make, camera_model,
               latitude, longitude, iso, aperture, shutter_speed, focal_length,
               is_favorite, is_encrypted,
               is_optimized, is_enhanced, caption, thumbnail_path, preview_path
        FROM photos
        WHERE is_encrypted = ? AND trashed_at IS NULL
    """
    params = [1 if is_encrypted else 0]

    if favorite_only:
        query += " AND is_favorite = 1"

    if year == "Undated":
        query += " AND taken_at IS NULL"
    elif year and year != "All Years":
        query += " AND strftime('%Y', taken_at) = ?"
        params.append(year)

    query += " ORDER BY taken_at DESC, id DESC LIMIT ? OFFSET ?;"
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
                latitude=row["latitude"],
                longitude=row["longitude"],
                iso=row["iso"],
                aperture=row["aperture"],
                shutter_speed=row["shutter_speed"],
                focal_length=row["focal_length"],
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
    try:
        async with conn.execute("SELECT thumbnail_path, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row or not row["thumbnail_path"]:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted thumbnail requires vault authentication")

    thumb_path = Path(row["thumbnail_path"])
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail file missing on disk")

    return FileResponse(
        str(thumb_path),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400"}
    )


@router.get("/{photo_id}/preview")
async def get_photo_preview(photo_id: int):
    """Streams the 2K/4K display proxy for Lightbox rendering."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT preview_path, filepath, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

    preview_path = Path(row["preview_path"]) if row["preview_path"] else Path(row["filepath"])
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Preview file missing on disk")

    return FileResponse(
        str(preview_path),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400"}
    )


@router.post("/{photo_id}/neural-enhance", status_code=status.HTTP_200_OK)
async def trigger_neural_enhancement(photo_id: int):
    """Executes on-demand neural Real-ESRGAN texture synthesis for a photo."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT filepath, preview_path, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

    src_file = Path(row["filepath"])
    if not src_file.exists():
        raise HTTPException(status_code=404, detail="Original photo file missing")

    from engine.config import settings
    from engine.services.neural_sr_service import neural_enhance_image

    neural_dir = settings.data_dir / "previews"
    neural_dest = neural_dir / f"{photo_id}_neural.webp"

    try:
        loop = asyncio.get_running_loop()
        out_path, w, h, sz = await loop.run_in_executor(
            None,
            neural_enhance_image,
            src_file,
            neural_dest,
        )
        return {
            "status": "ok",
            "photo_id": photo_id,
            "neural_preview_url": f"/api/photos/{photo_id}/neural-preview",
            "width": w,
            "height": h,
            "size": sz,
        }
    except Exception as err:
        logger.error(f"Neural enhancement failed for photo {photo_id}: {err}")
        raise HTTPException(status_code=500, detail=f"Neural enhancement error: {str(err)}")


@router.get("/{photo_id}/neural-preview")
async def get_neural_preview(photo_id: int):
    """Streams the neural-reconstructed high-frequency texture proxy."""
    from engine.config import settings
    neural_path = settings.data_dir / "previews" / f"{photo_id}_neural.webp"
    if not neural_path.exists():
        raise HTTPException(status_code=404, detail="Neural preview not generated yet")

    return FileResponse(
        str(neural_path),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400"}
    )


@router.post("/{photo_id}/face-restore", status_code=status.HTTP_200_OK)
async def trigger_face_restore(photo_id: int):
    """Executes high-fidelity face unblur and restoration (CodeFormer + YOLOv8-Face)."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT filepath, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

    src_file = Path(row["filepath"])
    if not src_file.exists():
        raise HTTPException(status_code=404, detail="Original photo file missing")

    from engine.config import settings
    from engine.services.face_restore_service import restore_faces_in_image

    preview_dir = settings.data_dir / "previews"
    restore_dest = preview_dir / f"{photo_id}_face_restore.webp"

    try:
        loop = asyncio.get_running_loop()
        out_path, w, h, sz = await loop.run_in_executor(
            None,
            restore_faces_in_image,
            src_file,
            restore_dest,
            0.85,  # Fidelity weight strictly preserving authentic identity
        )
        return {
            "status": "ok",
            "photo_id": photo_id,
            "preview_url": f"/api/photos/{photo_id}/face-restore-preview",
            "width": w,
            "height": h,
            "size": sz,
        }
    except Exception as err:
        logger.error(f"Face restoration failed for photo {photo_id}: {err}")
        raise HTTPException(status_code=500, detail=f"Face restoration error: {str(err)}")


@router.get("/{photo_id}/face-restore-preview")
async def get_face_restore_preview(photo_id: int):
    """Streams the high-fidelity face-restored preview proxy."""
    from engine.config import settings
    preview_path = settings.data_dir / "previews" / f"{photo_id}_face_restore.webp"
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Face restore preview not generated yet")

    return FileResponse(
        str(preview_path),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400"}
    )


@router.post("/{photo_id}/favorite", status_code=status.HTTP_200_OK)
async def toggle_favorite(photo_id: int) -> dict:
    """Toggles the favorite star status of a photo."""
    conn = await get_db_connection()
    await conn.execute("UPDATE photos SET is_favorite = NOT is_favorite WHERE id = ?;", (photo_id,))
    await conn.commit()
    await conn.close()
    return {"status": "ok", "photo_id": photo_id}


@router.get("/optimization-progress", response_model=OptimizationProgressResponse, status_code=status.HTTP_200_OK)
async def get_optimization_progress() -> OptimizationProgressResponse:
    """Returns the real-time background optimization state."""
    return OptimizationProgressResponse(**optimization_state)


@router.post("/start-optimization", status_code=status.HTTP_202_ACCEPTED)
async def trigger_optimization(background_tasks: BackgroundTasks) -> dict:
    """Triggers background 4K optimization pass for all unoptimized photos."""
    background_tasks.add_task(run_background_optimization)
    return {"status": "started"}


@router.post("/import", response_model=ImportResponse, status_code=status.HTTP_201_CREATED)
async def import_folder(payload: ImportRequest, background_tasks: BackgroundTasks) -> ImportResponse:
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

    if imported > 0:
        background_tasks.add_task(run_background_optimization)

    return ImportResponse(total_found=total_found, imported=imported, skipped=skipped)
