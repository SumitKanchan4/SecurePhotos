"""T14: Try again on an improved photo (engine.services.try_again and its API)."""
# The shared `lib` fixture comes from test_photo_versions; pytest passes it by name.
# ruff: noqa: F811

import json

import aiosqlite
import pytest
from httpx import ASGITransport, AsyncClient

from engine.api.system import SettingsUpdatePayload, get_app_settings, update_app_settings
from engine.main import app
from engine.services import restore_queue, try_again
from engine.tests.test_photo_versions import _photo, lib  # noqa: F401


async def _copy(lib, choice="keep_both", style="natural"):
    """An improved copy of the old photo, kept with ``choice``; returns (original id, copy id)."""
    original_id = lib["ids"][0]
    (job_id,) = await restore_queue.enqueue([original_id], "colour", {"style": style})
    assert await restore_queue.process_next_job()
    copy_id = (await restore_queue.keep_result(job_id, choice))["photo_id"]
    return original_id, copy_id


async def _retry(copy_id, style=None):
    job_id = await try_again.enqueue(copy_id, style)
    assert await restore_queue.process_next_job()
    return job_id


def test_one_job_redoes_every_fix():
    assert try_again.job_for(["colour"]) == ("colour", {"faces": False, "scratches": False})
    assert try_again.job_for(["fade", "faces"]) == ("fade", {"faces": True, "scratches": False})
    assert try_again.job_for(["colour", "scratches", "faces"]) == ("colour", {"faces": True, "scratches": True})
    assert try_again.job_for(["scratches", "faces"]) == ("faces", {"scratches": True})
    assert try_again.job_for(["scratches"]) == ("scratches", {})
    assert try_again.other_style("natural") == "vivid" and try_again.other_style("vivid") == "natural"


async def test_offered_for_an_improved_copy_whose_original_still_exists(lib):
    conn = lib["conn"]
    original_id, copy_id = await _copy(lib)
    found = await try_again.plan(conn, copy_id)
    assert found["original_id"] == original_id and found["kinds"] == ["colour"] and found["style"] == "natural"
    assert found["original_in_trash"] is False
    assert await try_again.plan(conn, original_id) is None  # Not on an original.
    # The original in Trash after "Replace" still counts; deleted for good (link cleared) doesn't.
    await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ?;", (original_id,))
    await conn.commit()
    assert (await try_again.plan(conn, copy_id))["original_in_trash"] is True
    await conn.execute("UPDATE photos SET derived_from_id = NULL WHERE id = ?;", (copy_id,))
    await conn.commit()
    assert await try_again.plan(conn, copy_id) is None


async def test_the_retry_runs_on_the_original_with_the_other_style(lib, monkeypatch):
    seen = []

    def fake(image, params, progress, cancelled):
        seen.append(params)
        from engine.tests.test_photo_versions import _result_jpeg

        return _result_jpeg()

    monkeypatch.setitem(restore_queue.PROCESSORS, "colour", restore_queue.Processor(models=(), run=fake))
    original_id, copy_id = await _copy(lib)
    job_id = await _retry(copy_id)
    conn = lib["conn"]
    conn.row_factory = aiosqlite.Row
    async with conn.execute("SELECT photo_id, status, params FROM restore_jobs WHERE id = ?;", (job_id,)) as cur:
        job = await cur.fetchone()
    assert job["photo_id"] == original_id and job["status"] == "review"  # Never kept automatically.
    assert seen[-1] == {"style": "vivid", "faces": False, "scratches": False, "redo_of": copy_id}
    # Asked for a style: that one.
    await restore_queue.keep_result(job_id, "discard")
    await _retry(copy_id, "natural")
    assert seen[-1]["style"] == "natural"


