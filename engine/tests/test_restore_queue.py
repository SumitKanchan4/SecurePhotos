"""H10 / A2a: the old-photo improvement queue (no real models: a fake processor stands in)."""

import asyncio
import builtins
import secrets
import shutil

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import ai_models, onnx_sessions, restore_queue, vault_storage
from engine.services.crypto_vault import decrypt_file_to_bytes
from engine.services.media_paths import resolve_stored_path, to_db_path

RESULT = b"improved image bytes"


def _jpeg(path, colour=(90, 90, 90)):
    Image.new("RGB", (64, 48), colour).save(path, "JPEG", quality=90)


@pytest.fixture
async def env(monkeypatch):
    """Two plain photos, a fake 'colour' processor, mains power, vault locked."""
    await run_migrations()
    folder = settings.data_dir / "originals" / f"a2a_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    calls = []

    def fake_run(image, params, progress, cancelled):
        calls.append((len(image), params))
        progress(50)
        return RESULT

    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=fake_run))
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: None)

    async def mains():
        return False

    monkeypatch.setattr(restore_queue, "_holding_auto_jobs", mains)
    monkeypatch.setitem(restore_queue.state, "paused", False)
    ids = []
    conn = await get_db_connection()
    try:
        for name in ("a.jpg", "b.jpg"):
            _jpeg(folder / name)
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES (?, ?, 100, 'image/jpeg');",
                (name, to_db_path(folder / name)),
            )
            ids.append(cur.lastrowid)
        await conn.commit()
        yield {"conn": conn, "ids": ids, "folder": folder, "calls": calls}
    finally:
        await conn.execute(f"DELETE FROM restore_jobs WHERE photo_id IN ({','.join('?' * len(ids))});", ids)
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", ids)
        await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)
        shutil.rmtree(restore_queue.staging_dir(), ignore_errors=True)


async def _job(conn, job_id):
    conn.row_factory = None
    async with conn.execute("SELECT status, progress, result_path, error_message FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        return await cur.fetchone()


async def test_queueing_skips_trashed_videos_and_duplicates(env):
    conn, (a, b) = env["conn"], env["ids"]
    await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ?;", (b,))
    await conn.commit()
    first = await restore_queue.enqueue([a, b, 999999], "colour")
    again = await restore_queue.enqueue([a], "colour")
    assert len(first) == 1 and again == first  # Trashed and missing skipped; same photo+kind not added twice.
    with pytest.raises(ValueError):
        await restore_queue.enqueue([a], "make_it_pretty")


async def test_a_job_ends_waiting_for_review_with_the_original_untouched(env):
    a = env["ids"][0]
    original = (env["folder"] / "a.jpg").read_bytes()
    (job_id,) = await restore_queue.enqueue([a], "colour", {"style": "natural"})
    assert await restore_queue.process_next_job() is True
    status, progress, result_path, _ = await _job(env["conn"], job_id)
    assert (status, progress) == ("review", 100)
    assert resolve_stored_path(result_path).read_bytes() == RESULT
    assert (env["folder"] / "a.jpg").read_bytes() == original
    assert env["calls"] == [(len(original), {"style": "natural"})]
    assert await restore_queue.process_next_job() is False  # Nothing left.


async def test_cancel_before_and_after_running(env):
    a, b = env["ids"]
    (queued,) = await restore_queue.enqueue([a], "colour")
    assert await restore_queue.cancel(queued)
    assert (await _job(env["conn"], queued))[0] == "cancelled"

    (done,) = await restore_queue.enqueue([b], "colour")
    await restore_queue.process_next_job()
    staged = resolve_stored_path((await _job(env["conn"], done))[2])
    assert await restore_queue.cancel(done)  # Discarding a result waiting for review deletes it.
    assert not staged.exists() and (await _job(env["conn"], done))[0] == "cancelled"
    assert not await restore_queue.cancel(done)  # Already finished.


async def test_cancelling_a_running_job_stops_it(env, monkeypatch):
    a = env["ids"][0]
    (job_id,) = await restore_queue.enqueue([a], "colour")

    def slow(image, params, progress, cancelled):
        restore_queue._cancel_requested.add(job_id)  # The user presses Cancel mid-way.
        assert cancelled()
        return RESULT

    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=slow))
    await restore_queue.process_next_job()
    status, _, result_path, _ = await _job(env["conn"], job_id)
    assert status == "cancelled" and result_path is None
    assert not restore_queue.staging_dir().exists() or not any(restore_queue.staging_dir().iterdir())


