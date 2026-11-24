"""Background queue for improving old photos (H10 / A2a).

The user asks to improve a photo ("Add colour", "Fix faded colours", "Sharpen faces",
"Remove scratches and spots") or the automatic rules do it after import (A6). Each request
is a row in ``restore_jobs``; one worker runs them one at a time on the CPU, so the
app stays responsive and memory stays bounded (one large model loaded, see
``onnx_sessions``).

Flow of one job::

    queued -> working -> review   (result staged) -> done (kept) | discarded
                                  automatic jobs skip the question: "Keep original" decides
                      -> failed    (error_message says why; e.g. "models_missing")
    queued | working | review -> cancelled

Rules:
- Jobs that use the same model run back to back, so a model loads once per batch.
- Pause / resume by the user. Automatic jobs wait while the laptop runs on battery (the
  existing "pause on battery" setting); photos the user asked for run anyway, first.
- Vault photos are processed only while the vault is unlocked, decrypted in memory only,
  and their staged result is written encrypted. If the vault locks mid-job, the result is
  dropped and the job waits for the next unlock.
- After a crash, ``working`` jobs go back to ``queued`` and stray staging files are removed.
- The queue never downloads a model by itself (A2c): the installer fetches them, and the app
  asks before downloading one that is missing. A job whose model isn't there fails with
  ``models_missing`` (Activity: "Needs a download").

The actual image work for each kind is plugged in with :func:`register_processor`
(A3 colour + faded colours, A5 faces, A7 scratches), so this module has no model code.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

import aiosqlite

from engine.config import settings
from engine.database import db_connection
from engine.services import ai_models, onnx_sessions
from engine.services.media_paths import ENC_SUFFIX, resolve_stored_path, to_db_path

logger = logging.getLogger("securephotos.restore_queue")

KINDS = ("colour", "fade", "faces", "scratches")
ORIGINS = ("manual", "auto")
OPEN_STATUSES = ("queued", "working")
IDLE_SECONDS = 2.0

# Progress callback (0-100) and "should I stop?" check handed to a processor.
ProgressFn = Callable[[int], None]
CancelledFn = Callable[[], bool]


@dataclass(frozen=True)
class Processor:
    """How one kind of improvement is done.

    Attributes:
        models: On-demand model keys it needs (a job fails with "models_missing" without them).
        run: ``run(image_bytes, params, progress, cancelled) -> result_bytes | Outcome``. Runs
            on a worker thread; must return an encoded image (the original file stays untouched).
    """

    models: Sequence[str]
    run: Callable[[bytes, Dict[str, Any], ProgressFn, CancelledFn], Any]


@dataclass
class Outcome:
    """A result with more than the image (A5: the faces that were sharpened).

    Attributes:
        image: The encoded result.
        info: Small JSON-able details for the viewer, e.g. ``{"faces": [...], "width", "height"}``.
            Kept in the database for library photos, in memory only for vault photos.
        extra: Bytes staged next to the result (encrypted for vault photos), e.g. the sharpened
            faces, so single faces can be switched off before keeping.
    """

    image: bytes
    info: Dict[str, Any] = field(default_factory=dict)
    extra: Optional[bytes] = None


PROCESSORS: Dict[str, Processor] = {}

state: Dict[str, Any] = {
    "paused": False,          # Paused by the user.
    "paused_reason": None,    # "on_battery" while waiting for the charger.
    "active_job_id": None,
    "download": None,         # {"model": key, "done": bytes, "total": bytes} for the whole download.
    "download_result": None,  # "done" | "failed" | "cancelled" once the last download ended.
}
_progress: Dict[int, int] = {}
_private_info: Dict[int, Dict[str, Any]] = {}  # Outcome.info of vault jobs: never written in plain form.
_cancel_requested: set = set()
_download_cancel = threading.Event()
_wake: Optional[asyncio.Event] = None
_worker_task: Optional[asyncio.Task] = None


class JobCancelled(Exception):
    """The user cancelled the job while it was running."""


def register_processor(kind: str, processor: Processor) -> None:
    """Plugs in the code that performs ``kind`` (called by each feature at import)."""
    if kind not in KINDS:
        raise ValueError(f"Unknown improvement {kind!r}")
    PROCESSORS[kind] = processor


def staging_dir() -> Path:
    """Where finished results wait for the user's keep / replace / discard."""
    return settings.data_dir / "restore_staging"


