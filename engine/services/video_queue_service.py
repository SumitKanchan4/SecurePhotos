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
import logging
import os
from pathlib import Path
from typing import Dict, Optional, Any

import aiosqlite

from engine.config import resolve_media_path
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

        # Purge any orphaned queue rows whose photo record was deleted
        await conn.execute(
            """
            DELETE FROM video_processing_queue
            WHERE photo_id NOT IN (SELECT id FROM photos);
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
        # Guard: Ensure photo exists and is not trashed
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT id FROM photos WHERE id = ? AND trashed_at IS NULL;", (photo_id,)) as cursor:
            if not await cursor.fetchone():
                logger.info(f"Skipping enqueue for photo #{photo_id}: photo does not exist or is trashed.")
                return False

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
        except OSError as e:
            # A leftover temp file that can't be removed now is tried again next start.
            logger.warning("Could not remove a leftover video temp file next to %s: %s", p, e)


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

        # Continuous Self-Healing 1: Purge any queue entries whose photo was deleted or moved to trash
        await conn.execute(
            """
            DELETE FROM video_processing_queue 
            WHERE photo_id NOT IN (SELECT id FROM photos WHERE trashed_at IS NULL AND is_encrypted = 0);
            """
        )

        # Continuous Self-Healing 2: Reset/fail stale processing jobs older than 3 minutes
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

        # Find next queued or eligible paused item (prioritizing queued, with a 60s cooldown on paused)
        query = """
            SELECT q.id as queue_id, q.photo_id, q.action, q.target_height, q.retry_count, q.status as queue_status,
                   p.filepath, p.filename, p.is_enhanced, p.is_optimized
            FROM video_processing_queue q
            JOIN photos p ON q.photo_id = p.id
            WHERE (
                q.status = 'queued'
                OR (
                    q.status = 'paused'
                    AND (q.updated_at IS NULL OR q.updated_at <= datetime('now', '-60 seconds'))
                    AND q.retry_count < 5
                )
            )
            AND p.trashed_at IS NULL
            AND p.is_encrypted = 0
            ORDER BY 
                CASE WHEN q.status = 'queued' THEN 0 ELSE 1 END ASC,
                q.created_at ASC
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
        retry_count = job["retry_count"] or 0
        queue_status = job["queue_status"]

        # Disconnection Safety Check 1: Check if source file exists
        resolved_p = resolve_media_path(filepath)
        if not filepath or not resolved_p.exists():
            new_retries = retry_count + 1
            if new_retries >= 5:
                logger.warning(
                    f"Source storage for video #{photo_id} ({filepath}) remained unavailable after 5 reconnection checks. Marking job failed."
                )
                status_to_set = "failed"
                err_text = "Source storage or file missing after multiple reconnection checks."
            else:
                if queue_status != "paused":
                    logger.warning(
                        f"Source storage for video #{photo_id} ({filepath}) is inaccessible or drive disconnected. Pausing job."
                    )
                status_to_set = "paused"
                err_text = "Storage drive or source file is disconnected."

            await conn.execute(
                """
                UPDATE video_processing_queue
                SET status = ?,
                    error_message = ?,
                    retry_count = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?;
                """,
                (status_to_set, err_text, new_retries, queue_id),
            )
            await conn.commit()
            return False

    finally:
        await conn.close()

    # One heavy job at a time (after-import plan, owner D2). The slot is taken before the job is
    # marked "processing", so waiting for it never looks like a stalled job (3-minute watchdog).
    from engine.services import cpu_budget

    priority = cpu_budget.USER if action == "enhance" else cpu_budget.BACKGROUND  # "Enhance" is asked for.
    async with cpu_budget.heavy(priority, f"video:{photo_id}"):
        return await _run_video_job(queue_id, photo_id, action, target_height, retry_count)


async def _run_video_job(queue_id: int, photo_id: int, action: str, target_height: int, retry_count: int) -> bool:
    """Runs one video job (holding the heavy-work slot) and records how it ended."""
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            """
            UPDATE video_processing_queue
            SET status = 'processing',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status IN ('queued', 'paused');
            """,
            (queue_id,),
        )
        await conn.commit()
        if cur.rowcount == 0:  # Removed or taken meanwhile (e.g. the video went to Trash).
            return True
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
            if "not found" in str(error_msg).lower():
                status_to_set = "delete"
            else:
                status_to_set = "failed" if retry_count >= 2 else "queued"
        else:
            status_to_set = "completed"
    except (FileNotFoundError, OSError) as io_err:
        # Drive was unplugged or storage I/O failed mid-encode
        logger.warning(f"Drive I/O error during video processing #{photo_id}: {io_err}. Marking job paused.")
        error_msg = "Storage drive disconnected during processing."
        status_to_set = "paused"
    except Exception as e:
        logger.exception(f"Unexpected error processing video #{photo_id}: {e}")
        error_msg = str(e)
        status_to_set = "failed" if retry_count >= 2 else "queued"

    # Update database record with result
    conn = await get_db_connection()
    try:
        if status_to_set == "delete":
            await conn.execute("DELETE FROM video_processing_queue WHERE id = ?;", (queue_id,))
        else:
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


def start_video_queue_worker(force: bool = False) -> None:
    """Starts the background video queue worker task if not already running.
    
    Args:
        force: If True, starts worker even when running in automated test suites.
               By default, automated tests (PYTEST_CURRENT_TEST) isolate background
               workers to avoid dangling tasks across test-scoped event loops.
    """
    global _worker_task
    if os.environ.get("PYTEST_CURRENT_TEST") and not force:
        return

    if _worker_task is None or _worker_task.done():
        try:
            loop = asyncio.get_running_loop()
            _worker_task = loop.create_task(video_queue_worker_loop())
            logger.info("Background video worker task initialized.")
        except RuntimeError:
            logger.warning("No active event loop found to start video queue worker.")


async def stop_video_queue_worker() -> None:
    """Stops and cancels the background video queue worker task cleanly.
    
    Awaits the cancelled task to ensure all SQLite queries and thread-pool
    operations are drained before event loop teardown.
    """
    global _worker_task
    if _worker_task is not None and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug("Exception while awaiting cancelled video worker task: %s", e)
        finally:
            _worker_task = None
            logger.info("Background video queue worker task cleanly stopped.")
    else:
        _worker_task = None
