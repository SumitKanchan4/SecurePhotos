"""Old-photo improvements: queue, Activity feed and model files (H10 / A2a).

The viewer and selection bar queue jobs; the Activity screen polls ``GET /jobs``.
Keep / replace / discard of a finished result arrives with versions (A2b).
"""

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from engine.services import ai_models, restore_queue

router = APIRouter(prefix="/api/restore", tags=["Old photos"])

_download_task: Optional[asyncio.Task] = None


class QueueRequest(BaseModel):
    photo_ids: List[int] = Field(..., min_length=1, max_length=5000)
    kind: str
    params: Dict[str, Any] = Field(default_factory=dict)


@router.post("/jobs")
async def queue_jobs(payload: QueueRequest) -> Dict[str, Any]:
    """Queues one improvement for one or more photos (the user asked for it).

    409 ``models_missing`` when a model it needs isn't on this computer: the app asks
    before downloading it (A2c), so nothing is queued that can't run.
    """
    if payload.kind in restore_queue.KINDS and await asyncio.to_thread(restore_queue.missing_for, payload.kind):
        raise HTTPException(status_code=409, detail="models_missing")
    try:
        ids = await restore_queue.enqueue(payload.photo_ids, payload.kind, payload.params, origin="manual")
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"job_ids": ids}


@router.get("/jobs")
async def list_jobs() -> Dict[str, Any]:
    """Working, waiting, waiting-for-review and finished-today jobs (vault ones flagged private)."""
    return await restore_queue.list_jobs()


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: int) -> Dict[str, bool]:
    if not await restore_queue.cancel(job_id):
        raise HTTPException(status_code=404, detail="Nothing to cancel.")
    return {"cancelled": True}


class KeepRequest(BaseModel):
    choice: str  # "keep_both" | "replace" | "discard"
    remember: bool = False
    intensity: float = Field(1.0, ge=0.0, le=1.0)  # The viewer's strength slider.
    faces_off: List[int] = Field(default_factory=list, max_length=500)  # Faces switched off in the viewer (A5).


@router.post("/jobs/{job_id}/keep")
async def keep_job_result(job_id: int, payload: KeepRequest) -> Dict[str, Any]:
    """The user's decision after seeing the result: keep both, replace the photo, or discard."""
    from engine.services.photo_versions import VersionError

    try:
        return await restore_queue.keep_result(job_id, payload.choice, payload.remember, payload.intensity, payload.faces_off)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except VersionError as err:
        raise HTTPException(status_code=409, detail=str(err))


def _face_indices(text: str) -> List[int]:
    try:
        return sorted({int(x) for x in text.split(",") if x.strip()})[:500]
    except ValueError:
        raise HTTPException(status_code=400, detail="faces_off must be face numbers, e.g. 0,2")


@router.get("/jobs/{job_id}/result")
async def job_result(job_id: int, faces_off: str = "") -> Response:
    """The finished result waiting for a decision, for the viewer's before/after (never cached).
    ``faces_off=0,2`` shows it with those faces left as they were (the per-face switch)."""
    import aiosqlite

    from engine.database import db_connection
    from engine.services import photo_versions

    off = _face_indices(faces_off)
    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT j.*, p.is_encrypted FROM restore_jobs j JOIN photos p ON p.id = j.photo_id WHERE j.id = ?;",
            (job_id,),
        ) as cur:
            job = await cur.fetchone()
        if job is None or job["status"] != "review":
            raise HTTPException(status_code=404, detail="No result is waiting.")
        key = restore_queue._vault_key() if job["is_encrypted"] else None
        if job["is_encrypted"] and key is None:
            raise HTTPException(status_code=409, detail="vault_locked")
        try:
            data = await restore_queue.result_image(conn, job, key, off)
        except photo_versions.VersionError as err:
            raise HTTPException(status_code=404, detail=str(err))
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/photos/{photo_id}/state")
async def photo_state(photo_id: int) -> Dict[str, Any]:
    """Everything the viewer needs for one photo in one request: which improvements fit, its
    Original / Improved family, and any job for it that is still open (waiting, working, review)."""
    from engine.database import db_connection
    from engine.services import photo_versions

    try:
        options = await photo_options(photo_id)
    except HTTPException as err:
        if err.status_code != 409:
            raise
        options = {"colour": False, "fade": False, "faces": False, "scratches": False}  # Vault locked: nothing to offer until it opens.
    async with db_connection() as conn:
        try:
            family = await photo_versions.versions_of(conn, photo_id)
        except photo_versions.VersionError as err:
            raise HTTPException(status_code=404, detail=str(err))
    jobs = await restore_queue.list_jobs()
    open_job = next((j for j in jobs["working"] + jobs["waiting"] + jobs["review"] if j["photo_id"] == photo_id), None)
    return {"options": options, "downloads": await _downloads_for(options), "members": family["members"], "job": open_job}


