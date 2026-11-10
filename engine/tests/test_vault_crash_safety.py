"""Crash-safety tests for vault lock/unlock (backlog item C5).

A hard crash (power loss, hot-unplug, process kill) is simulated by raising
``SimulatedCrash``, a ``BaseException`` that bypasses every ``except Exception``
handler, at a chosen step. The test then runs the startup recovery sweep and
checks that no photo was lost and no leftover file remains.
"""

import secrets
import shutil
from pathlib import Path

import pytest
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.services import vault_storage
from engine.services.crypto_vault import decrypt_file_to_bytes


class SimulatedCrash(BaseException):
    """Stands in for the process dying at an arbitrary point."""


@pytest.fixture
async def vault_env():
    """Creates a test folder inside the data dir and two photo rows (original + thumbnail).

    Yields a dict with the key, connection, folder and photo ids. Cleans up rows,
    journal entries and files afterwards.
    """
    await run_migrations()
    folder = settings.data_dir / "originals" / f"_test_c5_{secrets.token_hex(4)}"
    folder.mkdir(parents=True)
    conn = await get_db_connection()
    ids = []
    try:
        for name in ("alpha.jpg", "beta.jpg"):
            orig = folder / name
            thumb = folder / f"{orig.stem}_thumb.webp"
            Image.new("RGB", (120, 80), color=(10, 200, 30)).save(orig, format="JPEG")
            Image.new("RGB", (32, 32), color=(200, 10, 30)).save(thumb, format="WEBP")
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, thumbnail_path, file_size, mime_type) VALUES (?, ?, ?, ?, 'image/jpeg');",
                (name, vault_storage.to_db_path(orig), vault_storage.to_db_path(thumb), orig.stat().st_size),
            )
            ids.append(cur.lastrowid)
        await conn.commit()
        yield {"mvk": secrets.token_bytes(32), "conn": conn, "folder": folder, "ids": ids}
    finally:
        placeholders = ",".join("?" for _ in ids)
        if ids:
            await conn.execute(f"DELETE FROM photos WHERE id IN ({placeholders});", ids)
            await conn.execute(f"DELETE FROM vault_pending_ops WHERE photo_id IN ({placeholders});", ids)
            await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)


async def _row(conn, photo_id):
    async with conn.execute(
        "SELECT id, filepath, thumbnail_path, preview_path, is_encrypted FROM photos WHERE id = ?;", (photo_id,)
    ) as cur:
        return await cur.fetchone()


async def _journal_count(conn, photo_id):
    async with conn.execute("SELECT COUNT(*) FROM vault_pending_ops WHERE photo_id = ?;", (photo_id,)) as cur:
        return (await cur.fetchone())[0]


def _files(folder: Path):
    return sorted(p.name for p in folder.iterdir())


async def test_lock_unlock_roundtrip_stores_relative_paths(vault_env):
    """A normal lock then unlock restores identical bytes and stores portable paths."""
    conn, mvk, folder, pid = vault_env["conn"], vault_env["mvk"], vault_env["folder"], vault_env["ids"][0]
    original_bytes = (folder / "alpha.jpg").read_bytes()

    assert await vault_storage.lock_photo(conn, await _row(conn, pid), mvk)
    row = await _row(conn, pid)
    assert row["is_encrypted"] == 1
    assert not Path(row["filepath"]).is_absolute() and row["filepath"].endswith("alpha.jpg.enc")
    assert row["thumbnail_path"].endswith("alpha_thumb.webp.enc")
    assert not (folder / "alpha.jpg").exists()
    assert decrypt_file_to_bytes(folder / "alpha.jpg.enc", mvk) == original_bytes
    assert await _journal_count(conn, pid) == 0

    assert await vault_storage.unlock_photo(conn, await _row(conn, pid), mvk)
    row = await _row(conn, pid)
    assert row["is_encrypted"] == 0
    assert row["filepath"].endswith("alpha.jpg") and not Path(row["filepath"]).is_absolute()
    assert (folder / "alpha.jpg").read_bytes() == original_bytes
    assert not (folder / "alpha.jpg.enc").exists()
    assert await _journal_count(conn, pid) == 0


async def test_crash_while_encrypting_keeps_originals(vault_env, monkeypatch):
    """Crash after the original is encrypted but before the thumbnail is: nothing is lost."""
    conn, mvk, folder, pid = vault_env["conn"], vault_env["mvk"], vault_env["folder"], vault_env["ids"][0]
    real_encrypt = vault_storage.encrypt_file_chunked
    calls = {"n": 0}

    def crash_on_second(src, dest, key):
        calls["n"] += 1
        if calls["n"] == 2:
            raise SimulatedCrash()
        real_encrypt(src, dest, key)

    monkeypatch.setattr(vault_storage, "encrypt_file_chunked", crash_on_second)
    with pytest.raises(SimulatedCrash):
        await vault_storage.lock_photo(conn, await _row(conn, pid), mvk)
    assert (folder / "alpha.jpg.enc").exists()  # Leftover from the crash.

    await vault_storage.reconcile_pending_vault_ops(conn)
    row = await _row(conn, pid)
    assert row["is_encrypted"] == 0
    assert (folder / "alpha.jpg").exists() and (folder / "alpha_thumb.webp").exists()
    assert not any(name.endswith((".enc", ".tmp")) for name in _files(folder))
    assert await _journal_count(conn, pid) == 0