def _wake_worker() -> None:
    if _wake is not None:
        _wake.set()


def _vault_key() -> Optional[bytes]:
    """The vault key if the vault is open, without counting as user activity."""
    from engine.api.vault import peek_active_mvk

    return peek_active_mvk()


# ── Queueing ────────────────────────────────────────────────────────────────


async def enqueue(photo_ids: Iterable[int], kind: str, params: Optional[Dict[str, Any]] = None, origin: str = "manual") -> List[int]:
    """Adds one job per photo. A photo that already has the same kind queued or working is not added twice.

    Photos that are missing, in Trash or videos are skipped.

    Returns:
        The job ids (existing ones for duplicates), in the order of ``photo_ids``.

    Raises:
        ValueError: Unknown ``kind`` or ``origin``.
    """
    if kind not in KINDS:
        raise ValueError(f"Unknown improvement {kind!r}")
    if origin not in ORIGINS:
        raise ValueError(f"Unknown origin {origin!r}")
    params_json = json.dumps(params or {}, sort_keys=True)
    ids: List[int] = []
    async with db_connection() as conn:
        for photo_id in dict.fromkeys(int(p) for p in photo_ids):
            async with conn.execute(
                "SELECT 1 FROM photos WHERE id = ? AND trashed_at IS NULL AND (mime_type IS NULL OR mime_type NOT LIKE 'video/%');",
                (photo_id,),
            ) as cur:
                if await cur.fetchone() is None:
                    continue
            async with conn.execute(
                "SELECT id FROM restore_jobs WHERE photo_id = ? AND kind = ? AND status IN ('queued', 'working');",
                (photo_id, kind),
            ) as cur:
                existing = await cur.fetchone()
            if existing:
                ids.append(existing[0])
                continue
            cur = await conn.execute(
                "INSERT INTO restore_jobs (photo_id, kind, params, origin) VALUES (?, ?, ?, ?);",
                (photo_id, kind, params_json, origin),
            )
            ids.append(cur.lastrowid)
        await conn.commit()
    _wake_worker()
    return ids


def _extra_path(result: Path) -> Path:
    """The file staged next to a result (Outcome.extra: sharpened faces, or the damage marks):
    ``job_7.img`` -> ``job_7.extra``; ``job_7.enc`` -> ``job_7.extra.enc``."""
    if result.name.endswith(ENC_SUFFIX):
        return result.with_name(result.name[: -len(ENC_SUFFIX)] + ".extra" + ENC_SUFFIX)
    return result.with_name(result.stem + ".extra")


MASK_TOKEN_CHARS = set("0123456789abcdef")


def mask_in_path(token: str, private: bool) -> Path:
    """Where a Touch-up mask waits for its job (encrypted for vault photos)."""
    if len(token) != 32 or not set(token) <= MASK_TOKEN_CHARS:
        raise ValueError("Bad mask reference.")
    return staging_dir() / (f"mask_{token}.png" + (ENC_SUFFIX if private else ""))


def stage_mask(data: bytes, key: Optional[bytes]) -> str:
    """Stores a painted mask for a new job; returns the token to put in the job's params."""
    import secrets

    token = secrets.token_hex(16)
    _write_staged(0, data, key, mask_in_path(token, key is not None))
    return token


def _read_mask(token: str, key: Optional[bytes]) -> bytes:
    path = mask_in_path(token, key is not None)
    if key is not None:
        from engine.services.crypto_vault import decrypt_file_to_bytes

        return decrypt_file_to_bytes(path, key)
    return path.read_bytes()


def _drop_mask(params_json: Optional[str]) -> None:
    try:
        token = json.loads(params_json or "{}").get("mask_in")
    except ValueError:
        return
    if token:
        for private in (False, True):
            try:
                mask_in_path(token, private).unlink(missing_ok=True)
            except ValueError:
                return


