"""H4: the vault key is overwritten on a graceful engine shutdown, and the auto-lock notice states the real setting."""

import secrets
import time

import pytest
from fastapi import HTTPException

from engine.api import vault
from engine.main import app, lifespan


@pytest.fixture(autouse=True)
def clean_session():
    vault.purge_vault_key()
    saved = vault.AUTO_LOCK_SECONDS
    yield
    vault.purge_vault_key()
    vault.set_auto_lock_seconds(saved)


async def test_graceful_engine_shutdown_overwrites_and_drops_the_key():
    key = secrets.token_bytes(32)
    async with lifespan(app):
        vault._open_session(key, pin_verifier="pin-set")  # PIN set: a normal lock would keep the key.
        vault.soft_lock_vault()
        buffer = vault.ACTIVE_VAULT_SESSION["mvk"]
        assert bytes(buffer) == key  # Still held for PIN re-unlock while the app runs.

    assert vault.ACTIVE_VAULT_SESSION["mvk"] is None
    assert bytes(buffer) == bytes(32)  # The session buffer itself was overwritten with zeros.


async def test_auto_lock_notice_uses_the_configured_time():
    vault.set_auto_lock_seconds(900)
    vault._open_session(secrets.token_bytes(32), pin_verifier=None)
    vault.ACTIVE_VAULT_SESSION["last_activity"] = time.time() - 901

    with pytest.raises(HTTPException) as err:
        vault.get_active_mvk()

    assert err.value.status_code == 401
    assert err.value.detail == "Vault locked automatically after 15 minutes of inactivity."
    assert vault.auto_lock_message() == err.value.detail
    vault.set_auto_lock_seconds(60)
    assert vault.auto_lock_message() == "Vault locked automatically after 1 minute of inactivity."


async def test_activity_on_the_vault_screen_keeps_the_engine_open():
    """M8 follow-up: the screen reports mouse/key activity, so the engine's clock matches its countdown."""
    from httpx import ASGITransport, AsyncClient

    vault.set_auto_lock_seconds(300)
    vault._open_session(secrets.token_bytes(32), pin_verifier=None)
    vault.ACTIVE_VAULT_SESSION["last_activity"] = time.time() - 250  # Idle for the engine, active on screen.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/api/vault/activity")
        assert res.status_code == 200
        assert time.time() - vault.ACTIVE_VAULT_SESSION["last_activity"] < 2

        # Idle past the limit: the report is refused and the vault is locked.
        vault.ACTIVE_VAULT_SESSION["last_activity"] = time.time() - 301
        res = await client.post("/api/vault/activity")
        assert res.status_code == 401
        assert vault.ACTIVE_VAULT_SESSION["is_unlocked"] is False

        # Locked: still refused.
        assert (await client.post("/api/vault/activity")).status_code == 401


def test_vault_photo_lists_decrypt_each_photos_details_once(monkeypatch):
    """Q4: listing vault photos decrypts a photo's sealed details once (it was three times)."""
    calls = []

    def fake_decrypt(row, mvk):
        calls.append(row["id"])
        return {"ocr_text": "passport no. X", "latitude": 12.9, "longitude": 77.6}

    monkeypatch.setattr(vault.vault_storage, "decrypt_vault_details", fake_decrypt)
    row = {
        "id": 7, "filename": "p.jpg", "filepath": "vault/p.enc", "file_size": 10, "original_file_size": None,
        "mime_type": "image/jpeg", "width": 4, "height": 3, "taken_at": "2024-03-03 10:00:00",
        "camera_make": None, "camera_model": None, "latitude": None, "longitude": None, "iso": None,
        "aperture": None, "shutter_speed": None, "focal_length": None, "is_favorite": 0, "is_encrypted": 1,
        "is_optimized": 1, "is_enhanced": 0, "caption": None, "thumbnail_path": None, "preview_path": None,
        "is_document": 1, "ocr_text": None, "vault_meta_enc": "sealed",
        "derived_from_id": None, "ai_kind": None,
    }
    photo = vault._vault_photo_dict(row, b"k" * 32)
    assert calls == [7]
    assert (photo["ocr_text"], photo["latitude"], photo["longitude"]) == ("passport no. X", 12.9, 77.6)
    assert photo["original_file_size"] == 10 and photo["is_document"] is True
