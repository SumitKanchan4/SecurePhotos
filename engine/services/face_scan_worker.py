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
from pathlib import Path
from typing import Any, Dict, Optional

from PIL import Image

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


async def run_background_face_scan() -> Dict[str, Any]:
    """Iterates through all unscanned library photos, extracting faces and ArcFace vectors."""
    global face_scan_state

    if face_scan_state["is_scanning"]:
        return {"status": "already_running", **get_scan_status()}

    async with _scan_lock:
        face_scan_state["is_scanning"] = True
        face_scan_state["error"] = None

        conn = await get_db_connection()
        try:
            # Query all active photos that haven't been scanned for faces yet
            async with conn.execute(
                """
                SELECT id, filename, filepath
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
                face_scan_state["current_photo"] = filename

                photo_path = Path(filepath_str)
                if not photo_path.exists():
                    # Mark as scanned so we don't spin endlessly on missing files
                    await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
                    await conn.commit()
                    face_scan_state["scanned_photos"] += 1
                    continue

                try:
                    # Run CPU/DirectML heavy detection in thread pool to keep asyncio loop responsive
                    def _process(p_path):
                        with Image.open(p_path) as raw_img:
                            rgb_img = raw_img.convert("RGB")
                            return detect_and_embed_faces(rgb_img)

                    loop = asyncio.get_running_loop()
                    faces = await loop.run_in_executor(None, _process, photo_path)

                    # Clean up any existing faces and thumbnails for this photo to prevent duplicate records
                    async with conn.execute("SELECT id FROM faces WHERE photo_id = ?;", (photo_id,)) as cur:
                        old_rows = await cur.fetchall()
                        for old_r in old_rows:
                            old_thumb = thumbnails_dir / f"{old_r['id']}.webp"
                            if old_thumb.exists():
                                try:
                                    old_thumb.unlink()
                                except OSError:
                                    pass
                    await conn.execute("DELETE FROM faces WHERE photo_id = ?;", (photo_id,))

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

                    await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
                    await conn.commit()

                except Exception as ex:
                    logger.error(f"Error scanning faces for photo {photo_id} ({filename}): {ex}", exc_info=True)

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


def start_background_scan() -> None:
    """Spawns the background face scan task asynchronously if not already running."""
    if not face_scan_state["is_scanning"]:
        asyncio.create_task(run_background_face_scan())