async def test_paused_queue_does_nothing_until_resumed(env):
    (job_id,) = await restore_queue.enqueue([env["ids"][0]], "colour")
    restore_queue.pause()
    assert await restore_queue.process_next_job() is False
    restore_queue.resume()
    assert await restore_queue.process_next_job() is True
    assert (await _job(env["conn"], job_id))[0] == "review"


async def test_on_battery_only_automatic_jobs_wait(env, monkeypatch):
    a, b = env["ids"]

    async def battery():
        return True

    monkeypatch.setattr(restore_queue, "_holding_auto_jobs", battery)
    (auto_job,) = await restore_queue.enqueue([a], "colour", origin="auto")
    (manual_job,) = await restore_queue.enqueue([b], "colour", origin="manual")
    assert await restore_queue.process_next_job() is True
    assert (await _job(env["conn"], manual_job))[0] == "review"  # The user asked: runs on battery.
    assert await restore_queue.process_next_job() is False
    assert (await _job(env["conn"], auto_job))[0] == "queued" and restore_queue.state["paused_reason"] == "on_battery"


async def test_photos_the_user_asked_for_go_before_automatic_ones(env):
    a, b = env["ids"]
    (auto_job,) = await restore_queue.enqueue([a], "colour", origin="auto")
    (manual_job,) = await restore_queue.enqueue([b], "colour", origin="manual")
    await restore_queue.process_next_job()
    assert (await _job(env["conn"], manual_job))[0] == "review"
    assert (await _job(env["conn"], auto_job))[0] == "queued"


async def test_automatic_results_follow_keep_original_except_drawings_and_documents(env, monkeypatch):
    """A8: with "Keep original" off an automatic result replaces the photo, but a drawing,
    document or screenshot (``keep_both``) always keeps its original."""
    a, b = env["ids"]
    choices = {}

    async def keep_off():
        return {"old_photos_keep_original": False}

    async def record(job_id, choice, *args, **kwargs):
        choices[job_id] = choice

    monkeypatch.setattr(restore_queue, "_old_photo_settings", keep_off)
    monkeypatch.setattr(restore_queue, "keep_result", record)
    (photo_job,) = await restore_queue.enqueue([a], "colour", {"style": "natural"}, origin="auto")
    (drawing_job,) = await restore_queue.enqueue([b], "colour", {"style": "natural", "keep_both": True}, origin="auto")
    await restore_queue.process_next_job()
    await restore_queue.process_next_job()
    assert choices == {photo_job: "replace", drawing_job: "keep_both"}


async def test_jobs_using_the_loaded_model_go_first(env, monkeypatch):
    a, b = env["ids"]
    monkeypatch.setitem(restore_queue.PROCESSORS, "faces", restore_queue.Processor(models=("gfpgan",), run=lambda *x: RESULT))
    monkeypatch.setattr(onnx_sessions, "loaded_model", lambda: "gfpgan")
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: True)
    (colour_job,) = await restore_queue.enqueue([a], "colour")
    (faces_job,) = await restore_queue.enqueue([b], "faces")
    await restore_queue.process_next_job()
    assert (await _job(env["conn"], faces_job))[0] == "review"  # No model swap needed.
    assert (await _job(env["conn"], colour_job))[0] == "queued"


async def test_missing_models_fail_the_job_and_are_never_downloaded_without_asking(env, monkeypatch):
    monkeypatch.setitem(restore_queue.PROCESSORS, "faces", restore_queue.Processor(models=("gfpgan",), run=lambda *x: RESULT))
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: False)
    monkeypatch.setattr(ai_models, "fetch_on_demand", lambda *a, **k: pytest.fail("downloaded without asking"))
    (job_id,) = await restore_queue.enqueue([env["ids"][0]], "faces", origin="auto")
    await restore_queue.process_next_job()
    assert (await _job(env["conn"], job_id))[0::3] == ("failed", "models_missing")
    assert restore_queue.state["download"] is None


