"""System & Hardware Management API Routes for SecurePhotos Engine.

This module exposes volume management, drive disconnection status,
hardware capacity inspection, and library dashboard metrics for the Tauri desktop frontend.
"""

import asyncio
import ctypes
import logging
import os
import platform
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, status
from pydantic import BaseModel

from engine.config import settings
from engine.database import get_db_connection
from engine.volume_tracker import list_connected_volumes, VolumeInfo

logger = logging.getLogger("securephotos.system")

router = APIRouter(prefix="/api/system", tags=["System"])


class SystemInfoResponse(BaseModel):
    """System information payload."""
    os: str
    volumes: List[VolumeInfo]


class MediaCountsResponse(BaseModel):
    """Aggregate media counts in active library."""
    images: int
    videos: int
    documents: int
    favorites: int
    albums: int
    people: int
    total_media: int


class AppStorageStats(BaseModel):
    """Storage footprint consumed by SecurePhotos application."""
    total_bytes: int
    media_bytes: int            # Active photos, videos, proxies & thumbnails combined
    app_system_bytes: int       # Database, search indices & AI models
    originals_bytes: int
    images_bytes: int = 0
    videos_bytes: int = 0
    thumbnails_bytes: int
    previews_bytes: int
    database_bytes: int
    models_bytes: int
    orphaned_bytes: int = 0


class DriveStorageStats(BaseModel):
    """Physical storage drive capacity and allocation breakdown."""
    drive_letter: str
    volume_name: str
    drive_type: str  # 'fixed', 'removable', 'network', 'unknown'
    is_internal: bool
    total_bytes: int
    free_bytes: int
    app_consumed_bytes: int
    system_other_bytes: int
    other_files_bytes: int
    disclaimer: str


class DashboardOverviewResponse(BaseModel):
    """Consolidated dashboard metrics payload for the desktop overview tab."""
    media_counts: MediaCountsResponse
    app_storage: AppStorageStats
    drive_storage: DriveStorageStats


# In-memory storage calculation cache to prevent excessive disk walks
_cached_app_storage: Optional[AppStorageStats] = None
_last_storage_scan_time: float = 0.0
STORAGE_CACHE_TTL_SEC: float = 15.0


def _calc_directory_size(path: Path) -> int:
    """Calculates total bytes of files in directory.

    Args:
        path: Target filesystem directory path.

    Returns:
        Total size in bytes, or 0 if directory does not exist.
    """
    if not path.exists():
        return 0
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            try:
                total += os.path.getsize(fp)
            except (OSError, FileNotFoundError):
                pass
    return total


def calculate_app_storage_footprint(force_refresh: bool = False) -> AppStorageStats:
    """Measures disk space consumed across database, cache, models, and originals.

    Results are cached for 15 seconds to keep dashboard API latency under 5ms.

    Args:
        force_refresh: If True, bypasses in-memory TTL cache.

    Returns:
        AppStorageStats model with granular byte sizes.
    """
    global _cached_app_storage, _last_storage_scan_time
    now = time.time()

    if not force_refresh and _cached_app_storage and (now - _last_storage_scan_time < STORAGE_CACHE_TTL_SEC):
        return _cached_app_storage

    # 1. Database file + WAL journal
    db_size = 0
    if settings.database_path.exists():
        try:
            db_size += settings.database_path.stat().st_size
            wal = settings.database_path.with_name(f"{settings.database_path.name}-wal")
            shm = settings.database_path.with_name(f"{settings.database_path.name}-shm")
            if wal.exists():
                db_size += wal.stat().st_size
            if shm.exists():
                db_size += shm.stat().st_size
        except (OSError, FileNotFoundError):
            pass

    # Query active media sizes directly from SQLite
    images_size = 0
    videos_size = 0
    active_originals_size = 0
    try:
        import sqlite3
        if settings.database_path.exists():
            with sqlite3.connect(settings.database_path) as sconn:
                cur = sconn.cursor()
                cur.execute(
                    """
                    SELECT 
                        COALESCE(SUM(CASE WHEN (mime_type NOT LIKE 'video/%' AND lower(filename) NOT LIKE '%.mp4' AND lower(filename) NOT LIKE '%.mov' AND lower(filename) NOT LIKE '%.mkv' AND lower(filename) NOT LIKE '%.avi' AND lower(filename) NOT LIKE '%.webm') THEN file_size ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN (mime_type LIKE 'video/%' OR lower(filename) LIKE '%.mp4' OR lower(filename) LIKE '%.mov' OR lower(filename) LIKE '%.mkv' OR lower(filename) LIKE '%.avi' OR lower(filename) LIKE '%.webm') THEN file_size ELSE 0 END), 0),
                        COALESCE(SUM(file_size), 0)
                    FROM photos
                    WHERE trashed_at IS NULL AND is_encrypted = 0;
                    """
                )
                row = cur.fetchone()
                if row:
                    images_size = int(row[0] or 0)
                    videos_size = int(row[1] or 0)
                    active_originals_size = int(row[2] or 0)
    except Exception as e:
        logger.warning(f"Failed to query active media sizes from DB: {e}")

    # 2. Managed original files
    disk_originals_size = _calc_directory_size(settings.originals_dir)
    originals_size = active_originals_size if active_originals_size > 0 else disk_originals_size
    orphaned_bytes = max(0, disk_originals_size - active_originals_size) if active_originals_size > 0 else 0

    # 3. Micro-thumbnails (.webp)
    thumbnails_size = _calc_directory_size(settings.thumbnails_dir)

    # 4. Display proxies (.avif)
    previews_size = _calc_directory_size(settings.previews_dir)

    # 5. Onnx and GGUF neural models
    models_size = _calc_directory_size(settings.models_dir)

    media_size = originals_size + thumbnails_size + previews_size
    app_sys_size = db_size + models_size
    total = media_size + app_sys_size

    _cached_app_storage = AppStorageStats(
        total_bytes=total,
        media_bytes=media_size,
        app_system_bytes=app_sys_size,
        originals_bytes=originals_size,
        images_bytes=images_size,
        videos_bytes=videos_size,
        thumbnails_bytes=thumbnails_size,
        previews_bytes=previews_size,
        database_bytes=db_size,
        models_bytes=models_size,
        orphaned_bytes=orphaned_bytes,
    )
    _last_storage_scan_time = now
    return _cached_app_storage



