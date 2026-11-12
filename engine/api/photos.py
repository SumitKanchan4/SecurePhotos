import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.config import settings, resolve_media_path
from engine.services.ingestion_service import ingest_single_photo

logger = logging.getLogger("securephotos.api.photos")

router = APIRouter(prefix="/api/photos", tags=["Photos"])


class PhotoResponse(BaseModel):
    """Media item response payload."""
    id: int
    filename: str = ""
    filepath: str
    file_size: int
    original_file_size: Optional[int] = None
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
    source_directory: Optional[str] = None
    file_paths: Optional[List[str]] = None
    # Only copying into the library is supported (M4); anything else is rejected with 422.
    mode: Literal["managed"] = "managed"
    delete_source: bool = False
    album_id: Optional[int] = None


class ImportResponse(BaseModel):
    """Summary of batch ingestion."""
    total_found: int
    imported: int
    skipped: int
    failed: int = 0
    imported_photo_ids: List[int] = []
    album_linked_count: int = 0


class OptimizationProgressResponse(BaseModel):
    """Payload reflecting real-time 8K optimization progress."""
    is_active: bool
    active_photo_id: Optional[int] = None
    active_filename: Optional[str] = None
    item_progress: int = 0
    completed_count: int = 0
    total_count: int = 0
    last_completed_photo_id: Optional[int] = None
    paused_reason: Optional[str] = None  # "on_battery" while waiting for the charger


class BatchTrashRequest(BaseModel):
    """Payload to soft-delete multiple photos to trash."""
    photo_ids: List[int]


class BatchTrashResponse(BaseModel):
    """Summary of batch trash operation."""
    status: str
    trashed_count: int


class TimelineYearItem(BaseModel):
    """Represents a specific calendar year and its media item count."""
    year: str
    count: int


class TimelineYearsResponse(BaseModel):
    """Summary of active timeline years with photo counts."""
    total_count: int
    years: List[TimelineYearItem]



# Global in-memory progress tracker
optimization_state = {
    "is_active": False,
    "active_photo_id": None,
    "active_filename": None,
    "item_progress": 0,
    "completed_count": 0,
    "total_count": 0,
    "last_completed_photo_id": None,
    "paused_reason": None,  # "on_battery" while waiting for the charger
}

_optimization_lock = asyncio.Lock()

BATTERY_RECHECK_SECONDS = 30


def _running_on_battery() -> bool:
    """True if the PC reports it is running on battery (desktops without a battery: False)."""
    try:
        import psutil

        battery = psutil.sensors_battery()
    except Exception:
        return False
    return bool(battery) and not battery.power_plugged


async def _load_enhancement_settings() -> Dict[str, Any]:
    """Reads the enhancement-related user settings (quality slider, battery guard)."""
    from engine.api.system import get_app_settings

    return (await get_app_settings())["settings"]


async def _wait_while_on_battery() -> None:
    """Waits while the battery guard is on and the PC runs on battery.

    Settings are re-read on every check, so turning the guard off resumes at once.
    """
    while True:
        app_settings = await _load_enhancement_settings()
        if not (app_settings.get("pause_on_battery", True) and _running_on_battery()):
            break
        if optimization_state["paused_reason"] != "on_battery":
            logger.info("Photo enhancement paused: running on battery.")
        optimization_state["paused_reason"] = "on_battery"
        await asyncio.sleep(BATTERY_RECHECK_SECONDS)
    if optimization_state["paused_reason"]:
        logger.info("Photo enhancement resumed.")
    optimization_state["paused_reason"] = None


