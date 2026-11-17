"""H10 / A5: Sharpen faces — the recipe, the identity check, per-face on/off, recipe R, and the
queue / API around them. GFPGAN and face finding are faked; the maths is real."""

import contextlib
import io
import secrets

import aiosqlite
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.main import app
from engine.services import ai_models, face_sharpen, old_photo_processors, onnx_sessions, restore_queue, vault_storage
from engine.services.media_paths import resolve_stored_path
from engine.tests.test_photo_versions import _finish, _photo, lib  # noqa: F401  (fixture)

GREY = 100
W, H = 320, 240


def _face(x: float, y: float, scale: float = 0.25) -> np.ndarray:
    """A YuNet-style face whose landmarks sit exactly on GFPGAN's template, moved and scaled."""
    lm = face_sharpen.TEMPLATE * scale + np.array([x, y], np.float32)
    box = [x + 40 * scale, y + 120 * scale, 432 * scale, 380 * scale]
    return np.array([*box, *lm.reshape(-1), 0.95], np.float32)


class WhiteFaces:
    """A fake GFPGAN: every face comes back pure white, so the paste is easy to measure."""

    def run(self, _outputs, feeds):
        x = feeds["input"]
        assert x.shape == (1, 3, 512, 512)
        return [np.ones_like(x)]


@pytest.fixture
def fake_faces(monkeypatch):
    """Faces A and B side by side (their soft edges overlap), C apart; likeness per face."""
    faces = {"list": [_face(20, 20), _face(90, 20), _face(220, 140, 0.18)], "likeness": [0.9, 0.9, 0.9]}
    monkeypatch.setattr(face_sharpen, "find_faces", lambda rgb, min_px=24: list(faces["list"]))
    monkeypatch.setattr(face_sharpen, "count_faces", lambda rgb, min_px=24: len(faces["list"]))
    calls = iter(range(1000))
    monkeypatch.setattr(face_sharpen, "likeness", lambda before, after, face: faces["likeness"][next(calls) % len(faces["likeness"])])

    @contextlib.contextmanager
    def use_model(key):
        assert key == "gfpgan"
        yield WhiteFaces()

    monkeypatch.setattr(onnx_sessions, "use_model", use_model)
    return faces


def _grey() -> np.ndarray:
    return np.full((H, W, 3), GREY, np.uint8)


def _centre(face: np.ndarray):
    lm = face[4:14].reshape(5, 2)
    return int(round(lm[2][1])), int(round(lm[2][0]))  # (row, col) of the nose.


# ── The recipe ──────────────────────────────────────────────────────────────


def test_owner_rule_faces_that_no_longer_look_alike_are_left_as_they_were():
    assert face_sharpen.strength_for(0.93) == face_sharpen.strength_for(0.45) == 0.8
    assert face_sharpen.strength_for(0.449) == 0.0
    assert face_sharpen.strength_for(None) == 0.0  # Can't measure it: no guessing.
    assert face_sharpen.LIKENESS_KEEP == 0.45


def test_faces_are_pasted_at_80_percent_inside_the_face_only(fake_faces):
    fake_faces["likeness"] = [0.9, 0.9, 0.3]  # C no longer looks like the same person.
    out, records, crops = face_sharpen.sharpen_faces(_grey())
    a, c = _centre(fake_faces["list"][0]), _centre(fake_faces["list"][2])
    assert abs(int(out[a][0]) - round(GREY * 0.2 + 255 * 0.8)) <= 1
    assert (out[c] == GREY).all()                 # Left as it was.
    assert (out[H - 3, 5] == GREY).all()          # Far from every face: untouched.
    assert [r["strength"] for r in records] == [0.8, 0.8, 0.0]
    assert [r["likeness"] for r in records] == [0.9, 0.9, 0.3] and len(crops) == 3


def test_rebuilding_gives_the_same_image_and_a_switched_off_face_keeps_its_neighbour(fake_faces):
    base = _grey()
    out, records, crops = face_sharpen.sharpen_faces(base)
    assert (face_sharpen.compose(base, records, crops) == out).all()
    without_a = face_sharpen.compose(base, records, crops, off=[0])
    assert (without_a[_centre(fake_faces["list"][0])] == GREY).all()                    # A as it was.
    assert (without_a[_centre(fake_faces["list"][1])] == out[_centre(fake_faces["list"][1])]).all()  # B unchanged.
    # Where A's and B's soft edges overlap, B's sharpening survives (putting the old pixels
    # back would have wiped it).
    overlap = (_centre(fake_faces["list"][0])[0], 130)
    assert without_a[overlap][0] > GREY + 20


