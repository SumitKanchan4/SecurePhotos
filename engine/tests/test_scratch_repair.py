"""H10 / A7: Remove scratches and spots — finding marks (faces protected), filling only what is
marked, Touch up with the user's marks (vault: encrypted), automatic rules that keep nothing
when there's nothing to fix. The two models are faked; the image handling is real."""

import base64
import contextlib
import io
import json
import secrets

import aiosqlite
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.main import app
from engine.services import ai_models, old_photo_processors, old_photo_rules, onnx_sessions, restore_queue, scratch_repair, vault_storage
from engine.services.media_paths import resolve_stored_path
from engine.tests.test_photo_versions import _finish, _photo, lib  # noqa: F401  (fixture)

W, H = 320, 240
GREY = 120


def _grey():
    return np.full((H, W, 3), GREY, np.uint8)


def _line_mask():
    m = np.zeros((H, W), np.uint8)
    m[100:103, 20:300] = 1  # A long horizontal scratch.
    return m


class WhiteFill:
    """A fake LaMa: fills every marked pixel with white."""

    def __init__(self):
        self.calls = 0

    def run(self, _outputs, feeds):
        self.calls += 1
        image, mask = feeds["image"], feeds["mask"]
        assert image.shape == (1, 3, 512, 512) and mask.shape == (1, 1, 512, 512)
        return [mask * 1.0 + (1 - mask) * image]


@pytest.fixture
def fake_models(monkeypatch):
    lama = WhiteFill()
    marks = {"mask": _line_mask()}
    monkeypatch.setattr(scratch_repair, "detect", lambda rgb: marks["mask"].astype(np.float32))
    monkeypatch.setattr(scratch_repair, "specks", lambda rgb: np.zeros(rgb.shape[:2], np.uint8))
    monkeypatch.setattr(scratch_repair, "faces_area", lambda rgb: np.zeros(rgb.shape[:2], np.uint8))

    @contextlib.contextmanager
    def use_model(key):
        assert key == "lama"
        yield lama

    monkeypatch.setattr(onnx_sessions, "use_model", use_model)
    return {"lama": lama, "marks": marks}


# ── Finding and filling ────────────────────────────────────────────────────


def test_dust_specks_are_found_but_lines_and_edges_are_not():
    rgb = _grey()
    rgb[50:53, 60:63] = 250                 # A light speck.
    rgb[150:152, 200:202] = 10              # A dark speck.
    rgb[200:203, 10:310] = 250              # A long line: not "dust".
    rgb[:, 250:] = 30                       # A big dark area: an edge, not dust.
    m = scratch_repair.specks(rgb)
    assert m[51, 61] and m[150, 200]
    assert not m[201, 100] and not m[120, 280] and not m[120, 249]


def test_marks_inside_a_face_are_dropped(monkeypatch):
    monkeypatch.setattr(scratch_repair, "detect", lambda rgb: _line_mask().astype(np.float32))
    monkeypatch.setattr(scratch_repair, "specks", lambda rgb: np.zeros(rgb.shape[:2], np.uint8))
    face = np.zeros((H, W), np.uint8)
    face[80:130, 100:160] = 1
    monkeypatch.setattr(scratch_repair, "faces_area", lambda rgb: face)
    m = scratch_repair.find_damage(_grey())
    assert m[101, 50] and not m[101, 130]  # The scratch is kept outside the face, dropped inside.


def test_only_marked_pixels_change(fake_models):
    mask = _line_mask()
    out = scratch_repair.repair(_grey(), mask)
    assert out[101, 150].min() > 240                  # Filled (white from the fake).
    assert (out[20, 20] == GREY).all() and (out[200, 300] == GREY).all()  # Far away: untouched.
    assert fake_models["lama"].calls == 1             # 320 x 240 at 1024: one area.
    assert (scratch_repair.repair(_grey(), np.zeros((H, W), np.uint8)) == GREY).all()
    assert fake_models["lama"].calls == 1             # Nothing marked: the model isn't even run.


def test_marks_round_trip_for_the_viewer():
    mask = _line_mask()
    png = scratch_repair.encode_mask(mask)
    with Image.open(io.BytesIO(png)) as im:
        assert im.format == "PNG" and im.size == (W, H)
    assert (scratch_repair.decode_mask(png, (H, W, 3)) == mask).all()
    big = np.zeros((3000, 4000), np.uint8)
    with Image.open(io.BytesIO(scratch_repair.encode_mask(big))) as im:
        assert max(im.size) == scratch_repair.MASK_LONG_SIDE


def test_automatic_repairs_only_clearly_scratched_photos(fake_models):
    fake_models["marks"]["mask"] = np.zeros((H, W), np.uint8)
    fake_models["marks"]["mask"][100, 20:60] = 1  # 40 px of 76800: 0.05%, below 0.4%.
    assert scratch_repair.auto_repair(_grey()) is None
    fake_models["marks"]["mask"] = _line_mask()   # 840 px: 1.1%.
    assert scratch_repair.auto_repair(_grey())[101, 150].min() > 240