def _remove_staged(stored: Optional[str]) -> None:
    path = resolve_stored_path(stored) if stored else None
    if path is not None:
        path.unlink(missing_ok=True)
        _extra_path(path).unlink(missing_ok=True)


async def cancel(job_id: int) -> bool:
    """Cancels a job. A queued or waiting-for-review job stops at once (its staged result is
    deleted); a working job stops at its next checkpoint.

    Returns:
        False if the job doesn't exist or is already finished.
    """
    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT status, result_path, params FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
            row = await cur.fetchone()
        if row is None or row["status"] not in ("queued", "working", "review"):
            return False
        if row["status"] == "working":
            _cancel_requested.add(job_id)
            return True
        _remove_staged(row["result_path"])
        _drop_mask(row["params"])
        _private_info.pop(job_id, None)
        await conn.execute(
            "UPDATE restore_jobs SET status = 'cancelled', result_path = NULL, result_info = NULL, updated_at = CURRENT_TIMESTAMP, "
            "finished_at = CURRENT_TIMESTAMP WHERE id = ?;",
            (job_id,),
        )
        await conn.commit()
        return True


def pause() -> None:
    """Pauses the queue after the current photo (nothing is lost)."""
    state["paused"] = True


def resume() -> None:
    """Resumes a paused queue."""
    state["paused"] = False
    _wake_worker()


def cancel_download() -> None:
    """Stops a model download in progress."""
    _download_cancel.set()


# ── Listing (Activity screen) ───────────────────────────────────────────────


def _job_view(row: aiosqlite.Row) -> Dict[str, Any]:
    private = bool(row["is_encrypted"])
    return {
        "id": row["id"],
        "photo_id": row["photo_id"],
        "kind": row["kind"],
        "origin": row["origin"],
        "status": row["status"],
        "progress": _progress.get(row["id"], row["progress"]),
        "private": private,                                   # The UI blurs it and shows no name.
        "filename": None if private else row["filename"],
        "error": row["error_message"],
        "result_photo_id": row["result_photo_id"],
        **_faces_view(row["id"], row["status"], row["result_info"], private),
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


def result_info(job_id: int, stored: Optional[str], private: bool) -> Dict[str, Any]:
    """The Outcome.info of a result waiting for a decision ({} if none)."""
    if private:
        return _private_info.get(job_id, {})
    try:
        return json.loads(stored) if stored else {}
    except ValueError:
        return {}


def _faces_view(job_id: int, status: str, stored: Optional[str], private: bool) -> Dict[str, Any]:
    """For the viewer: each face as a box in 0-1 of the image and whether it was sharpened;
    ``faces_waiting``: faces that could be sharpened once the face model is downloaded."""
    if status != "review":
        return {"faces": [], "faces_waiting": 0, "marked": None}
    info = result_info(job_id, stored, private)
    w, h = float(info.get("width") or 1), float(info.get("height") or 1)
    faces = [
        {"box": [round(b[0] / w, 4), round(b[1] / h, 4), round(b[2] / w, 4), round(b[3] / h, 4)], "sharpened": f["strength"] > 0}
        for f in info.get("faces", [])
        for b in [f["box"]]
    ]
    return {"faces": faces, "faces_waiting": int(info.get("faces_waiting", 0)), "marked": info.get("marked")}


CHOICES_LISTED = 60  # Activity shows this many "choose what to keep" tiles; the count covers all.


async def list_jobs() -> Dict[str, Any]:
    """Everything the Activity screen shows for old-photo work."""
    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            """
            SELECT j.*, p.filename, p.is_encrypted FROM restore_jobs j JOIN photos p ON p.id = j.photo_id
            WHERE j.status IN ('queued', 'working', 'review')
               OR (j.finished_at IS NOT NULL AND date(j.finished_at, 'localtime') = date('now', 'localtime'))
            ORDER BY j.created_at, j.id;
            """
        ) as cur:
            rows = [_job_view(r) for r in await cur.fetchall()]
        from engine.services.photo_versions import count_pending_choices, pending_choices

        conn.row_factory = None
        choices = await pending_choices(conn, CHOICES_LISTED)
        choices_total = await count_pending_choices(conn) if len(choices) >= CHOICES_LISTED else len(choices)
    return {
        # A8: improved photos kept automatically, waiting for "improved, original or both".
        "choices": choices,
        "choices_total": choices_total,
        "working": [r for r in rows if r["status"] == "working"],
        "waiting": [r for r in rows if r["status"] == "queued"],
        "review": [r for r in rows if r["status"] == "review"],
        "finished_today": [r for r in rows if r["status"] in ("done", "discarded", "failed", "cancelled")],
        "paused": state["paused"],
        "paused_reason": state["paused_reason"],
        "download": state["download"],
    }


