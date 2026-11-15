"""Settings → Private Vault → "Print a new card" (redesign R6): replacing the Emergency Card."""

import pytest
from httpx import ASGITransport, AsyncClient

from engine.api.vault import purge_vault_key
from engine.database import run_migrations
from engine.main import app

PASSWORD = "CardReplace#2026"


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=120)


@pytest.mark.asyncio
async def test_new_card_replaces_the_old_one_and_needs_the_password():
    await run_migrations()
    async with _client() as client:
        setup = await client.post("/api/vault/setup", json={"password": PASSWORD})
        assert setup.status_code == 201
        old_card = setup.json()["grid_card"]

        # Locked vault: refused even with the right password.
        purge_vault_key()
        locked = await client.post("/api/vault/grid-card/replace", json={"current_password": PASSWORD})
        assert locked.status_code == 401

        assert (await client.post("/api/vault/unlock", json={"password": PASSWORD})).status_code == 200
        wrong = await client.post("/api/vault/grid-card/replace", json={"current_password": "not-it-at-all"})
        assert wrong.status_code == 401

        res = await client.post("/api/vault/grid-card/replace", json={"current_password": PASSWORD})
        assert res.status_code == 200
        new_card = res.json()["grid_card"]
        assert new_card["card_id"] != old_card["card_id"]
        assert set(new_card["cells"]) == set("ABCDEFGHIJKLMNOP")
        status = (await client.get("/api/vault/status")).json()
        assert status["is_unlocked"] is True  # replacing the card doesn't lock the vault

        purge_vault_key()
        # The old card no longer works, by numbers or by file.
        by_old_numbers = await client.post(
            "/api/vault/reset-password", json={"new_password": "Another#Pass1", "card_cells": old_card["cells"]}
        )
        assert by_old_numbers.status_code == 401
        by_old_file = await client.post(
            "/api/vault/reset-password", json={"new_password": "Another#Pass1", "card_token": old_card["card_token"]}
        )
        assert by_old_file.status_code == 401

        # The new card works both ways, and the vault opens with the password it set.
        by_new_numbers = await client.post(
            "/api/vault/reset-password", json={"new_password": "FromNumbers#1", "card_cells": new_card["cells"]}
        )
        assert by_new_numbers.status_code == 200
        by_new_file = await client.post(
            "/api/vault/reset-password", json={"new_password": "FromFile#2026", "card_token": new_card["card_token"]}
        )
        assert by_new_file.status_code == 200
        assert (await client.post("/api/vault/unlock", json={"password": "FromFile#2026"})).status_code == 200
        purge_vault_key()
