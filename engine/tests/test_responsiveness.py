"""H7: heavy file work runs off the event loop, and overlapping work is queued safely."""

import asyncio
import secrets
import shutil
import threading
import time

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import vault_storage
from engine.services.crypto_vault import decrypt_file_to_bytes


@pytest.fixture
async def one_photo():
    await run_migrations()
    folder = settings.data_dir / "originals" / f"_test_h7_{secrets.token_hex(4)}"
    folder.mkdir(parents=True)
    orig = folder / "alpha.jpg"
    Image.new("RGB", (160, 120), (20, 120, 220)).save(orig, "JPEG")
    conn = await get_db_connection()
    cur = await conn.execute(
        "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('alpha.jpg', ?, ?, 'image/jpeg');",
        (vault_storage.to_db_path(orig), orig.stat().st_size),
    )
    pid = cur.lastrowid
    await conn.commit()
    try:
        yield {"conn": conn, "folder": folder, "id": pid, "orig": orig, "bytes": orig.read_bytes(), "mvk": secrets.token_bytes(32)}
    finally:
        await conn.execute("DELETE FROM photos WHERE id = ?;", (pid,))
        await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (pid,))
        await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)


async def _row(conn, pid):
    async with conn.execute("SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id = ?;", (pid,)) as cur:
        return await cur.fetchone()


async def test_engine_answers_while_a_photo_is_being_encrypted(one_photo, monkeypatch):
    real_encrypt = vault_storage.encrypt_and_verify
    encrypting = threading.Event()

    def slow_encrypt(pair, mvk):  # Stands in for encrypting a large video.
        encrypting.set()
        time.sleep(0.6)
        real_encrypt(pair, mvk)
        encrypting.clear()

    monkeypatch.setattr(vault_storage, "encrypt_and_verify", slow_encrypt)
    conn = one_photo["conn"]
    task = asyncio.create_task(vault_storage.lock_photos(conn, [await _row(conn, one_photo["id"])], one_photo["mvk"]))
    for _ in range(200):
        if encrypting.is_set():
            break
        await asyncio.sleep(0.01)

    # Before H7 the encryption ran on the event loop, so nothing else could run until it had finished.
    assert encrypting.is_set(), "the event loop was blocked for the whole encryption"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        health = await client.get("/api/health")
    assert health.status_code == 200
    assert encrypting.is_set()  # Answered while the encryption was still running.
    assert (await task) == ([one_photo["id"]], [])


async def test_two_simultaneous_locks_of_the_same_photo_are_safe(one_photo):
    """E.g. a double-clicked 'Move to Vault': the second waits, then finds nothing left to do."""
    conn, pid, mvk = one_photo["conn"], one_photo["id"], one_photo["mvk"]
    row = await _row(conn, pid)
    conn2 = await get_db_connection()
    try:
        first, second = await asyncio.gather(
            vault_storage.lock_photos(conn, [row], mvk),
            vault_storage.lock_photos(conn2, [row], mvk),
        )
    finally:
        await conn2.close()

    assert sorted(first[0] + second[0]) == [pid]  # Locked exactly once.
    assert first[1] == second[1] == []
    files = sorted(p.name for p in one_photo["folder"].iterdir())
    assert files == ["alpha.jpg.enc"]
    stored = (await _row(conn, pid))["filepath"]
    assert stored.endswith("alpha.jpg.enc")
    assert decrypt_file_to_bytes(settings.data_dir / stored, mvk) == one_photo["bytes"]


async def test_two_simultaneous_imports_of_the_same_file_add_it_once(tmp_path, monkeypatch):
    from engine.services import ingestion_service

    await run_migrations()
    src = tmp_path / f"same_photo_{secrets.token_hex(3)}.jpg"
    Image.effect_noise((800, 600), 77).convert("RGB").save(src, "JPEG")
    real_hash = ingestion_service.calculate_file_hash

    def slow_hash(path):  # Both imports are hashing at the same time, as with large files.
        time.sleep(0.3)
        return real_hash(path)

    monkeypatch.setattr(ingestion_service, "calculate_file_hash", slow_hash)
    body = {"file_paths": [str(src)], "mode": "managed"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            a, b = await asyncio.gather(client.post("/api/photos/import", json=body), client.post("/api/photos/import", json=body))
        assert (a.status_code, b.status_code) == (201, 201)
        results = sorted((r.json()["imported"], r.json()["skipped"], r.json()["failed"]) for r in (a, b))
        assert results == [(0, 1, 0), (1, 0, 0)]  # One adds it, the other sees it is already there; no errors.
    finally:
        conn = await get_db_connection()
        try:
            async with conn.execute("SELECT id FROM photos WHERE filename = ?;", (src.name,)) as cur:
                ids = [r["id"] for r in await cur.fetchall()]
            await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(ids))});", ids)
            await conn.commit()
        finally:
            await conn.close()
    assert len(ids) == 1  # Added once.