# ── Worker ──────────────────────────────────────────────────────────────────


async def recover_on_start() -> None:
    """After a crash or restart: unfinished jobs go back to the queue; stray staged files are removed."""
    async with db_connection() as conn:
        await conn.execute("UPDATE restore_jobs SET status = 'queued', progress = 0 WHERE status = 'working';")
        await conn.commit()
        async with conn.execute("SELECT result_path FROM restore_jobs WHERE status = 'review' AND result_path IS NOT NULL;") as cur:
            keep = set()
            for (stored,) in await cur.fetchall():
                keep.add(stored)
                resolved = resolve_stored_path(stored)
                if resolved is not None:
                    keep.add(to_db_path(_extra_path(resolved)))
        async with conn.execute("SELECT params FROM restore_jobs WHERE status = 'queued' AND params LIKE '%mask_in%';") as cur:
            for (params,) in await cur.fetchall():
                token = json.loads(params or "{}").get("mask_in", "")
                for private in (False, True):
                    try:
                        keep.add(to_db_path(mask_in_path(token, private)))
                    except ValueError:
                        pass
    folder = staging_dir()
    if folder.is_dir():
        for path in folder.iterdir():
            if to_db_path(path) not in keep:
                path.unlink(missing_ok=True)


async def _holding_auto_jobs() -> bool:
    """True while automatic jobs must wait: on battery with "pause on battery" on.

    Photos the user asked to improve run anyway; only background (automatic) work waits.
    """
    from engine.api import photos as photos_api

    from engine.services import computers

    app_settings = await photos_api._load_enhancement_settings()
    return computers.hold_reason() is not None or photos_api.battery_guard_applies(app_settings)


async def _plain_photos_first() -> bool:
    """True while plain photos are getting 8K (they need far less work than an old print)."""
    from engine.api import photos as photos_api

    return await photos_api.plain_photos_first()


async def _next_job(conn: aiosqlite.Connection, vault_open: bool, auto_allowed: bool = True) -> Optional[aiosqlite.Row]:
    """Oldest queued job, preferring one that uses the model already in memory.

    Vault photos are skipped while the vault is locked (they wait for the next unlock).
    Automatic jobs are skipped while ``auto_allowed`` is False (on battery).
    Kinds with no processor yet are skipped (their feature isn't installed).
    """
    kinds = [k for k in KINDS if k in PROCESSORS]
    if not kinds:
        return None
    loaded = onnx_sessions.loaded_model()
    same_model = [k for k in kinds if loaded in PROCESSORS[k].models]
    marks = ",".join("?" * len(kinds))
    prefer = ",".join("?" * len(same_model)) if same_model else "''"
    conn.row_factory = aiosqlite.Row
    async with conn.execute(
        f"""
        SELECT j.*, p.filepath, p.is_encrypted FROM restore_jobs j JOIN photos p ON p.id = j.photo_id
        WHERE j.status = 'queued' AND j.kind IN ({marks}) AND (? OR p.is_encrypted = 0)
          AND (? OR j.origin = 'manual')
        ORDER BY (j.origin = 'manual') DESC, (j.kind IN ({prefer})) DESC, j.created_at, j.id
        LIMIT 1;
        """,
        (*kinds, 1 if vault_open else 0, 1 if auto_allowed else 0, *same_model),
    ) as cur:
        return await cur.fetchone()