def _png(rgb):
    out = io.BytesIO()
    Image.fromarray(rgb).save(out, "PNG")
    return out.getvalue()


def test_the_processor_uses_the_users_marks_after_touch_up(fake_models):
    run = old_photo_processors.remove_scratches
    auto = run(_png(_grey()), {}, lambda p: None, lambda: False)
    assert auto.info["marked"] > 0 and auto.extra.startswith(b"\x89PNG")
    painted = np.zeros((H, W), np.uint8)
    painted[10:20, 10:20] = 1
    touched = run(_png(_grey()), {"_mask": scratch_repair.encode_mask(painted)}, lambda p: None, lambda: False)
    result = np.asarray(Image.open(io.BytesIO(touched.image)).convert("RGB"))
    assert result[15, 15].min() > 230 and abs(int(result[101, 150][0]) - GREY) < 8  # Only what was painted.
    fake_models["marks"]["mask"] = np.zeros((H, W), np.uint8)
    assert run(_png(_grey()), {"strict": True}, lambda p: None, lambda: False).info == {"unchanged": True}


def test_labels_say_scratches_were_repaired_too():
    assert old_photo_processors.kinds_kept("colour", {"scratches_repaired": True}, []) == "colour,scratches"
    assert old_photo_processors.kinds_kept("fade", {"scratches_repaired": True, "faces": [{"strength": 0.8}]}, []) == "fade,scratches,faces"


@pytest.mark.parametrize(
    "grey, faces, auto, expected",
    [
        (True, False, {"scratches": True}, ("scratches", {"strict": True})),
        (True, False, {"colour": True, "scratches": True}, ("colour", {"style": "natural", "faces": False, "scratches": True})),
        (False, True, {"faces": True, "scratches": True}, ("faces", {"scratches": True})),
        (False, False, {"fade": True}, ("fade", {"faces": False})),
    ],
)
def test_automatic_scratches_fold_into_the_one_job(grey, faces, auto, expected):
    assert old_photo_rules.plan(grey, faces, auto) == expected


def test_automatic_colour_repairs_scratches_first(fake_models, monkeypatch):
    monkeypatch.setattr(ai_models, "missing_models", lambda keys, d=None: [])
    seen = []
    monkeypatch.setattr(old_photo_processors, "fix_faded_colours", lambda rgb: seen.append(rgb.copy()) or rgb)
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: False)
    monkeypatch.setattr(old_photo_processors.face_sharpen, "count_faces", lambda rgb, min_px=24: 0)
    out = old_photo_processors.fade(_png(_grey()), {"faces": False, "scratches": True}, lambda p: None, lambda: False)
    assert seen[0][101, 150].min() > 240 and out.info == {"scratches_repaired": True}


# ── Queue and API ──────────────────────────────────────────────────────────


@pytest.fixture
async def scratch_lib(lib, fake_models, monkeypatch):  # noqa: F811
    Image.fromarray(_grey()).save(lib["folder"] / "grandparents.jpg", "JPEG", quality=100)
    monkeypatch.setitem(restore_queue.PROCESSORS, "scratches", restore_queue.Processor(models=(), run=old_photo_processors.remove_scratches))
    yield {**lib, **fake_models}


async def _row(conn, job_id):
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT * FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        return await cur.fetchone()


async def test_marks_are_shown_and_touch_up_repairs_again_with_the_painted_marks(scratch_lib):
    conn, photo_id = scratch_lib["conn"], scratch_lib["ids"][0]
    job_id = await _finish(photo_id, kind="scratches")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        mask = await client.get(f"/api/restore/jobs/{job_id}/mask")
        assert mask.status_code == 200 and mask.headers["content-type"] == "image/png"
        assert (await client.post(f"/api/restore/jobs/{job_id}/touch-up", json={"mask_png": "not base64!"})).status_code == 400
        jpeg = base64.b64encode(_png(_grey())[:10]).decode()
        assert (await client.post(f"/api/restore/jobs/{job_id}/touch-up", json={"mask_png": jpeg})).status_code == 400
        painted = np.zeros((H, W), np.uint8)
        painted[10:20, 10:20] = 1
        body = {"mask_png": base64.b64encode(scratch_repair.encode_mask(painted)).decode()}
        res = await client.post(f"/api/restore/jobs/{job_id}/touch-up", json=body)
        assert res.status_code == 200
        new_id = res.json()["job_id"]
        assert (await client.post(f"/api/restore/jobs/{job_id}/touch-up", json=body)).status_code == 404  # Old one is gone.
    assert (await _row(conn, job_id))["status"] == "discarded"
    token = json.loads((await _row(conn, new_id))["params"])["mask_in"]
    staged = restore_queue.mask_in_path(token, False)
    assert staged.read_bytes().startswith(b"\x89PNG")
    await restore_queue.recover_on_start()
    assert staged.exists()  # A waiting job keeps its marks across a restart.
    assert await restore_queue.process_next_job()
    row = await _row(conn, new_id)
    assert row["status"] == "review" and not staged.exists()
    with Image.open(resolve_stored_path(row["result_path"])) as im:
        result = np.asarray(im.convert("RGB"))
    assert result[15, 15].min() > 230 and abs(int(result[101, 150][0]) - GREY) < 8


