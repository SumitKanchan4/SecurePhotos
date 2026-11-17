"""After-import process, P1: text and faces for every library photo, in order, recorded on the
photo, newest first; documents get no faces (owner D1); Pause all and the battery setting hold
it (D5); vault and Trash never."""

import secrets
import shutil

import pytest

from engine.api import photos as photos_api
from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.services import after_import, document_service, face_clustering_service, face_scan_worker

RECEIPT_TEXT = "CROMA Invoice No 4471 Qty 1 Rate 2499 Amount 2499 GST 18% Total 2949 Payment card"


@pytest.fixture
async def lib(monkeypatch):
    await run_migrations()
    order = []

    async def fake_ocr(path):
        name = str(path).replace("\\", "/").rsplit("/", 1)[-1]
        order.append(("text", name))
        if name.startswith("broken"):
            raise RuntimeError("unreadable")
        return RECEIPT_TEXT if name.startswith("receipt") else ""

    async def fake_scan(conn, row, thumbnails_dir):
        order.append(("faces", row["filename"]))
        await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (row["id"],))
        await conn.commit()
        return 2

    async def fake_faces_ready():
        return True

    async def no_hold():
        return None

    reclusters = []

    async def fake_recluster():
        reclusters.append(1)

    monkeypatch.setattr(document_service, "extract_ocr_text_on_device", fake_ocr)
    monkeypatch.setattr(face_scan_worker, "scan_photo_faces", fake_scan)
    monkeypatch.setattr(after_import, "_faces_ready", fake_faces_ready)
    monkeypatch.setattr(after_import, "_hold_reason", no_hold)
    monkeypatch.setattr(face_clustering_service, "recluster_all_faces", fake_recluster)

    tag = secrets.token_hex(3)
    folder = settings.data_dir / "originals" / tag
    folder.mkdir(parents=True)
    conn = await get_db_connection()
    # Only this test's photos are waiting: everything else in the shared test database is done.
    await conn.execute("UPDATE photos SET ocr_text = COALESCE(ocr_text, ''), faces_scanned = 1, restore_checked = 1, phash = COALESCE(phash, '');")
    ids = {}
    for name, extra in (
        ("old.jpg", {}),
        ("receipt.jpg", {}),
        ("vault.jpg", {"is_encrypted": 1}),
        ("trashed.jpg", {"trashed_at": "2026-11-01 00:00:00"}),
        ("clip.mp4", {"mime_type": "video/mp4"}),
        ("broken.jpg", {}),
        ("new.jpg", {}),
    ):
        (folder / name).write_bytes(b"x")  # The text reader is a stand-in; the file just has to exist.
        cols = {"filename": name, "filepath": f"originals/{tag}/{name}", "file_size": 1, "mime_type": "image/jpeg", "faces_scanned": 0, **extra}
        cur = await conn.execute(f"INSERT INTO photos ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))});", tuple(cols.values()))
        ids[name] = cur.lastrowid
    await conn.commit()
    yield {"conn": conn, "ids": ids, "order": order, "reclusters": reclusters}
    marks = ",".join("?" * len(ids))
    await conn.execute(f"DELETE FROM photos WHERE id IN ({marks});", tuple(ids.values()))
    await conn.commit()
    await conn.close()
    shutil.rmtree(folder, ignore_errors=True)


async def _run_all():
    steps = 0
    while await after_import.run_once():
        steps += 1
        assert steps < 50
    await after_import._finish_faces()


async def _row(conn, photo_id):
    async with conn.execute("SELECT ocr_text, faces_scanned, is_document, document_source FROM photos WHERE id = ?;", (photo_id,)) as cur:
        return tuple(await cur.fetchone())


async def test_text_then_faces_newest_first_documents_without_faces(lib):
    conn, ids, order = lib["conn"], lib["ids"], lib["order"]
    assert (await after_import.counts())["text_waiting"] == 4  # Not the vault, Trash or video.
    await _run_all()
    texts = [name for step, name in order if step == "text"]
    faces = [name for step, name in order if step == "faces"]
    assert texts == ["new.jpg", "broken.jpg", "receipt.jpg", "old.jpg"]  # Newest import first.
    assert order.index(("text", "old.jpg")) < order.index(("faces", "old.jpg"))  # Text before faces.
    assert faces == ["new.jpg", "broken.jpg", "clip.mp4", "old.jpg"]  # The receipt gets no faces (D1).
    assert await _row(conn, ids["receipt.jpg"]) == (RECEIPT_TEXT, 0, 1, "scan")
    assert (await _row(conn, ids["broken.jpg"]))[0] == ""  # Unreadable: recorded, never retried forever.
    assert await _row(conn, ids["vault.jpg"]) == (None, 0, 0, None)  # The vault is never touched.
    assert await _row(conn, ids["trashed.jpg"]) == (None, 0, 0, None)
    assert lib["reclusters"] == [1]  # Grouped once after the run, not per photo.
    assert await after_import.counts() == {"text_waiting": 0, "faces_waiting": 0, "rules_waiting": 0, "dups_waiting": 0}
    # The old-photo rules looked at every original last (P2): 8K waits for this.
    async with conn.execute(f"SELECT filename, restore_checked FROM photos WHERE id IN ({','.join('?' * len(ids))});", tuple(ids.values())) as cur:
        checked = dict(await cur.fetchall())
    assert checked == {"old.jpg": 1, "receipt.jpg": 1, "broken.jpg": 1, "new.jpg": 1, "vault.jpg": 0, "trashed.jpg": 0, "clip.mp4": 0}