async def _downloads_for(options: Dict[str, Any]) -> Dict[str, int]:
    """For each offered improvement whose models aren't here yet: the bytes to download.
    The viewer shows those as locked until the user agrees to the download."""
    needed: Dict[str, int] = {}
    for kind, offered in options.items():
        if offered:
            missing = await asyncio.to_thread(restore_queue.missing_for, kind)
            if missing:
                needed[kind] = ai_models.download_size(missing)
    return needed


@router.get("/photos/{photo_id}/options")
async def photo_options(photo_id: int) -> Dict[str, Any]:
    """Which improvements fit this photo: "Add colour" for grey photos, "Fix faded colours" otherwise,
    "Sharpen faces" when it has faces (found on the 1024 px thumbnail), and "Remove scratches
    and spots" for scans of prints (no camera exposure data) and black-and-white photos.
    None for an original that already has an improved copy (A8): improve the copy instead."""
    from engine.database import db_connection
    from engine.services import photo_versions
    from engine.services.face_sharpen import count_faces
    from engine.services.old_photo_processors import decode_rgb, is_black_and_white

    async with db_connection() as conn:
        async with conn.execute(
            "SELECT thumbnail_path, filepath, is_encrypted, mime_type, ai_kind, iso, aperture, shutter_speed,"
            " EXISTS (SELECT 1 FROM photos c WHERE c.derived_from_id = photos.id AND c.trashed_at IS NULL)"
            " FROM photos WHERE id = ? AND trashed_at IS NULL;",
            (photo_id,),
        ) as cur:
            row = await cur.fetchone()
    if row is None or (row[3] or "").startswith("video/"):
        raise HTTPException(status_code=404, detail="Not a photo.")
    if row[8]:  # A8: already improved; the improved photo is where to go on (no second copy).
        return {"colour": False, "fade": False, "faces": False, "scratches": False}
    key = restore_queue._vault_key() if row[2] else None
    if row[2] and key is None:
        raise HTTPException(status_code=409, detail="vault_locked")
    try:
        data = await asyncio.to_thread(photo_versions.read_photo_bytes, row[0] or row[1], bool(row[2]), key)
        rgb = await asyncio.to_thread(decode_rgb, data)
        grey = await asyncio.to_thread(is_black_and_white, rgb)
    except Exception:
        raise HTTPException(status_code=404, detail="The photo can't be read.")
    done = set(filter(None, (row[4] or "").split(",")))
    try:
        # Small on the thumbnail is fine: a 40 px face in a 3500 px scan is ~12 px here.
        has_faces = "faces" not in done and await asyncio.to_thread(count_faces, rgb, 10) > 0
    except Exception:  # Face models unavailable: just don't offer it.
        has_faces = False
    del rgb
    # An AI-coloured copy is a colour photo now, but "fixing its faded colours" makes no sense.
    return {
        "colour": grey and "colour" not in done,
        "fade": not grey and not done & {"fade", "colour"},
        "faces": has_faces,
        "scratches": "scratches" not in done and (grey or (row[5] is None and row[6] is None and row[7] is None)),
    }


@router.get("/photos/{photo_id}/versions")
async def photo_versions_list(photo_id: int) -> Dict[str, Any]:
    """The original and its improved copies, for the viewer's Original / Improved switch."""
    from engine.database import db_connection
    from engine.services import photo_versions

    async with db_connection() as conn:
        try:
            return await photo_versions.versions_of(conn, photo_id)
        except photo_versions.VersionError as err:
            raise HTTPException(status_code=404, detail=str(err))


@router.post("/photos/{photo_id}/restore-original")
async def restore_original(photo_id: int) -> Dict[str, int]:
    """Brings the original of an improved photo back from Trash, still linked."""
    from engine.database import db_connection
    from engine.services import photo_versions

    async with db_connection() as conn:
        try:
            return {"original_id": await photo_versions.restore_original(conn, photo_id)}
        except photo_versions.VersionError as err:
            raise HTTPException(status_code=404, detail=str(err))


class ChoiceRequest(BaseModel):
    photo_ids: List[int] = Field(..., min_length=1, max_length=5000)  # Improved copies.
    choice: str  # "keep_improved" | "keep_both" | "keep_original"


@router.post("/choices")
async def choose_versions(payload: ChoiceRequest) -> Dict[str, int]:
    """A8: what to keep of improved photos the app kept automatically (one pair or many)."""
    from engine.database import db_connection
    from engine.services import photo_versions

    async with db_connection() as conn:
        try:
            return {"applied": await photo_versions.choose(conn, payload.photo_ids, payload.choice)}
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))


@router.post("/pause")
async def pause() -> Dict[str, bool]:
    restore_queue.pause()
    return {"paused": True}


