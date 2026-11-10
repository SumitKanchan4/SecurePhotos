"""Vault privacy tests (backlog item C4).

Locking a photo must leave no readable document text, GPS location or face data
for it on the drive; library photos' faces must be untouched; unlocking restores
the details and queues a fresh face scan.
"""

import secrets
import shutil

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, rebuild_fts_index, run_migrations
from engine.main import app
from engine.services import vault_storage
from engine.services.face_recognition_service import get_face_thumbnails_dir
from engine.services.media_paths import to_db_path

SECRET_TEXT = "PASSPORT Z7734519 MEDICALREPORT"
SECRET_TOKEN = b"Z7734519"
LAT, LON = 48.858370, 2.294481
PASSWORD = "PrivacyTestPass#1"
PHRASE = {"confirm_phrase": "ERASE ALL DATA"}


class SimulatedCrash(BaseException):
    """Stands in for the process dying (bypasses normal error handling)."""


async def _photo(conn, folder, name, **cols):
    path = folder / name
    Image.new("RGB", (80, 60), color=(30, 60, 90)).save(path, format="JPEG")
    fields = {"filename": name, "filepath": to_db_path(path), "file_size": path.stat().st_size,
              "mime_type": "image/jpeg", "faces_scanned": 1, **cols}
    cur = await conn.execute(
        f"INSERT INTO photos ({','.join(fields)}) VALUES ({','.join('?' * len(fields))});", list(fields.values())
    )
    return cur.lastrowid


async def _face(conn, photo_id, person_id):
    cur = await conn.execute(
        "INSERT INTO faces (photo_id, person_id, box_x, box_y, box_w, box_h, embedding) VALUES (?, ?, .1, .1, .2, .2, '[0.1]');",
        (photo_id, person_id),
    )
    crop = get_face_thumbnails_dir() / f"{cur.lastrowid}.webp"
    Image.new("RGB", (8, 8)).save(crop, format="WEBP")
    return cur.lastrowid, crop


@pytest.fixture
async def library():
    """One photo to lock (with document text, GPS, a face) and one library photo of the same person."""
    await run_migrations()
    folder = settings.data_dir / "originals" / f"c4_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    conn = await get_db_connection()
    try:
        cur = await conn.execute("INSERT INTO persons (name) VALUES ('Test Person');")
        person_id = cur.lastrowid
        private_id = await _photo(conn, folder, "private_doc.jpg", ocr_text=SECRET_TEXT, latitude=LAT, longitude=LON, is_document=1)
        public_id = await _photo(conn, folder, "public.jpg")
        private_face, private_crop = await _face(conn, private_id, person_id)
        public_face, public_crop = await _face(conn, public_id, person_id)
        await conn.commit()
    finally:
        await conn.close()
    yield {
        "folder": folder, "person_id": person_id, "private_id": private_id, "public_id": public_id,
        "private_face": private_face, "private_crop": private_crop,
        "public_face": public_face, "public_crop": public_crop,
    }
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (private_id, public_id))
        await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id IN (?, ?);", (private_id, public_id))
        await conn.execute("DELETE FROM persons WHERE id = ?;", (person_id,))
        await conn.commit()
    finally:
        await conn.close()
    shutil.rmtree(folder, ignore_errors=True)


async def _one(sql, params=()):
    conn = await get_db_connection()
    try:
        async with conn.execute(sql, params) as cur:
            return await cur.fetchone()
    finally:
        await conn.close()


def _database_bytes() -> bytes:
    """Raw bytes of the database file and its write-ahead log, as an attacker copying the drive would see them."""
    data = b""
    for suffix in ("", "-wal"):
        path = settings.database_path.with_name(settings.database_path.name + suffix)
        if path.exists():
            data += path.read_bytes()
    return data


async def _checkpoint():
    conn = await get_db_connection()
    try:
        await conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    finally:
        await conn.close()


