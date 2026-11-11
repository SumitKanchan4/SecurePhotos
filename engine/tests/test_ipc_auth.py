"""Tests for the engine's local IPC authentication (backlog H6).

Credentials: the ``X-SecurePhotos-Token`` header (the IPC secret) or the
``securephotos_session`` cookie issued at handshake (a separate random value).
"""

import sys

import pytest
from httpx import ASGITransport, AsyncClient

from engine.config import settings
from engine.main import app, create_app

SECRET = "secure-production-secret-999"


@pytest.fixture(autouse=True)
def reset_ipc_secret():
    """Ensures settings.ipc_secret is cleanly restored after every test."""
    original_secret = settings.ipc_secret
    yield
    settings.ipc_secret = original_secret


def _client(base_url="https://test", application=app, **kwargs):
    # https: the session cookie is Secure, so a correct client only sends it over https
    # (in the app, http://127.0.0.1 counts as a secure origin).
    return AsyncClient(transport=ASGITransport(app=application), base_url=base_url, **kwargs)


async def test_health_exempt_without_auth():
    settings.ipc_secret = SECRET
    async with _client() as client:
        assert (await client.get("/health")).status_code == 200
        assert (await client.get("/api/health")).status_code == 200


async def test_dev_mode_bypass_when_no_secret():
    """Development (not frozen) without a secret: requests are allowed."""
    settings.ipc_secret = None
    async with _client() as client:
        assert (await client.get("/api/auth/verify")).status_code == 200


async def test_installed_build_without_secret_fails_closed(monkeypatch):
    """A packaged engine started without a secret must refuse requests."""
    settings.ipc_secret = None
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    async with _client() as client:
        assert (await client.get("/api/auth/verify")).status_code == 403
        assert (await client.get("/api/health")).status_code == 200  # Liveness check still answers.


async def test_unauthenticated_and_wrong_token_blocked():
    settings.ipc_secret = SECRET
    async with _client() as client:
        assert (await client.get("/api/auth/verify")).status_code == 403
        bad = await client.get("/api/auth/verify", headers={"X-SecurePhotos-Token": "wrong"})
        assert bad.status_code == 403


async def test_header_token_accepted():
    settings.ipc_secret = SECRET
    async with _client() as client:
        res = await client.get("/api/auth/verify", headers={"X-SecurePhotos-Token": SECRET})
        assert res.status_code == 200 and res.json()["authenticated"] is True


async def test_token_in_url_is_not_accepted():
    """?token= used to be accepted; URLs end up in logs, so it no longer is."""
    settings.ipc_secret = SECRET
    async with _client() as client:
        assert (await client.get(f"/api/auth/verify?token={SECRET}")).status_code == 403


async def test_handshake_issues_random_session_cookie_webview2_accepts():
    settings.ipc_secret = SECRET
    async with _client() as client:
        res = await client.post("/api/auth/handshake", headers={"X-SecurePhotos-Token": SECRET})
        assert res.status_code == 200
        set_cookie = res.headers["set-cookie"].lower()
        assert "securephotos_session=" in set_cookie
        assert "samesite=none" in set_cookie and "secure" in set_cookie and "httponly" in set_cookie
        assert "max-age" not in set_cookie and "expires" not in set_cookie  # Ends with the engine session.
        value = res.cookies["securephotos_session"]
        assert value != SECRET and len(value) == 64

        # The cookie alone (as an <img> request would send it) is accepted.
        assert (await client.get("/api/auth/verify")).status_code == 200

    # A different client presenting only the cookie value is accepted; forged ones aren't.
    async with _client(cookies={"securephotos_session": value}) as cookie_client:
        assert (await cookie_client.get("/api/auth/verify")).status_code == 200
    async with _client(cookies={"securephotos_session": "f" * 64}) as forged:
        assert (await forged.get("/api/auth/verify")).status_code == 403
    # The old cookie, which carried the secret itself, is no longer honoured.
    async with _client(cookies={"securephotos_ipc": SECRET}) as old_style:
        assert (await old_style.get("/api/auth/verify")).status_code == 403


async def test_handshake_needs_the_secret():
    settings.ipc_secret = SECRET
    async with _client() as client:
        assert (await client.post("/api/auth/handshake")).status_code == 403
        assert (await client.post("/api/auth/handshake", headers={"X-SecurePhotos-Token": "nope"})).status_code == 403
        assert (await client.post(f"/api/auth/handshake?token={SECRET}")).status_code == 403
        assert "securephotos_session" not in client.cookies


async def test_api_docs_only_in_development(monkeypatch):
    settings.ipc_secret = None
    async with _client(application=create_app()) as client:
        assert (await client.get("/openapi.json")).status_code == 200
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    settings.ipc_secret = SECRET
    async with _client(application=create_app()) as client:
        headers = {"X-SecurePhotos-Token": SECRET}
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path, headers=headers)).status_code == 404
