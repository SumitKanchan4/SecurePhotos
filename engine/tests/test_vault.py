"""Automated Tests for Zero-Trust Vault Encryption, Key Wrapping & API Endpoints."""

import secrets
import tempfile
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import run_migrations
from engine.main import app
from engine.services.crypto_vault import (
    derive_key_from_password,
    derive_key_from_recovery_phrase,
    wrap_master_key,
    unwrap_master_key,
    encrypt_file_chunked,
    decrypt_file_chunked_stream,
    decrypt_file_to_bytes,
    generate_totp_secret,
    verify_totp_code,
)


def test_argon2_and_recovery_key_derivation():
    """Verifies that Argon2id and PBKDF2 derive independent 256-bit keys."""
    salt = secrets.token_bytes(16)
    key_pass = derive_key_from_password("VaultSecret123!", salt)
    assert len(key_pass) == 32

    phrase = "apple timber ocean canyon desert mountain river breeze stone valley thunder shadow"
    key_rec = derive_key_from_recovery_phrase(phrase, salt)
    assert len(key_rec) == 32
    assert key_pass != key_rec


def test_master_key_wrapping_and_unwrapping():
    """Verifies multi-slot wrapping and unwrapping of 256-bit Master Vault Key."""
    mvk = secrets.token_bytes(32)
    salt = secrets.token_bytes(16)

    kek = derive_key_from_password("MySuperPassword", salt)
    wrapped_b64 = wrap_master_key(mvk, kek)

    # Valid unwrap
    unwrapped = unwrap_master_key(wrapped_b64, kek)
    assert unwrapped == mvk

    # Invalid password attempt (must fail cleanly)
    bad_kek = derive_key_from_password("WrongPassword", salt)
    bad_unwrap = unwrap_master_key(wrapped_b64, bad_kek)
    assert bad_unwrap is None


def test_chunked_file_encryption_and_decryption():
    """Verifies 64 KB chunked authenticated AES-256-GCM streaming encryption."""
    mvk = secrets.token_bytes(32)
    sample_data = b"Enterprise zero-trust media payload with authentications." * 5000  # ~285 KB

    with tempfile.TemporaryDirectory() as tmpdir:
        src = Path(tmpdir) / "original.jpg"
        enc = Path(tmpdir) / "original.jpg.enc"
        src.write_bytes(sample_data)

        # Encrypt file
        encrypt_file_chunked(src, enc, mvk)
        assert enc.exists()
        assert enc.stat().st_size > src.stat().st_size  # Header & tags overhead

        # Decrypt into bytes and stream chunks
        decrypted_bytes = decrypt_file_to_bytes(enc, mvk)
        assert decrypted_bytes == sample_data

        chunks = list(decrypt_file_chunked_stream(enc, mvk))
        assert len(chunks) >= 4  # Proves chunked streaming worked
        assert b"".join(chunks) == sample_data