async def _set(conn: aiosqlite.Connection, job_id: int, **fields: Any) -> None:
    sets = ", ".join(f"{k} = ?" for k in fields)
    finished = ", finished_at = CURRENT_TIMESTAMP" if fields.get("status") in ("review", "done", "discarded", "failed", "cancelled") else ""
    await conn.execute(
        f"UPDATE restore_jobs SET {sets}, updated_at = CURRENT_TIMESTAMP{finished} WHERE id = ?;",
        (*fields.values(), job_id),
    )
    await conn.commit()


def models_for(kind: str) -> Sequence[str]:
    """The on-demand models an improvement needs (none for a non-AI fix)."""
    processor = PROCESSORS.get(kind)
    return tuple(processor.models) if processor else ()


def missing_for(kind: str) -> List[str]:
    """Models still to download before ``kind`` can run (may hash a file once: call in a thread)."""
    return ai_models.missing_models(models_for(kind))


async def download_models(keys: Sequence[str]) -> bool:
    """Downloads missing models with progress, after the user agreed. Progress covers the
    whole download (all missing models). False if a download failed or was cancelled."""
    missing = await asyncio.to_thread(ai_models.missing_models, keys)
    _download_cancel.clear()
    state["download_result"] = None
    total = ai_models.download_size(missing)
    before = 0
    try:
        for key in missing:
            state["download"] = {"model": key, "done": before, "total": total}

            def progress(done: int, _total: int, _key: str = key, _before: int = before) -> None:
                state["download"] = {"model": _key, "done": min(total, _before + done), "total": total}

            try:
                await asyncio.to_thread(ai_models.fetch_on_demand, key, None, progress, _download_cancel)
            except ai_models.DownloadCancelled:
                state["download_result"] = "cancelled"
                return False
            except Exception as err:  # Offline, repo not public yet, bad checksum.
                logger.warning("Could not get model %s: %s", key, err)
                state["download_result"] = "failed"
                return False
            before += int(ai_models.ON_DEMAND_MODELS[key]["size"])
    finally:
        state["download"] = None
    state["download_result"] = "done"
    return True


def _read_photo(row: aiosqlite.Row, key: Optional[bytes]) -> bytes:
    path = resolve_stored_path(row["filepath"])
    if path is None:
        raise FileNotFoundError("The photo's file is missing.")
    if row["is_encrypted"]:
        from engine.services.crypto_vault import decrypt_file_to_bytes

        return decrypt_file_to_bytes(path, key)  # Memory only; never written in plain form.
    return path.read_bytes()


def _write_staged(job_id: int, data: bytes, key: Optional[bytes], dest: Optional[Path] = None) -> Path:
    folder = staging_dir()
    folder.mkdir(parents=True, exist_ok=True)
    if key is not None:
        from engine.services.crypto_vault import encrypt_file_chunked

        dest = dest or folder / f"job_{job_id}{ENC_SUFFIX}"
        encrypt_file_chunked(data, dest, key)  # Temp + fsync + rename inside.
        return dest
    dest = dest or folder / f"job_{job_id}.img"
    tmp = dest.with_name(dest.name + ".tmp")
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, dest)
    return dest


