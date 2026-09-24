import asyncio
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import aiosqlite

from engine.config import settings
from engine.database import get_db_connection
from engine.services.video_runtime import (
    is_video_runtime_available,
    get_ffmpeg_path,
)
from engine.services.video_service import (
    analyze_video_candidate,
    compress_video,
    enhance_old_video,
    extract_video_metadata,
)
from engine.services.video_runtime import is_video_runtime_available
from engine.services.video_queue_service import (
    enqueue_video_for_processing,
    get_queue_status,
    pause_video_queue,
    resume_video_queue,
    start_video_queue_worker,
)

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
            WHERE mime_type LIKE 'video/%' AND trashed_at IS NULL AND is_encrypted = 0
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
            WHERE mime_type LIKE 'video/%' AND trashed_at IS NULL AND is_encrypted = 0
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
    """Returns the real-time continuous video batch optimization state, including background queue jobs."""
    global video_optimization_state
    if video_optimization_state.get("is_active"):
        return video_optimization_state

    # Check background video_processing_queue
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row

        # Self-healing Layer 2.1: Opportunistically purge orphaned or trashed queue rows
        await conn.execute(
            """
            DELETE FROM video_processing_queue 
            WHERE photo_id NOT IN (SELECT id FROM photos WHERE trashed_at IS NULL);
            """
        )

        # Self-healing Layer 2.2: Stalled job watchdog (recover jobs stuck in 'processing' > 3 mins)
        await conn.execute(
            """
            UPDATE video_processing_queue
            SET status = CASE WHEN retry_count >= 2 THEN 'failed' ELSE 'queued' END,
                error_message = 'Job timed out or worker process was interrupted.',
                retry_count = retry_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE status = 'processing'
              AND updated_at <= datetime('now', '-3 minutes');
            """
        )
        await conn.commit()

        async with conn.execute(
            """
            SELECT q.photo_id, q.status, q.action, p.filename
            FROM video_processing_queue q
            JOIN photos p ON p.id = q.photo_id
            WHERE q.status IN ('queued', 'processing')
              AND p.trashed_at IS NULL
              AND p.is_encrypted = 0
            ORDER BY CASE WHEN q.status = 'processing' THEN 0 ELSE 1 END ASC, q.created_at ASC
            LIMIT 1;
            """
        ) as cursor:
            active_row = await cursor.fetchone()

        if active_row:
            async with conn.execute(
                """
                SELECT COUNT(*) FROM video_processing_queue q
                JOIN photos p ON p.id = q.photo_id
                WHERE q.status IN ('queued', 'processing')
                  AND p.trashed_at IS NULL;
                """
            ) as c2:
                row_c = await c2.fetchone()
                total_pending = row_c[0] if row_c else 1

            return {
                "is_active": True,
                "total_count": total_pending,
                "completed_count": 0,
                "active_video_id": active_row["photo_id"],
                "active_filename": active_row["filename"] or f"Video #{active_row['photo_id']}",
                "item_progress": 50 if active_row["status"] == "processing" else 10,
                "total_reclaimed_bytes": 0,
            }
        else:
            return {
                "is_active": False,
                "total_count": 0,
                "completed_count": 0,
                "active_video_id": None,
                "active_filename": None,
                "item_progress": 0,
                "total_reclaimed_bytes": 0,
            }
    except Exception as e:
        logger.warning(f"Failed to query queue status for progress: {e}")
    finally:
        await conn.close()

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


@router.get("/queue")
async def get_video_queue_endpoint() -> Dict[str, Any]:
    """Returns background video queue status, counts, and paused state."""
    return await get_queue_status()


@router.post("/queue/pause")
async def pause_video_queue_endpoint() -> Dict[str, Any]:
    """Pauses the background video processing worker."""
    pause_video_queue()
    return {"success": True, "status": "paused"}


@router.post("/queue/resume")
async def resume_video_queue_endpoint() -> Dict[str, Any]:
    """Resumes the background video processing worker."""
    resume_video_queue()
    start_video_queue_worker()
    return {"success": True, "status": "running"}


@router.get("/{photo_id}/stream")
async def stream_video_endpoint(photo_id: int):
    """Streams video with universal web-browser playback compatibility.
    
    If the video is already H.264/AAC, streams directly with full byte-range support.
    If the video is HEVC/H.265 (common in Google Pixel & modern phones) or another
    non-browser codec, automatically prepares and caches a faststart H.264 streaming proxy.
    """
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT filepath, mime_type, is_encrypted FROM photos WHERE id = ?;",
            (photo_id,),
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Video not found")

    if row["is_encrypted"]:
        raise HTTPException(status_code=403, detail="Encrypted video requires vault authentication")

    src_file = Path(row["filepath"])
    if not src_file.exists():
        raise HTTPException(status_code=404, detail="Video file missing on disk")

    # Probe codec to determine if it is natively decodable in Chromium / WebView2
    try:
        meta = extract_video_metadata(str(src_file))
        codec = (meta.get("codec") or "").lower()
    except Exception as err:
        logger.warning("Failed to extract metadata for video %s: %s", photo_id, err)
        codec = "unknown"

    # H.264 / AVC1 is universally supported across 100% of browsers & WebView2
    if codec in ("h264", "avc1"):
        return FileResponse(
            str(src_file),
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

    # For HEVC/H.265 or other non-web codecs, serve or generate a web-compatible H.264 preview
    previews_dir = settings.previews_dir / "videos"
    previews_dir.mkdir(parents=True, exist_ok=True)
    preview_file = previews_dir / f"{photo_id}_web.mp4"

    if preview_file.exists() and preview_file.stat().st_size > 0:
        return FileResponse(
            str(preview_file),
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        # Fallback to source file if ffmpeg runtime is not found
        return FileResponse(
            str(src_file),
            media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
        )

    # On-the-fly ultrafast H.264 transcode with faststart for instant streaming
    temp_preview = preview_file.with_suffix(".tmp.mp4")
    cmd = [
        ffmpeg, "-y",
        "-i", str(src_file),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "24",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        str(temp_preview),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

        if temp_preview.exists() and temp_preview.stat().st_size > 0:
            if preview_file.exists():
                preview_file.unlink()
            temp_preview.rename(preview_file)
            return FileResponse(
                str(preview_file),
                media_type="video/mp4",
                headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
            )
    except Exception as transcode_err:
        logger.error("Failed to generate web video preview for %s: %s", photo_id, transcode_err)
        if temp_preview.exists():
            temp_preview.unlink(missing_ok=True)

    # Direct fallback if transcoding encounters an error
    return FileResponse(
        str(src_file),
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"},
    )