@router.post("/resume")
async def resume() -> Dict[str, bool]:
    restore_queue.resume()
    return {"paused": False}


@router.get("/models")
async def models_status() -> Dict[str, Any]:
    """Which old-photo models are on this computer, and any download in progress."""
    items = []
    for key, spec in ai_models.ON_DEMAND_MODELS.items():
        ready = await asyncio.to_thread(ai_models.is_model_ready, key)
        items.append({"key": key, "file": spec["file"], "size": int(spec["size"]), "license": spec["license"], "ready": ready})
    return {"models": items, "download": restore_queue.state["download"], "result": restore_queue.state["download_result"]}


class DownloadRequest(BaseModel):
    kind: Optional[str] = None  # Only the models this improvement needs; all when omitted.


@router.post("/models/download")
async def download_models(payload: Optional[DownloadRequest] = None) -> Dict[str, Any]:
    """Starts fetching missing models in the background, after the user agreed in the app's
    popup (progress in ``GET /models``). Only the app's own pinned files can be fetched."""
    global _download_task
    kind = payload.kind if payload else None
    if kind is not None and kind not in restore_queue.KINDS:
        raise HTTPException(status_code=400, detail="Unknown improvement.")
    keys = list(restore_queue.models_for(kind)) if kind else list(ai_models.ON_DEMAND_MODELS)
    if _download_task is None or _download_task.done():
        restore_queue.state["download_result"] = None
        _download_task = asyncio.create_task(restore_queue.download_models(keys))
    return {"started": True, "bytes": ai_models.download_size(await asyncio.to_thread(ai_models.missing_models, keys))}


@router.post("/models/cancel-download")
async def cancel_download() -> Dict[str, bool]:
    restore_queue.cancel_download()
    return {"cancelling": True}


@router.get("/jobs/{job_id}/mask")
async def job_mask(job_id: int) -> Response:
    """The damage marks of a "Remove scratches and spots" result (white = repaired), for the
    viewer's "Show marks" and Touch up. Never cached."""
    import aiosqlite

    from engine.database import db_connection
    from engine.services import photo_versions
    from engine.services.media_paths import to_db_path

    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT j.status, j.kind, j.result_path, p.is_encrypted FROM restore_jobs j JOIN photos p ON p.id = j.photo_id WHERE j.id = ?;",
            (job_id,),
        ) as cur:
            job = await cur.fetchone()
    if job is None or job["status"] != "review" or job["kind"] != "scratches":
        raise HTTPException(status_code=404, detail="No marks for this result.")
    key = restore_queue._vault_key() if job["is_encrypted"] else None
    if job["is_encrypted"] and key is None:
        raise HTTPException(status_code=409, detail="vault_locked")
    stored = to_db_path(restore_queue._extra_path(restore_queue.resolve_stored_path(job["result_path"])))
    try:
        data = await asyncio.to_thread(photo_versions.read_photo_bytes, stored, bool(job["is_encrypted"]), key)
    except photo_versions.VersionError as err:
        raise HTTPException(status_code=404, detail=str(err))
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "no-store"})


MAX_MASK_BYTES = 8 * 1024 * 1024


class TouchUpRequest(BaseModel):
    mask_png: str = Field(..., max_length=MAX_MASK_BYTES * 4 // 3 + 8)  # base64; white = repair.


@router.post("/jobs/{job_id}/touch-up")
async def touch_up(job_id: int, payload: TouchUpRequest) -> Dict[str, int]:
    """Touch up: repair again with the marks the user painted. The old result is discarded
    and a new job (same photo) uses exactly these marks."""
    import base64
    import io

    import aiosqlite
    from PIL import Image

    from engine.database import db_connection

    try:
        data = base64.b64decode(payload.mask_png, validate=True)
        with Image.open(io.BytesIO(data)) as im:
            if im.format != "PNG" or max(im.size) > 8192:
                raise ValueError("not a mask")
            im.load()
    except Exception:
        raise HTTPException(status_code=400, detail="The marks must be a PNG picture.")
    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT j.status, j.kind, j.photo_id, p.is_encrypted FROM restore_jobs j JOIN photos p ON p.id = j.photo_id WHERE j.id = ?;",
            (job_id,),
        ) as cur:
            job = await cur.fetchone()
    if job is None or job["status"] != "review" or job["kind"] != "scratches":
        raise HTTPException(status_code=404, detail="No result to touch up.")
    key = restore_queue._vault_key() if job["is_encrypted"] else None
    if job["is_encrypted"] and key is None:
        raise HTTPException(status_code=409, detail="vault_locked")
    token = await asyncio.to_thread(restore_queue.stage_mask, data, key)
    await restore_queue.keep_result(job_id, "discard")
    (new_id,) = await restore_queue.enqueue([job["photo_id"]], "scratches", {"mask_in": token}, origin="manual")
    return {"job_id": new_id}