async def _mark_optimized_without_change(photo_id: int) -> None:
    """Marks a photo that cannot be enhanced so it isn't retried forever."""
    conn = await get_db_connection()
    try:
        await conn.execute("UPDATE photos SET is_optimized = 1 WHERE id = ?;", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()


async def run_background_optimization():
    """Enhances every not-yet-enhanced photo, one at a time, replacing it with an AVIF.

    Per photo: enhance to a new AVIF (in a worker thread, so the app stays
    responsive), commit the row pointing at it, then delete the old file. A
    crash before the commit leaves the original untouched; a crash after it
    leaves at most an orphaned old file, never a lost photo.

    Photos whose file can't be found (e.g. drive asleep or unplugged) are
    skipped without being marked, so they're retried on the next run.
    """
    global optimization_state
    if optimization_state["is_active"]:
        return

    from engine.services import enhancement_service
    from engine.services.media_paths import resolve_stored_path, to_db_path
    from engine.services.thumbnail_service import calculate_file_hash

    async with _optimization_lock:
        optimization_state["is_active"] = True
        optimization_state["last_completed_photo_id"] = None
        try:
            conn = await get_db_connection()
            try:
                async with conn.execute(
                    """
                    SELECT id, filename, filepath, preview_path
                    FROM photos
                    WHERE (mime_type IS NULL OR mime_type NOT LIKE 'video/%')
                      AND is_optimized = 0
                      AND trashed_at IS NULL
                      AND is_encrypted = 0
                    ORDER BY id ASC;
                    """
                ) as cursor:
                    unoptimized = await cursor.fetchall()
            finally:
                await conn.close()

            optimization_state["total_count"] = len(unoptimized)
            optimization_state["completed_count"] = 0

            for idx, row in enumerate(unoptimized):
                photo_id = row["id"]
                filename = row["filename"]

                await _wait_while_on_battery()

                optimization_state["active_photo_id"] = photo_id
                optimization_state["active_filename"] = filename
                optimization_state["item_progress"] = 10

                source = resolve_stored_path(row["filepath"])
                if source is None:
                    logger.warning("Photo %s not found on disk; will retry on the next run: %s", photo_id, row["filepath"])
                    continue

                try:
                    app_settings = await _load_enhancement_settings()
                    quality = enhancement_service.slider_to_avif_quality(
                        app_settings.get("quality_crf", enhancement_service.DEFAULT_QUALITY_SLIDER)
                    )
                    optimization_state["item_progress"] = 30
                    result = await asyncio.to_thread(
                        enhancement_service.enhance_to_avif,
                        source,
                        quality,
                    )
                    optimization_state["item_progress"] = 80
                    new_hash = await asyncio.to_thread(calculate_file_hash, result.path)

                    conn = await get_db_connection()
                    try:
                        await conn.execute(
                            """
                            UPDATE photos
                            SET filepath = ?, filename = ?, mime_type = ?,
                                original_file_size = COALESCE(original_file_size, file_size),
                                original_file_hash = COALESCE(original_file_hash, file_hash),
                                file_hash = ?, file_size = ?, width = ?, height = ?,
                                is_optimized = 1, is_enhanced = 1, preview_path = NULL
                            WHERE id = ?;
                            """,
                            (
                                to_db_path(result.path),
                                result.path.name,
                                result.mime_type,
                                new_hash,
                                result.size,
                                result.width,
                                result.height,
                                photo_id,
                            ),
                        )
                        await conn.commit()
                    finally:
                        await conn.close()

                    # The row now points at the AVIF: the old files are no longer needed.
                    if result.path.resolve() != source.resolve():
                        source.unlink(missing_ok=True)
                    old_preview = resolve_stored_path(row["preview_path"])
                    if old_preview is not None and old_preview.resolve() != result.path.resolve():
                        old_preview.unlink(missing_ok=True)

                except Exception as err:
                    logger.warning("Could not enhance photo %s (%s): %s", photo_id, filename, err)
                    # Mark it so an unreadable file isn't retried on every run.
                    await _mark_optimized_without_change(photo_id)

                optimization_state["item_progress"] = 100
                optimization_state["completed_count"] = idx + 1
                optimization_state["last_completed_photo_id"] = photo_id
                await asyncio.sleep(0)

        finally:
            optimization_state["is_active"] = False
            optimization_state["active_photo_id"] = None
            optimization_state["active_filename"] = None
            optimization_state["item_progress"] = 0
            optimization_state["last_completed_photo_id"] = None
            optimization_state["paused_reason"] = None


thumbnail_regen_state = {
    "is_active": False,
    "total_count": 0,
    "completed_count": 0,
    "active_photo_id": None,
    "active_filename": None,
}

_thumbnail_regen_lock = asyncio.Lock()


async def run_background_thumbnail_regeneration():
    """Iterates through photos in the library and regenerates 512px Retina thumbnails with UnsharpMask."""
    global thumbnail_regen_state
    if thumbnail_regen_state["is_active"]:
        return

    async with _thumbnail_regen_lock:
        thumbnail_regen_state["is_active"] = True
        try:
            conn = await get_db_connection()
            try:
                async with conn.execute(
                    """
                    SELECT id, filename, filepath, file_hash, thumbnail_path, mime_type, is_encrypted 
                    FROM photos 
                    WHERE trashed_at IS NULL AND is_encrypted = 0 
                    ORDER BY id ASC;
                    """
                ) as cursor:
                    photos_list = await cursor.fetchall()
            finally:
                await conn.close()

            if not photos_list:
                thumbnail_regen_state["is_active"] = False
                return

            thumbnail_regen_state["total_count"] = len(photos_list)
            thumbnail_regen_state["completed_count"] = 0

            from engine.services.thumbnail_service import generate_micro_thumbnail, get_sharded_thumbnail_path
            from engine.services.video_service import generate_video_thumbnail

            for row in photos_list:
                photo_id = row["id"]
                filename = row["filename"]
                filepath = row["filepath"]
                file_hash = row["file_hash"]
                mime_type = row["mime_type"] or ""
                is_encrypted = bool(row["is_encrypted"])

                thumbnail_regen_state["active_photo_id"] = photo_id
                thumbnail_regen_state["active_filename"] = filename

                # Zero-trust safety defense: strictly skip encrypted vault media
                if is_encrypted:
                    thumbnail_regen_state["completed_count"] += 1
                    continue

                try:
                    # Stored paths are relative to the data folder, not the working directory.
                    from engine.services.media_paths import resolve_stored_path, to_db_path
                    target_file = resolve_stored_path(filepath) or Path(filepath)
                    if target_file.exists() and target_file.suffix.lower() != ".enc":
                        is_video = bool(
                            mime_type.startswith("video/")
                            or target_file.suffix.lower() in [".mp4", ".mov", ".avi", ".mkv", ".webm", ".ts"]
                        )
                        if is_video:
                            raw_thumb = Path(row["thumbnail_path"]) if row["thumbnail_path"] else None
                            thumb_dest = raw_thumb if (raw_thumb and raw_thumb.is_absolute()) else (
                                (settings.data_dir / raw_thumb) if raw_thumb else get_sharded_thumbnail_path(file_hash, is_encrypted=False)
                            )
                            # Generate video thumbnail via ffmpeg/OpenCV frame extraction
                            success = await asyncio.to_thread(generate_video_thumbnail, str(target_file), str(thumb_dest))
                            thumb_path = thumb_dest if success else None
                        else:
                            thumb_path, tw, th = await asyncio.to_thread(
                                generate_micro_thumbnail,
                                target_file,
                                file_hash=file_hash,
                                size=1024,
                                force=True,
                            )

                        if thumb_path and Path(thumb_path).exists():
                            update_conn = await get_db_connection()
                            try:
                                await update_conn.execute(
                                    "UPDATE photos SET thumbnail_path = ? WHERE id = ?;",
                                    (to_db_path(Path(thumb_path)), photo_id),
                                )
                                await update_conn.commit()
                            finally:
                                await update_conn.close()
                except Exception as e:
                    logger.error("Failed to regenerate thumbnail for photo %s: %s", photo_id, e)

                thumbnail_regen_state["completed_count"] += 1
                await asyncio.sleep(0.005)

        finally:
            thumbnail_regen_state["is_active"] = False
            thumbnail_regen_state["active_photo_id"] = None
            thumbnail_regen_state["active_filename"] = None


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
        SELECT id, filename, filepath, file_size, original_file_size, mime_type, width, height,
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
                original_file_size=row["original_file_size"] if "original_file_size" in row.keys() and row["original_file_size"] is not None else row["file_size"],
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


@router.get("/timeline-years", response_model=TimelineYearsResponse, status_code=status.HTTP_200_OK)
async def get_timeline_years() -> TimelineYearsResponse:
    """Returns distinct years that actually have photos, along with photo counts."""
    conn = await get_db_connection()
    try:
        # Total count of active, non-trashed, non-encrypted photos
        async with conn.execute(
            "SELECT COUNT(*) AS total FROM photos WHERE is_encrypted = 0 AND trashed_at IS NULL;"
        ) as cursor:
            row = await cursor.fetchone()
            total_count = row["total"] if row else 0

        # Aggregated photo count grouped by year
        query = """
            SELECT 
                CASE 
                    WHEN taken_at IS NULL OR taken_at = '' THEN 'Undated'
                    ELSE strftime('%Y', taken_at)
                END AS year_label,
                COUNT(*) AS photo_count
            FROM photos
            WHERE is_encrypted = 0 AND trashed_at IS NULL
            GROUP BY year_label
            ORDER BY 
                CASE WHEN year_label = 'Undated' THEN 1 ELSE 0 END ASC,
                year_label DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()
            years = [
                TimelineYearItem(year=row["year_label"], count=row["photo_count"])
                for row in rows
                if row["year_label"]
            ]
    finally:
        await conn.close()

    return TimelineYearsResponse(total_count=total_count, years=years)


@router.get("/{photo_id}/thumbnail")
async def get_photo_thumbnail(photo_id: int):
    """Streams the 512px Retina WebP micro-thumbnail for a photo or video."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            "SELECT filepath, file_hash, thumbnail_path, mime_type, is_encrypted FROM photos WHERE id = ?;", (photo_id,)
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row or not row["thumbnail_path"]:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted thumbnail requires vault authentication")

    raw_thumb = Path(row["thumbnail_path"])
    thumb_path = raw_thumb if raw_thumb.is_absolute() else (settings.data_dir / raw_thumb)

    is_video = bool(row["mime_type"] and row["mime_type"].startswith("video/"))

    # Auto-upgrade or regenerate if missing or 0 bytes on disk
    if (not thumb_path.exists() or thumb_path.stat().st_size == 0) and row["filepath"]:
        src_path = resolve_media_path(row["filepath"])
        if src_path.exists():
            if is_video:
                from engine.services.video_service import generate_video_thumbnail
                await asyncio.to_thread(generate_video_thumbnail, str(src_path), str(thumb_path))  # H7
            else:
                from engine.services.thumbnail_service import generate_micro_thumbnail
                thumb_path, _, _ = await asyncio.to_thread(  # H7
                    generate_micro_thumbnail, src_path, file_hash=row["file_hash"], size=1024
                )

    if not thumb_path.exists() or thumb_path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="Thumbnail file missing on disk")

    return FileResponse(
        str(thumb_path),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=604800, stale-while-revalidate=86400"}
    )


