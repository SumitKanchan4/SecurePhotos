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
from typing import List, Optional
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
    media_bytes: int            # Photos, videos, proxies & thumbnails combined
    app_system_bytes: int       # Database, search indices & AI models
    originals_bytes: int
    thumbnails_bytes: int
    previews_bytes: int
    database_bytes: int
    models_bytes: int


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

    # 2. Managed original files
    originals_size = _calc_directory_size(settings.originals_dir)

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
        thumbnails_bytes=thumbnails_size,
        previews_bytes=previews_size,
        database_bytes=db_size,
        models_bytes=models_size,
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

    Executes a single unified SQLite covering query for media counts and queries
    Windows Win32 filesystem disk status for capacity and partition type.

    Returns:
        DashboardOverviewResponse containing media counts, app consumption, and drive capacity.
    """
    conn = await get_db_connection()
    try:
        # 1. Consolidated media count query using composite covering index
        async with conn.execute(
            """
            SELECT 
                COALESCE(SUM(CASE WHEN is_document = 0 AND (mime_type NOT LIKE 'video/%' AND lower(filename) NOT LIKE '%.mp4' AND lower(filename) NOT LIKE '%.mov' AND lower(filename) NOT LIKE '%.mkv' AND lower(filename) NOT LIKE '%.avi' AND lower(filename) NOT LIKE '%.webm') THEN 1 ELSE 0 END), 0) as images_count,
                COALESCE(SUM(CASE WHEN (mime_type LIKE 'video/%' OR lower(filename) LIKE '%.mp4' OR lower(filename) LIKE '%.mov' OR lower(filename) LIKE '%.mkv' OR lower(filename) LIKE '%.avi' OR lower(filename) LIKE '%.webm') THEN 1 ELSE 0 END), 0) as videos_count,
                COALESCE(SUM(CASE WHEN (is_document = 1 OR vault_type = 'documents' OR mime_type LIKE '%pdf%' OR lower(filename) LIKE '%.pdf') THEN 1 ELSE 0 END), 0) as documents_count,
                COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0) as favorites_count,
                COUNT(*) as total_count
            FROM photos
            WHERE trashed_at IS NULL;
            """
        ) as cursor:
            row = await cursor.fetchone()
            images_cnt = row[0] or 0
            videos_cnt = row[1] or 0
            docs_cnt = row[2] or 0
            favs_cnt = row[3] or 0
            total_cnt = row[4] or 0

        # Query albums and people counts
        async with conn.execute("SELECT COUNT(*) FROM albums;") as cursor:
            albums_row = await cursor.fetchone()
            albums_cnt = albums_row[0] if albums_row else 0

        async with conn.execute("SELECT COUNT(*) FROM persons;") as cursor:
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