@pytest.mark.asyncio
async def test_vault_setup_and_unlock_api():
    """Verifies /api/vault/setup and /api/vault/unlock API workflow."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Setup vault
        setup_res = await client.post(
            "/api/vault/setup",
            json={
                "password": "MasterVaultPassword99!",
                "recovery_phrase": "timber ocean canyon desert mountain river breeze stone valley thunder shadow apple",
                "password_hint": "Favorite nature words",
                "enable_totp": False,
            },
        )
        assert setup_res.status_code == 201

        # Check status
        status_res = await client.get("/api/vault/status")
        assert status_res.status_code == 200
        assert status_res.json()["is_configured"] is True

        # Unlock with valid password
        unlock_res = await client.post(
            "/api/vault/unlock",
            json={"password": "MasterVaultPassword99!"},
        )
        assert unlock_res.status_code == 200
        assert unlock_res.json()["status"] == "unlocked"
        assert "session_token" in unlock_res.json()

        # Unlock with wrong password (should fail 401)
        bad_unlock = await client.post(
            "/api/vault/unlock",
            json={"password": "IncorrectPassword!"},
        )
        assert bad_unlock.status_code == 401

        # Lock vault
        lock_res = await client.post("/api/vault/lock")
        assert lock_res.status_code == 200

        # Clean up test vault state so dev DB is not polluted
        await client.post("/api/vault/reset")


@pytest.mark.asyncio
async def test_vault_photos_crud_and_streaming_api():
    """Verifies complete photo locking, thumbnail streaming, listing, and unlocking workflow."""
    from PIL import Image
    from engine.database import get_db_connection

    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Setup and unlock vault
        await client.post(
            "/api/vault/setup",
            json={
                "password": "SecureVaultPass456!",
                "recovery_phrase": "timber ocean canyon desert mountain river breeze stone valley thunder shadow apple",
                "enable_totp": False,
            },
        )
        unlock_res = await client.post(
            "/api/vault/unlock",
            json={"password": "SecureVaultPass456!"},
        )
        assert unlock_res.status_code == 200

        with tempfile.TemporaryDirectory() as tmpdir:
            orig_path = Path(tmpdir) / "secret_document.jpg"
            thumb_path = Path(tmpdir) / "secret_document_thumb.jpg"

            # Create test image
            img = Image.new("RGB", (200, 200), color=(255, 100, 50))
            img.save(orig_path, format="JPEG")
            img.resize((64, 64)).save(thumb_path, format="JPEG")

            # Insert into photos DB table
            conn = await get_db_connection()
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, thumbnail_path, is_encrypted, is_favorite)
                VALUES ('secret_document.jpg', ?, 1024, 'image/jpeg', ?, 0, 0);
                """,
                (str(orig_path.resolve()), str(thumb_path.resolve())),
            )
            photo_id = cursor.lastrowid
            await conn.commit()
            await conn.close()

            # 2. Lock photo into Vault
            lock_res = await client.post(
                "/api/vault/photos/lock",
                json={"photo_ids": [photo_id]},
            )
            assert lock_res.status_code == 200
            assert lock_res.json()["locked_count"] == 1

            # Verify unencrypted files removed from disk, .enc created
            assert not orig_path.exists()
            enc_orig = orig_path.with_suffix(".jpg.enc")
            assert enc_orig.exists()

            # 3. List photos in Vault
            list_res = await client.get("/api/vault/photos")
            assert list_res.status_code == 200
            vault_items = list_res.json()
            assert any(p["id"] == photo_id and p["is_encrypted"] is True for p in vault_items)

            # 4. Stream decrypted thumbnail
            thumb_res = await client.get(f"/api/vault/thumbnail/{photo_id}")
            assert thumb_res.status_code == 200
            assert thumb_res.headers["content-type"] == "image/jpeg"
            assert len(thumb_res.content) > 0

            # 5. Stream decrypted full-res media
            stream_res = await client.get(f"/api/vault/stream/{photo_id}")
            assert stream_res.status_code == 200
            assert stream_res.headers["content-type"] == "image/jpeg"
            assert len(stream_res.content) > 0

            # 6. Unlock / Restore photo back to public library
            unlock_photo_res = await client.post(
                "/api/vault/photos/unlock",
                json={"photo_ids": [photo_id]},
            )
            assert unlock_photo_res.status_code == 200
            assert unlock_photo_res.json()["unlocked_count"] == 1

            # Verify unencrypted file restored on disk and .enc removed
            assert orig_path.exists()
            assert not enc_orig.exists()

            # 7. Lock the entire vault and verify 401 gate
            await client.post("/api/vault/lock")
            unauth_res = await client.get("/api/vault/photos")
            assert unauth_res.status_code == 401

            # Clean up test vault and test photo row
            await client.post("/api/vault/reset")
            conn = await get_db_connection()
            await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            await conn.commit()
            await conn.close()