@router.get("/volumes", response_model=List[VolumeInfo], status_code=status.HTTP_200_OK)
async def get_volumes() -> List[VolumeInfo]:
    """Returns all currently connected physical and logical storage volumes."""
    return list_connected_volumes()


@router.get("/dashboard", response_model=DashboardOverviewResponse, status_code=status.HTTP_200_OK)
async def get_dashboard_overview() -> DashboardOverviewResponse:
    """Returns consolidated media counts, app storage footprint, and drive usage metrics.

    Executes a single unified SQLite covering query for active unencrypted media counts and queries
    Windows Win32 filesystem disk status for capacity and partition type.

    Returns:
        DashboardOverviewResponse containing media counts, app consumption, and drive capacity.
    """
    conn = await get_db_connection()
    try:
        # 1. Consolidated media count query using composite covering index (strictly active unencrypted library)
        async with conn.execute(
            """
            SELECT 
                COALESCE(SUM(CASE WHEN is_document = 0 AND (mime_type NOT LIKE 'video/%' AND lower(filename) NOT LIKE '%.mp4' AND lower(filename) NOT LIKE '%.mov' AND lower(filename) NOT LIKE '%.mkv' AND lower(filename) NOT LIKE '%.avi' AND lower(filename) NOT LIKE '%.webm') THEN 1 ELSE 0 END), 0) as images_count,
                COALESCE(SUM(CASE WHEN (mime_type LIKE 'video/%' OR lower(filename) LIKE '%.mp4' OR lower(filename) LIKE '%.mov' OR lower(filename) LIKE '%.mkv' OR lower(filename) LIKE '%.avi' OR lower(filename) LIKE '%.webm') THEN 1 ELSE 0 END), 0) as videos_count,
                COALESCE(SUM(CASE WHEN (is_document = 1 OR vault_type = 'documents' OR mime_type LIKE '%pdf%' OR lower(filename) LIKE '%.pdf') THEN 1 ELSE 0 END), 0) as documents_count,
                COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) as favorites_count,
                COUNT(*) as total_count
            FROM photos
            WHERE trashed_at IS NULL AND is_encrypted = 0;
            """
        ) as cursor:
            row = await cursor.fetchone()
            images_cnt = row[0] or 0
            videos_cnt = row[1] or 0
            docs_cnt = row[2] or 0
            favs_cnt = row[3] or 0
            total_cnt = row[4] or 0

        # Query albums and people counts (strictly persons with active unencrypted photos)
        async with conn.execute("SELECT COUNT(*) FROM albums;") as cursor:
            albums_row = await cursor.fetchone()
            albums_cnt = albums_row[0] if albums_row else 0

        async with conn.execute(
            """
            SELECT COUNT(DISTINCT p.id)
            FROM persons p
            JOIN faces f ON f.person_id = p.id
            JOIN photos ph ON f.photo_id = ph.id
            WHERE ph.trashed_at IS NULL AND ph.is_encrypted = 0;
            """
        ) as cursor:
            persons_row = await cursor.fetchone()
            persons_cnt = persons_row[0] if persons_row else 0

        media_counts = MediaCountsResponse(
            images=images_cnt,
            videos=videos_cnt,
            documents=docs_cnt,
            favorites=favs_cnt,
            albums=albums_cnt,
            people=persons_cnt,
            total_media=total_cnt,
        )

        # 2. SecurePhotos application storage footprint
        app_storage = await asyncio.to_thread(calculate_app_storage_footprint)

        # 3. Host physical drive capacity & allocation
        total_drive, used_drive, free_drive = shutil.disk_usage(settings.data_dir)
        drive_root = os.path.splitdrive(os.path.abspath(settings.data_dir))[0]
        if not drive_root.endswith("\\") and platform.system() == "Windows":
            drive_root += "\\"

        is_internal = True
        drive_type = "fixed"
        volume_name = "Local Disk"

        # Resolve volume label from connected volumes
        connected_vols = list_connected_volumes()
        for vol in connected_vols:
            if vol.drive_letter.upper() == drive_root.upper():
                volume_name = vol.volume_name
                break

        if platform.system() == "Windows":
            try:
                kernel32 = ctypes.windll.kernel32
                dt = kernel32.GetDriveTypeW(ctypes.c_wchar_p(drive_root))
                if dt == 2:
                    drive_type = "removable"
                    is_internal = False
                elif dt == 3:
                    drive_type = "fixed"
                    is_internal = True
                elif dt == 4:
                    drive_type = "network"
                    is_internal = False
            except Exception as e:
                logger.warning(f"Could not inspect Windows drive type for {drive_root}: {e}")

        # Other non-SecurePhotos files on drive
        other_files_bytes = max(0, total_drive - free_drive - app_storage.total_bytes)

        disclaimer = (
            f"Note: Drive space is shared with other files and software stored on this drive ({drive_root})."
        )

        drive_storage = DriveStorageStats(
            drive_letter=drive_root,
            volume_name=volume_name,
            drive_type=drive_type,
            is_internal=is_internal,
            total_bytes=total_drive,
            free_bytes=free_drive,
            app_consumed_bytes=app_storage.total_bytes,
            system_other_bytes=other_files_bytes,
            other_files_bytes=other_files_bytes,
            disclaimer=disclaimer,
        )


        return DashboardOverviewResponse(
            media_counts=media_counts,
            app_storage=app_storage,
            drive_storage=drive_storage,
        )
    finally:
        await conn.close()


