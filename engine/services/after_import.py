"""The ordered after-import process, step P1.

Every library photo goes through the same steps, in this order, and each step is recorded on
the photo itself, so nothing is missed and a restart resumes where it stopped:

1. Basics: during import (date, place, camera, hash, thumbnail).
2. **Read text** (``ocr_text``: NULL = not read yet, '' = read, no text) → document check.
3. **Faces** (``faces_scanned``), only after the text is read, never on documents (owner D1).
4. **Old-photo rules** (``restore_checked``): queue the automatic fix (Settings → Old photos).
5. **8K** (``is_optimized``): the 8K pass in ``api/photos.py`` takes a photo only when 2-4 are
   done and no old-photo job is open for it; improved copies first, then their originals (D3).
   Heavy work (fixes, 8K, video, vault) takes turns through ``cpu_budget`` (D2).
6.-7. Duplicates, stories: P3.

This module runs the quick steps (2 and 3: well under a second per photo), newest photos
first, for the whole library: a new import, an older library whose text was never read, and
a photo un-marked as a document all get them. It follows "Pause all" and the battery setting
(owner D5), never touches vault photos, and regroups faces once a run of faces is done.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from engine.database import db_connection

logger = logging.getLogger("securephotos.after_import")

# What is still waiting, per step. Vault and Trash never; the order of the steps is in here.
_LIBRARY = "trashed_at IS NULL AND COALESCE(is_encrypted, 0) = 0"
TEXT_WAITING = f"{_LIBRARY} AND ocr_text IS NULL AND COALESCE(mime_type, '') LIKE 'image/%'"
FACES_WAITING = (
    f"{_LIBRARY} AND faces_scanned = 0 AND COALESCE(is_document, 0) = 0 "
    "AND (ocr_text IS NOT NULL OR COALESCE(mime_type, '') NOT LIKE 'image/%')"
)
# Step 6 (P3): the fingerprint for duplicates (dHash, from the thumbnail), after the text.
DUPS_WAITING = (
    f"{_LIBRARY} AND phash IS NULL AND thumbnail_path IS NOT NULL "
    "AND (ocr_text IS NOT NULL OR COALESCE(mime_type, '') NOT LIKE 'image/%')"
)
# Step 4 (P2): the old-photo rules look at an original once its text and faces are done.
RULES_WAITING = (
    f"{_LIBRARY} AND restore_checked = 0 AND derived_from_id IS NULL AND COALESCE(mime_type, '') LIKE 'image/%' "
    "AND ocr_text IS NOT NULL AND (faces_scanned = 1 OR COALESCE(is_document, 0) = 1)"
)

# Which step a photo being prepared is on (owner feedback 2026-11-19: the grid shows a progress
# ring and names the step): 1 reading text, 2 finding faces, 3 checking old prints, 4 looking for
# duplicates, 5 enhancing; 0 when it's ready. The same tests as PREPARING, in order.
PREPARING_STEP = (
    "(CASE WHEN COALESCE(is_encrypted, 0) = 1 THEN 0 "
    "WHEN ocr_text IS NULL AND COALESCE(mime_type, '') LIKE 'image/%' THEN 1 "
    "WHEN faces_scanned = 0 AND COALESCE(is_document, 0) = 0 THEN 2 "
    "WHEN restore_checked = 0 AND derived_from_id IS NULL AND COALESCE(mime_type, '') LIKE 'image/%' THEN 3 "
    "WHEN phash IS NULL AND thumbnail_path IS NOT NULL THEN 4 "
    "WHEN is_optimized = 0 AND COALESCE(mime_type, '') NOT LIKE 'video/%' THEN 5 "
    "ELSE 0 END)"
)

# A photo still being prepared (P4: the grid's quiet "preparing" dot): any step not done yet,
# 8K included. Plain columns of the photos table, for use in any library query.
PREPARING = (
    "(COALESCE(is_encrypted, 0) = 0 AND ("
    "(ocr_text IS NULL AND COALESCE(mime_type, '') LIKE 'image/%') "
    "OR (faces_scanned = 0 AND COALESCE(is_document, 0) = 0) "
    "OR (restore_checked = 0 AND derived_from_id IS NULL AND COALESCE(mime_type, '') LIKE 'image/%') "
    "OR (phash IS NULL AND thumbnail_path IS NOT NULL) "
    "OR (is_optimized = 0 AND COALESCE(mime_type, '') NOT LIKE 'video/%')))"
)

IDLE_RECHECK_SECONDS = 60  # Also picks up anything a missed wake-up left behind.
BATTERY_RECHECK_SECONDS = 30

state: Dict[str, Any] = {
    "active": False,          # Working on a photo right now.
    "step": None,             # "text" | "faces"
    "photo_id": None,
    "text_waiting": 0,
    "faces_waiting": 0,
    "done_this_run": 0,
    "paused_reason": None,    # "on_battery" | "by_user"
}

_wake: Optional[asyncio.Event] = None
_task: Optional[asyncio.Task] = None


# P4: the last import, for its summary once its photos are ready ("124 added · 18 people ...").
last_import: Dict[str, Any] = {"batch": 0, "ids": []}


def remember_import(photo_ids) -> None:
    ids = [int(i) for i in photo_ids]
    if ids:
        last_import.update(batch=last_import["batch"] + 1, ids=ids)


async def import_summary() -> Optional[Dict[str, Any]]:
    """What the last import brought, once its quick steps (text, faces, rules, duplicates) are
    done; None while it is still being prepared (or when nothing was imported this session).
    8K is not waited for: it takes much longer and changes nothing the summary says."""
    ids = last_import["ids"]
    if not ids:
        return None
    marks = ",".join("?" * len(ids))
    quick = f"({TEXT_WAITING}) OR ({FACES_WAITING}) OR ({RULES_WAITING}) OR ({DUPS_WAITING})"
    async with db_connection() as conn:
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE id IN ({marks}) AND ({quick});", ids) as cur:
            if (await cur.fetchone())[0]:
                return None
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE id IN ({marks}) AND trashed_at IS NULL;", ids) as cur:
            added = (await cur.fetchone())[0]
        async with conn.execute(
            f"SELECT COUNT(DISTINCT COALESCE('p' || person_id, 'c' || cluster_id, 'f' || id)) FROM faces WHERE photo_id IN ({marks});", ids
        ) as cur:
            people = (await cur.fetchone())[0]
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE id IN ({marks}) AND COALESCE(is_document, 0) = 1;", ids) as cur:
            documents = (await cur.fetchone())[0]
        async with conn.execute(
            f"SELECT COUNT(DISTINCT photo_id) FROM restore_jobs WHERE photo_id IN ({marks}) AND origin = 'auto' AND status IN ('queued', 'working', 'done');",
            ids,
        ) as cur:
            improved = (await cur.fetchone())[0]
        async with conn.execute(f"SELECT COUNT(DISTINCT photo_id) FROM duplicate_groups WHERE photo_id IN ({marks});", ids) as cur:
            duplicates = (await cur.fetchone())[0]
    return {"batch": last_import["batch"], "added": added, "people": people, "documents": documents,
            "old_photos": improved, "duplicates": duplicates}


def wake() -> None:
    """New photos (or a changed photo): look for waiting steps now instead of at the next check."""
    if _wake is not None:
        _wake.set()


async def counts() -> Dict[str, int]:
    async with db_connection() as conn:
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE {TEXT_WAITING};") as cur:
            text = (await cur.fetchone())[0]
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE {FACES_WAITING};") as cur:
            faces = (await cur.fetchone())[0]
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE {RULES_WAITING};") as cur:
            rules = (await cur.fetchone())[0]
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE {DUPS_WAITING};") as cur:
            dups = (await cur.fetchone())[0]
    return {"text_waiting": int(text), "faces_waiting": int(faces), "rules_waiting": int(rules), "dups_waiting": int(dups)}


async def fingerprint(photo_id: int) -> None:
    """Step 6: the photo's fingerprint for finding duplicates ('' when it can't be read)."""
    from engine.services.duplicate_service import compute_image_dhash
    from engine.services.media_paths import resolve_stored_path

    async with db_connection() as conn:
        async with conn.execute("SELECT thumbnail_path FROM photos WHERE id = ?;", (photo_id,)) as cur:
            row = await cur.fetchone()
    path = resolve_stored_path(row[0]) if row and row[0] else None
    value = await asyncio.to_thread(compute_image_dhash, str(path)) if path is not None else None
    async with db_connection() as conn:
        await conn.execute("UPDATE photos SET phash = ? WHERE id = ? AND phash IS NULL;", (value or "", photo_id))
        await conn.commit()


async def _hold_reason() -> Optional[str]:
    """Why background work must wait now (Pause all, or the battery setting), or None."""
    from engine.api import photos as photos_api

    if photos_api.enhancement_paused_by_user:
        return "by_user"
    settings = await photos_api._load_enhancement_settings()
    return "on_battery" if photos_api.battery_guard_applies(settings) else None


async def read_text(photo_id: int) -> None:
    """Step 2: reads the text in one photo and marks it a document when it is one."""
    from engine.services import document_service as docs
    from engine.services.media_paths import resolve_stored_path

    async with db_connection() as conn:
        async with conn.execute(
            f"SELECT filename, filepath, preview_path, mime_type, is_document, document_source FROM photos WHERE id = ? AND {_LIBRARY};",
            (photo_id,),
        ) as cur:
            row = await cur.fetchone()
    if row is None:
        return
    filename, filepath, preview, mime_type, is_document, source_of_mark = row
    is_document = is_document or source_of_mark == "user"  # Never against the owner's own choice.
    # The viewer's 2560 px preview reads as well and decodes much faster than an 8K photo.
    source = (resolve_stored_path(preview) if preview else None) or resolve_stored_path(filepath)
    text = await docs.extract_ocr_text_on_device(source) if source is not None else ""
    async with db_connection() as conn:
        await conn.execute("UPDATE photos SET ocr_text = ? WHERE id = ? AND ocr_text IS NULL;", (text or "", photo_id))
        if not is_document and docs.is_candidate_document(filename or "", text, mime_type):
            await conn.execute(
                "UPDATE photos SET is_document = 1, content_tags = COALESCE(content_tags, ?), document_source = 'scan' WHERE id = ?;",
                (docs.classify_document(filename or "", text, mime_type), photo_id),
            )
        await conn.commit()


async def find_faces(photo_id: int) -> int:
    """Step 3: finds the faces in one photo. Returns how many were added."""
    from engine.services import face_scan_worker as faces
    from engine.services.face_recognition_service import get_face_thumbnails_dir

    async with faces._scan_lock:  # Never alongside a full re-scan from People.
        async with db_connection() as conn:
            import aiosqlite

            conn.row_factory = aiosqlite.Row
            async with conn.execute(
                f"""SELECT id, filename, filepath, mime_type, thumbnail_path, preview_path, is_encrypted
                    FROM photos WHERE id = ? AND {FACES_WAITING};""",
                (photo_id,),
            ) as cur:
                row = await cur.fetchone()
            if row is None:  # Done meanwhile (or now a document): nothing to do.
                return 0
            return await faces.scan_photo_faces(conn, row, get_face_thumbnails_dir())


async def _next(condition: str) -> Optional[int]:
    async with db_connection() as conn:
        async with conn.execute(f"SELECT id FROM photos WHERE {condition} ORDER BY id DESC LIMIT 1;") as cur:
            row = await cur.fetchone()
    return int(row[0]) if row else None


async def _faces_ready() -> bool:
    """The face models load (once); False keeps faces waiting (e.g. offline), never skipped."""
    from engine.services.face_recognition_service import get_inference_sessions

    try:
        await asyncio.to_thread(get_inference_sessions)
        return True
    except Exception as err:
        logger.warning("Face models unavailable; faces wait: %s", err)
        return False


async def run_once() -> bool:
    """Does one waiting step for one photo. Returns False when nothing could be done."""
    from engine.services import face_scan_worker as faces

    state.update(await counts())
    photo_id = await _next(TEXT_WAITING)
    if photo_id is not None:
        state.update(active=True, step="text", photo_id=photo_id)
        try:
            await read_text(photo_id)
        except Exception as err:  # Never loop on one photo: record "read, nothing found".
            logger.warning("Couldn't read the text of photo %s: %s", photo_id, err)
            async with db_connection() as conn:
                await conn.execute("UPDATE photos SET ocr_text = '' WHERE id = ? AND ocr_text IS NULL;", (photo_id,))
                await conn.commit()
        state["done_this_run"] += 1
        return True
    photo_id = await _next(FACES_WAITING)
    if photo_id is not None and await _faces_ready():
        state.update(active=True, step="faces", photo_id=photo_id)
        # People shows its "looking for faces" progress from this (feedback R1 #22).
        faces.face_scan_state.update(
            is_scanning=True, total_photos=faces.face_scan_state.get("scanned_photos", 0) + state["faces_waiting"], error=None
        )
        added = await find_faces(photo_id)
        faces.face_scan_state["scanned_photos"] = faces.face_scan_state.get("scanned_photos", 0) + 1
        faces.face_scan_state["faces_found"] = faces.face_scan_state.get("faces_found", 0) + added
        state["done_this_run"] += 1
        state["faces_dirty"] = True
        return True
    photo_id = await _next(RULES_WAITING)
    if photo_id is not None:
        from engine.services import old_photo_rules

        state.update(active=True, step="rules", photo_id=photo_id)
        await old_photo_rules.check_photo(photo_id)  # Always records that it looked.
        state["done_this_run"] += 1
        state["rules_done"] = True
        return True
    photo_id = await _next(DUPS_WAITING)
    if photo_id is not None:
        state.update(active=True, step="duplicates", photo_id=photo_id)
        await fingerprint(photo_id)
        state["done_this_run"] += 1
        state["dups_dirty"] = True
        return True
    return False


async def finish_run() -> None:
    """After a run: regroup duplicates once, suggest the new photos' stories, and the day's."""
    from engine.services import stories_planner

    if state.pop("dups_dirty", False):
        from engine.services.duplicate_service import scan_and_cluster_duplicates

        try:
            async with db_connection() as conn:
                await scan_and_cluster_duplicates(conn)
        except Exception as err:
            logger.warning("Finding duplicates failed: %s", err)
    if state.pop("rules_done", False):  # New photos were prepared.
        _start_enhancement()  # Photos the rules passed (and their copies, later) go on to 8K.
        try:
            await stories_planner.after_import()
        except Exception as err:
            logger.warning("Suggesting stories failed: %s", err)
    try:
        await stories_planner.daily_if_due()
    except Exception as err:
        logger.warning("The day's stories failed: %s", err)


async def _finish_faces() -> None:
    """After a run of faces: group them once (not after every photo)."""
    from engine.services import face_scan_worker as faces
    from engine.services.face_clustering_service import recluster_all_faces

    if state.pop("faces_dirty", False):
        try:
            await recluster_all_faces()
        except Exception as err:
            logger.warning("Grouping faces failed: %s", err)
    faces.face_scan_state.update(is_scanning=False, current_photo=None, scanned_photos=0, faces_found=0, total_photos=0)


async def worker_loop() -> None:
    global _wake
    _wake = asyncio.Event()
    while True:
        try:
            reason = await _hold_reason()
            state["paused_reason"] = reason
            if reason:
                state.update(active=False, step=None, photo_id=None)
                await asyncio.sleep(BATTERY_RECHECK_SECONDS if reason == "on_battery" else 2)
                continue
            if await run_once():
                await asyncio.sleep(0)
                continue
            await _finish_faces()
            await finish_run()
            state.update(active=False, step=None, photo_id=None, done_this_run=0, **(await counts()))
            _wake.clear()
            try:
                await asyncio.wait_for(_wake.wait(), timeout=IDLE_RECHECK_SECONDS)
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            break
        except Exception as err:  # Keep going; the next round tries again.
            logger.error("After-import step failed: %s", err, exc_info=True)
            state.update(active=False, step=None, photo_id=None)
            await asyncio.sleep(5)


def _start_enhancement() -> None:
    from engine.api import photos as photos_api

    if not photos_api.optimization_state["is_active"]:
        asyncio.get_running_loop().create_task(photos_api.run_background_optimization())


def start() -> None:
    """Starts the worker once (engine start)."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(worker_loop())