async def process_next_job() -> bool:
    """Runs the next queued job to the end. Returns False when there was nothing to do."""
    if state["paused"]:
        return False
    async with db_connection() as conn:
        key = _vault_key()
        hold_auto = await _holding_auto_jobs()
        # Quick wins first (owner, 2026-11-18): automatic fixes wait while plain photos get 8K.
        quick_first = not hold_auto and await _plain_photos_first()
        job = await _next_job(conn, key is not None, auto_allowed=not hold_auto and not quick_first)
        if hold_auto:
            async with conn.execute("SELECT 1 FROM restore_jobs WHERE status = 'queued' AND origin = 'auto' LIMIT 1;") as cur:
                if await cur.fetchone():
                    from engine.services import computers

                    state["paused_reason"] = computers.hold_reason() or "on_battery"
                else:
                    state["paused_reason"] = None
        else:
            state["paused_reason"] = None
        if job is None:
            return False
        job_id, processor = job["id"], PROCESSORS[job["kind"]]
        private = bool(job["is_encrypted"])
        if not private:
            key = None

        if await asyncio.to_thread(ai_models.missing_models, processor.models):
            await _set(conn, job_id, status="failed", error_message="models_missing")
            return True

        # One heavy job at a time (owner D2): what the user asked for goes first, then automatic
        # fixes (before 8K). The job shows "waiting" until it has the slot.
        from engine.services import cpu_budget

        slot = contextlib.AsyncExitStack()
        await slot.enter_async_context(
            cpu_budget.heavy(cpu_budget.USER if job["origin"] == "manual" else cpu_budget.AUTO_RESTORE, f"restore:{job_id}")
        )
        try:
            await _set(conn, job_id, status="working", progress=0)
        except BaseException:
            await slot.aclose()
            raise
        state["active_job_id"] = job_id
        _progress[job_id] = 0

        def progress(value: int) -> None:
            _progress[job_id] = max(0, min(100, int(value)))

        def cancelled() -> bool:
            return job_id in _cancel_requested or (private and _vault_key() is None)

        try:
            image = await asyncio.to_thread(_read_photo, job, key)
            params = json.loads(job["params"] or "{}")
            if params.get("mask_in"):  # Touch up: the user's painted marks.
                params["_mask"] = await asyncio.to_thread(_read_mask, params["mask_in"], key)
            result = await _run_on_best_device(processor, image, params, progress, cancelled)
            del image
            if cancelled():
                raise JobCancelled()
            outcome = result if isinstance(result, Outcome) else Outcome(image=result)
            del result
            if outcome.info.get("unchanged") and job["origin"] == "auto":
                # An automatic rule found nothing to fix: no copy, no question.
                await _set(conn, job_id, status="discarded", progress=100, error_message="nothing_to_fix")
                return True
            staged = await asyncio.to_thread(_write_staged, job_id, outcome.image, key)
            if outcome.extra is not None:
                await asyncio.to_thread(_write_staged, job_id, outcome.extra, key, _extra_path(staged))
            if private and _vault_key() is None:  # The vault locked while saving: respect it.
                staged.unlink(missing_ok=True)
                _extra_path(staged).unlink(missing_ok=True)
                raise JobCancelled()
            info_json = None
            if outcome.info:
                if private:
                    _private_info[job_id] = outcome.info
                else:
                    info_json = json.dumps(outcome.info)
            del outcome
            await _set(conn, job_id, status="review", progress=100, result_path=to_db_path(staged), result_info=info_json, error_message=None)
            if job["origin"] == "auto":  # No one to ask: apply the "Keep original" setting.
                # Drawings, documents and screenshots always keep their original too (A8).
                keep_original = params.get("keep_both") or (await _old_photo_settings()).get("old_photos_keep_original", True)
                await keep_result(job_id, "keep_both" if keep_original else "replace")
        except JobCancelled:
            if job_id in _cancel_requested:
                await _set(conn, job_id, status="cancelled", progress=0)
            else:  # Vault locked mid-job: try again after the next unlock.
                await _set(conn, job_id, status="queued", progress=0)
        except Exception as err:
            logger.warning("Improving photo %s (%s) failed: %s", job["photo_id"], job["kind"], err)
            await _set(conn, job_id, status="failed", progress=0, error_message=str(err)[:300])
        finally:
            async with conn.execute("SELECT status FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
                now = await cur.fetchone()
            if now is None or now[0] != "queued":  # Kept for a retry after the vault opens again.
                _drop_mask(job["params"])
            _cancel_requested.discard(job_id)
            _progress.pop(job_id, None)
            state["active_job_id"] = None
            key = None
            await slot.aclose()
        # The photo (and a kept copy) can go on to 8K now (after-import order: fix, then 8K).
        _kick_enhancement()
        return True


async def _run_on_best_device(processor: Processor, image: bytes, params: Dict[str, Any], progress: ProgressFn, cancelled: CancelledFn) -> Any:
    """T31: runs the job's models on the graphics card where that is faster on this computer.

    A known computer whose card hasn't been tested is tested first (the slot is already held).
    If the card fails mid-job, the models it used go back to the processor for good on this
    computer (until its driver changes) and the job is done again on the processor.
    """
    from engine.services import ai_device, computers

    if ai_device.needs_test() and computers._this["id"] not in (None, "unknown"):
        from engine.services import hardware_check

        await hardware_check.run(hold_slot=False)
    ai_device.start_job()
    try:
        return await asyncio.to_thread(processor.run, image, params, progress, cancelled)
    except Exception as err:
        on_card = ai_device.used_gpu()
        if not on_card or cancelled():
            raise
        logger.warning("The graphics card stopped (%s); finishing on the processor: %s", ", ".join(on_card), str(err)[:200])
        ai_device.mark_cpu(on_card, "stopped working on the graphics card")
        onnx_sessions.release()
        await computers.save_hardware()
        ai_device.start_job()
        return await asyncio.to_thread(processor.run, image, params, progress, cancelled)


def _kick_enhancement() -> None:
    """Starts the 8K pass if it isn't running (it picks up whatever is ready)."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return  # Tests run the passes themselves.
    from engine.api import photos as photos_api

    if not photos_api.optimization_state["is_active"]:
        asyncio.get_running_loop().create_task(photos_api.run_background_optimization())


KEEP_CHOICES = ("keep_both", "replace", "discard", "use_new")  # use_new: Try again only (T14).


async def _old_photo_settings() -> Dict[str, Any]:
    from engine.api.system import get_app_settings

    return (await get_app_settings())["settings"]


async def result_image(conn: aiosqlite.Connection, job: aiosqlite.Row, key: Optional[bytes], faces_off: Sequence[int] = ()) -> bytes:
    """The staged result, rebuilt without the faces in ``faces_off`` (the viewer's per-face switch)."""
    from engine.services import photo_versions

    staged = await asyncio.to_thread(photo_versions.read_photo_bytes, job["result_path"], bool(job["is_encrypted"]), key)
    info = result_info(job["id"], job["result_info"], bool(job["is_encrypted"]))
    off = sorted({int(i) for i in faces_off if 0 <= int(i) < len(info.get("faces", []))})
    if not off or job["kind"] not in ("faces", "fade") or info.get("scratches_repaired"):
        # Only these can rebuild the image before sharpening (from the original, recomputed).
        return staged
    from engine.services.old_photo_processors import without_faces

    extra_stored = to_db_path(_extra_path(resolve_stored_path(job["result_path"])))
    extra = await asyncio.to_thread(photo_versions.read_photo_bytes, extra_stored, bool(job["is_encrypted"]), key)
    async with conn.execute("SELECT filepath FROM photos WHERE id = ?;", (job["photo_id"],)) as cur:
        source_path = (await cur.fetchone())[0]
    source = await asyncio.to_thread(photo_versions.read_photo_bytes, source_path, bool(job["is_encrypted"]), key)
    return await asyncio.to_thread(without_faces, job["kind"], source, info, extra, off)


async def keep_result(
    job_id: int, choice: str, remember: bool = False, intensity: float = 1.0, faces_off: Sequence[int] = ()
) -> Dict[str, Any]:
    """What the user (or the automatic rule) decided for a finished result.

    - ``keep_both``: the improved photo is added next to the original.
    - ``replace``: the improved photo is added and the original goes to Trash for 30 days
      (still linked; "Restore original" brings it back).
    - ``discard``: the result is deleted; nothing changes in the library.

    ``remember`` stores the choice as the "When I keep a result" setting (not for discard).
    ``intensity`` (0-1) is the viewer's strength slider: below 1 the result is mixed with the original.
    ``faces_off``: faces (by index) the user switched off; they are kept as they were.
    A Try again job (T14, ``redo_of`` in its params) takes ``use_new`` or ``discard`` only:
    ``use_new`` replaces the copy it was a retry of (see :mod:`engine.services.try_again`).

    Returns:
        ``{"photo_id": new photo id or None}``, plus ``replaced_id`` after ``use_new``.

    Raises:
        ValueError: Unknown choice, or the job isn't waiting for a decision.
        photo_versions.VersionError: The vault is locked (vault photo) or the files failed a check.
    """
    from engine.services import photo_versions

    if choice not in KEEP_CHOICES:
        raise ValueError(f"Unknown choice {choice!r}")
    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT j.*, p.is_encrypted FROM restore_jobs j JOIN photos p ON p.id = j.photo_id WHERE j.id = ?;", (job_id,)
        ) as cur:
            job = await cur.fetchone()
        if job is None or job["status"] != "review":
            raise ValueError("This result is no longer waiting for a decision.")
        redo = "redo_of" in json.loads(job["params"] or "{}")
        if redo != (choice == "use_new") and choice != "discard":
            raise ValueError("Try again results are used or discarded." if redo else "Unknown choice 'use_new'")
        new_id = None
        replaced_id = None
        if choice != "discard":
            key = _vault_key() if job["is_encrypted"] else None
            if job["is_encrypted"] and key is None:
                raise photo_versions.VersionError("vault_locked")
            staged = await result_image(conn, job, key, faces_off)
            if intensity < 0.999:
                from engine.services.old_photo_processors import apply_intensity

                async with conn.execute("SELECT filepath FROM photos WHERE id = ?;", (job["photo_id"],)) as cur:
                    source_path = (await cur.fetchone())[0]
                source = await asyncio.to_thread(photo_versions.read_photo_bytes, source_path, bool(job["is_encrypted"]), key)
                staged = await asyncio.to_thread(apply_intensity, staged, source, intensity)
                del source
            from engine.services.old_photo_processors import kinds_kept

            info = result_info(job["id"], job["result_info"], bool(job["is_encrypted"]))
            kind = kinds_kept(job["kind"], info, [int(i) for i in faces_off])
            if redo:
                from engine.services import try_again

                swapped = await try_again.use_new(conn, job, staged, kind, key)
                new_id, replaced_id = swapped["photo_id"], swapped["replaced_id"]
            else:
                new_id = await photo_versions.create_version(
                    conn, job["photo_id"], staged, kind, json.loads(job["params"] or "{}"), key
                )
            del staged, key
            if choice == "replace":
                await photo_versions.trash_photo(conn, job["photo_id"])
            elif job["origin"] == "auto":  # A8: nobody chose yet; the app asks later.
                await conn.execute("UPDATE photos SET choice_pending = 1 WHERE id = ?;", (new_id,))
        _remove_staged(job["result_path"])
        _private_info.pop(job_id, None)
        await _set(
            conn, job_id, status="discarded" if choice == "discard" else "done",
            result_path=None, result_info=None, result_photo_id=new_id,
        )
    if remember and choice not in ("discard", "use_new"):
        from engine.api.system import SettingsUpdatePayload, update_app_settings

        await update_app_settings(SettingsUpdatePayload(settings={"old_photos_keep_choice": choice}))
    return {"photo_id": new_id} if replaced_id is None else {"photo_id": new_id, "replaced_id": replaced_id}


async def worker_loop() -> None:
    """Runs jobs forever; frees the model when idle."""
    global _wake
    _wake = asyncio.Event()
    await recover_on_start()
    while True:
        try:
            if await process_next_job():
                continue
            onnx_sessions.release()
            _wake.clear()
            try:
                await asyncio.wait_for(_wake.wait(), timeout=IDLE_SECONDS)
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            break
        except Exception as err:
            logger.error("Old-photo queue error: %s", err, exc_info=True)
            await asyncio.sleep(5.0)


def start_worker(force: bool = False) -> None:
    """Starts the background worker (skipped in tests unless ``force``)."""
    global _worker_task
    if os.environ.get("PYTEST_CURRENT_TEST") and not force:
        return
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.get_running_loop().create_task(worker_loop())


async def stop_worker() -> None:
    """Stops the worker and waits for it to finish its current step."""
    global _worker_task
    if _worker_task is not None and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except (asyncio.CancelledError, Exception):
            pass
    _worker_task = None
    onnx_sessions.release()