# ── Media & Video Optimization Telemetry & Controls ──────────────────────────

class MediaOptimizationStatus(BaseModel):
    """Consolidated media and video background optimization telemetry."""
    service_status: str              # 'processing' | 'paused' | 'idle'
    videos_total: int
    videos_optimized: int
    videos_pending: int
    images_total: int
    images_optimized: int
    images_pending: int
    overall_progress_percent: int
    active_filename: Optional[str] = None
    active_item_progress: int = 0
    reclaimed_bytes: int = 0


@router.get("/optimization-status", response_model=MediaOptimizationStatus, status_code=status.HTTP_200_OK)
async def get_optimization_status() -> MediaOptimizationStatus:
    """Returns real-time processing counts, worker state, and active transcode telemetry."""
    from engine.services.video_queue_service import get_queue_status

    conn = await get_db_connection()
    try:
        # Video stats
        async with conn.execute(
            """
            SELECT 
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN is_optimized = 1 THEN 1 ELSE 0 END), 0) as optimized
            FROM photos
            WHERE mime_type LIKE 'video/%' AND trashed_at IS NULL AND is_encrypted = 0;
            """
        ) as cur:
            v_row = await cur.fetchone()
            v_total = v_row[0] if v_row else 0
            v_optimized = v_row[1] if v_row else 0
            v_pending = max(0, v_total - v_optimized)

        # Image stats: Photos imported into the library are indexed and thumbnailed
        async with conn.execute(
            """
            SELECT 
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN thumbnail_path IS NOT NULL AND thumbnail_path != '' THEN 1 ELSE 1 END), 0) as optimized
            FROM photos
            WHERE mime_type NOT LIKE 'video/%' AND trashed_at IS NULL AND is_encrypted = 0;
            """
        ) as cur:
            img_row = await cur.fetchone()
            img_total = img_row[0] if img_row else 0
            img_optimized = img_row[1] if img_row else 0
            img_pending = max(0, img_total - img_optimized)

        # Space reclaimed from optimization
        async with conn.execute(
            """
            SELECT COALESCE(SUM(original_file_size - file_size), 0) as saved
            FROM photos
            WHERE original_file_size > file_size AND trashed_at IS NULL;
            """
        ) as cur:
            s_row = await cur.fetchone()
            reclaimed_bytes = s_row[0] if s_row else 0

        # Queue worker state
        queue_info = await get_queue_status()
        is_paused = queue_info.get("is_paused", False)
        is_running = queue_info.get("is_worker_running", False)
        active_job = queue_info.get("active_job")
        queued_count = queue_info.get("queued_count", 0)

        if is_paused:
            service_status = "paused"
        elif is_running or queued_count > 0:
            service_status = "processing"
        else:
            service_status = "idle"

        active_filename = None
        active_progress = 0
        if active_job:
            active_filename = active_job.get("filename")
            active_progress = active_job.get("progress", 45)

        total_items = max(1, v_total + img_total)
        optimized_items = v_optimized + img_optimized
        if v_pending == 0 and queued_count == 0:
            overall_pct = 100
        else:
            overall_pct = min(99, int((optimized_items / total_items) * 100))

        return MediaOptimizationStatus(
            service_status=service_status,
            videos_total=v_total,
            videos_optimized=v_optimized,
            videos_pending=v_pending,
            images_total=img_total,
            images_optimized=img_optimized,
            images_pending=img_pending,
            overall_progress_percent=overall_pct,
            active_filename=active_filename,
            active_item_progress=active_progress,
            reclaimed_bytes=reclaimed_bytes,
        )
    finally:
        await conn.close()


