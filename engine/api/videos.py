"""FastAPI Router for Video Discovery, Compression, and Enhancement Operations."""

import logging
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import aiosqlite

from engine.database import get_db_connection
from engine.services.video_service import (
    analyze_video_candidate,
    compress_video,
    enhance_old_video,
    extract_video_metadata,
)
from engine.services.video_runtime import is_video_runtime_available

logger = logging.getLogger("securephotos.api.videos")

router = APIRouter(prefix="/api/videos", tags=["Videos"])


class CompressRequest(BaseModel):
    crf: Optional[int] = None
    preset: Optional[str] = None


class EnhanceRequest(BaseModel):
    target_height: Optional[int] = 720


@router.get("/summary")
async def get_video_summary() -> Dict[str, Any]:
    """Returns library-wide video statistics, telemetry, and projected storage reclamation."""
    if not is_video_runtime_available():
        return {
            "runtime_available": False,
            "total_videos": 0,
            "total_bytes": 0,
            "projected_reclaimable_bytes": 0,
            "compressible_count": 0,
            "enhanceable_count": 0,
            "optimized_count": 0,
            "error": "FFmpeg and FFprobe binaries are not found on the system.",
        }

    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        query = """
            SELECT id, filename, filepath, file_size, width, height, is_optimized, is_enhanced
            FROM photos
            WHERE mime_type LIKE 'video/%' AND trashed_at IS NULL
            ORDER BY file_size DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()
    finally:
        await conn.close()

    total_videos = len(rows)
    total_bytes = sum(r["file_size"] or 0 for r in rows)
    projected_reclaimable = 0
    compressible_count = 0
    enhanceable_count = 0
    optimized_count = 0

    for r in rows:
        plan = analyze_video_candidate(dict(r))
        status = plan.get("status")
        if status == "compressible":
            compressible_count += 1
            projected_reclaimable += plan.get("projected_savings_bytes", 0)
        elif status == "enhanceable":
            enhanceable_count += 1
        elif status == "already_optimized":
            optimized_count += 1

    return {
        "runtime_available": True,
        "total_videos": total_videos,
        "total_bytes": total_bytes,
        "projected_reclaimable_bytes": projected_reclaimable,
        "compressible_count": compressible_count,
        "enhanceable_count": enhanceable_count,
        "optimized_count": optimized_count,
    }


@router.get("/candidates")
async def list_video_candidates() -> List[Dict[str, Any]]:
    """Returns all active video media items hydrated with optimization plans and stream telemetry."""
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        query = """
            SELECT id, filename, filepath, file_size, width, height, taken_at,
                   thumbnail_path, preview_path, is_favorite, is_optimized, is_enhanced
            FROM photos
            WHERE mime_type LIKE 'video/%' AND trashed_at IS NULL
            ORDER BY file_size DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()
    finally:
        await conn.close()

    results = []
    for r in rows:
        rec = dict(r)
        plan = analyze_video_candidate(rec)
        rec["optimization_plan"] = plan
        results.append(rec)

    return results


@router.post("/{photo_id}/compress")
async def compress_video_endpoint(photo_id: int, req: Optional[CompressRequest] = None) -> Dict[str, Any]:
    """Compresses a specific high-bitrate video using visually lossless H.265/HEVC."""
    crf = req.crf if req else None
    preset = req.preset if req else None

    res = await compress_video(photo_id, crf=crf, preset=preset)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Transcoding failed."))

    return res


@router.post("/{photo_id}/enhance")
async def enhance_video_endpoint(photo_id: int, req: Optional[EnhanceRequest] = None) -> Dict[str, Any]:
    """Enhances and upscales an older, vintage, or low-resolution video."""
    target_height = req.target_height if req and req.target_height else 720

    res = await enhance_old_video(photo_id, target_height=target_height)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Enhancement failed."))

    return res


@router.post("/compress-all")
async def compress_all_videos_endpoint() -> Dict[str, Any]:
    """Batch compresses all heavy candidate videos in the library."""
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        query = """
            SELECT id, filename, filepath, file_size, width, height, is_optimized, is_enhanced
            FROM photos
            WHERE mime_type LIKE 'video/%' AND is_optimized = 0 AND trashed_at IS NULL
            ORDER BY file_size DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()
    finally:
        await conn.close()

    candidates = [dict(r) for r in rows if analyze_video_candidate(dict(r)).get("status") == "compressible"]

    processed = 0
    total_reclaimed = 0
    errors = []

    for c in candidates:
        res = await compress_video(c["id"])
        if res.get("success"):
            processed += 1
            total_reclaimed += res.get("saved_bytes", 0)
        else:
            errors.append({"id": c["id"], "error": res.get("error")})

    return {
        "candidate_count": len(candidates),
        "processed_count": processed,
        "total_reclaimed_bytes": total_reclaimed,
        "errors": errors,
    }
