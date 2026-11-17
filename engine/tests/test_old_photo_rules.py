"""H10 / A6: automatic old-photo improvements after import — only scans of prints, one job per
photo, faces folded into the colour job, and the import hook."""

import secrets
import shutil
import tempfile
from pathlib import Path

import aiosqlite
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.api.system import SettingsUpdatePayload, update_app_settings
from engine.config import settings
from engine.database import db_connection, run_migrations
from engine.main import app
from engine.services import face_sharpen, old_photo_rules, restore_queue
from engine.services.media_paths import to_db_path

DEFAULTS = {"old_photos_colour": "ask", "old_photos_fade": "ask", "old_photos_faces": "ask"}


def test_only_photos_without_camera_exposure_data_count_as_scans():
    assert old_photo_rules.looks_like_a_scan(None, None, None)
    assert not old_photo_rules.looks_like_a_scan(100, None, None)
    assert not old_photo_rules.looks_like_a_scan(None, 1.8, None)
    assert not old_photo_rules.looks_like_a_scan(None, None, "1/120")


@pytest.mark.parametrize(
    "grey, faces, auto, expected",
    [
        (True, True, {"colour": True, "faces": True}, ("colour", {"style": "natural", "faces": True})),
        (True, True, {"colour": True}, ("colour", {"style": "natural", "faces": False})),  # Faces "When I ask": left alone.
        (False, False, {"fade": True}, ("fade", {"faces": False})),
        (False, True, {"fade": True, "faces": True}, ("fade", {"faces": True})),
        (True, True, {"faces": True}, ("faces", {})),
        (False, True, {"faces": True}, ("faces", {})),
        (False, False, {"faces": True}, None),
        (True, True, {"fade": True}, None),     # A grey photo isn't "faded colours".
        (False, True, {"colour": True}, None),  # A colour photo doesn't get "Add colour".
        (True, True, {}, None),
    ],
)
def test_one_job_per_photo(grey, faces, auto, expected):
    assert old_photo_rules.plan(grey, faces, auto) == expected


def _graphic(rgb):
    from engine.services.old_photo_processors import looks_like_a_graphic

    return looks_like_a_graphic(np.ascontiguousarray(rgb, dtype=np.uint8))


def test_drawings_text_and_screenshots_are_told_apart_from_photos():
    rng = np.random.default_rng(7)
    # A page of dark-mode text: black screen, a few white lines of letters.
    screen = np.zeros((600, 400, 3), np.uint8)
    for y in range(40, 560, 30):
        screen[y:y + 8, 30:30 + int(rng.integers(150, 360))] = 230
    # A pencil drawing on paper, scanned (paper grain, a few lines).
    paper = np.clip(rng.normal(240, 3, (600, 800, 3)), 0, 255)
    for x in range(100, 700, 40):
        paper[150:450, x:x + 3] = 80
    # A grainy old print of a scene: light, shade and film grain everywhere.
    scene = np.clip(np.linspace(40, 210, 800)[None, :, None] + np.linspace(-30, 30, 600)[:, None, None] + rng.normal(0, 18, (600, 800, 3)), 0, 255)
    # A photo with a big, even sky still has a gradient and grain.
    sky = scene.copy()
    sky[:300] = np.clip(np.linspace(150, 200, 300)[:, None, None] + rng.normal(0, 6, (300, 800, 3)), 0, 255)
    assert _graphic(screen)
    assert _graphic(paper)
    assert not _graphic(scene)
    assert not _graphic(sky)


@pytest.fixture
async def library(monkeypatch):
    await run_migrations()
    folder = settings.data_dir / "originals" / f"a6_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    faces = {"count": 0}
    monkeypatch.setattr(face_sharpen, "count_faces", lambda rgb, min_px=24: faces["count"])
    ids = {}
    async with db_connection() as conn:
        for name, colour, exposure, extra in (
            ("grey_scan.jpg", (128, 128, 128), (None, None, None), {}),
            ("colour_scan.jpg", (200, 60, 50), (None, None, None), {}),
            ("grey_phone.jpg", (128, 128, 128), (100, 1.8, "1/120"), {}),
            ("grey_vault.jpg", (128, 128, 128), (None, None, None), {"is_encrypted": 1}),
            ("grey_doc.jpg", (128, 128, 128), (None, None, None), {"is_document": 1}),
            ("drawing.png", None, (None, None, None), {}),
        ):
            if colour is None:  # A pencil drawing: white paper, a few grey lines.
                img = Image.new("RGB", (192, 144), (246, 244, 240))
                for x in range(20, 180, 16):
                    img.paste((90, 90, 90), (x, 30, x + 2, 120))
            else:
                img = Image.new("RGB", (96, 72), colour)
                if colour != (128, 128, 128):
                    img.paste((40, 90, 200), (48, 0, 96, 72))  # Varied colours: a colour photo.
                # Film grain and real-world light: a photo is never one flat background.
                grain = np.random.default_rng(len(name)).normal(0, 22, (72, 96, 1)) + np.linspace(-40, 40, 96)[None, :, None]
                img = Image.fromarray(np.clip(np.asarray(img, np.float32) + grain, 0, 255).astype(np.uint8))
            img.save(folder / name, "PNG" if name.endswith(".png") else "JPEG")
            cols = {"filename": name, "filepath": to_db_path(folder / name), "file_size": 1, "mime_type": "image/jpeg",
                    "iso": exposure[0], "aperture": exposure[1], "shutter_speed": exposure[2], **extra}
            cur = await conn.execute(
                f"INSERT INTO photos ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))});", tuple(cols.values())
            )
            ids[name] = cur.lastrowid
        await conn.commit()
    yield {"ids": ids, "faces": faces}
    await update_app_settings(SettingsUpdatePayload(settings=DEFAULTS))
    async with db_connection() as conn:
        marks = ",".join("?" * len(ids))
        await conn.execute(f"DELETE FROM restore_jobs WHERE photo_id IN ({marks});", tuple(ids.values()))
        await conn.execute(f"DELETE FROM photos WHERE id IN ({marks});", tuple(ids.values()))
        await conn.commit()
    shutil.rmtree(folder, ignore_errors=True)