async def test_crash_after_commit_removes_leftover_plaintext(vault_env, monkeypatch):
    """Crash after the row is committed but before plaintext cleanup: recovery removes the plaintext."""
    conn, mvk, folder, pid = vault_env["conn"], vault_env["mvk"], vault_env["folder"], vault_env["ids"][0]

    def crash(_path):
        raise SimulatedCrash()

    monkeypatch.setattr(vault_storage, "_safe_unlink", crash)
    with pytest.raises(SimulatedCrash):
        await vault_storage.lock_photo(conn, await _row(conn, pid), mvk)
    monkeypatch.undo()

    assert (await _row(conn, pid))["is_encrypted"] == 1
    assert (folder / "alpha.jpg").exists()  # Plaintext still on disk: a privacy leak until recovery.

    await vault_storage.reconcile_pending_vault_ops(conn)
    assert not (folder / "alpha.jpg").exists() and not (folder / "alpha_thumb.webp").exists()
    assert decrypt_file_to_bytes(folder / "alpha.jpg.enc", vault_env["mvk"])
    assert await _journal_count(conn, pid) == 0


async def test_crash_while_decrypting_keeps_vault_copy(vault_env, monkeypatch):
    """Crash mid-unlock: the vault copy is kept and the partial plaintext removed."""
    conn, mvk, folder, pid = vault_env["conn"], vault_env["mvk"], vault_env["folder"], vault_env["ids"][0]
    await vault_storage.lock_photo(conn, await _row(conn, pid), mvk)

    real_decrypt = vault_storage.decrypt_to_file
    calls = {"n": 0}

    def crash_on_second(pair, key):
        calls["n"] += 1
        if calls["n"] == 2:
            raise SimulatedCrash()
        real_decrypt(pair, key)

    monkeypatch.setattr(vault_storage, "decrypt_to_file", crash_on_second)
    with pytest.raises(SimulatedCrash):
        await vault_storage.unlock_photo(conn, await _row(conn, pid), mvk)
    assert (folder / "alpha.jpg").exists()  # Partially restored.

    await vault_storage.reconcile_pending_vault_ops(conn)
    row = await _row(conn, pid)
    assert row["is_encrypted"] == 1
    assert not (folder / "alpha.jpg").exists()
    assert (folder / "alpha.jpg.enc").exists() and (folder / "alpha_thumb.webp.enc").exists()


async def test_failed_verification_leaves_photo_untouched(vault_env, monkeypatch):
    """If the encrypted copy doesn't decrypt back to the original, the photo is reported and unchanged."""
    conn, mvk, folder, ids = vault_env["conn"], vault_env["mvk"], vault_env["folder"], vault_env["ids"]
    real_hash = vault_storage._sha256_decrypted

    def corrupt_for_alpha(enc, key):
        return "0" * 64 if enc.name.startswith("alpha") else real_hash(enc, key)

    monkeypatch.setattr(vault_storage, "_sha256_decrypted", corrupt_for_alpha)
    rows = [await _row(conn, i) for i in ids]
    locked, failed = await vault_storage.lock_photos(conn, rows, mvk)

    assert failed == [ids[0]] and locked == [ids[1]]
    assert (await _row(conn, ids[0]))["is_encrypted"] == 0
    assert (folder / "alpha.jpg").exists() and not (folder / "alpha.jpg.enc").exists()
    assert (await _row(conn, ids[1]))["is_encrypted"] == 1
    assert await _journal_count(conn, ids[0]) == 0


async def test_lock_never_overwrites_an_existing_enc_file(vault_env):
    """An unrelated file already at the target name is preserved; a unique name is used."""
    conn, mvk, folder, pid = vault_env["conn"], vault_env["mvk"], vault_env["folder"], vault_env["ids"][0]
    squatter = folder / "alpha.jpg.enc"
    squatter.write_bytes(b"someone else's data")

    await vault_storage.lock_photo(conn, await _row(conn, pid), mvk)
    assert squatter.read_bytes() == b"someone else's data"
    assert (await _row(conn, pid))["filepath"].endswith("alpha (1).jpg.enc")


async def test_recovery_never_deletes_a_file_another_photo_uses(vault_env):
    """A leftover that another row still points at is kept."""
    conn, folder, ids = vault_env["conn"], vault_env["folder"], vault_env["ids"]
    # Photo A is encrypted; its journal says its plaintext was beta.jpg, which photo B still uses.
    enc = folder / "alpha.jpg.enc"
    enc.write_bytes(b"ciphertext")
    await conn.execute(
        "UPDATE photos SET is_encrypted = 1, filepath = ? WHERE id = ?;", (vault_storage.to_db_path(enc), ids[0])
    )
    await conn.execute(
        "INSERT INTO vault_pending_ops (photo_id, operation, file_pairs) VALUES (?, 'lock', ?);",
        (ids[0], f'[["{vault_storage.to_db_path(folder / "beta.jpg")}", "{vault_storage.to_db_path(enc)}"]]'),
    )
    await conn.commit()

    await vault_storage.reconcile_pending_vault_ops(conn)
    assert (folder / "beta.jpg").exists()
    assert await _journal_count(conn, ids[0]) == 0
