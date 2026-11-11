"""Tests for enhancing vault photos while the vault is open (backlog C7)."""

import builtins
import io
import secrets
import shutil

import piexif
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.api import vault as vault_api
from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import vault_enhancer, vault_storage
from engine.services.crypto_vault import decrypt_file_to_bytes
from engine.services.media_paths import to_db_path

PASSWORD = "VaultEnhance#2026"
PHRASE = {"confirm_phrase": "ERASE ALL DATA"}


class SimulatedCrash(BaseException):
    """Stands in for the process dying (bypasses normal error handling)."""


def _jpeg(path):
    exif = piexif.dump({"0th": {piexif.ImageIFD.Make: b"VaultCam"}})
    img = Image.new("RGB", (1200, 900), (60, 90, 120))
    img.paste((230, 40, 40), (0, 0, 300, 225))
    img.save(path, "JPEG", quality=92, exif=exif)


@pytest.fixture
async def locked_photo():
    """One JPEG locked into the vault with a known key (direct service calls)."""
    await run_migrations()
    folder = settings.data_dir / "originals" / f"c7_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    src = folder / "secret.jpg"
    _jpeg(src)
    mvk = secrets.token_bytes(32)
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, file_hash) VALUES ('secret.jpg', ?, ?, 'image/jpeg', 'orig');",
            (to_db_path(src), src.stat().st_size),
        )
        photo_id = cur.lastrowid
        await conn.commit()
        async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (photo_id,)) as c:
            assert await vault_storage.lock_photo(conn, await c.fetchone(), mvk)
        yield {"conn": conn, "photo_id": photo_id, "mvk": mvk, "folder": folder}
    finally:
        await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
        await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (photo_id,))
        await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)


async def _row(conn, photo_id):
    async with conn.execute(
        "SELECT id, filepath, filename, mime_type, width, height, is_optimized, is_enhanced, original_file_hash FROM photos WHERE id = ?;",
        (photo_id,),
    ) as cur:
        return await cur.fetchone()


async def test_vault_photo_is_enhanced_and_stays_encrypted(locked_photo):
    env = locked_photo
    conn, mvk = env["conn"], env["mvk"]
    old = await _row(conn, env["photo_id"])
    assert await vault_storage.enhance_vault_photo(conn, old, mvk, 80, lambda: True)

    row = await _row(conn, env["photo_id"])
    assert row["filepath"].endswith("secret.avif.enc") and row["filename"] == "secret.avif"
    assert row["mime_type"] == "image/avif" and (row["width"], row["height"]) == (7680, 5760)
    assert row["is_optimized"] == 1 and row["is_enhanced"] == 1 and row["original_file_hash"] == "orig"
    assert not (env["folder"] / "secret.jpg.enc").exists()  # Old encrypted copy removed.
    with Image.open(io.BytesIO(decrypt_file_to_bytes(env["folder"] / "secret.avif.enc", mvk))) as img:
        assert img.format == "AVIF" and img.getexif().get(0x010F) == "VaultCam"
    assert sorted(p.name for p in env["folder"].iterdir()) == ["secret.avif.enc"]


async def test_nothing_unencrypted_is_ever_written(locked_photo, monkeypatch):
    """Records every file opened for writing during the enhancement: all must be encrypted files."""
    env = locked_photo
    written = []
    real_open = builtins.open

    def spy_open(file, mode="r", *args, **kwargs):
        if any(m in mode for m in ("w", "a", "+", "x")):
            written.append(str(file))
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy_open)
    row = await _row(env["conn"], env["photo_id"])
    assert await vault_storage.enhance_vault_photo(env["conn"], row, env["mvk"], 80, lambda: True)
    monkeypatch.undo()

    photo_files = [w for w in written if str(env["folder"]) in w]
    assert photo_files, "expected the encrypted output to be written"
    assert all(".enc" in w for w in photo_files), photo_files


async def test_vault_locking_midway_keeps_the_original(locked_photo):
    env = locked_photo
    conn = env["conn"]
    before = await _row(conn, env["photo_id"])
    assert not await vault_storage.enhance_vault_photo(conn, before, env["mvk"], 80, lambda: False)
    after = await _row(conn, env["photo_id"])
    assert after["filepath"] == before["filepath"] and after["is_optimized"] == 0
    assert sorted(p.name for p in env["folder"].iterdir()) == ["secret.jpg.enc"]


