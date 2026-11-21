"""Vault factory-reset tests (backlog item C6).

Reset must require the typed confirmation phrase and must permanently erase
every vault photo (files, rows, face crops) and every vault album, while leaving
library photos untouched. Runs against the throwaway test library (Q6).
"""

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection
from engine.main import app
from engine.services import vault_storage
from engine.services.face_recognition_service import get_face_thumbnails_dir

PASSWORD = "ResetTestPass789!"
PHRASE = {"confirm_phrase": "ERASE ALL DATA"}


async def _make_photo(conn, folder, name):
    """Creates a photo + thumbnail on disk inside the data folder and its row."""
    orig, thumb = folder / name, folder / f"{name}.thumb.webp"
    Image.new("RGB", (64, 48), color=(1, 2, 3)).save(orig, format="JPEG")
    Image.new("RGB", (16, 16), color=(3, 2, 1)).save(thumb, format="WEBP")
    cur = await conn.execute(
        "INSERT INTO photos (filename, filepath, thumbnail_path, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/jpeg');",
        (name, vault_storage.to_db_path(orig), vault_storage.to_db_path(thumb), orig.stat().st_size),
    )
    return cur.lastrowid, orig, thumb


@pytest.fixture
async def populated_vault():
    """A configured, unlocked vault holding one photo in one vault album, plus one library photo.

    The vault photo also has a detected face with a face-crop image on disk.
    """
    folder = settings.data_dir / "originals" / "reset_test"
    folder.mkdir(parents=True, exist_ok=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # A vault left by an earlier test is erased first: setup refuses to replace one (2026-11-21).
        await client.post("/api/vault/reset", json={"confirm_phrase": "ERASE ALL DATA"})
        assert (await client.post("/api/vault/setup", json={"password": PASSWORD})).status_code == 201
        assert (await client.post("/api/vault/unlock", json={"password": PASSWORD})).status_code == 200

        conn = await get_db_connection()
        try:
            vault_id, vault_orig, vault_thumb = await _make_photo(conn, folder, "private.jpg")
            lib_id, lib_orig, lib_thumb = await _make_photo(conn, folder, "public.jpg")
            cur = await conn.execute("INSERT INTO albums (name) VALUES ('Private Trip');")
            album_id = cur.lastrowid
            await conn.execute("INSERT INTO photo_album (photo_id, album_id) VALUES (?, ?);", (vault_id, album_id))
            cur = await conn.execute(
                "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding) VALUES (?, 0.1, 0.1, 0.2, 0.2, '[]');",
                (vault_id,),
            )
            face_crop = get_face_thumbnails_dir() / f"{cur.lastrowid}.webp"
            Image.new("RGB", (8, 8)).save(face_crop, format="WEBP")
            await conn.commit()
        finally:
            await conn.close()

        lock = await client.post(f"/api/vault/albums/{album_id}/lock")
        assert lock.status_code == 200 and lock.json()["photos_encrypted"] == 1
        # C4: locking removes the photo's face records and face crop images.
        assert not face_crop.exists()

        yield {
            "client": client,
            "vault_id": vault_id,
            "vault_files": [vault_orig.with_name("private.jpg.enc"), vault_thumb.with_name("private.jpg.thumb.webp.enc")],
            "face_crop": face_crop,
            "album_id": album_id,
            "lib_id": lib_id,
            "lib_files": [lib_orig, lib_thumb],
        }

        # Leave the shared test library clean for other tests.
        await client.post("/api/vault/reset", json=PHRASE)
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM photos WHERE id = ?;", (lib_id,))
            await conn.commit()
        finally:
            await conn.close()


async def _exists(table, row_id):
    conn = await get_db_connection()
    try:
        async with conn.execute(f"SELECT 1 FROM {table} WHERE id = ?;", (row_id,)) as cur:
            return await cur.fetchone() is not None
    finally:
        await conn.close()


async def _vault_configured():
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT COUNT(*) FROM vault_configs;") as cur:
            return (await cur.fetchone())[0] > 0
    finally:
        await conn.close()


@pytest.mark.parametrize("body", [None, {"confirm_phrase": "erase"}, {"confirm_phrase": ""}])
async def test_reset_without_correct_phrase_changes_nothing(populated_vault, body):
    """Missing or wrong phrase is rejected and nothing is erased."""
    client = populated_vault["client"]
    res = await client.post("/api/vault/reset", json=body) if body is not None else await client.post("/api/vault/reset")
    assert res.status_code in (400, 422)

    assert await _vault_configured()
    assert await _exists("photos", populated_vault["vault_id"])
    assert await _exists("albums", populated_vault["album_id"])
    assert all(f.exists() for f in populated_vault["vault_files"])


async def test_reset_preview_counts_vault_contents(populated_vault):
    """The reset screen can show how much will be erased, even while locked."""
    client = populated_vault["client"]
    await client.post("/api/vault/lock")
    res = await client.get("/api/vault/reset-preview")
    assert res.status_code == 200
    assert res.json() == {"photo_count": 1, "album_count": 1}


async def test_reset_erases_vault_and_keeps_library(populated_vault):
    """Reset erases vault photos, files, face crops, albums and keys; library photos survive."""
    client = populated_vault["client"]
    res = await client.post("/api/vault/reset", json=PHRASE)
    assert res.status_code == 200
    assert res.json()["erased_photos"] == 1 and res.json()["erased_albums"] == 1

    assert not await _vault_configured()
    assert not await _exists("photos", populated_vault["vault_id"])
    assert not await _exists("albums", populated_vault["album_id"])
    assert not any(f.exists() for f in populated_vault["vault_files"])
    assert not populated_vault["face_crop"].exists()

    assert await _exists("photos", populated_vault["lib_id"])
    assert all(f.exists() for f in populated_vault["lib_files"])
    assert (await client.get("/api/vault/status")).json()["is_configured"] is False


async def test_reset_finishes_after_interruption(populated_vault):
    """If files were already deleted by an interrupted reset, running it again completes cleanly."""
    client = populated_vault["client"]
    for f in populated_vault["vault_files"]:
        f.unlink()  # Simulates a reset that died after deleting files, before deleting rows.

    res = await client.post("/api/vault/reset", json=PHRASE)
    assert res.status_code == 200 and res.json()["erased_photos"] == 1
    assert not await _exists("photos", populated_vault["vault_id"])

    again = await client.post("/api/vault/reset", json=PHRASE)
    assert again.status_code == 200 and again.json()["erased_photos"] == 0