async def test_download_progress_covers_every_missing_model(env, monkeypatch):
    ready = {"ddcolor_artistic"}
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: key in ready)
    sizes = {k: int(s["size"]) for k, s in ai_models.ON_DEMAND_MODELS.items()}
    seen = []

    def fetch(key, d, progress, cancel):
        progress(sizes[key] // 2, sizes[key])
        seen.append(dict(restore_queue.state["download"]))
        ready.add(key)

    monkeypatch.setattr(ai_models, "fetch_on_demand", fetch)
    assert await restore_queue.download_models(["ddcolor_large", "ddcolor_artistic", "gfpgan"]) is True
    total = sizes["ddcolor_large"] + sizes["gfpgan"]
    assert [s["total"] for s in seen] == [total, total]
    assert seen[0]["done"] == sizes["ddcolor_large"] // 2
    assert seen[1]["done"] == sizes["ddcolor_large"] + sizes["gfpgan"] // 2
    assert restore_queue.state["download"] is None and restore_queue.state["download_result"] == "done"


async def test_a_failed_or_cancelled_download_says_so(env, monkeypatch):
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: False)

    def offline(*a, **k):
        raise OSError("no internet")

    monkeypatch.setattr(ai_models, "fetch_on_demand", offline)
    assert await restore_queue.download_models(["gfpgan"]) is False
    assert restore_queue.state["download_result"] == "failed"

    def cancelled(*a, **k):
        raise ai_models.DownloadCancelled("gfpgan")

    monkeypatch.setattr(ai_models, "fetch_on_demand", cancelled)
    assert await restore_queue.download_models(["gfpgan"]) is False
    assert restore_queue.state["download_result"] == "cancelled" and restore_queue.state["download"] is None


async def test_a_failing_improvement_is_reported_not_retried_forever(env, monkeypatch):
    def broken(*a):
        raise RuntimeError("bad pixels")

    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=broken))
    (job_id,) = await restore_queue.enqueue([env["ids"][0]], "colour")
    await restore_queue.process_next_job()
    assert (await _job(env["conn"], job_id))[0::3] == ("failed", "bad pixels")
    assert await restore_queue.process_next_job() is False


async def test_restart_requeues_unfinished_jobs_and_removes_stray_files(env):
    a, b = env["ids"]
    (kept,) = await restore_queue.enqueue([a], "colour")
    await restore_queue.process_next_job()
    (interrupted,) = await restore_queue.enqueue([b], "colour")
    await env["conn"].execute("UPDATE restore_jobs SET status = 'working', progress = 40 WHERE id = ?;", (interrupted,))
    await env["conn"].commit()
    stray = restore_queue.staging_dir() / "job_leftover.img"
    stray.write_bytes(b"half written")

    await restore_queue.recover_on_start()

    assert (await _job(env["conn"], interrupted))[:2] == ("queued", 0)
    assert not stray.exists()
    assert resolve_stored_path((await _job(env["conn"], kept))[2]).read_bytes() == RESULT  # A result awaiting review stays.


async def test_activity_list_hides_names_of_vault_photos(env):
    a, b = env["ids"]
    await env["conn"].execute("UPDATE photos SET is_encrypted = 1 WHERE id = ?;", (b,))
    await env["conn"].commit()
    await restore_queue.enqueue([a, b], "colour")
    waiting = {j["photo_id"]: j for j in (await restore_queue.list_jobs())["waiting"]}
    assert waiting[a]["filename"] == "a.jpg" and waiting[a]["private"] is False
    assert waiting[b]["filename"] is None and waiting[b]["private"] is True


# ── Vault photos ────────────────────────────────────────────────────────────


@pytest.fixture
async def vault_photo(env):
    """env's first photo locked into the vault with a known key."""
    import aiosqlite

    conn, mvk = env["conn"], secrets.token_bytes(32)
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (env["ids"][0],)) as cur:
        row = await cur.fetchone()
    assert await vault_storage.lock_photo(conn, row, mvk)
    yield {**env, "mvk": mvk, "photo_id": env["ids"][0]}
    await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (env["ids"][0],))
    await conn.commit()


async def test_vault_photos_wait_while_the_vault_is_locked(vault_photo):
    (job_id,) = await restore_queue.enqueue([vault_photo["photo_id"]], "colour")
    assert await restore_queue.process_next_job() is False
    assert (await _job(vault_photo["conn"], job_id))[0] == "queued"


async def test_vault_result_is_staged_encrypted_and_nothing_plain_is_written(vault_photo, monkeypatch):
    mvk = vault_photo["mvk"]
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: mvk)
    (job_id,) = await restore_queue.enqueue([vault_photo["photo_id"]], "colour")
    written = []
    real_open = builtins.open

    def spy_open(file, mode="r", *args, **kwargs):
        if any(m in mode for m in ("w", "a", "+", "x")):
            written.append(str(file))
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy_open)
    await restore_queue.process_next_job()
    monkeypatch.setattr(builtins, "open", real_open)

    status, _, result_path, _ = await _job(vault_photo["conn"], job_id)
    staged = resolve_stored_path(result_path)
    assert status == "review" and staged.name.endswith(".enc")
    assert decrypt_file_to_bytes(staged, mvk) == RESULT
    assert written and all(".enc" in w for w in written), written
    assert vault_photo["calls"] and vault_photo["calls"][0][0] > 0  # The processor got the decrypted photo.