async def test_lock_leaves_no_readable_details_and_unlock_restores_them(library):
    ids = library
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/vault/reset", json=PHRASE)
        assert (await client.post("/api/vault/setup", json={"password": PASSWORD})).status_code == 201
        assert (await client.post("/api/vault/unlock", json={"password": PASSWORD})).status_code == 200

        await _checkpoint()
        assert SECRET_TOKEN in _database_bytes()  # Sanity: the secret is readable before locking.

        res = await client.post("/api/vault/photos/lock", json={"photo_ids": [ids["private_id"]]})
        assert res.status_code == 200 and res.json()["locked_count"] == 1

        row = await _one("SELECT ocr_text, latitude, longitude, vault_meta_enc FROM photos WHERE id = ?;", (ids["private_id"],))
        assert (row["ocr_text"], row["latitude"], row["longitude"]) == (None, None, None)
        assert row["vault_meta_enc"]

        # Only the locked photo's face is gone; the library photo's face and the person stay.
        assert await _one("SELECT 1 FROM faces WHERE id = ?;", (ids["private_face"],)) is None
        assert not ids["private_crop"].exists()
        assert await _one("SELECT 1 FROM faces WHERE id = ?;", (ids["public_face"],)) is not None
        assert ids["public_crop"].exists()
        assert await _one("SELECT 1 FROM persons WHERE id = ?;", (ids["person_id"],)) is not None

        # Nothing readable left in the files, even after the startup search-index rebuild.
        await rebuild_fts_index()
        assert await _one("SELECT 1 FROM photos_fts WHERE photos_fts MATCH 'Z7734519';") is None
        await _checkpoint()
        assert SECRET_TOKEN not in _database_bytes()

        # While the vault is open, the vault screen still shows the details.
        listed = next(p for p in (await client.get("/api/vault/photos")).json() if p["id"] == ids["private_id"])
        assert listed["ocr_text"] == SECRET_TEXT
        assert (listed["latitude"], listed["longitude"]) == (LAT, LON)

        # Unlock restores everything and queues a fresh face scan.
        res = await client.post("/api/vault/photos/unlock", json={"photo_ids": [ids["private_id"]]})
        assert res.status_code == 200 and res.json()["unlocked_count"] == 1
        row = await _one(
            "SELECT ocr_text, latitude, longitude, vault_meta_enc, faces_scanned FROM photos WHERE id = ?;", (ids["private_id"],)
        )
        assert (row["ocr_text"], row["latitude"], row["longitude"]) == (SECRET_TEXT, LAT, LON)
        assert row["vault_meta_enc"] is None and row["faces_scanned"] == 0

        await client.post("/api/vault/reset", json=PHRASE)


async def test_crash_after_lock_commit_still_removes_face_crops(library, monkeypatch):
    """If the app dies right after the lock commits, recovery deletes the leftover face crop."""
    ids = library
    mvk = secrets.token_bytes(32)
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (ids["private_id"],)) as cur:
            row = await cur.fetchone()

        def crash(_path):
            raise SimulatedCrash()

        monkeypatch.setattr(vault_storage, "_safe_unlink", crash)
        with pytest.raises(SimulatedCrash):
            await vault_storage.lock_photo(conn, row, mvk)
        monkeypatch.undo()
        assert ids["private_crop"].exists()  # Left behind by the crash.

        await vault_storage.reconcile_pending_vault_ops(conn)
        assert not ids["private_crop"].exists()
        assert ids["public_crop"].exists()
    finally:
        await conn.close()


async def test_sealed_details_cannot_be_moved_to_another_photo(library):
    """A sealed blob copied onto another row fails to open; that photo stays safely in the vault."""
    ids = library
    mvk = secrets.token_bytes(32)
    conn = await get_db_connection()
    try:
        async with conn.execute(
            "SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id IN (?, ?) ORDER BY id;",
            (ids["private_id"], ids["public_id"]),
        ) as cur:
            rows = await cur.fetchall()
        locked, failed = await vault_storage.lock_photos(conn, rows, mvk)
        assert sorted(locked) == sorted([ids["private_id"], ids["public_id"]]) and not failed

        # Copy the private photo's sealed details onto the other photo.
        await conn.execute(
            "UPDATE photos SET vault_meta_enc = (SELECT vault_meta_enc FROM photos WHERE id = ?) WHERE id = ?;",
            (ids["private_id"], ids["public_id"]),
        )
        await conn.commit()

        async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (ids["public_id"],)) as cur:
            tampered = await cur.fetchone()
        unlocked, failed = await vault_storage.unlock_photos(conn, [tampered], mvk)
        assert unlocked == [] and failed == [ids["public_id"]]
        async with conn.execute("SELECT is_encrypted, ocr_text FROM photos WHERE id = ?;", (ids["public_id"],)) as cur:
            still = await cur.fetchone()
        assert still["is_encrypted"] == 1 and still["ocr_text"] is None
    finally:
        await conn.close()