async def test_a_vault_photos_marks_are_staged_encrypted(scratch_lib, monkeypatch):
    conn, photo_id, mvk = scratch_lib["conn"], scratch_lib["ids"][0], secrets.token_bytes(32)
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (photo_id,)) as cur:
        assert await vault_storage.lock_photo(conn, await cur.fetchone(), mvk)
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: mvk)
    try:
        job_id = await _finish(photo_id, kind="scratches")
        extra = restore_queue._extra_path(resolve_stored_path((await _row(conn, job_id))["result_path"]))
        assert extra.name.endswith(".extra.enc") and not extra.read_bytes().startswith(b"\x89PNG")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get(f"/api/restore/jobs/{job_id}/mask")).content.startswith(b"\x89PNG")  # Decrypted in memory.
            body = {"mask_png": base64.b64encode(scratch_repair.encode_mask(_line_mask())).decode()}
            new_id = (await client.post(f"/api/restore/jobs/{job_id}/touch-up", json=body)).json()["job_id"]
        token = json.loads((await _row(conn, new_id))["params"])["mask_in"]
        staged = restore_queue.mask_in_path(token, True)
        assert staged.exists() and not staged.read_bytes().startswith(b"\x89PNG")
        assert not restore_queue.mask_in_path(token, False).exists()
        assert await restore_queue.cancel(new_id)
        assert not staged.exists()
    finally:
        await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (photo_id,))
        await conn.commit()


async def test_an_automatic_job_with_nothing_to_fix_keeps_nothing(scratch_lib):
    conn, photo_id = scratch_lib["conn"], scratch_lib["ids"][0]
    scratch_lib["marks"]["mask"] = np.zeros((H, W), np.uint8)
    (job_id,) = await restore_queue.enqueue([photo_id], "scratches", {"strict": True}, origin="auto")
    assert await restore_queue.process_next_job()
    row = await _row(conn, job_id)
    assert (row["status"], row["error_message"], row["result_photo_id"]) == ("discarded", "nothing_to_fix", None)
    async with conn.execute("SELECT COUNT(*) FROM photos WHERE derived_from_id = ?;", (photo_id,)) as cur:
        assert (await cur.fetchone())[0] == 0


async def test_touch_up_is_only_for_scratch_results_and_bad_tokens_are_refused(scratch_lib):
    job_id = await _finish(scratch_lib["ids"][0], kind="colour")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        body = {"mask_png": base64.b64encode(scratch_repair.encode_mask(_line_mask())).decode()}
        assert (await client.post(f"/api/restore/jobs/{job_id}/touch-up", json=body)).status_code == 404
        assert (await client.get(f"/api/restore/jobs/{job_id}/mask")).status_code == 404
    with pytest.raises(ValueError):
        restore_queue.mask_in_path("../../etc/passwd" + "0" * 16, False)


async def test_scratches_are_offered_for_scans_and_grey_photos_not_colour_phone_photos(scratch_lib):
    conn, photo_id = scratch_lib["conn"], scratch_lib["ids"][1]  # A colour photo.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get(f"/api/restore/photos/{photo_id}/options")).json()["scratches"] is True  # No camera data: a scan.
        await conn.execute("UPDATE photos SET iso = 100, aperture = 1.8, shutter_speed = '1/120' WHERE id = ?;", (photo_id,))
        await conn.commit()
        assert (await client.get(f"/api/restore/photos/{photo_id}/options")).json()["scratches"] is False
    assert (await _photo(conn, photo_id))["iso"] == 100


def test_a_large_photo_keeps_full_detail_outside_the_marks(fake_models):
    """The fill-in works on a 1024 px copy; only marked pixels may come from it."""
    rgb = np.random.default_rng(3).integers(0, 256, (1536, 2048, 3), dtype=np.uint8)  # Fine detail everywhere.
    mask = np.zeros(rgb.shape[:2], np.uint8)
    mask[700:704, 100:1900] = 1
    out = scratch_repair.repair(rgb, mask)
    assert (out[:600] == rgb[:600]).all() and (out[800:] == rgb[800:]).all()  # Untouched, pixel for pixel.
    assert out[702, 1000].min() > 230  # Marked: filled.
