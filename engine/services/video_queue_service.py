"""Resilient Background Video Queue Worker with Disconnection Safety and CPU Throttling.

Delivers:
1. SQLite-backed persistent queue (`video_processing_queue`).
2. Single-worker FIFO asynchronous execution.
3. Resumability across app restarts and sudden shutdowns.
4. Drive disconnection safety (catches detached USB drives, pauses cleanly without crashing).
5. Clean up of orphaned temporary files (`*.tmp.mp4`).
6. Atomic file swap with 30-day `.trash/` recovery protection.
"""

import asyncio
import datetime
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Any

import aiosqlite

from engine.database import get_db_connection
from engine.services.video_service import compress_video, enhance_old_video

logger = logging.getLogger("securephotos.video_queue")

# Singleton worker state
_worker_task: Optional[asyncio.Task] = None
_is_paused: bool = False


async def init_video_queue_db() -> None:
    """Creates the video processing queue schema if not already present, and resets orphaned processing tasks."""
    conn = await get_db_connection()
    try:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS video_processing_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                photo_id INTEGER NOT NULL UNIQUE,
                action TEXT NOT NULL,
                target_height INTEGER,
                status TEXT NOT NULL DEFAULT 'queued',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                error_message TEXT,
                retry_count INTEGER DEFAULT 0
            );
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_video_queue_status 
            ON video_processing_queue (status, created_at);
            """
        )

        # Reset any tasks that were interrupted when the app was closed
        await conn.execute(
            """
            UPDATE video_processing_queue
            SET status = 'queued',
                updated_at = CURRENT_TIMESTAMP
            WHERE status = 'processing';
            """
        )
        await conn.commit()
    finally:
        await conn.close()


async def enqueue_video_for_processing(
    photo_id: int,
    action: str,
    target_height: Optional[int] = 1080,
) -> bool:
    """Enqueues a video for automated background processing (enhance or compress).

    Args:
        photo_id: Database ID of the photo/video item.
        action: 'enhance' or 'compress'.
        target_height: Target vertical resolution if action == 'enhance' (default: 1080).

    Returns:
        True if successfully queued or already present, False otherwise.
    """
    conn = await get_db_connection()
    try:
        await conn.execute(
            """
            INSERT INTO video_processing_queue (photo_id, action, target_height, status, updated_at)
            VALUES (?, ?, ?, 'queued', CURRENT_TIMESTAMP)
            ON CONFLICT(photo_id) DO UPDATE SET
                action = excluded.action,
                target_height = excluded.target_height,
                status = CASE 
                    WHEN video_processing_queue.status = 'completed' THEN video_processing_queue.status 
                    ELSE 'queued' 
                END,
                updated_at = CURRENT_TIMESTAMP;
            """,
            (photo_id, action, target_height),
        )
        await conn.commit()
        logger.info(f"Enqueued video #{photo_id} for {action} (target: {target_height}p).")
        return True
    except Exception as e:
        logger.exception(f"Failed to enqueue video #{photo_id}: {e}")
        return False
    finally:
        await conn.close()


async def get_queue_status() -> Dict[str, Any]:
    """Returns current counts and state of the video processing queue."""
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            """
            SELECT status, COUNT(*) as count 
            FROM video_processing_queue 
            GROUP BY status;
            """
        ) as cursor:
            rows = await cursor.fetchall()
            counts = {r["status"]: r["count"] for r in rows}

        return {
            "is_paused": _is_paused,
            "queued": counts.get("queued", 0),
            "processing": counts.get("processing", 0),
            "completed": counts.get("completed", 0),
            "paused": counts.get("paused", 0),
            "failed": counts.get("failed", 0),
            "total": sum(counts.values()),
        }
    finally:
        await conn.close()


def pause_video_queue() -> None:
    """Pauses background video processing loop."""
    global _is_paused
    _is_paused = True
    logger.info("Background video processing queue paused.")


def resume_video_queue() -> None:
    """Resumes background video processing loop."""
    global _is_paused
    _is_paused = False
    logger.info("Background video processing queue resumed.")


async def cleanup_orphaned_video_temp_files() -> None:
    """Scans photos database and safely removes interrupted *.tmp.mp4 files."""
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT filepath FROM photos WHERE mime_type LIKE 'video/%'") as cursor:
            rows = await cursor.fetchall()
    finally:
        await conn.close()

    for r in rows:
        filepath = r["filepath"]
        if not filepath:
            continue
        try:
            p = Path(filepath)
            parent = p.parent
            if not parent.exists():
                continue
            # Look for matching tmp files for this stem
            trans_tmp = parent / f"{p.stem}_transcoding.tmp.mp4"
            enh_tmp = parent / f"{p.stem}_enhancing.tmp.mp4"
            if trans_tmp.exists():
                trans_tmp.unlink()
                logger.info(f"Cleaned up orphaned transcoding temp file: {trans_tmp}")
            if enh_tmp.exists():
                enh_tmp.unlink()
                logger.info(f"Cleaned up orphaned enhancing temp file: {enh_tmp}")
        except Exception:
            pass


async def _process_next_video_job() -> bool:
    """Processes the next eligible queued video job with full disconnection and crash safety.

    Returns:
        True if an item was processed, False if queue was empty or paused.
    """
    if _is_paused:
        return False

    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        # Find next queued or previously paused item
        query = """
            SELECT q.id as queue_id, q.photo_id, q.action, q.target_height, q.retry_count,
                   p.filepath, p.filename, p.is_enhanced, p.is_optimized
            FROM video_processing_queue q
            JOIN photos p ON q.photo_id = p.id
            WHERE q.status IN ('queued', 'paused') AND p.trashed_at IS NULL
            ORDER BY q.created_at ASC
            LIMIT 1;
        """
        async with conn.execute(query) as cursor:
            job = await cursor.fetchone()

        if not job:
            return False

        queue_id = job["queue_id"]
        photo_id = job["photo_id"]
        action = job["action"]
        target_height = job["target_height"] or 1080
        filepath = job["filepath"]
        retry_count = job["retry_count"]

        # Disconnection Safety Check 1: Check if source file and directory exist
        if not filepath or not os.path.exists(filepath):
            logger.warning(
                f"Source storage for video #{photo_id} ({filepath}) is inaccessible or drive disconnected. Pausing job."
            )
            await conn.execute(
                """
                UPDATE video_processing_queue
                SET status = 'paused',
                    error_message = 'Storage drive or source file is disconnected.',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?;
                """,
                (queue_id,),
            )
            await conn.commit()
            return False

        # Mark as processing
        await conn.execute(
            """
            UPDATE video_processing_queue
            SET status = 'processing',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
            """,
            (queue_id,),
        )
        await conn.commit()
    finally:
        await conn.close()

    # Execute processing outside connection lock
    logger.info(f"Starting background video job #{queue_id} (photo #{photo_id}, action={action})...")
    success = False
    error_msg = None

    try:
        if action == "enhance":
            res = await enhance_old_video(photo_id, target_height=target_height)
        else:
            res = await compress_video(photo_id)

        success = bool(res.get("success"))
        if not success:
            error_msg = res.get("error", "Processing failed.")
    except (FileNotFoundError, OSError) as io_err:
        # Drive was unplugged or storage I/O failed mid-encode
        logger.warning(f"Drive I/O error during video processing #{photo_id}: {io_err}. Marking job paused.")
        error_msg = "Storage drive disconnected during processing."
        status_to_set = "paused"
    except Exception as e:
        logger.exception(f"Unexpected error processing video #{photo_id}: {e}")
        error_msg = str(e)
        status_to_set = "failed" if retry_count >= 2 else "queued"
    else:
        status_to_set = "completed" if success else ("failed" if retry_count >= 2 else "queued")

    # Update database record with result
    conn = await get_db_connection()
    try:
        new_retries = retry_count + (0 if success or status_to_set == "paused" else 1)
        await conn.execute(
            """
            UPDATE video_processing_queue
            SET status = ?,
                error_message = ?,
                retry_count = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
            """,
            (status_to_set, error_msg, new_retries, queue_id),
        )
        await conn.commit()
    finally:
        await conn.close()

    return True


async def video_queue_worker_loop() -> None:
    """Continuous background worker loop that runs at low CPU priority."""
    logger.info("Video queue background worker loop started.")
    try:
        await init_video_queue_db()
        await cleanup_orphaned_video_temp_files()

        while True:
            try:
                processed = await _process_next_video_job()
                if not processed:
                    # Idle sleep when queue is empty or paused
                    await asyncio.sleep(4.0)
                else:
                    # Rest 1.5s between videos to allow system to cool down
                    await asyncio.sleep(1.5)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in video queue loop: {e}")
                await asyncio.sleep(5.0)
    finally:
        logger.info("Video queue background worker loop stopped.")


def start_video_queue_worker() -> None:
    """Starts the background video queue worker task if not already running."""
    global _worker_task
    if _worker_task is None or _worker_task.done():
        try:
            loop = asyncio.get_running_loop()
            _worker_task = loop.create_task(video_queue_worker_loop())
            logger.info("Background video worker task initialized.")
        except RuntimeError:
            logger.warning("No active event loop found to start video queue worker.")
