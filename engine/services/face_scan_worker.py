"""Background Face Detection & Embedding Worker.

This worker runs asynchronously in the background, ingesting photos with faces_scanned = 0,
detecting facial bounding boxes and landmarks using YOLOv8-Face, computing 512-D ArcFace
identity embeddings, persisting face crops to disk, and triggering unsupervised clustering.

Guarantees:
- Non-Blocking: Asynchronous event loop execution without stalling frontend UI responsiveness.
- Resilient Batching: Commits each photo atomically so interruptions can resume gracefully.
- Automatic Reclustering: Triggers medoid selection and cluster grouping upon scan completion.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

from PIL import Image

from engine.config import settings
from engine.database import get_db_connection
from engine.services.face_clustering_service import recluster_all_faces
from engine.services.face_recognition_service import (
    detect_and_embed_faces,
    get_face_thumbnails_dir,
)

logger = logging.getLogger("securephotos.face_scan_worker")

# Global in-memory progress tracker for UI status bar
face_scan_state: Dict[str, Any] = {
    "is_scanning": False,
    "total_photos": 0,
    "scanned_photos": 0,
    "faces_found": 0,
    "current_photo": None,
    "error": None,
}

_scan_lock = asyncio.Lock()


def get_scan_status() -> Dict[str, Any]:
    """Returns a snapshot copy of the current background face scan progress."""
    return dict(face_scan_state)


async def run_background_face_scan(force: bool = False) -> Dict[str, Any]:
    """Iterates through all unscanned library photos, extracting faces and ArcFace vectors."""
    global face_scan_state

    async with _scan_lock:
        face_scan_state["is_scanning"] = True
        face_scan_state["error"] = None

        conn = await get_db_connection()
        try:
            # Only reset faces_scanned if database has zero faces and zero persons (clean slate after reset)
            async with conn.execute("SELECT COUNT(*) FROM faces;") as f_cur:
                f_row = await f_cur.fetchone()
                faces_in_db = f_row[0] if f_row else 0
            async with conn.execute("SELECT COUNT(*) FROM persons;") as p_cur:
                p_row = await p_cur.fetchone()
                persons_in_db = p_row[0] if p_row else 0

            if faces_in_db == 0 and persons_in_db == 0:
                await conn.execute("UPDATE photos SET faces_scanned = 0 WHERE trashed_at IS NULL;")
                await conn.commit()

            # Query all active photos that haven't been scanned for faces yet
            async with conn.execute(
                """
                SELECT id, filename, filepath, mime_type, thumbnail_path, preview_path
                FROM photos
                WHERE faces_scanned = 0 AND trashed_at IS NULL
                ORDER BY id ASC;
                """
            ) as cursor:
                unscanned = await cursor.fetchall()

            face_scan_state["total_photos"] = len(unscanned)
            face_scan_state["scanned_photos"] = 0
            face_scan_state["faces_found"] = 0

            if not unscanned:
                # Also ensure existing faces are clustered if any exist
                await recluster_all_faces()
                face_scan_state["is_scanning"] = False
                return {"status": "completed", "scanned": 0, "faces_found": 0}

            logger.info(f"Starting background face scan for {len(unscanned)} photos...")
            thumbnails_dir = get_face_thumbnails_dir()

            new_faces_count = 0

            for row in unscanned:
                photo_id = row["id"]
                filename = row["filename"]
                filepath_str = row["filepath"]
                mime_type = row["mime_type"] or ""
                preview_str = row["preview_path"]
                thumb_str = row["thumbnail_path"]
                face_scan_state["current_photo"] = filename

                photo_path = Path(filepath_str)
                is_video = mime_type.startswith("video/") or photo_path.suffix.lower() in [
                    ".mp4", ".mov", ".avi", ".mkv", ".webm"
                ]

                # Determine which image file to scan for faces
                scan_path: Optional[Path] = None
                if is_video:
                    # For videos, inspect generated WebP preview or thumbnail image
                    for cand_str in (preview_str, thumb_str):
                        if cand_str:
                            cand_p = Path(cand_str) if os.path.isabs(cand_str) else settings.data_dir / cand_str
                            if cand_p.exists() and cand_p.stat().st_size > 0:
                                scan_path = cand_p
                                break
                else:
                    if photo_path.exists() and photo_path.stat().st_size > 0:
                        scan_path = photo_path

                if not scan_path:
                    # Mark as scanned so missing files or videos without thumbnails don't spin in an endless loop
                    await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
                    await conn.commit()
                    face_scan_state["scanned_photos"] += 1
                    continue

                try:
                    # Run CPU/DirectML heavy detection in thread pool to keep asyncio loop responsive
                    def _process(p_path: Path):
                        with Image.open(p_path) as raw_img:
                            rgb_img = raw_img.convert("RGB")
                            return detect_and_embed_faces(rgb_img)

                    loop = asyncio.get_running_loop()
                    faces = await loop.run_in_executor(None, _process, scan_path)

                    # Clean up only unconfirmed faces and their thumbnails for this photo
                    async with conn.execute("SELECT id FROM faces WHERE photo_id = ? AND person_id IS NULL;", (photo_id,)) as cur:
                        old_rows = await cur.fetchall()
                        for old_r in old_rows:
                            old_thumb = thumbnails_dir / f"{old_r['id']}.webp"
                            if old_thumb.exists():
                                try:
                                    old_thumb.unlink()
                                except OSError:
                                    pass
                    await conn.execute("DELETE FROM faces WHERE photo_id = ? AND person_id IS NULL;", (photo_id,))

                    for face in faces:
                        emb_json = json.dumps(face["embedding"])
                        cursor = await conn.execute(
                            """
                            INSERT INTO faces (
                                photo_id, box_x, box_y, box_w, box_h,
                                quality_score, is_anchor_medoid, embedding
                            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?);
                            """,
                            (
                                photo_id,
                                face["box_x"],
                                face["box_y"],
                                face["box_w"],
                                face["box_h"],
                                face["quality_score"],
                                emb_json,
                            ),
                        )
                        face_id = cursor.lastrowid

                        # Persist WebP face avatar thumbnail
                        thumb_crop: Image.Image = face["crop_thumbnail"]
                        thumb_file = thumbnails_dir / f"{face_id}.webp"
                        thumb_crop.save(thumb_file, format="WEBP", quality=90)

                        new_faces_count += 1
                        face_scan_state["faces_found"] += 1

                except Exception as ex:
                    logger.error(f"Error scanning faces for photo {photo_id} ({filename}): {ex}", exc_info=True)
                finally:
                    # ALWAYS mark faces_scanned = 1 so corrupted or failed items never crash in an infinite retry loop
                    await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
                    await conn.commit()
                    face_scan_state["scanned_photos"] += 1

            logger.info(f"Face scan finished. Detected {new_faces_count} faces across {len(unscanned)} photos.")

            # Run unsupervised clustering on all detected faces
            await recluster_all_faces()

            return {
                "status": "completed",
                "scanned": face_scan_state["scanned_photos"],
                "faces_found": face_scan_state["faces_found"],
            }

        except Exception as exc:
            logger.error(f"Fatal error in face scan worker: {exc}", exc_info=True)
            face_scan_state["error"] = str(exc)
            return {"status": "error", "error": str(exc)}
        finally:
            face_scan_state["is_scanning"] = False
            face_scan_state["current_photo"] = None
            await conn.close()


def start_background_scan(force: bool = False) -> None:
    """Spawns the background face scan task asynchronously if not already running."""
    if not face_scan_state["is_scanning"]:
        face_scan_state["is_scanning"] = True
        face_scan_state["error"] = None
        asyncio.create_task(run_background_face_scan(force=force))


def reset_scan_state() -> None:
    """Resets the in-memory face scan progress tracker."""
    global face_scan_state
    face_scan_state["is_scanning"] = False
    face_scan_state["total_photos"] = 0
    face_scan_state["scanned_photos"] = 0
    face_scan_state["faces_found"] = 0
    face_scan_state["current_photo"] = None
    face_scan_state["error"] = None