async def test_a_document_the_owner_makes_a_photo_gets_faces_and_stays_a_photo(lib):
    conn, ids, order = lib["conn"], lib["ids"], lib["order"]
    await _run_all()
    assert await document_service.toggle_document_status(ids["receipt.jpg"], False)
    assert (await after_import.counts())["faces_waiting"] == 1
    await _run_all()
    assert ("faces", "receipt.jpg") in order
    assert await _row(conn, ids["receipt.jpg"]) == (RECEIPT_TEXT, 1, 0, "user")
    await document_service.scan_library_for_documents()  # A later scan respects the owner's choice.
    assert (await _row(conn, ids["receipt.jpg"]))[2] == 0


async def test_people_shows_progress_while_faces_are_found(lib, monkeypatch):
    seen = []
    real = face_scan_worker.scan_photo_faces

    async def watching(conn, row, thumbnails_dir):
        seen.append(face_scan_worker.face_scan_state["is_scanning"])
        return await real(conn, row, thumbnails_dir)

    monkeypatch.setattr(face_scan_worker, "scan_photo_faces", watching)
    await _run_all()
    assert seen and all(seen)
    assert face_scan_worker.face_scan_state["is_scanning"] is False


async def test_pause_all_and_the_battery_setting_hold_everything(monkeypatch):
    async def settings():
        return {"pause_on_battery": True, "battery_pause_below": 20}

    monkeypatch.setattr(photos_api, "_load_enhancement_settings", settings)
    monkeypatch.setattr(photos_api, "enhancement_paused_by_user", False)
    monkeypatch.setattr(photos_api, "_running_on_battery", lambda: True)
    monkeypatch.setattr(photos_api, "_battery_percent", lambda: 12.0)
    assert await after_import._hold_reason() == "on_battery"
    monkeypatch.setattr(photos_api, "_battery_percent", lambda: 80.0)
    assert await after_import._hold_reason() is None
    monkeypatch.setattr(photos_api, "enhancement_paused_by_user", True)
    assert await after_import._hold_reason() == "by_user"


async def test_new_photos_are_waiting_straight_after_import(lib):
    # Nothing to flag on import: a new photo simply has no text read and no faces yet.
    counts = await after_import.counts()
    assert counts == {"text_waiting": 4, "faces_waiting": 1, "rules_waiting": 0, "dups_waiting": 0}  # Only the video can go to faces now.


async def test_fingerprints_for_duplicates_then_one_regrouping_and_stories(lib, monkeypatch):
    """P3: after the text, each photo gets its duplicate fingerprint (from the thumbnail); at the
    end of the run duplicates are regrouped once and the new photos' stories are suggested."""
    from PIL import Image

    from engine.services import duplicate_service, stories_planner

    conn, ids = lib["conn"], lib["ids"]
    thumb = settings.data_dir / "thumbnails" / f"p3_{ids['old.jpg']}.webp"
    thumb.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (64, 48), (200, 30, 30)).save(thumb, "WEBP")
    await conn.execute("UPDATE photos SET thumbnail_path = ? WHERE id = ?;", (f"thumbnails/{thumb.name}", ids["old.jpg"]))
    await conn.commit()
    events = []

    async def regroup(c):
        events.append("duplicates")
        return []

    async def stories_after():
        events.append("stories")

    async def daily(today=None):
        events.append("daily")
        return False

    monkeypatch.setattr(duplicate_service, "scan_and_cluster_duplicates", regroup)
    monkeypatch.setattr(stories_planner, "after_import", stories_after)
    monkeypatch.setattr(stories_planner, "daily_if_due", daily)
    monkeypatch.setattr(after_import, "_start_enhancement", lambda: events.append("8K"))
    try:
        assert (await after_import.counts())["dups_waiting"] == 0  # Not before its text is read.
        await _run_all()
        async with conn.execute("SELECT phash FROM photos WHERE id = ?;", (ids["old.jpg"],)) as cur:
            assert len((await cur.fetchone())[0]) == 16  # A 64-bit fingerprint.
        await after_import.finish_run()
        assert events == ["duplicates", "8K", "stories", "daily"]
        events.clear()
        await after_import.finish_run()  # Nothing new: only the daily check.
        assert events == ["daily"]
    finally:
        thumb.unlink(missing_ok=True)
