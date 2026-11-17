"""H10 / A2b: improved copies of photos, linked to their originals (keep both / replace / discard)."""

import builtins
import io
import secrets
import shutil

import aiosqlite
import piexif
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.api import people as people_api
from engine.api.system import SettingsUpdatePayload, get_app_settings, update_app_settings
from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import photo_versions, restore_queue, vault_storage
from engine.services.crypto_vault import decrypt_file_to_bytes, decrypt_photo_metadata
from engine.services.duplicate_service import scan_and_cluster_duplicates
from engine.services.face_recognition_service import get_face_thumbnails_dir
from engine.services.media_paths import resolve_stored_path, to_db_path

TAKEN = "1974-06-01 10:00:00"


def _jpeg(path, colour, make=b"OldCam"):
    exif = piexif.dump({"0th": {piexif.ImageIFD.Make: make}})
    img = Image.new("RGB", (96, 72), colour)
    img.paste((200, 200, 200), (10, 10, 40, 40))
    img.save(path, "JPEG", quality=92, exif=exif)


def _result_jpeg() -> bytes:
    """What a processor hands back: the same picture, a little brighter (looks alike on purpose)."""
    img = Image.new("RGB", (96, 72), (130, 110, 90))
    img.paste((230, 210, 200), (10, 10, 40, 40))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=92)
    return out.getvalue()


@pytest.fixture
async def lib(monkeypatch):
    """An old photo with a date, place, camera, favourite, caption, album and a named face; a fake 'colour' processor."""
    await run_migrations()
    folder = settings.data_dir / "originals" / f"a2b_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=lambda *a: _result_jpeg()))
    monkeypatch.setitem(restore_queue.PROCESSORS, "faces", restore_queue.Processor(models=(), run=lambda *a: _result_jpeg()))
    monkeypatch.setitem(restore_queue.PROCESSORS, "fade", restore_queue.Processor(models=(), run=lambda *a: _result_jpeg()))
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: None)

    async def mains():
        return False

    monkeypatch.setattr(restore_queue, "_holding_auto_jobs", mains)
    monkeypatch.setitem(restore_queue.state, "paused", False)
    conn = await get_db_connection()
    conn.row_factory = aiosqlite.Row
    _jpeg(folder / "grandparents.jpg", (120, 100, 80))
    _jpeg(folder / "other.jpg", (20, 120, 220))
    ids = []
    for name in ("grandparents.jpg", "other.jpg"):
        cur = await conn.execute(
            """INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, latitude, longitude,
                   camera_make, is_favorite, caption, is_optimized, is_enhanced, faces_scanned)
               VALUES (?, ?, 100, 'image/jpeg', ?, 18.52, 73.85, 'OldCam', 1, 'At the fair', 1, 1, 1);""",
            (name, to_db_path(folder / name), TAKEN),
        )
        ids.append(cur.lastrowid)
    cur = await conn.execute("INSERT INTO albums (name) VALUES ('Family 1970s');")
    album_id = cur.lastrowid
    await conn.execute("INSERT INTO photo_album (photo_id, album_id, added_at) VALUES (?, ?, '2020-01-01 00:00:00');", (ids[0], album_id))
    cur = await conn.execute("INSERT INTO persons (name) VALUES ('Asha');")
    person_id = cur.lastrowid
    cur = await conn.execute(
        "INSERT INTO faces (photo_id, person_id, box_x, box_y, box_w, box_h, quality_score, embedding) VALUES (?, ?, 0.1, 0.1, 0.3, 0.3, 0.9, '[0.1]');",
        (ids[0], person_id),
    )
    crop = get_face_thumbnails_dir() / f"{cur.lastrowid}.webp"
    crop.write_bytes(b"face crop")
    await conn.commit()
    env = {"conn": conn, "ids": ids, "folder": folder, "album_id": album_id, "person_id": person_id}
    yield env
    async with conn.execute("SELECT id FROM photos WHERE id IN (?, ?) OR derived_from_id IN (?, ?);", (*ids, *ids)) as c:
        all_ids = [r[0] for r in await c.fetchall()]
    marks = ",".join("?" * len(all_ids))
    await conn.execute(f"DELETE FROM restore_jobs WHERE photo_id IN ({marks});", all_ids)
    await conn.execute(f"DELETE FROM faces WHERE photo_id IN ({marks});", all_ids)
    await conn.execute(f"DELETE FROM photos WHERE id IN ({marks});", all_ids)
    await conn.execute("DELETE FROM albums WHERE id = ?;", (album_id,))
    await conn.execute("DELETE FROM persons WHERE id = ?;", (person_id,))
    await conn.execute("DELETE FROM duplicate_groups;")
    await conn.commit()
    await conn.close()
    shutil.rmtree(folder, ignore_errors=True)
    shutil.rmtree(restore_queue.staging_dir(), ignore_errors=True)
    await update_app_settings(SettingsUpdatePayload(settings={"old_photos_keep_original": True, "old_photos_keep_choice": "ask"}))