async def _jobs(photo_ids):
    async with db_connection() as conn:
        conn.row_factory = aiosqlite.Row
        marks = ",".join("?" * len(photo_ids))
        async with conn.execute(
            f"SELECT photo_id, kind, params, origin FROM restore_jobs WHERE photo_id IN ({marks}) ORDER BY id;", tuple(photo_ids)
        ) as cur:
            return [(r["photo_id"], r["kind"], r["params"], r["origin"]) for r in await cur.fetchall()]


async def test_nothing_happens_while_every_row_is_when_i_ask(library):
    await update_app_settings(SettingsUpdatePayload(settings=DEFAULTS))
    assert await old_photo_rules.on_imported(library["ids"].values()) == []
    assert await _jobs(list(library["ids"].values())) == []


async def test_automatic_rows_touch_only_scans_and_fold_faces_into_the_colour_job(library):
    ids = library["ids"]
    library["faces"]["count"] = 2
    await update_app_settings(SettingsUpdatePayload(settings={"old_photos_colour": "auto", "old_photos_fade": "auto", "old_photos_faces": "auto"}))
    queued = await old_photo_rules.on_imported(ids.values())
    jobs = await _jobs(list(ids.values()))
    assert len(queued) == len(jobs) == 4
    assert (ids["grey_scan.jpg"], "colour", '{"faces": true, "style": "natural"}', "auto") in jobs
    assert (ids["colour_scan.jpg"], "fade", '{"faces": true}', "auto") in jobs
    # A8: a drawing and a document are improved too, but always keep their original.
    assert (ids["drawing.png"], "colour", '{"faces": true, "keep_both": true, "style": "natural"}', "auto") in jobs
    assert (ids["grey_doc.jpg"], "colour", '{"faces": true, "keep_both": true, "style": "natural"}', "auto") in jobs
    # Never: the phone's own black-and-white photo, the vault photo.
    assert {j[0] for j in jobs} == {ids["grey_scan.jpg"], ids["colour_scan.jpg"], ids["drawing.png"], ids["grey_doc.jpg"]}
    # Every photo the rules looked at is recorded (8K waits for it), whatever they decided.
    async with db_connection() as conn:
        async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE restore_checked = 1 AND id IN ({','.join('?' * len(ids))});", tuple(ids.values())) as cur:
            assert (await cur.fetchone())[0] == len(ids)  # Including the ones skipped (phone photo, vault).


async def test_faces_alone_sharpens_scans_with_faces_only(library):
    ids = library["ids"]
    await update_app_settings(SettingsUpdatePayload(settings={**DEFAULTS, "old_photos_faces": "auto"}))
    assert await old_photo_rules.on_imported(ids.values()) == []  # No faces found.
    library["faces"]["count"] = 1
    await old_photo_rules.on_imported(ids.values())
    assert {(j[0], j[1]) for j in await _jobs(list(ids.values()))} == {
        (ids["grey_scan.jpg"], "faces"), (ids["colour_scan.jpg"], "faces"), (ids["drawing.png"], "faces"), (ids["grey_doc.jpg"], "faces"),
    }


async def test_automatic_jobs_go_after_what_the_user_asked_for(library, monkeypatch):
    ids = library["ids"]
    await update_app_settings(SettingsUpdatePayload(settings={**DEFAULTS, "old_photos_colour": "auto"}))
    (auto_job,) = await old_photo_rules.on_imported([ids["grey_scan.jpg"]])
    (manual_job,) = await restore_queue.enqueue([ids["colour_scan.jpg"]], "fade")
    seen = []
    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=lambda *a: seen.append("colour") or b""))
    monkeypatch.setitem(restore_queue.PROCESSORS, "fade", restore_queue.Processor(models=(), run=lambda *a: seen.append("fade") or b""))

    async def mains():
        return False

    monkeypatch.setattr(restore_queue, "_holding_auto_jobs", mains)
    monkeypatch.setitem(restore_queue.state, "paused", False)
    await restore_queue.process_next_job()
    assert seen == ["fade"]
    for job_id in (auto_job, manual_job):
        await restore_queue.cancel(job_id)


async def test_an_import_hands_its_new_photos_to_the_after_import_process(monkeypatch):
    """Since P2 the rules are a step of the after-import process (after text and faces): an
    import wakes it, and its new photos wait for the rules."""
    from engine.services import after_import

    await run_migrations()
    handed = []
    monkeypatch.setattr(after_import, "wake", lambda: handed.append("woken"))
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"scan_{secrets.token_hex(3)}.jpg"
        Image.new("RGB", (64, 48), (90, 90, 90)).save(path, "JPEG")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=120) as client:
            res = await client.post("/api/photos/import", json={"file_paths": [str(path)]})
    new_ids = res.json()["imported_photo_ids"]
    try:
        assert handed == ["woken"] and len(new_ids) == 1
        async with db_connection() as conn:
            async with conn.execute("SELECT restore_checked FROM photos WHERE id = ?;", (new_ids[0],)) as cur:
                assert (await cur.fetchone())[0] == 0  # Waits for the rules (and 8K waits for them).
    finally:
        async with db_connection() as conn:
            await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(new_ids))});", tuple(new_ids))
            await conn.commit()
