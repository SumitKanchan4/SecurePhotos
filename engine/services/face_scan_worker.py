"""Background Face Detection & Embedding Worker.

This worker runs asynchronously in the background, ingesting photos with faces_scanned = 0,
finding faces and landmarks with YuNet, computing 128-D SFace identity embeddings,
persisting face crops to disk, and triggering unsupervised clustering. Re-scans carry
names over to the new faces by position (see save_scanned_faces).

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
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from engine.config import settings, resolve_media_path
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

# A new face inherits the name of an existing face it overlaps at least this much.
NAME_CARRY_OVER_IOU = 0.4
# A new face this close to a place the owner marked "Not a face" is left out.
DISMISSED_IOU = 0.4


async def dismiss_faces(conn, face_ids) -> int:
    """'Not a face': removes unnamed faces and remembers where they were, so a rescan of the
    photo never adds them again. Named faces are left alone. The caller commits and removes
    the crop images. Returns how many were removed."""
    ids = [int(i) for i in face_ids]
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    await conn.execute(
        f"""INSERT INTO face_dismissals (photo_id, box_x, box_y, box_w, box_h)
            SELECT photo_id, box_x, box_y, box_w, box_h FROM faces WHERE id IN ({marks}) AND person_id IS NULL;""",
        ids,
    )
    cur = await conn.execute(f"DELETE FROM faces WHERE id IN ({marks}) AND person_id IS NULL;", ids)
    return cur.rowcount
# Named face that a newer model couldn't find again: keeps its person link, has no
# usable embedding and is left out of grouping.
UNMATCHED_LEGACY_MODEL = "unmatched-legacy"


def _iou(a, b) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _stored_box(row) -> tuple:
    """Relative (x1, y1, x2, y2) of a stored face; older rows stored float32 as 4-byte blobs."""
    def num(v):
        if isinstance(v, (bytes, bytearray)):
            import numpy as np
            return float(np.frombuffer(v, dtype=np.float32 if len(v) == 4 else np.float64)[0])
        return float(v)
    x, y, w, h = (num(row[k]) for k in ("box_x", "box_y", "box_w", "box_h"))
    return (x, y, x + w, y + h)


async def save_scanned_faces(conn, photo_id: int, faces: list, thumbnails_dir: Path) -> Tuple[int, List[int]]:
    """Replaces a photo's faces with a fresh scan without losing names.

    - Each new face inherits the person of the best-overlapping existing *named*
      face (IoU >= ``NAME_CARRY_OVER_IOU``); that old face is replaced.
    - Unnamed old faces are replaced.
    - A named old face with no match is kept with its person. If it came from an
      older model, its embedding is cleared and it's marked ``unmatched-legacy``,
      so fingerprints from different models are never compared.

    The caller commits; old crop images are deleted only after this returns.

    Returns:
        (number of new faces inserted, ids of deleted faces whose crop images
        the caller removes after committing).
    """
    from engine.services.face_recognition_service import EMBEDDING_MODEL

    async with conn.execute(
        "SELECT id, person_id, box_x, box_y, box_w, box_h, embedding_model FROM faces WHERE photo_id = ?;", (photo_id,)
    ) as cur:
        existing = await cur.fetchall()
    async with conn.execute(
        "SELECT box_x, box_y, box_w, box_h FROM face_dismissals WHERE photo_id = ?;", (photo_id,)
    ) as cur:
        dismissed = [_stored_box(r) for r in await cur.fetchall()]
    named = [r for r in existing if r["person_id"] is not None]
    claimed: set = set()
    to_delete = [r["id"] for r in existing if r["person_id"] is None]
    inserted = 0

    for face in faces:
        new_box = (face["box_x"], face["box_y"], face["box_x"] + face["box_w"], face["box_y"] + face["box_h"])
        # The owner said this place is not a face: never add it again.
        if any(_iou(new_box, box) >= DISMISSED_IOU for box in dismissed):
            continue
        best, best_iou = None, 0.0
        for r in named:
            if r["id"] in claimed:
                continue
            overlap = _iou(new_box, _stored_box(r))
            if overlap > best_iou:
                best, best_iou = r, overlap
        person_id = None
        if best is not None and best_iou >= NAME_CARRY_OVER_IOU:
            claimed.add(best["id"])
            to_delete.append(best["id"])
            person_id = best["person_id"]

        cursor = await conn.execute(
            """
            INSERT INTO faces (photo_id, person_id, box_x, box_y, box_w, box_h,
                               quality_score, is_anchor_medoid, embedding, embedding_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?);
            """,
            (
                photo_id, person_id,
                float(face["box_x"]), float(face["box_y"]), float(face["box_w"]), float(face["box_h"]),
                float(face["quality_score"]), json.dumps(face["embedding"]), face.get("embedding_model", EMBEDDING_MODEL),
            ),
        )
        face["crop_thumbnail"].save(thumbnails_dir / f"{cursor.lastrowid}.webp", format="WEBP", quality=90)
        inserted += 1

    for r in named:
        if r["id"] not in claimed and r["embedding_model"] != EMBEDDING_MODEL:
            await conn.execute(
                "UPDATE faces SET embedding = '[]', embedding_model = ?, cluster_id = NULL, is_anchor_medoid = 0 WHERE id = ?;",
                (UNMATCHED_LEGACY_MODEL, r["id"]),
            )
            logger.info("Named face %s (photo %s) wasn't found by the new model; kept with its person.", r["id"], photo_id)

    if to_delete:
        await conn.execute(f"DELETE FROM faces WHERE id IN ({','.join('?' * len(to_delete))});", to_delete)
    return inserted, to_delete


def retire_old_face_models() -> None:
    """Deletes model files the app no longer uses, once no face still needs them."""
    from engine.services.face_recognition_service import RETIRED_MODEL_FILES, get_models_dir

    for name in RETIRED_MODEL_FILES:
        path = get_models_dir() / name
        if path.exists():
            try:
                path.unlink()
                logger.info("Removed retired model file %s.", name)
            except OSError as err:
                logger.warning("Could not remove retired model file %s: %s", name, err)


async def scan_photo_faces(conn, row, thumbnails_dir: Path) -> int:
    """Finds and saves the faces of one photo (or a video's thumbnail); returns how many were added.

    ``row`` needs ``id, filename, filepath, mime_type, thumbnail_path, preview_path, is_encrypted``.
    The photo is always marked scanned afterwards, even when it can't be read, so a broken file
    never loops; a failure leaves its earlier faces as they were. Vault photos are never read.
    """
    photo_id = row["id"]
    photo_path = resolve_media_path(row["filepath"])
    if row["is_encrypted"] or photo_path.suffix.lower() == ".enc":
        return 0

    mime_type = row["mime_type"] or ""
    is_video = mime_type.startswith("video/") or photo_path.suffix.lower() in [".mp4", ".mov", ".avi", ".mkv", ".webm"]

    # Determine which image file to scan for faces
    scan_path: Optional[Path] = None
    if is_video:
        # For videos, inspect generated WebP preview or thumbnail image
        for cand_str in (row["preview_path"], row["thumbnail_path"]):
            if cand_str:
                cand_p = Path(cand_str) if os.path.isabs(cand_str) else settings.data_dir / cand_str
                if cand_p.exists() and cand_p.stat().st_size > 0:
                    scan_path = cand_p
                    break
    elif photo_path.exists() and photo_path.stat().st_size > 0:
        scan_path = photo_path

    inserted = 0
    try:
        if scan_path is not None:
            # Run CPU/DirectML heavy detection in thread pool to keep asyncio loop responsive
            def _process(p_path: Path):
                with Image.open(p_path) as raw_img:
                    rgb_img = raw_img.convert("RGB")
                    return detect_and_embed_faces(rgb_img)

            faces = await asyncio.to_thread(_process, scan_path)
            inserted, deleted_ids = await save_scanned_faces(conn, photo_id, faces, thumbnails_dir)
            await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
            await conn.commit()
            for old_id in deleted_ids:
                (thumbnails_dir / f"{old_id}.webp").unlink(missing_ok=True)
    except Exception as ex:
        logger.error(f"Error scanning faces for photo {photo_id} ({row['filename']}): {ex}", exc_info=True)
        # Undo any half-saved faces of this photo; its previous faces stay as they were.
        await conn.rollback()
        inserted = 0
    finally:
        # ALWAYS mark faces_scanned = 1 so corrupted or failed items never crash in an infinite retry loop
        await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
        await conn.commit()
    return inserted


def get_scan_status() -> Dict[str, Any]:
    """Returns a snapshot copy of the current background face scan progress."""
    return dict(face_scan_state)


async def run_background_face_scan(force: bool = False) -> Dict[str, Any]:
    """Iterates through all unscanned library photos, extracting faces and SFace embeddings."""
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
                await conn.execute("UPDATE photos SET faces_scanned = 0 WHERE trashed_at IS NULL AND is_encrypted = 0;")
                await conn.commit()

            # Query all active photos that haven't been scanned for faces yet
            async with conn.execute(
                """
                SELECT id, filename, filepath, mime_type, thumbnail_path, preview_path, is_encrypted
                FROM photos
                WHERE faces_scanned = 0 AND trashed_at IS NULL AND is_encrypted = 0
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

            # Load (and if needed download + verify) the face models before touching any
            # photo: if they're unavailable (e.g. offline), stop without marking photos as
            # scanned, so nothing is skipped and the next run tries again.
            if unscanned:
                from engine.services.face_recognition_service import get_inference_sessions
                try:
                    await asyncio.to_thread(get_inference_sessions)
                except Exception as model_err:
                    logger.warning("Face models unavailable; face scan postponed: %s", model_err)
                    face_scan_state["error"] = "Face recognition models are not available yet."
                    return {"status": "postponed", "error": str(model_err)}

            new_faces_count = 0

            for row in unscanned:
                face_scan_state["current_photo"] = row["filename"]
                inserted = await scan_photo_faces(conn, row, thumbnails_dir)
                new_faces_count += inserted
                face_scan_state["faces_found"] += inserted
                face_scan_state["scanned_photos"] += 1

            logger.info(f"Face scan finished. Detected {new_faces_count} faces across {len(unscanned)} photos.")

            # Run unsupervised clustering on all detected faces
            await recluster_all_faces()

            # H9: once every library photo has been re-scanned with the new models,
            # the old (non-permissively licensed) model files are no longer needed.
            async with conn.execute(
                "SELECT COUNT(*) FROM photos WHERE faces_scanned = 0 AND trashed_at IS NULL AND is_encrypted = 0;"
            ) as cur:
                pending = (await cur.fetchone())[0]
            if pending == 0:
                retire_old_face_models()

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