async def test_crash_after_commit_removes_old_copy(locked_photo, monkeypatch):
    env = locked_photo
    conn = env["conn"]

    def crash(_path):
        raise SimulatedCrash()

    monkeypatch.setattr(vault_storage, "_safe_unlink", crash)
    with pytest.raises(SimulatedCrash):
        await vault_storage.enhance_vault_photo(conn, await _row(conn, env["photo_id"]), env["mvk"], 80, lambda: True)
    monkeypatch.undo()
    assert {p.name for p in env["folder"].iterdir()} == {"secret.jpg.enc", "secret.avif.enc"}

    await vault_storage.reconcile_pending_vault_ops(conn)
    assert sorted(p.name for p in env["folder"].iterdir()) == ["secret.avif.enc"]
    assert (await _row(conn, env["photo_id"]))["filepath"].endswith("secret.avif.enc")


async def test_crash_while_encrypting_keeps_old_copy(locked_photo, monkeypatch):
    env = locked_photo
    conn = env["conn"]
    real_encrypt = vault_storage.encrypt_file_chunked

    def crash_half_way(source, dest, key):
        real_encrypt(source, dest, key)  # The new file exists...
        raise SimulatedCrash()           # ...but the process dies before the row changes.

    monkeypatch.setattr(vault_storage, "encrypt_file_chunked", crash_half_way)
    with pytest.raises(SimulatedCrash):
        await vault_storage.enhance_vault_photo(conn, await _row(conn, env["photo_id"]), env["mvk"], 80, lambda: True)
    monkeypatch.undo()

    await vault_storage.reconcile_pending_vault_ops(conn)
    assert sorted(p.name for p in env["folder"].iterdir()) == ["secret.jpg.enc"]
    row = await _row(conn, env["photo_id"])
    assert row["filepath"].endswith("secret.jpg.enc") and row["is_optimized"] == 0
    assert decrypt_file_to_bytes(env["folder"] / "secret.jpg.enc", env["mvk"])[:2] == b"\xff\xd8"  # Still the JPEG.


async def test_runner_works_only_while_open_and_never_delays_auto_lock(monkeypatch):
    """Through the real vault API: unlock -> background run enhances; peeking never counts as activity."""
    from engine.api import photos as photos_api

    monkeypatch.setattr(photos_api, "_running_on_battery", lambda: False)
    await run_migrations()
    folder = settings.data_dir / "originals" / f"c7r_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    _jpeg(folder / "trip.jpg")
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('trip.jpg', ?, 1, 'image/jpeg');",
            (to_db_path(folder / "trip.jpg"),),
        )
        photo_id = cur.lastrowid
        # Only this photo should be processed.
        await conn.execute("UPDATE photos SET is_optimized = 1 WHERE id != ?;", (photo_id,))
        await conn.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post("/api/vault/reset", json=PHRASE)
            assert (await client.post("/api/vault/setup", json={"password": PASSWORD})).status_code == 201
            assert (await client.post("/api/vault/unlock", json={"password": PASSWORD})).status_code == 200
            assert (await client.post("/api/vault/photos/lock", json={"photo_ids": [photo_id]})).status_code == 200

            # Peeking at the key (as the runner and the progress poll do) never refreshes activity.
            before = vault_api.ACTIVE_VAULT_SESSION["last_activity"]
            vault_api.peek_active_mvk()
            assert (await client.get("/api/vault/enhancement-progress")).status_code == 200
            assert vault_api.ACTIVE_VAULT_SESSION["last_activity"] == before

            result = await vault_enhancer.run_vault_enhancement()
            assert result == {"status": "done", "enhanced": 1}
            async with conn.execute("SELECT filepath, is_enhanced FROM photos WHERE id = ?;", (photo_id,)) as c:
                row = await c.fetchone()
            assert row["filepath"].endswith("trip.avif.enc") and row["is_enhanced"] == 1

            # Idle for 5+ minutes: the vault counts as locked for background work.
            await conn.execute("UPDATE photos SET is_optimized = 0 WHERE id = ?;", (photo_id,))
            await conn.commit()
            vault_api.ACTIVE_VAULT_SESSION["last_activity"] -= vault_api.AUTO_LOCK_SECONDS + 1
            assert vault_api.peek_active_mvk() is None
            assert await vault_enhancer.run_vault_enhancement() == {"status": "vault_locked"}
            progress = (await client.get("/api/vault/enhancement-progress")).json()
            assert progress["is_active"] is False

            await client.post("/api/vault/reset", json=PHRASE)
    finally:
        await conn.execute("DELETE FROM photos WHERE filename IN ('trip.jpg', 'trip.avif');")
        await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)