async def _finish(photo_id, kind="colour", origin="manual"):
    (job_id,) = await restore_queue.enqueue([photo_id], kind, {"style": "natural"}, origin=origin)
    assert await restore_queue.process_next_job()
    return job_id


async def _photo(conn, photo_id):
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT * FROM photos WHERE id = ?;", (photo_id,)) as cur:
        return await cur.fetchone()


async def test_keep_both_adds_a_linked_copy_with_the_same_details(lib):
    conn, original_id = lib["conn"], lib["ids"][0]
    original_bytes = (lib["folder"] / "grandparents.jpg").read_bytes()
    job_id = await _finish(original_id)
    new_id = (await restore_queue.keep_result(job_id, "keep_both"))["photo_id"]

    new, orig = await _photo(conn, new_id), await _photo(conn, original_id)
    assert new["derived_from_id"] == original_id and new["ai_kind"] == "colour" and new["edited_at"]
    for col in ("taken_at", "latitude", "longitude", "camera_make", "is_favorite", "caption", "is_enhanced"):
        assert new[col] == orig[col], col
    assert new["filename"] == "grandparents_colour.avif" and new["mime_type"] == "image/avif"
    assert orig["trashed_at"] is None and (lib["folder"] / "grandparents.jpg").read_bytes() == original_bytes

    path = resolve_stored_path(new["filepath"])
    with Image.open(path) as im:
        assert im.format == "AVIF" and im.getexif().get(0x010F) == "OldCam"  # Camera details kept.
        assert b"compositeWithTrainedAlgorithmicMedia" in im.info["xmp"]   # Labelled as made with AI.
    assert resolve_stored_path(new["thumbnail_path"]).is_file()

    async with conn.execute("SELECT added_at FROM photo_album WHERE album_id = ? ORDER BY photo_id;", (lib["album_id"],)) as cur:
        assert [r[0] for r in await cur.fetchall()] == ["2020-01-01 00:00:00"] * 2  # Same album, beside the original.
    async with conn.execute("SELECT id, person_id, box_x FROM faces WHERE photo_id = ?;", (new_id,)) as cur:
        faces = await cur.fetchall()
    assert [(f["person_id"], f["box_x"]) for f in faces] == [(lib["person_id"], 0.1)]
    assert (get_face_thumbnails_dir() / f"{faces[0]['id']}.webp").read_bytes() == b"face crop"

    async with conn.execute("SELECT status, result_photo_id, result_path FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        assert tuple(await cur.fetchone()) == ("done", new_id, None)
    assert not any(restore_queue.staging_dir().iterdir())


async def test_replace_moves_the_original_to_trash_and_it_can_come_back(lib):
    conn, original_id = lib["conn"], lib["ids"][0]
    new_id = (await restore_queue.keep_result(await _finish(original_id), "replace"))["photo_id"]
    assert (await _photo(conn, original_id))["trashed_at"] is not None  # Trash: 30 days, not deleted.
    assert resolve_stored_path((await _photo(conn, original_id))["filepath"]).is_file()

    group = await photo_versions.versions_of(conn, new_id)
    assert group["original_id"] == original_id
    assert [(m["id"], m["is_original"], m["trashed"]) for m in group["members"]] == [(original_id, True, True), (new_id, False, False)]

    assert await photo_versions.restore_original(conn, new_id) == original_id
    assert (await _photo(conn, original_id))["trashed_at"] is None
    assert (await _photo(conn, new_id))["trashed_at"] is None  # Both kept, still linked.
    with pytest.raises(photo_versions.VersionError):
        await photo_versions.restore_original(conn, original_id)  # An original has nothing to restore.


async def test_discard_changes_nothing(lib):
    conn, original_id = lib["conn"], lib["ids"][0]
    job_id = await _finish(original_id)
    assert (await restore_queue.keep_result(job_id, "discard")) == {"photo_id": None}
    async with conn.execute("SELECT COUNT(*) FROM photos WHERE derived_from_id = ?;", (original_id,)) as cur:
        assert (await cur.fetchone())[0] == 0
    async with conn.execute("SELECT status FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        assert (await cur.fetchone())[0] == "discarded"
    assert not any(restore_queue.staging_dir().iterdir())
    with pytest.raises(ValueError):
        await restore_queue.keep_result(job_id, "keep_both")  # Already decided.
    with pytest.raises(ValueError):
        await restore_queue.keep_result(job_id, "maybe")


async def test_remember_my_choice_is_saved(lib):
    await restore_queue.keep_result(await _finish(lib["ids"][0]), "replace", remember=True)
    assert (await get_app_settings())["settings"]["old_photos_keep_choice"] == "replace"


@pytest.mark.parametrize("keep_original", [True, False])
async def test_automatic_jobs_follow_the_keep_original_switch(lib, keep_original):
    conn, original_id = lib["conn"], lib["ids"][0]
    await update_app_settings(SettingsUpdatePayload(settings={"old_photos_keep_original": keep_original}))
    job_id = await _finish(original_id, origin="auto")
    async with conn.execute("SELECT status, result_photo_id FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        status, new_id = await cur.fetchone()
    assert status == "done" and new_id  # Nobody is asked.
    assert ((await _photo(conn, original_id))["trashed_at"] is None) is keep_original


async def test_improving_an_improved_photo_links_to_the_first_original(lib):
    conn, original_id = lib["conn"], lib["ids"][0]
    first = (await restore_queue.keep_result(await _finish(original_id), "keep_both"))["photo_id"]
    second = (await restore_queue.keep_result(await _finish(first, kind="faces"), "keep_both"))["photo_id"]
    row = await _photo(conn, second)
    assert row["derived_from_id"] == original_id and row["ai_kind"] == "colour,faces"


async def test_the_plain_colour_fix_is_labelled_as_enhanced_not_ai_made(lib):
    new_id = (await restore_queue.keep_result(await _finish(lib["ids"][0], kind="fade"), "keep_both"))["photo_id"]
    with Image.open(resolve_stored_path((await _photo(lib["conn"], new_id))["filepath"])) as im:
        assert b"digitalsourcetype/algorithmicallyEnhanced" in im.info["xmp"]


async def test_the_copy_sits_right_after_its_original_in_photos(lib):
    original_id, other_id = lib["ids"]
    new_id = (await restore_queue.keep_result(await _finish(original_id), "keep_both"))["photo_id"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        items = (await client.get("/api/photos/timeline")).json()["items"]
        details = (await client.get(f"/api/photos/details?ids={new_id}")).json()
    order = [i[0] for i in items if i[0] in (original_id, other_id, new_id)]
    assert order == [other_id, original_id, new_id]  # Same date: the pair stays together, original first.
    flags = {i[0]: i[5] for i in items}
    assert flags[new_id] & 8 and not flags[original_id] & 8  # AI badge flag on the copy only.
    assert details[0]["derived_from_id"] == original_id and details[0]["ai_kind"] == "colour"


async def test_people_count_the_pair_once_and_show_the_copy(lib):
    conn, original_id = lib["conn"], lib["ids"][0]
    assert await people_api._library_photo_count(conn, "person_id", lib["person_id"]) == 1
    new_id = (await restore_queue.keep_result(await _finish(original_id), "keep_both"))["photo_id"]
    assert await people_api._library_photo_count(conn, "person_id", lib["person_id"]) == 1
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/people/{lib['person_id']}/photos")
    assert res.status_code == 200 and [p["id"] for p in res.json()] == [new_id]


async def test_a_photo_and_its_copy_are_never_offered_as_duplicates(lib):
    conn, original_id = lib["conn"], lib["ids"][0]
    new_id = (await restore_queue.keep_result(await _finish(original_id), "keep_both"))["photo_id"]
    groups = await scan_and_cluster_duplicates(conn)
    assert not any({original_id, new_id} <= {p["id"] for p in g["photos"]} for g in groups)


# ── Vault ───────────────────────────────────────────────────────────────────


@pytest.fixture
async def vault_lib(lib, monkeypatch):
    conn, mvk = lib["conn"], secrets.token_bytes(32)
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (lib["ids"][0],)) as cur:
        assert await vault_storage.lock_photo(conn, await cur.fetchone(), mvk)
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: mvk)
    yield {**lib, "mvk": mvk}
    await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (lib["ids"][0],))
    await conn.commit()


async def test_a_vault_photos_copy_stays_in_the_vault_and_nothing_plain_is_written(vault_lib, monkeypatch):
    conn, mvk, original_id = vault_lib["conn"], vault_lib["mvk"], vault_lib["ids"][0]
    job_id = await _finish(original_id)
    written, real_open = [], builtins.open

    def spy(file, mode="r", *a, **k):
        if any(m in mode for m in "wax+"):
            written.append(str(file))
        return real_open(file, mode, *a, **k)

    monkeypatch.setattr(builtins, "open", spy)
    new_id = (await restore_queue.keep_result(job_id, "keep_both"))["photo_id"]
    monkeypatch.setattr(builtins, "open", real_open)

    new = await _photo(conn, new_id)
    assert new["is_encrypted"] == 1 and new["vault_type"] == "private" and new["latitude"] is None
    assert new["filepath"].endswith("grandparents_colour.avif.enc") and new["thumbnail_path"].endswith(".enc")
    with Image.open(io.BytesIO(decrypt_file_to_bytes(resolve_stored_path(new["filepath"]), mvk))) as im:
        assert im.format == "AVIF"
    details = decrypt_photo_metadata(new["vault_meta_enc"], mvk, new_id)  # Re-sealed for the new photo.
    assert (details["latitude"], details["longitude"]) == (18.52, 73.85)
    async with conn.execute("SELECT COUNT(*) FROM faces WHERE photo_id = ?;", (new_id,)) as cur:
        assert (await cur.fetchone())[0] == 0  # Vault photos have no face records.
    media = [w for w in written if "originals" in w or "thumbnails" in w]
    assert media and all(".enc" in w for w in media), media


async def test_keeping_a_vault_result_needs_the_vault_open(vault_lib, monkeypatch):
    job_id = await _finish(vault_lib["ids"][0])
    monkeypatch.setattr(restore_queue, "_vault_key", lambda: None)
    with pytest.raises(photo_versions.VersionError, match="vault_locked"):
        await restore_queue.keep_result(job_id, "keep_both")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "keep_both"})
    assert res.status_code == 409


