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
