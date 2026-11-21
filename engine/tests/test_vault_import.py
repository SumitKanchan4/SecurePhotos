"""Importing straight into the vault (owner, 2026-11-21).

Each photo is encrypted as soon as it is copied and never shows in the library or reaches a
worker; the original is removed only when asked and only after encryption; a stop half-way is
undone at the next start; a vault that locks during an import stops the rest.
"""

import secrets
import shutil

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import vault_import
from engine.services.ingestion_service import PENDING_VAULT
from engine.services.media_paths import resolve_stored_path

PASSWORD = "VaultImportPass#1"
PHRASE = {"confirm_phrase": "ERASE ALL DATA"}


def _jpeg(path, colour):
    Image.new("RGB", (64, 48), color=colour).save(path, format="JPEG")
    return path


@pytest.fixture
async def outside(tmp_path):
    """A folder outside the library with two photos to add."""
    await run_migrations()
    folder = tmp_path / f"to_vault_{secrets.token_hex(3)}"
    folder.mkdir()
    yield [_jpeg(folder / "private_a.jpg", (10, 120, 200)), _jpeg(folder / "private_b.jpg", (200, 40, 90))]
    shutil.rmtree(folder, ignore_errors=True)


async def _rows():
    conn = await get_db_connection()
    try:
        async with conn.execute(
            "SELECT id, filename, filepath, thumbnail_path, is_encrypted, original_path, ocr_text, faces_scanned FROM photos "
            "WHERE filename LIKE 'private_%';"
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]
    finally:
        await conn.close()


async def _cleanup():
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM photos WHERE filename LIKE 'private_%';")
        await conn.commit()
    finally:
        await conn.close()


async def _open_vault(client):
    await client.post("/api/vault/reset", json=PHRASE)
    assert (await client.post("/api/vault/setup", json={"password": PASSWORD})).status_code == 201
    assert (await client.post("/api/vault/unlock", json={"password": PASSWORD})).status_code == 200


async def test_photos_go_straight_into_the_vault_and_the_originals_go(outside):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _open_vault(client)
        try:
            res = await client.post(
                "/api/photos/import", json={"file_paths": [str(p) for p in outside], "into_vault": True, "delete_source": True}
            )
            assert res.status_code == 201, res.text
            assert res.json()["imported"] == 2
            rows = await _rows()
            assert len(rows) == 2 and all(r["is_encrypted"] == 1 for r in rows)
            for r in rows:
                assert r["filepath"].endswith(".enc") and r["thumbnail_path"].endswith(".enc")
                assert r["original_path"] is None  # where it came from isn't recorded
                assert resolve_stored_path(r["filepath"]) is not None
            assert not any(p.exists() for p in outside)  # originals removed, after encryption
            # Nothing of them in the library views; both in the vault.
            library = (await client.get("/api/photos")).json()
            assert not [p for p in library if p["filename"].startswith("private_")]
            vault = (await client.get("/api/vault/photos")).json()
            assert sorted(p["filename"] for p in vault if p["filename"].startswith("private_")) == ["private_a.jpg", "private_b.jpg"]
        finally:
            await client.post("/api/vault/reset", json=PHRASE)
            await _cleanup()


async def test_the_originals_stay_when_the_switch_is_off(outside):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _open_vault(client)
        try:
            res = await client.post("/api/photos/import", json={"file_paths": [str(outside[0])], "into_vault": True})
            assert res.status_code == 201 and res.json()["imported"] == 1
            assert outside[0].exists()
            assert [r["is_encrypted"] for r in await _rows()] == [1]
        finally:
            await client.post("/api/vault/reset", json=PHRASE)
            await _cleanup()


async def test_a_locked_vault_refuses_and_changes_nothing(outside):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _open_vault(client)
        await client.post("/api/vault/lock")
        try:
            res = await client.post("/api/photos/import", json={"file_paths": [str(p) for p in outside], "into_vault": True})
            assert res.status_code in (401, 403)
            assert await _rows() == []
            assert all(p.exists() for p in outside)
        finally:
            await client.post("/api/vault/reset", json=PHRASE)
            await _cleanup()