# ── API ─────────────────────────────────────────────────────────────────────


async def test_api_keep_versions_and_restore(lib):
    original_id = lib["ids"][0]
    job_id = await _finish(original_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "sideways"})).status_code == 400
        res = await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "replace"})
        new_id = res.json()["photo_id"]
        group = (await client.get(f"/api/restore/photos/{original_id}/versions")).json()
        assert [m["id"] for m in group["members"]] == [original_id, new_id]
        assert (await client.post(f"/api/restore/photos/{original_id}/restore-original")).status_code == 404
        assert (await client.post(f"/api/restore/photos/{new_id}/restore-original")).json() == {"original_id": original_id}
        assert (await client.get("/api/restore/photos/999999/versions")).status_code == 404


async def test_stories_use_the_copy_not_both(lib):
    from engine.services.stories_service import delete_story, generate_year_in_review_story

    original_id, other_id = lib["ids"]
    new_id = (await restore_queue.keep_result(await _finish(original_id), "keep_both"))["photo_id"]
    story = await generate_year_in_review_story("1974")
    try:
        shown = {s.photo_id for s in story.slides}
        assert new_id in shown and other_id in shown and original_id not in shown
    finally:
        await delete_story(story.id)


# ── A3 endpoints: the waiting result, which actions fit, the strength slider ──


