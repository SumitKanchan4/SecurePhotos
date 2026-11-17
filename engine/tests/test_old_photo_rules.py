"""H10 / A6: automatic old-photo improvements after import — only scans of prints, one job per
photo, faces folded into the colour job, and the import hook."""

import secrets
import shutil
import tempfile
from pathlib import Path

import aiosqlite
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
        ):
            img = Image.new("RGB", (96, 72), colour)
            if colour != (128, 128, 128):
                img.paste((40, 90, 200), (48, 0, 96, 72))  # Varied colours: a colour photo.
            img.save(folder / name, "JPEG")
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
    assert len(queued) == len(jobs) == 2
    assert (ids["grey_scan.jpg"], "colour", '{"faces": true, "style": "natural"}', "auto") in jobs
    assert (ids["colour_scan.jpg"], "fade", '{"faces": true}', "auto") in jobs
    # Never: the phone's own black-and-white photo, the vault photo, the document.
    assert {j[0] for j in jobs} == {ids["grey_scan.jpg"], ids["colour_scan.jpg"]}


async def test_faces_alone_sharpens_scans_with_faces_only(library):
    ids = library["ids"]
    await update_app_settings(SettingsUpdatePayload(settings={**DEFAULTS, "old_photos_faces": "auto"}))
    assert await old_photo_rules.on_imported(ids.values()) == []  # No faces found.
    library["faces"]["count"] = 1
    await old_photo_rules.on_imported(ids.values())
    assert {(j[0], j[1]) for j in await _jobs(list(ids.values()))} == {(ids["grey_scan.jpg"], "faces"), (ids["colour_scan.jpg"], "faces")}


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


async def test_an_import_hands_its_new_photos_to_the_rules(monkeypatch):
    await run_migrations()
    handed = []

    async def record(ids):
        handed.append(list(ids))
        return []

    monkeypatch.setattr(old_photo_rules, "on_imported", record)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"scan_{secrets.token_hex(3)}.jpg"
        Image.new("RGB", (64, 48), (90, 90, 90)).save(path, "JPEG")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=120) as client:
            res = await client.post("/api/photos/import", json={"file_paths": [str(path)]})
    new_ids = res.json()["imported_photo_ids"]
    try:
        assert handed == [new_ids] and len(new_ids) == 1
    finally:
        async with db_connection() as conn:
            await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(new_ids))});", tuple(new_ids))
            await conn.commit()