async def test_the_vault_locking_mid_import_stops_the_rest_and_leaves_nothing_readable(outside, monkeypatch):
    from engine.api import vault as vault_api

    calls = {"n": 0}
    real_peek = vault_api.peek_active_mvk

    def locks_after_first():
        calls["n"] += 1
        return real_peek() if calls["n"] == 1 else None

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _open_vault(client)
        monkeypatch.setattr(vault_api, "peek_active_mvk", locks_after_first)
        try:
            res = await client.post(
                "/api/photos/import", json={"file_paths": [str(p) for p in outside], "into_vault": True, "delete_source": True}
            )
            body = res.json()
            assert body["imported"] == 1 and body["cancelled"] and body["stopped_reason"] == "vault_locked"
            rows = await _rows()
            assert [r["is_encrypted"] for r in rows] == [1]  # the first is safe; the second never came in
            assert sum(p.exists() for p in outside) == 1  # only the first original was removed
        finally:
            monkeypatch.setattr(vault_api, "peek_active_mvk", real_peek)
            await client.post("/api/vault/reset", json=PHRASE)
            await _cleanup()


async def test_a_photo_left_half_way_is_removed_at_the_next_start(outside):
    """A stop between copying and encrypting: the copy is hidden, then removed; the original stays."""
    from engine.services.ingestion_service import ingest_single_photo

    conn = await get_db_connection()
    try:
        photo_id, is_new = await ingest_single_photo(conn, outside[0], return_is_new=True, into_vault=True)
        await conn.commit()
    finally:
        await conn.close()
    try:
        assert is_new
        row = (await _rows())[0]
        assert row["is_encrypted"] == PENDING_VAULT
        copy = resolve_stored_path(row["filepath"])
        assert copy is not None and copy.is_relative_to(settings.data_dir)

        # Hidden everywhere meanwhile: not in the library, not in the vault, not prepared.
        from engine.services import after_import

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            assert not [p for p in (await client.get("/api/photos")).json() if p["filename"].startswith("private_")]
        conn = await get_db_connection()
        try:
            async with conn.execute(f"SELECT COUNT(*) FROM photos WHERE id = ? AND {after_import.PREPARING};", (photo_id,)) as cur:
                assert (await cur.fetchone())[0] == 0
        finally:
            await conn.close()

        assert await vault_import.undo_interrupted_imports() == 1
        assert await _rows() == []
        assert not copy.exists()
        assert outside[0].exists()
    finally:
        await _cleanup()


async def test_setting_up_again_never_replaces_an_existing_vault(outside):
    """2026-11-21: a second setup replaced the vault's key, so the photos in it could never be opened."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _open_vault(client)
        try:
            res = await client.post("/api/photos/import", json={"file_paths": [str(outside[0])], "into_vault": True})
            assert res.json()["imported"] == 1
            again = await client.post("/api/vault/setup", json={"password": "SomethingElse#9"})
            assert again.status_code == 409
            # The old password still opens the vault, and the photo can still be moved out.
            await client.post("/api/vault/lock")
            assert (await client.post("/api/vault/unlock", json={"password": PASSWORD})).status_code == 200
            vault_id = (await _rows())[0]["id"]
            out = (await client.post("/api/vault/photos/unlock", json={"photo_ids": [vault_id]})).json()
            assert out["unlocked_count"] == 1 and out["failed_ids"] == []
        finally:
            await client.post("/api/vault/reset", json=PHRASE)
            await _cleanup()


async def test_moving_out_uses_the_photo_as_it_is_now_not_as_it_was_read(outside):
    """2026-11-21: the vault enhancer rewrote a photo while "Move to library" waited its turn, and
    the move skipped it silently because it used the old file name."""
    from engine.api.vault import peek_active_mvk
    from engine.services import vault_storage

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _open_vault(client)
        try:
            await client.post("/api/photos/import", json={"file_paths": [str(outside[0])], "into_vault": True})
            row = (await _rows())[0]
            stale = {"id": row["id"], "filepath": "originals/old-name-before-8k.jpg.enc"}
            # Meanwhile the file is rewritten under a new name (as the 8K enhancer does).
            current = resolve_stored_path(row["filepath"])
            renamed = current.with_name("rewritten_" + current.name)
            current.rename(renamed)
            conn = await get_db_connection()
            try:
                from engine.services.media_paths import to_db_path

                await conn.execute("UPDATE photos SET filepath = ? WHERE id = ?;", (to_db_path(renamed), row["id"]))
                await conn.commit()
                unlocked, failed = await vault_storage.unlock_photos(conn, [stale], peek_active_mvk())
            finally:
                await conn.close()
            assert unlocked == [row["id"]] and failed == []
            assert (await _rows())[0]["is_encrypted"] == 0
        finally:
            await client.post("/api/vault/reset", json=PHRASE)
            await _cleanup()
