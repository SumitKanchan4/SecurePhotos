"""Tests for trash purging (M7) and the configurable vault auto-lock (M8)."""

import secrets
import shutil
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.api import trash as trash_api
from engine.api import vault as vault_api
from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.face_recognition_service import get_face_thumbnails_dir
from engine.services.media_paths import to_db_path


class SimulatedCrash(BaseException):
    """Stands in for the process dying (bypasses normal error handling)."""


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def trashed_library():
    """Three photos with files under relative paths: two trashed (31 and 2 days ago), one in the library."""
    await run_migrations()
    folder = settings.data_dir / "originals" / f"m7_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    conn = await get_db_connection()
    made = {}
    try:
        for name, trashed in (("old", "-31 days"), ("recent", "-2 days"), ("kept", None)):
            orig, thumb, prev = folder / f"{name}.jpg", folder / f"{name}_t.webp", folder / f"{name}_p.webp"
            for path in (orig, thumb, prev):
                Image.new("RGB", (8, 8)).save(path)
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, thumbnail_path, preview_path, file_size, mime_type, trashed_at) "
                "VALUES (?, ?, ?, ?, 1, 'image/jpeg', CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END);",
                (orig.name, to_db_path(orig), to_db_path(thumb), to_db_path(prev), trashed, trashed),
            )
            photo_id = cur.lastrowid
            face = await conn.execute(
                "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding) VALUES (?, .1, .1, .2, .2, '[]');", (photo_id,)
            )
            crop = get_face_thumbnails_dir() / f"{face.lastrowid}.webp"
            Image.new("RGB", (8, 8)).save(crop)
            made[name] = {"id": photo_id, "files": [orig, thumb, prev, crop]}
        await conn.commit()
        yield {"conn": conn, "made": made}
    finally:
        ids = [m["id"] for m in made.values()]
        if ids:
            await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", ids)
            await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)


async def _exists(conn, photo_id):
    async with conn.execute("SELECT 1 FROM photos WHERE id = ?;", (photo_id,)) as cur:
        return await cur.fetchone() is not None


# ── M7: trash ─────────────────────────────────────────────────────────────────

async def test_delete_permanently_removes_files_with_relative_paths(trashed_library):
    made, conn = trashed_library["made"], trashed_library["conn"]
    async with _client() as client:
        res = await client.post("/api/trash/permanent", json={"photo_ids": [made["recent"]["id"]]})
    assert res.json()["deleted_count"] == 1
    assert not await _exists(conn, made["recent"]["id"])
    assert not any(p.exists() for p in made["recent"]["files"])  # Original, thumbnail, preview, face crop.
    assert all(p.exists() for p in made["old"]["files"] + made["kept"]["files"])


async def test_delete_permanently_ignores_photos_not_in_trash(trashed_library):
    made, conn = trashed_library["made"], trashed_library["conn"]
    async with _client() as client:
        res = await client.post("/api/trash/permanent", json={"photo_ids": [made["kept"]["id"]]})
    assert res.json()["deleted_count"] == 0
    assert await _exists(conn, made["kept"]["id"]) and all(p.exists() for p in made["kept"]["files"])


async def test_empty_trash_removes_all_trashed_files(trashed_library):
    made, conn = trashed_library["made"], trashed_library["conn"]
    async with _client() as client:
        res = await client.delete("/api/trash/empty")
    assert res.json()["deleted_count"] >= 2
    for key in ("old", "recent"):
        assert not await _exists(conn, made[key]["id"]) and not any(p.exists() for p in made[key]["files"])
    assert await _exists(conn, made["kept"]["id"]) and all(p.exists() for p in made["kept"]["files"])


async def test_automatic_purge_only_takes_items_older_than_30_days(trashed_library):
    made, conn = trashed_library["made"], trashed_library["conn"]
    assert await trash_api.purge_expired_trash() >= 1
    assert not await _exists(conn, made["old"]["id"]) and not any(p.exists() for p in made["old"]["files"])
    assert await _exists(conn, made["recent"]["id"]) and all(p.exists() for p in made["recent"]["files"])
    assert await _exists(conn, made["kept"]["id"])


async def test_crash_during_file_cleanup_leaves_no_broken_entries(trashed_library, monkeypatch):
    """Rows go first: a crash while deleting files leaves orphan files, never rows pointing at missing files."""
    made, conn = trashed_library["made"], trashed_library["conn"]

    def crash(self, missing_ok=False):
        raise SimulatedCrash()

    monkeypatch.setattr(Path, "unlink", crash)
    with pytest.raises(SimulatedCrash):
        await trash_api.purge_photos(conn, [made["recent"]["id"]])
    monkeypatch.undo()
    assert not await _exists(conn, made["recent"]["id"])  # Already committed.
    assert all(p.exists() for p in made["recent"]["files"])  # Only orphaned files remain.


# ── M8: auto-lock ─────────────────────────────────────────────────────────────

def test_auto_lock_values_are_normalised():
    assert vault_api.normalize_auto_lock(900) == 900
    assert vault_api.normalize_auto_lock(0) == 1800  # Old "Never" -> 30 minutes.
    assert vault_api.normalize_auto_lock(42) == 300
    assert vault_api.normalize_auto_lock("bogus") == 300


async def test_vault_follows_the_auto_lock_setting():
    await run_migrations()
    password = "AutoLockTest#1"
    async with _client() as client:
        try:
            await client.post("/api/vault/reset", json={"confirm_phrase": "ERASE ALL DATA"})
            assert (await client.post("/api/vault/setup", json={"password": password})).status_code == 201

            # "Never" is stored and applied as 30 minutes.
            res = await client.patch("/api/system/settings", json={"settings": {"auto_lock_duration": 0}})
            assert res.json()["settings"]["auto_lock_duration"] == 1800
            assert vault_api.AUTO_LOCK_SECONDS == 1800

            # 1 minute: idle for 61 s locks the vault.
            await client.patch("/api/system/settings", json={"settings": {"auto_lock_duration": 60}})
            assert (await client.get("/api/system/settings")).json()["settings"]["auto_lock_duration"] == 60
            await client.post("/api/vault/unlock", json={"password": password})
            vault_api.ACTIVE_VAULT_SESSION["last_activity"] -= 61
            assert (await client.get("/api/vault/photos")).status_code == 401

            # 30 minutes: the same idle time keeps it open.
            await client.patch("/api/system/settings", json={"settings": {"auto_lock_duration": 1800}})
            await client.post("/api/vault/unlock", json={"password": password})
            vault_api.ACTIVE_VAULT_SESSION["last_activity"] -= 61
            assert (await client.get("/api/vault/photos")).status_code == 200
        finally:
            await client.patch("/api/system/settings", json={"settings": {"auto_lock_duration": 300}})
            await client.post("/api/vault/reset", json={"confirm_phrase": "ERASE ALL DATA"})