def test_sharpened_faces_pack_and_unpack_exactly():
    crops = [np.random.default_rng(1).integers(0, 256, (512, 512, 3), dtype=np.uint8) for _ in range(2)]
    back = face_sharpen.unpack_faces(face_sharpen.pack_faces(crops))
    assert len(back) == 2 and all((a == b).all() for a, b in zip(crops, back))


def _jpeg_bytes(rgb: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(rgb).save(out, "PNG")  # Lossless, so the tests can compare pixels.
    return out.getvalue()


def test_fix_faded_colours_adds_faces_only_when_the_model_is_here(fake_faces, monkeypatch):
    data = _jpeg_bytes(_grey())
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: True)
    r = old_photo_processors.fade(data, {}, lambda p: None, lambda: False)
    assert len(r.info["faces"]) == 3 and r.extra and (r.info["width"], r.info["height"]) == (W, H)
    no = old_photo_processors.fade(data, {"faces": False}, lambda p: None, lambda: False)
    assert no.info == {} and no.extra is None
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: False)
    waiting = old_photo_processors.fade(data, {}, lambda p: None, lambda: False)
    assert waiting.info == {"faces_waiting": 3} and waiting.extra is None


def test_the_kept_copy_is_labelled_by_what_was_actually_done():
    info = {"faces": [{"strength": 0.8}, {"strength": 0.0}]}
    assert old_photo_processors.kinds_kept("fade", info, []) == "fade,faces"
    assert old_photo_processors.kinds_kept("fade", info, [0]) == "fade"  # Only face left on was never sharpened.
    assert old_photo_processors.kinds_kept("fade", {}, []) == "fade"
    assert old_photo_processors.kinds_kept("faces", info, []) == "faces"
    from engine.services.photo_versions import merged_kinds, source_type_for

    assert merged_kinds(None, "fade,faces") == "fade,faces" and source_type_for("fade,faces").endswith("compositeWithTrainedAlgorithmicMedia")
    assert merged_kinds("colour", "fade,faces") == "fade,colour,faces"


# ── Queue and API ──────────────────────────────────────────────────────────


@pytest.fixture
async def face_lib(lib, fake_faces, monkeypatch):  # noqa: F811
    """lib's first photo replaced by a 320 x 240 grey picture with three (fake) faces."""
    Image.fromarray(_grey()).save(lib["folder"] / "grandparents.jpg", "JPEG", quality=100, subsampling=0)
    monkeypatch.setitem(restore_queue.PROCESSORS, "faces", restore_queue.Processor(models=(), run=old_photo_processors.sharpen))
    monkeypatch.setitem(restore_queue.PROCESSORS, "fade", restore_queue.Processor(models=(), run=old_photo_processors.fade))
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: True)
    yield {**lib, "faces": fake_faces}


def _decode(data: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(data)) as im:
        return np.asarray(im.convert("RGB"))


async def _job_row(conn, job_id):
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT * FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        return await cur.fetchone()


async def test_viewer_sees_each_face_and_can_switch_one_off_before_keeping(face_lib):
    conn, original_id = face_lib["conn"], face_lib["ids"][0]
    face_lib["faces"]["likeness"] = [0.9, 0.9, 0.2]
    job_id = await _finish(original_id, kind="faces")
    job = (await restore_queue.list_jobs())["review"][0]
    assert job["id"] == job_id and job["faces_waiting"] == 0
    assert [f["sharpened"] for f in job["faces"]] == [True, True, False]
    x, y, w, h = job["faces"][0]["box"]
    assert 0 < x < 1 and 0 < y < 1 and abs(w - 108 / W) < 0.01  # 0-1 of the picture, for the overlay.
    row = await _job_row(conn, job_id)
    staged = resolve_stored_path(row["result_path"])
    assert row["result_info"] and restore_queue._extra_path(staged).is_file()

    a, b = _centre(face_lib["faces"]["list"][0]), _centre(face_lib["faces"]["list"][1])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        full = _decode((await client.get(f"/api/restore/jobs/{job_id}/result")).content)
        off = _decode((await client.get(f"/api/restore/jobs/{job_id}/result?faces_off=0")).content)
        assert (await client.get(f"/api/restore/jobs/{job_id}/result?faces_off=nose")).status_code == 400
        assert full[a][0] > 200 and abs(int(off[a][0]) - GREY) <= 3 and abs(int(off[b][0]) - int(full[b][0])) <= 3
        res = await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "keep_both", "faces_off": [0]})
    new = await _photo(conn, res.json()["photo_id"])
    assert new["ai_kind"] == "faces"
    with Image.open(resolve_stored_path(new["filepath"])) as im:
        kept = np.asarray(im.convert("RGB"))
    assert abs(int(kept[a][0]) - GREY) <= 6 and kept[b][0] > 200  # A as it was, B sharpened.
    assert not staged.exists() and not restore_queue._extra_path(staged).exists()
    assert (await _job_row(conn, job_id))["result_info"] is None