async def test_viewer_gets_the_waiting_result_and_the_actions_that_fit(lib):
    original_id, colour_id = lib["ids"]
    job_id = await _finish(original_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/restore/jobs/{job_id}/result")
        assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
        assert Image.open(io.BytesIO(res.content)).size == (96, 72)
        await restore_queue.keep_result(job_id, "discard")
        assert (await client.get(f"/api/restore/jobs/{job_id}/result")).status_code == 404  # Nothing waiting any more.

        conn = lib["conn"]
        grey = settings.data_dir / "originals" / f"grey_{secrets.token_hex(2)}.jpg"
        Image.new("RGB", (64, 48), (128, 128, 128)).save(grey, "JPEG")
        cur = await conn.execute("INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('grey.jpg', ?, 1, 'image/jpeg');", (to_db_path(grey),))
        grey_id = cur.lastrowid
        await conn.commit()
        try:
            assert (await client.get(f"/api/restore/photos/{grey_id}/options")).json() == {"colour": True, "fade": False, "faces": False}
            assert (await client.get(f"/api/restore/photos/{colour_id}/options")).json() == {"colour": False, "fade": True, "faces": False}
            assert (await client.get("/api/restore/photos/999999/options")).status_code == 404
        finally:
            await conn.execute("DELETE FROM photos WHERE id = ?;", (grey_id,))
            await conn.commit()
            grey.unlink(missing_ok=True)


async def test_strength_zero_keeps_the_original_look(lib, monkeypatch):
    conn, original_id = lib["conn"], lib["ids"][0]
    blue = io.BytesIO()
    Image.new("RGB", (96, 72), (20, 60, 220)).save(blue, "JPEG", quality=95)
    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=lambda *a: blue.getvalue()))
    job_id = await _finish(original_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "keep_both", "intensity": 0})
        assert (await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "keep_both", "intensity": 2})).status_code == 422
    new = await _photo(conn, res.json()["photo_id"])
    with Image.open(resolve_stored_path(new["filepath"])) as im:
        copy = im.convert("RGB").getpixel((60, 60))
    with Image.open(lib["folder"] / "grandparents.jpg") as im:
        orig = im.convert("RGB").getpixel((60, 60))
    assert max(abs(a - b) for a, b in zip(copy, orig)) < 12  # The original's pixels, not the blue result.


async def test_viewer_state_in_one_request(lib, monkeypatch):
    original_id = lib["ids"][0]
    two_colours = io.BytesIO()
    img = Image.new("RGB", (96, 72), (200, 60, 50))
    img.paste((40, 90, 200), (48, 0, 96, 72))
    img.save(two_colours, "JPEG", quality=95)
    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=lambda *a: two_colours.getvalue()))
    job_id = await _finish(original_id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        state = (await client.get(f"/api/restore/photos/{original_id}/state")).json()
        assert state["options"] == {"colour": False, "fade": True, "faces": False}
        assert state["job"]["id"] == job_id and state["job"]["status"] == "review"
        assert [m["id"] for m in state["members"]] == [original_id]
        new_id = (await client.post(f"/api/restore/jobs/{job_id}/keep", json={"choice": "keep_both"})).json()["photo_id"]
        state = (await client.get(f"/api/restore/photos/{new_id}/state")).json()
        assert state["job"] is None and [m["id"] for m in state["members"]] == [original_id, new_id]
        assert state["options"] == {"colour": False, "fade": False, "faces": False}  # Already coloured: nothing more to offer.
        assert (await client.get("/api/restore/photos/999999/state")).status_code == 404