@router.get("/{photo_id}/preview")
async def get_photo_preview(photo_id: int):
    """Streams the display image for Lightbox rendering.

    If an explicit preview file exists, streams it. Otherwise, serves the in-place
    optimized original photo directly with zero overhead.
    """
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT preview_path, filepath, mime_type, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

    # Seamless fallback to filepath, resolving relative preview path against data_dir
    preview_file = None
    if row["preview_path"]:
        raw_prev = Path(row["preview_path"])
        p_prev = raw_prev if raw_prev.is_absolute() else (settings.data_dir / raw_prev)
        if p_prev.exists():
            preview_file = p_prev

    if not preview_file:
        preview_file = resolve_media_path(row["filepath"])

    if not preview_file.exists():
        raise HTTPException(status_code=404, detail="Photo file missing on disk")

    suffix = preview_file.suffix.lower()
    if suffix == ".webp":
        mime = "image/webp"
    elif suffix in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif suffix == ".png":
        mime = "image/png"
    else:
        mime = row["mime_type"] or "image/jpeg"

    return FileResponse(
        str(preview_file),
        media_type=mime,
        headers={"Cache-Control": "public, max-age=86400"}
    )


@router.get("/{photo_id}/original")
async def get_photo_original(photo_id: int):
    """Streams the pristine, unenhanced original photo for Before/After comparison."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT filepath, mime_type, is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

    src_file = resolve_media_path(row["filepath"])
    if not src_file.exists():
        raise HTTPException(status_code=404, detail="Original photo file missing on disk")

    mime = row["mime_type"] or "image/jpeg"
    return FileResponse(
        str(src_file),
        media_type=mime,
        headers={"Cache-Control": "public, max-age=86400"}
    )


@router.get("/{photo_id}/download")
async def download_photo(photo_id: int, mode: str = Query("original", pattern="^(original|studio_print)$")):
    """Streams the photo file as an attachment download to the client machine.

    If mode == 'studio_print', converts the photo to a 300 DPI studio master
    with full 4:4:4 chroma subsampling (no color compression) and embedded
    JFIF/EXIF print headers for professional photo lab RIP systems.
    """
    conn = await get_db_connection()
    try:
        async with conn.execute(
            "SELECT filepath, mime_type, is_encrypted, filename FROM photos WHERE id = ?;",
            (photo_id,),
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted photo requires vault authentication")

    src_file = resolve_media_path(row["filepath"])
    if not src_file.exists():
        raise HTTPException(status_code=404, detail="Photo file missing on disk")

    if mode == "studio_print":
        import os
        import tempfile
        from PIL import Image, ImageOps
        from starlette.background import BackgroundTask

        stem = src_file.stem
        dl_filename = f"{stem}_studio_300dpi.jpg"

        temp_dir = Path(tempfile.gettempdir())
        temp_print = temp_dir / f"securephotos_studio_print_{photo_id}_{os.getpid()}.jpg"

        def _write_studio_print() -> None:  # H7: image work runs off the event loop.
            with Image.open(src_file) as img:
                exif_data = img.info.get("exif")
                img = ImageOps.exif_transpose(img)
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")

                save_kwargs = {
                    "format": "JPEG",
                    "quality": 98,
                    "subsampling": 0,  # 4:4:4 full color fidelity, eliminates chroma bleeding
                    "dpi": (300, 300),  # Explicit 300 DPI header for photo lab RIP software
                    "optimize": True,
                }
                if exif_data:
                    save_kwargs["exif"] = exif_data

                img.save(temp_print, **save_kwargs)

        await asyncio.to_thread(_write_studio_print)

        def cleanup_temp():
            try:
                if temp_print.exists():
                    temp_print.unlink()
            except OSError:
                pass

        return FileResponse(
            str(temp_print),
            media_type="image/jpeg",
            filename=dl_filename,
            headers={
                "Content-Disposition": f'attachment; filename="{dl_filename}"',
                "X-Print-DPI": "300",
            },
            background=BackgroundTask(cleanup_temp),
        )

    mime = row["mime_type"] or "image/jpeg"
    dl_filename = row["filename"] or src_file.name
    return FileResponse(
        str(src_file),
        media_type=mime,
        filename=dl_filename,
        headers={"Content-Disposition": f'attachment; filename="{dl_filename}"'},
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

    src_file = resolve_media_path(row["filepath"])
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


@router.post("/{photo_id}/toggle-favorite", status_code=status.HTTP_200_OK)
async def toggle_photo_favorite(photo_id: int) -> dict:
    """Toggles the favorite (liked) state of a photo."""
    conn = await get_db_connection()
    try:
        cursor = await conn.execute(
            "UPDATE photos SET is_favorite = NOT is_favorite WHERE id = ? RETURNING is_favorite;",
            (photo_id,),
        )
        row = await cursor.fetchone()
        await conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Photo not found")
        return {"status": "ok", "photo_id": photo_id, "is_favorite": bool(row["is_favorite"])}
    finally:
        await conn.close()


@router.delete("/{photo_id}", status_code=status.HTTP_200_OK)
async def delete_photo(photo_id: int) -> dict:
    """Soft-deletes a photo by moving it to the trash."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT id, trashed_at FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Photo not found")

        if row["trashed_at"] is not None:
            return {"status": "ok", "photo_id": photo_id, "already_trashed": True}

        await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ?;", (photo_id,))
        await conn.execute("DELETE FROM video_processing_queue WHERE photo_id = ?;", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()

    return {"status": "ok", "photo_id": photo_id}


@router.post("/batch-trash", response_model=BatchTrashResponse, status_code=status.HTTP_200_OK)
async def batch_trash_photos(payload: BatchTrashRequest) -> BatchTrashResponse:
    """Soft-deletes multiple photos to the trash atomically."""
    if not payload.photo_ids:
        return BatchTrashResponse(status="ok", trashed_count=0)

    conn = await get_db_connection()
    try:
        placeholders = ",".join("?" for _ in payload.photo_ids)
        cursor = await conn.execute(
            f"UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders}) AND trashed_at IS NULL;",
            payload.photo_ids,
        )
        trashed_count = cursor.rowcount
        await conn.execute(f"DELETE FROM video_processing_queue WHERE photo_id IN ({placeholders});", payload.photo_ids)
        await conn.commit()
    finally:
        await conn.close()

    return BatchTrashResponse(status="ok", trashed_count=trashed_count)


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
    """Triggers background 8K ULTRA optimization pass for all unoptimized photos."""
    background_tasks.add_task(run_background_optimization)
    return {"status": "started"}


@router.post("/regenerate-thumbnails", status_code=status.HTTP_202_ACCEPTED)
async def trigger_thumbnail_regeneration(background_tasks: BackgroundTasks) -> dict:
    """Triggers background regeneration of all library thumbnails to 512px Retina resolution."""
    background_tasks.add_task(run_background_thumbnail_regeneration)
    return {"status": "started"}


@router.get("/thumbnail-regeneration-progress", status_code=status.HTTP_200_OK)
async def get_thumbnail_regeneration_progress() -> dict:
    """Returns the real-time background thumbnail regeneration state."""
    return thumbnail_regen_state



# Real-time background media ingestion progress state
import_progress_state: Dict[str, Any] = {
    "is_active": False,
    "total_count": 0,
    "completed_count": 0,
    "current_filename": "",
    "album_id": None,
    "album_name": None,
    "imported": 0,
    "skipped": 0,
    "failed": 0,
}


@router.get("/import-progress")
async def get_import_progress() -> Dict[str, Any]:
    """Returns real-time background media ingestion progress and active telemetry."""
    return import_progress_state


@router.post("/import", response_model=ImportResponse, status_code=status.HTTP_201_CREATED)
async def import_folder(payload: ImportRequest, background_tasks: BackgroundTasks) -> ImportResponse:
    """Recursively ingests media files from a directory or specific file paths into the library.

    Imports run one batch at a time (H7): a second import waits for the first.
    """
    from engine.services.work_queues import imports

    async with imports():
        return await _import_batch(payload, background_tasks)


async def _import_batch(payload: ImportRequest, background_tasks: BackgroundTasks) -> ImportResponse:
    files_to_process: List[Path] = []

    # 1. Add specific file paths if provided
    if payload.file_paths:
        for fp in payload.file_paths:
            p = Path(fp)
            if p.exists() and p.is_file():
                files_to_process.append(p)
            else:
                logger.warning("Specified file path could not be located on disk: %s", fp)

    # 2. Add files from directory if provided
    if payload.source_directory:
        source_dir = Path(payload.source_directory)
        if source_dir.exists() and source_dir.is_dir():
            for file_path in source_dir.rglob("*"):
                if file_path.is_file():
                    files_to_process.append(file_path)

    if not files_to_process:
        if payload.file_paths and not payload.source_directory:
            raise HTTPException(
                status_code=400,
                detail="Selected file paths could not be located on disk. Ensure absolute filesystem paths are provided.",
            )
        raise HTTPException(status_code=400, detail="No valid media files or source directory provided")

    conn = await get_db_connection()
    total_found = len(files_to_process)
    imported = 0
    skipped = 0
    failed = 0
    imported_photo_ids: List[int] = []
    existing_photo_ids_to_link: List[int] = []

    album_name = None
    if payload.album_id:
        try:
            async with conn.execute("SELECT name FROM albums WHERE id = ?;", (payload.album_id,)) as a_cur:
                a_row = await a_cur.fetchone()
                if a_row:
                    album_name = a_row["name"]
        except Exception:
            pass

    global import_progress_state
    import_progress_state.update({
        "is_active": True,
        "total_count": total_found,
        "completed_count": 0,
        "current_filename": files_to_process[0].name if files_to_process else "",
        "album_id": payload.album_id,
        "album_name": album_name,
        "imported": 0,
        "skipped": 0,
        "failed": 0,
    })

    album_linked_count = 0
    try:
        for idx, file_path in enumerate(files_to_process):
            import_progress_state["current_filename"] = file_path.name
            try:
                res = await ingest_single_photo(
                    conn,
                    file_path,
                    mode=payload.mode,
                    delete_source=payload.delete_source,
                    return_is_new=True,
                )
                photo_id, is_new = res
                if photo_id:
                    if is_new:
                        imported += 1
                        imported_photo_ids.append(photo_id)
                        import_progress_state["imported"] = imported
                    else:
                        skipped += 1
                        import_progress_state["skipped"] = skipped
                        if payload.album_id:
                            existing_photo_ids_to_link.append(photo_id)
                else:
                    skipped += 1
                    import_progress_state["skipped"] = skipped
            except Exception as err:
                logger.error("Failed to ingest %s: %s", file_path, err, exc_info=True)
                failed += 1
                import_progress_state["failed"] = failed
            finally:
                import_progress_state["completed_count"] = idx + 1
                # Cooperative yield to allow concurrent /import-progress polling requests
                await asyncio.sleep(0)

        # If an album_id was specified, link both newly imported photos and existing library duplicates to the album
        all_album_photo_ids = list(dict.fromkeys(imported_photo_ids + existing_photo_ids_to_link))
        if payload.album_id and all_album_photo_ids:
            try:
                async with conn.execute("SELECT id, cover_photo_id FROM albums WHERE id = ?;", (payload.album_id,)) as a_cur:
                    album_row = await a_cur.fetchone()
                if album_row:
                    for pid in all_album_photo_ids:
                        cur = await conn.execute(
                            "INSERT OR IGNORE INTO photo_album (photo_id, album_id) VALUES (?, ?);",
                            (pid, payload.album_id),
                        )
                        if cur.rowcount > 0:
                            album_linked_count += 1
                    if not album_row["cover_photo_id"] and all_album_photo_ids:
                        await conn.execute(
                            "UPDATE albums SET cover_photo_id = ? WHERE id = ?;",
                            (all_album_photo_ids[0], payload.album_id),
                        )
                    await conn.commit()
            except Exception as album_err:
                logger.warning("Failed to link imported photos to album %s: %s", payload.album_id, album_err)

    finally:
        import_progress_state["is_active"] = False
        await conn.close()

    if imported > 0:
        background_tasks.add_task(run_background_optimization)

    return ImportResponse(
        total_found=total_found,
        imported=imported,
        skipped=skipped,
        failed=failed,
        imported_photo_ids=imported_photo_ids,
        album_linked_count=album_linked_count,
    )