async def test_faded_photo_with_faces_is_labelled_ai_unless_every_face_is_switched_off(face_lib):
    conn, original_id = face_lib["conn"], face_lib["ids"][0]
    first = await _finish(original_id, kind="fade")
    kept = await restore_queue.keep_result(first, "keep_both")
    assert (await _photo(conn, kept["photo_id"]))["ai_kind"] == "fade,faces"
    second = await _finish(original_id, kind="fade")
    kept = await restore_queue.keep_result(second, "keep_both", faces_off=[0, 1, 2])
    assert (await _photo(conn, kept["photo_id"]))["ai_kind"] == "fade"


async def test_without_the_face_model_a_faded_photo_offers_to_sharpen_faces_later(face_lib, monkeypatch):
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: False)
    await _finish(face_lib["ids"][0], kind="fade")
    job = (await restore_queue.list_jobs())["review"][0]
    assert job["faces_waiting"] == 3 and job["faces"] == []


async def test_vault_photo_faces_are_never_written_in_plain_form(face_lib, monkeypatch):
    conn, mvk, original_id = face_lib["conn"], secrets.token_bytes(32), face_lib["ids"][0]
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (original_id,)) as cur:
        assert await vault_storage.lock_photo(conn, await cur.fetchone(), mvk)
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: mvk)
    try:
        job_id = await _finish(original_id, kind="faces")
        row = await _job_row(conn, job_id)
        assert row["result_info"] is None and restore_queue._private_info[job_id]["faces"]
        extra = restore_queue._extra_path(resolve_stored_path(row["result_path"]))
        assert extra.name.endswith(".faces.enc") and not extra.read_bytes().startswith(b"PK")  # Not a plain npz.
        job = (await restore_queue.list_jobs())["review"][0]
        assert len(job["faces"]) == 3 and job["private"] and job["filename"] is None
        await restore_queue.keep_result(job_id, "keep_both", faces_off=[1])
        assert job_id not in restore_queue._private_info and not extra.exists()
    finally:
        await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (original_id,))
        await conn.commit()


async def test_cancel_and_restart_handle_the_faces_file(face_lib):
    conn, original_id = face_lib["conn"], face_lib["ids"][0]
    kept_job = await _finish(original_id, kind="faces")
    kept_extra = restore_queue._extra_path(resolve_stored_path((await _job_row(conn, kept_job))["result_path"]))
    stray = restore_queue.staging_dir() / "job_999999.faces"
    stray.write_bytes(b"left over")
    await restore_queue.recover_on_start()
    assert kept_extra.exists() and not stray.exists()  # A result still waiting keeps its faces.
    assert await restore_queue.cancel(kept_job)
    assert not kept_extra.exists() and (await _job_row(conn, kept_job))["result_info"] is None


async def test_sharpen_faces_is_offered_for_photos_with_faces_and_locked_without_the_model(face_lib, monkeypatch):
    original_id = face_lib["ids"][0]
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: key != "gfpgan")
    monkeypatch.setitem(restore_queue.PROCESSORS, "faces", restore_queue.Processor(models=("gfpgan",), run=old_photo_processors.sharpen))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        state = (await client.get(f"/api/restore/photos/{original_id}/state")).json()
        assert state["options"]["faces"] is True
        assert state["downloads"] == {"faces": int(ai_models.ON_DEMAND_MODELS["gfpgan"]["size"])}
        monkeypatch.setattr(face_sharpen, "count_faces", lambda rgb, min_px=24: 0)
        assert (await client.get(f"/api/restore/photos/{original_id}/options")).json()["faces"] is False
    monkeypatch.setattr(face_sharpen, "count_faces", lambda rgb, min_px=24: 2)
    conn = face_lib["conn"]
    await conn.execute("UPDATE photos SET ai_kind = 'faces' WHERE id = ?;", (original_id,))
    await conn.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(f"/api/restore/photos/{original_id}/options")).json()["faces"] is False  # Done already.
