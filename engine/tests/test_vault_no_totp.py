"""H3: TOTP is gone. Setup never stores a secret, and an old stored secret can't block unlocking."""

from httpx import ASGITransport, AsyncClient

from engine.api.vault import purge_vault_key
from engine.database import get_db_connection, run_migrations
from engine.main import app

PASSWORD = "NoTotpVault#2026"


async def _totp_column():
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT totp_secret_encrypted FROM vault_configs;") as cur:
            return [r[0] for r in await cur.fetchall()]
    finally:
        await conn.close()


async def test_setup_ignores_enable_totp_and_unlocks_with_password_only():
    await run_migrations()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        setup = await client.post("/api/vault/setup", json={"password": PASSWORD, "enable_totp": True})
        assert setup.status_code == 201
        assert "totp_secret" not in setup.json() and "totp_uri" not in setup.json()
        assert await _totp_column() == [None]
        status = (await client.get("/api/vault/status")).json()
        assert "has_totp" not in status
        purge_vault_key()
        unlock = await client.post("/api/vault/unlock", json={"password": PASSWORD})
        assert unlock.status_code == 200


async def test_old_stored_secret_is_blanked_and_does_not_block_unlock():
    await run_migrations()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post("/api/vault/setup", json={"password": PASSWORD})).status_code == 201
        conn = await get_db_connection()
        try:  # What an older version stored: the plain base32 secret.
            await conn.execute("UPDATE vault_configs SET totp_secret_encrypted = 'JBSWY3DPEHPK3PXP';")
            await conn.execute("DELETE FROM applied_migrations WHERE name = '2026_11_h3_blank_totp_secrets';")
            await conn.commit()
        finally:
            await conn.close()

        await run_migrations()

        assert await _totp_column() == [None]
        purge_vault_key()
        unlock = await client.post("/api/vault/unlock", json={"password": PASSWORD})
        assert unlock.status_code == 200