async def test_vault_locking_mid_job_drops_the_result_and_requeues(vault_photo, monkeypatch):
    mvk = vault_photo["mvk"]
    keys = {"value": mvk}
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: keys["value"])

    def lock_meanwhile(image, params, progress, cancelled):
        keys["value"] = None  # Auto-lock fires while the photo is being improved.
        assert cancelled()  # The processor is told to stop early.
        return RESULT

    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=lock_meanwhile))
    (job_id,) = await restore_queue.enqueue([vault_photo["photo_id"]], "colour")
    await restore_queue.process_next_job()
    status, _, result_path, _ = await _job(vault_photo["conn"], job_id)
    assert status == "queued" and result_path is None
    assert not restore_queue.staging_dir().exists() or not any(restore_queue.staging_dir().iterdir())


async def test_vault_locking_while_saving_deletes_the_saved_result(vault_photo, monkeypatch):
    mvk = vault_photo["mvk"]
    keys = {"value": mvk}
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: keys["value"])
    real_write = restore_queue._write_staged

    def write_then_lock(job_id, data, key):
        path = real_write(job_id, data, key)
        keys["value"] = None  # Auto-lock fires right after the encrypted result was written.
        return path

    monkeypatch.setattr(restore_queue, "_write_staged", write_then_lock)
    (job_id,) = await restore_queue.enqueue([vault_photo["photo_id"]], "colour")
    await restore_queue.process_next_job()
    status, _, result_path, _ = await _job(vault_photo["conn"], job_id)
    assert status == "queued" and result_path is None
    assert not any(restore_queue.staging_dir().iterdir())


# ── API ─────────────────────────────────────────────────────────────────────


async def test_api_queues_lists_and_cancels(env):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/api/restore/jobs", json={"photo_ids": env["ids"], "kind": "colour", "params": {"style": "vivid"}})
        assert res.status_code == 200
        job_ids = res.json()["job_ids"]
        assert len(job_ids) == 2
        assert (await client.post("/api/restore/jobs", json={"photo_ids": env["ids"], "kind": "nope"})).status_code == 400
        listed = (await client.get("/api/restore/jobs")).json()
        assert {j["id"] for j in listed["waiting"]} >= set(job_ids)
        assert (await client.post(f"/api/restore/jobs/{job_ids[0]}/cancel")).status_code == 200
        assert (await client.post("/api/restore/jobs/987654/cancel")).status_code == 404
        assert (await client.post("/api/restore/pause")).json() == {"paused": True}
        assert (await client.post("/api/restore/resume")).json() == {"paused": False}
        models = (await client.get("/api/restore/models")).json()["models"]
        assert {m["key"] for m in models} == set(ai_models.ON_DEMAND_MODELS)
        # There is no way to hand the app another model file (A2c).
        assert (await client.post("/api/restore/models/import", json={"path": str(env["folder"] / "a.jpg")})).status_code in (404, 405)


async def test_api_refuses_a_job_whose_model_is_missing_and_downloads_only_what_it_needs(env, monkeypatch):
    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=("ddcolor_large", "ddcolor_artistic"), run=lambda *x: RESULT))
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: key == "ddcolor_artistic")
    asked = []

    async def fake_download(keys):
        asked.append(list(keys))
        return True

    monkeypatch.setattr(restore_queue, "download_models", fake_download)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/api/restore/jobs", json={"photo_ids": env["ids"], "kind": "colour"})
        assert res.status_code == 409 and res.json()["detail"] == "models_missing"
        assert (await client.get("/api/restore/jobs")).json()["waiting"] == []
        started = await client.post("/api/restore/models/download", json={"kind": "colour"})
        assert started.json() == {"started": True, "bytes": int(ai_models.ON_DEMAND_MODELS["ddcolor_large"]["size"])}
        await asyncio.sleep(0)
        assert asked == [["ddcolor_large", "ddcolor_artistic"]]
        assert (await client.post("/api/restore/models/download", json={"kind": "nope"})).status_code == 400
        # Only the app's own models can be fetched: a URL or file name in the body is ignored.
        asked.clear()
        await client.post("/api/restore/models/download", json={"kind": None, "url": "https://evil.example/x.onnx"})
        await asyncio.sleep(0)
        assert asked == [list(ai_models.ON_DEMAND_MODELS)]

