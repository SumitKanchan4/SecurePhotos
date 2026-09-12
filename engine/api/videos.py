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


# Global in-memory video optimization state tracker
video_optimization_state: Dict[str, Any] = {
    "is_active": False,
    "total_count": 0,
    "completed_count": 0,
    "active_video_id": None,
    "active_filename": None,
    "item_progress": 0,
    "total_reclaimed_bytes": 0,
}


@router.get("/optimization-progress")
async def get_video_optimization_progress() -> Dict[str, Any]:
    """Returns the real-time continuous video batch optimization state."""
    return video_optimization_state


@router.post("/{photo_id}/compress")
async def compress_video_endpoint(photo_id: int, req: Optional[CompressRequest] = None) -> Dict[str, Any]:
    """Compresses a specific high-bitrate video using visually lossless H.265/HEVC."""
    global video_optimization_state
    crf = req.crf if req else None
    preset = req.preset if req else None

    video_optimization_state["is_active"] = True
    video_optimization_state["total_count"] = 1
    video_optimization_state["completed_count"] = 0
    video_optimization_state["active_video_id"] = photo_id
    video_optimization_state["item_progress"] = 35

    try:
        res = await compress_video(photo_id, crf=crf, preset=preset)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Transcoding failed."))
        video_optimization_state["completed_count"] = 1
        video_optimization_state["item_progress"] = 100
        return res
    finally:
        video_optimization_state["is_active"] = False
        video_optimization_state["active_video_id"] = None
        video_optimization_state["active_filename"] = None
        video_optimization_state["item_progress"] = 0


@router.post("/{photo_id}/enhance")
async def enhance_video_endpoint(photo_id: int, req: Optional[EnhanceRequest] = None) -> Dict[str, Any]:
    """Enhances and upscales an older, vintage, or low-resolution video."""
    global video_optimization_state
    target_height = req.target_height if req and req.target_height else 720

    video_optimization_state["is_active"] = True
    video_optimization_state["total_count"] = 1
    video_optimization_state["completed_count"] = 0
    video_optimization_state["active_video_id"] = photo_id
    video_optimization_state["item_progress"] = 35

    try:
        res = await enhance_old_video(photo_id, target_height=target_height)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Enhancement failed."))
        video_optimization_state["completed_count"] = 1
        video_optimization_state["item_progress"] = 100
        return res
    finally:
        video_optimization_state["is_active"] = False
        video_optimization_state["active_video_id"] = None
        video_optimization_state["active_filename"] = None
        video_optimization_state["item_progress"] = 0


@router.post("/compress-all")
async def compress_all_videos_endpoint() -> Dict[str, Any]:
    """Batch compresses all heavy candidate videos in the library."""
    global video_optimization_state
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

    if not candidates:
        return {
            "candidate_count": 0,
            "processed_count": 0,
            "total_reclaimed_bytes": 0,
            "errors": [],
        }

    # Pin state to active throughout the entire batch
    video_optimization_state["is_active"] = True
    video_optimization_state["total_count"] = len(candidates)
    video_optimization_state["completed_count"] = 0
    video_optimization_state["total_reclaimed_bytes"] = 0

    processed = 0
    total_reclaimed = 0
    errors = []

    try:
        for idx, c in enumerate(candidates):
            video_optimization_state["active_video_id"] = c["id"]
            video_optimization_state["active_filename"] = c["filename"]
            video_optimization_state["item_progress"] = 35

            res = await compress_video(c["id"])
            if res.get("success"):
                processed += 1
                total_reclaimed += res.get("saved_bytes", 0)
                video_optimization_state["total_reclaimed_bytes"] = total_reclaimed
            else:
                errors.append({"id": c["id"], "error": res.get("error")})

            video_optimization_state["completed_count"] = idx + 1
            video_optimization_state["item_progress"] = 100
    finally:
        video_optimization_state["is_active"] = False
        video_optimization_state["active_video_id"] = None
        video_optimization_state["active_filename"] = None
        video_optimization_state["item_progress"] = 0

    return {
        "candidate_count": len(candidates),
        "processed_count": processed,
        "total_reclaimed_bytes": total_reclaimed,
        "errors": errors,
    }
