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
