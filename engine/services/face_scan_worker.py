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

from PIL import Image, ImageOps

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

    # Read and replace in one write transaction (2026-11-21): two scans of the same photo, even
    # from two engines on one library, then run one after the other, and the second replaces
    # the first's faces instead of adding a second copy of each.
    if not conn.in_transaction:
        await conn.execute("BEGIN IMMEDIATE;")
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
        if person_id is not None and best is not None:
            # The person's chosen profile face follows it to its replacement (2026-11-19).
            await conn.execute("UPDATE persons SET cover_face_id = ? WHERE cover_face_id = ?;", (cursor.lastrowid, best["id"]))
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
        # T30 (owner, 2026-11-21): a video is checked on frames spread through it, not only on its
        # preview, and each different face is kept once. The preview is the fallback.
        if is_video and photo_path.exists():
            from engine.services.video_faces import faces_in_video
            from engine.services.video_service import extract_video_metadata

            def _video_faces():
                duration = float(extract_video_metadata(str(photo_path)).get("duration") or 0)
                return faces_in_video(photo_path, duration, detect_and_embed_faces)

            video_faces = await asyncio.to_thread(_video_faces)
            if video_faces:
                inserted, deleted_ids = await save_scanned_faces(conn, photo_id, video_faces, thumbnails_dir)
                await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (photo_id,))
                await conn.commit()
                for old_id in deleted_ids:
                    (thumbnails_dir / f"{old_id}.webp").unlink(missing_ok=True)
                return inserted
        if scan_path is not None:
            # Run CPU/DirectML heavy detection in thread pool to keep asyncio loop responsive
            def _process(p_path: Path):
                with Image.open(p_path) as raw_img:
                    # Upright first (owner feedback 2026-11-19): a phone photo stored sideways
                    # gave sideways faces and boxes in the wrong place, since faces are now found
                    # on the imported file, before 8K writes it upright.
                    rgb_img = ImageOps.exif_transpose(raw_img).convert("RGB")
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


# ── One-time repair: faces found on a sideways-stored photo (owner feedback 2026-11-19) ──────
# Before the fix above, faces were found on the imported file without turning it upright, so a
# phone photo stored sideways got a box in the wrong place and a sideways face picture. The 8K
# step has since rewritten most of those files upright, so the stored boxes are compared with
# faces found on the upright thumbnail; if they only match after a quarter or half turn, they are
# turned back (keeping names) and the photo's faces are found again.

SIDEWAYS_REPAIR_KEY = "repair_sideways_faces_done"
# Turns that map a box found on the raw (sideways) pixels to the upright picture.
TURNS = {
    "cw": lambda x, y: (1.0 - y, x),     # stored with EXIF orientation 6
    "ccw": lambda x, y: (y, 1.0 - x),    # orientation 8
    "half": lambda x, y: (1.0 - x, 1.0 - y),  # orientation 3
}


def turn_box(box: tuple, turn: str) -> tuple:
    """A relative (x1, y1, x2, y2) box turned with :data:`TURNS`."""
    if turn == "none":
        return box
    fn = TURNS[turn]
    xs, ys = zip(*(fn(x, y) for x, y in ((box[0], box[1]), (box[2], box[3]))))
    return (min(xs), min(ys), max(xs), max(ys))


def best_turn(stored: List[tuple], found: List[tuple], min_match: float = 0.3, margin: float = 0.15) -> str:
    """Which turn makes the stored boxes line up with the faces found upright ("none" if no turn
    is clearly better). Each stored box scores its best overlap with a found face."""
    if not stored or not found:
        return "none"

    def score(turn: str) -> float:
        return sum(max(_iou(turn_box(b, turn), f) for f in found) for b in stored) / len(stored)

    plain = score("none")
    turn, best = max(((t, score(t)) for t in TURNS), key=lambda item: item[1])
    return turn if best >= min_match and best > plain + margin else "none"


async def repair_sideways_faces() -> int:
    """Runs the repair once per library; returns how many photos were fixed."""
    from engine.database import get_db_connection
    from engine.services.face_recognition_service import detect_faces, ensure_face_models
    from engine.services.media_paths import resolve_stored_path

    try:
        await asyncio.to_thread(ensure_face_models)
    except Exception as err:  # noqa: BLE001 - no face models yet: try again on the next start
        logger.info("Sideways-face check waits for the face models: %s", err)
        return 0
    conn = await get_db_connection()
    fixed = 0
    try:
        async with conn.execute("SELECT 1 FROM app_settings WHERE key = ?;", (SIDEWAYS_REPAIR_KEY,)) as cur:
            if await cur.fetchone():
                return 0
        async with conn.execute(
            """SELECT DISTINCT p.id, p.filename, p.filepath, p.mime_type, p.thumbnail_path, p.preview_path, p.is_encrypted
               FROM photos p JOIN faces f ON f.photo_id = p.id
               WHERE COALESCE(p.is_encrypted, 0) = 0 AND (p.mime_type IS NULL OR p.mime_type NOT LIKE 'video/%');"""
        ) as cur:
            photos = await cur.fetchall()
        thumbnails_dir = get_face_thumbnails_dir()
        for row in photos:
            thumb = resolve_stored_path(row["thumbnail_path"]) if row["thumbnail_path"] else None
            if thumb is None or not thumb.exists():
                continue

            def _found(path: Path) -> List[tuple]:
                with Image.open(path) as raw:
                    img = ImageOps.exif_transpose(raw).convert("RGB")
                w, h = img.size
                return [(x1 / w, y1 / h, x2 / w, y2 / h) for (x1, y1, x2, y2), _s, _l in detect_faces(img)]

            try:
                found = await asyncio.to_thread(_found, thumb)
            except Exception as err:  # noqa: BLE001 - one unreadable photo must not stop the rest
                logger.warning("Sideways-face check skipped photo %s: %s", row["id"], err)
                continue
            async with conn.execute("SELECT id, box_x, box_y, box_w, box_h FROM faces WHERE photo_id = ?;", (row["id"],)) as cur:
                faces = await cur.fetchall()
            turn = best_turn([_stored_box(f) for f in faces], found)
            if turn == "none":
                continue
            for f in faces:
                x1, y1, x2, y2 = turn_box(_stored_box(f), turn)
                await conn.execute(
                    "UPDATE faces SET box_x = ?, box_y = ?, box_w = ?, box_h = ? WHERE id = ?;",
                    (x1, y1, x2 - x1, y2 - y1, f["id"]),
                )
            await conn.commit()
            # Found again upright: names carry over to the matching (now turned) boxes.
            await scan_photo_faces(conn, row, thumbnails_dir)
            fixed += 1
        await conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, '1');", (SIDEWAYS_REPAIR_KEY,))
        await conn.commit()
        if fixed:
            logger.info("Turned the faces of %d sideways-stored photos upright.", fixed)
        return fixed
    finally:
        await conn.close()