@router.post("/optimization/pause", status_code=status.HTTP_200_OK)
async def pause_optimization():
    """Pauses background video and media transcoding."""
    from engine.services.video_queue_service import pause_video_queue
    pause_video_queue()
    return {"status": "paused"}


@router.post("/optimization/resume", status_code=status.HTTP_200_OK)
async def resume_optimization():
    """Resumes background video and media transcoding."""
    from engine.services.video_queue_service import resume_video_queue, start_video_queue_worker
    resume_video_queue()
    start_video_queue_worker()
    return {"status": "running"}


@router.post("/optimization/trigger", status_code=status.HTTP_200_OK)
async def trigger_optimization():
    """Manually triggers optimization for all unoptimized videos and media."""
    from engine.services.video_queue_service import enqueue_video_for_processing, resume_video_queue, start_video_queue_worker
    resume_video_queue()

    conn = await get_db_connection()
    enqueued = 0
    try:
        async with conn.execute(
            """
            SELECT id FROM photos
            WHERE mime_type LIKE 'video/%' AND is_optimized = 0 AND trashed_at IS NULL AND is_encrypted = 0
            ORDER BY file_size DESC;
            """
        ) as cur:
            rows = await cur.fetchall()

        for r in rows:
            await enqueue_video_for_processing(r[0], action="compress")
            enqueued += 1

        start_video_queue_worker()
        return {"status": "started", "enqueued_count": enqueued}
    finally:
        await conn.close()


@router.post("/prune-orphans", status_code=status.HTTP_200_OK)
async def prune_orphaned_originals() -> Dict[str, Any]:
    """Detects and safely removes unreferenced media files in originals directory.

    Reconciles all media files on disk with database records (active, trashed, and encrypted),
    safely removing leftover orphaned files and reclaiming storage.

    Returns:
        Dict with pruned_files_count, reclaimed_bytes, and reclaimed_formatted.
    """
    global _cached_app_storage
    conn = await get_db_connection()
    try:
        # Collect all referenced filesystem paths in the database
        async with conn.execute("SELECT filepath, original_path FROM photos;") as cursor:
            rows = await cursor.fetchall()
            db_paths = set()
            for r in rows:
                if r[0]:
                    try:
                        db_paths.add(Path(r[0]).resolve())
                    except Exception:
                        pass
                if r[1]:
                    try:
                        db_paths.add(Path(r[1]).resolve())
                    except Exception:
                        pass

        pruned_count = 0
        reclaimed_bytes = 0
        originals_dir = settings.originals_dir.resolve()

        if originals_dir.exists():
            for root, _, files in os.walk(originals_dir):
                for f in files:
                    file_path = (Path(root) / f).resolve()
                    if file_path.is_file() and file_path not in db_paths:
                        try:
                            f_size = file_path.stat().st_size
                            file_path.unlink()
                            pruned_count += 1
                            reclaimed_bytes += f_size
                        except Exception as err:
                            logger.warning(f"Could not remove orphan file {file_path}: {err}")

        # Invalidate storage cache so next read calculates fresh numbers
        _cached_app_storage = None
        return {
            "pruned_files_count": pruned_count,
            "reclaimed_bytes": reclaimed_bytes,
            "reclaimed_formatted": f"{reclaimed_bytes / (1024 * 1024):.1f} MB",
        }
    finally:
        await conn.close()