async def test_use_the_new_one_takes_over_the_copy_and_sends_it_to_trash(lib):
    conn = lib["conn"]
    original_id, copy_id = await _copy(lib)
    # Things the person did to the copy after keeping it.
    await conn.execute("UPDATE photos SET is_favorite = 0, caption = 'Lake, 1978', choice_pending = 1 WHERE id = ?;", (copy_id,))
    cur = await conn.execute("INSERT INTO albums (name) VALUES ('Best of');")
    best = cur.lastrowid
    await conn.execute("INSERT INTO photo_album (photo_id, album_id, added_at) VALUES (?, ?, CURRENT_TIMESTAMP);", (copy_id, best))
    await conn.commit()
    job_id = await _retry(copy_id)
    got = await restore_queue.keep_result(job_id, "use_new")
    new_id = got["photo_id"]
    assert got["replaced_id"] == copy_id

    new, old, orig = await _photo(conn, new_id), await _photo(conn, copy_id), await _photo(conn, original_id)
    assert new["derived_from_id"] == original_id and new["trashed_at"] is None and new["ai_kind"] == "colour"
    assert json.loads(new["ai_params"]) == {"faces": False, "scratches": False, "style": "vivid"}  # No "redo_of".
    assert (new["is_favorite"], new["caption"], new["choice_pending"]) == (0, "Lake, 1978", 1)
    assert old["trashed_at"] is not None and orig["trashed_at"] is None
    conn.row_factory = None
    async with conn.execute("SELECT album_id FROM photo_album WHERE photo_id = ? ORDER BY album_id;", (new_id,)) as cur:
        assert [r[0] for r in await cur.fetchall()] == sorted([lib["album_id"], best])
    async with conn.execute("SELECT COUNT(*) FROM faces WHERE photo_id = ? AND person_id = ?;", (new_id, lib["person_id"])) as cur:
        assert (await cur.fetchone())[0] == 1
    await conn.execute("DELETE FROM photo_album WHERE album_id = ?;", (best,))
    await conn.execute("DELETE FROM albums WHERE id = ?;", (best,))
    await conn.commit()

    # Undo: the earlier copy comes back, the new one goes to Trash.
    assert (await try_again.undo(new_id, copy_id)) == {"photo_id": copy_id}
    assert (await _photo(conn, copy_id))["trashed_at"] is None
    assert (await _photo(conn, new_id))["trashed_at"] is not None
    with pytest.raises(ValueError):
        await try_again.undo(new_id, copy_id)  # Already undone.


async def test_keep_the_current_one_changes_nothing(lib):
    conn = lib["conn"]
    _, copy_id = await _copy(lib)
    conn.row_factory = None
    async with conn.execute("SELECT COUNT(*) FROM photos;") as cur:
        before = (await cur.fetchone())[0]
    job_id = await _retry(copy_id)
    assert (await restore_queue.keep_result(job_id, "discard"))["photo_id"] is None
    async with conn.execute("SELECT COUNT(*) FROM photos;") as cur:
        assert (await cur.fetchone())[0] == before
    assert (await _photo(conn, copy_id))["trashed_at"] is None


async def test_only_use_new_or_discard_and_the_remembered_choice_is_never_used_or_changed(lib):
    _, copy_id = await _copy(lib)
    await update_app_settings(SettingsUpdatePayload(settings={"old_photos_keep_choice": "replace"}))
    job_id = await _retry(copy_id)
    for choice in ("keep_both", "replace"):
        with pytest.raises(ValueError):
            await restore_queue.keep_result(job_id, choice)
    await restore_queue.keep_result(job_id, "use_new", remember=True)
    assert (await get_app_settings())["settings"]["old_photos_keep_choice"] == "replace"
    # And "use_new" means nothing for an ordinary result.
    (plain,) = await restore_queue.enqueue([lib["ids"][1]], "colour", {"style": "natural"})
    await restore_queue.process_next_job()
    with pytest.raises(ValueError):
        await restore_queue.keep_result(plain, "use_new")
    await restore_queue.keep_result(plain, "discard")


async def test_retry_works_when_the_original_is_in_trash_after_replace(lib):
    conn = lib["conn"]
    original_id, copy_id = await _copy(lib, choice="replace")
    assert (await _photo(conn, original_id))["trashed_at"] is not None
    job_id = await _retry(copy_id)
    new_id = (await restore_queue.keep_result(job_id, "use_new"))["photo_id"]
    assert (await _photo(conn, new_id))["derived_from_id"] == original_id
    assert (await _photo(conn, original_id))["trashed_at"] is not None  # The original stays where it was.


async def test_api_offers_starts_and_undoes(lib):
    original_id, copy_id = await _copy(lib)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/restore/photos/{copy_id}/try-again", json={})
        assert res.status_code == 200 and res.json()["kinds"] == ["colour"]
        assert await restore_queue.process_next_job()
        res = await client.post(f"/api/restore/jobs/{res.json()['job_id']}/keep", json={"choice": "use_new"})
        new_id = res.json()["photo_id"]
        assert res.json()["replaced_id"] == copy_id
        res = await client.post("/api/restore/try-again/undo", json={"new_photo_id": new_id, "old_photo_id": copy_id})
        assert res.json() == {"photo_id": copy_id}
        assert (await client.post(f"/api/restore/photos/{original_id}/try-again", json={})).status_code == 404


async def test_photo_options_say_when_try_again_fits(lib):
    original_id, copy_id = await _copy(lib, style="vivid")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        copy = (await client.get(f"/api/restore/photos/{copy_id}/options")).json()
        orig = (await client.get(f"/api/restore/photos/{original_id}/options")).json()
    assert copy["again"] == {"kinds": ["colour"], "style": "vivid"}
    assert orig["again"] is None