# ── One-time cleanup: faces saved twice (2026-11-21) ─────────────────────────────────────────
# Two engines on one library could find a photo's faces at the same time and both save them.
# A duplicate can never join its twin's group (one person can't be twice in a photo), so it
# showed as an extra "Who is this?" card. This removes the extra copies once.

DUPLICATE_FACE_IOU = 0.8
DUPLICATES_REPAIR_KEY = "repair_duplicate_faces_done"


def duplicate_faces_to_remove(faces: list) -> List[Tuple[int, int]]:
    """Pairs (remove, keep) among one photo's faces that are the same face saved twice.

    Of a pair, a named face is kept over an unnamed one, otherwise the older (lower id).
    Two faces named as different people are both kept: which one is right can't be told.
    """
    pairs: List[Tuple[int, int]] = []
    removed: set = set()
    ordered = sorted(faces, key=lambda f: (f["person_id"] is None, f["id"]))
    for i, keep in enumerate(ordered):
        if keep["id"] in removed:
            continue
        for other in ordered[i + 1:]:
            if other["id"] in removed or _iou(_stored_box(keep), _stored_box(other)) < DUPLICATE_FACE_IOU:
                continue
            if keep["person_id"] is not None and other["person_id"] is not None and keep["person_id"] != other["person_id"]:
                continue
            pairs.append((other["id"], keep["id"]))
            removed.add(other["id"])
    return pairs


async def remove_duplicate_faces() -> int:
    """Removes faces saved twice, once per library; returns how many were removed."""
    from engine.database import get_db_connection

    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT 1 FROM app_settings WHERE key = ?;", (DUPLICATES_REPAIR_KEY,)) as cur:
            if await cur.fetchone():
                return 0
        async with conn.execute(
            """SELECT id, photo_id, person_id, box_x, box_y, box_w, box_h FROM faces
               WHERE photo_id IN (SELECT photo_id FROM faces GROUP BY photo_id HAVING COUNT(*) > 1)
               ORDER BY photo_id, id;"""
        ) as cur:
            rows = await cur.fetchall()
        by_photo: Dict[int, list] = {}
        for r in rows:
            by_photo.setdefault(r["photo_id"], []).append(r)
        gone: List[int] = []
        for faces in by_photo.values():
            for remove, keep in duplicate_faces_to_remove(faces):
                # A person's chosen profile face moves to the copy that stays.
                await conn.execute("UPDATE persons SET cover_face_id = ? WHERE cover_face_id = ?;", (keep, remove))
                await conn.execute("DELETE FROM faces WHERE id = ?;", (remove,))
                gone.append(remove)
        await conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, '1');", (DUPLICATES_REPAIR_KEY,))
        await conn.commit()
        folder = get_face_thumbnails_dir()
        for face_id in gone:
            (folder / f"{face_id}.webp").unlink(missing_ok=True)
        if gone:
            logger.info("Removed %d faces that had been saved twice.", len(gone))
            from engine.services.face_clustering_service import recluster_all_faces

            await recluster_all_faces()
        return len(gone)
    finally:
        await conn.close()


VIDEO_FACES_RESCAN_KEY = "rescan_video_faces_done"


async def rescan_videos_for_faces() -> int:
    """Once per library (T30): videos checked on their preview only are checked again on frames
    through the video. Videos with a named face are left alone, so no name is ever touched.
    Returns how many videos were queued (the after-import process picks them up)."""
    from engine.database import get_db_connection

    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT 1 FROM app_settings WHERE key = ?;", (VIDEO_FACES_RESCAN_KEY,)) as cur:
            if await cur.fetchone():
                return 0
        cur = await conn.execute(
            """UPDATE photos SET faces_scanned = 0
               WHERE COALESCE(mime_type, '') LIKE 'video/%' AND COALESCE(is_encrypted, 0) = 0 AND trashed_at IS NULL
                 AND faces_scanned = 1
                 AND id NOT IN (SELECT photo_id FROM faces WHERE person_id IS NOT NULL);"""
        )
        queued = cur.rowcount or 0
        await conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, '1');", (VIDEO_FACES_RESCAN_KEY,))
        await conn.commit()
    finally:
        await conn.close()
    if queued:
        logger.info("Checking %d video(s) again for faces, on frames through each video.", queued)
        from engine.services import after_import

        after_import.wake()
    return queued
