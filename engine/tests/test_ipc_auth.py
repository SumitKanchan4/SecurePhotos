"""Unit & Integration Tests for Zero-Trust Local IPC Authentication & Handshake."""

import pytest
from httpx import ASGITransport, AsyncClient

from engine.config import settings
from engine.main import app


@pytest.fixture(autouse=True)
def reset_ipc_secret():
    """Ensures settings.ipc_secret is cleanly restored after every test."""
    original_secret = settings.ipc_secret
    yield
    settings.ipc_secret = original_secret


@pytest.mark.asyncio
async def test_health_exempt_without_auth():
    """Verifies that /health is always accessible without any credentials."""
    settings.ipc_secret = "test-secret-key-xyz-123"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200

        api_health = await client.get("/api/health")
        assert api_health.status_code == 200


@pytest.mark.asyncio
async def test_dev_mode_bypass_when_no_secret():
    """Verifies that all endpoints are accessible when ipc_secret is None (dev mode)."""
    settings.ipc_secret = None
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/auth/verify")
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True


@pytest.mark.asyncio
async def test_unauthenticated_request_blocked():
    """Verifies that endpoints return 403 Forbidden when secret is active and no token is provided."""
    settings.ipc_secret = "secure-production-secret-999"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/auth/verify")
        assert response.status_code == 403
        data = response.json()
        assert "Unauthorized local IPC access" in data["detail"]


@pytest.mark.asyncio
async def test_invalid_token_rejected():
    """Verifies that an incorrect token is rejected with 403 Forbidden."""
    settings.ipc_secret = "secure-production-secret-999"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/auth/verify",
            headers={"X-SecurePhotos-Token": "completely-wrong-token"},
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_authenticated_request_via_header():
    """Verifies that request with valid X-SecurePhotos-Token header is accepted."""
    test_secret = "super-secret-token-abcdef"
    settings.ipc_secret = test_secret
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/auth/verify",
            headers={"X-SecurePhotos-Token": test_secret},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True


@pytest.mark.asyncio
async def test_handshake_flow_and_cookie_auth():
    """Verifies the handshake endpoint issues a secure session cookie for media requests."""
    test_secret = "token-for-cookie-test-456"
    settings.ipc_secret = test_secret
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Perform handshake
        handshake_res = await client.post(
            "/api/auth/handshake",
            headers={"X-SecurePhotos-Token": test_secret},
        )
        assert handshake_res.status_code == 200
        assert "securephotos_ipc" in handshake_res.cookies

        # 2. Subsequent request using the session cookie persisted in client's cookie jar
        verify_res = await client.get("/api/auth/verify")
        assert verify_res.status_code == 200
        assert verify_res.json()["authenticated"] is True

    # 3. Subsequent request from a fresh client instance configured with the session cookie directly
    cookie_val = handshake_res.cookies["securephotos_ipc"]
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"securephotos_ipc": cookie_val},
    ) as cookie_client:
        verify_res2 = await cookie_client.get("/api/auth/verify")
        assert verify_res2.status_code == 200
        assert verify_res2.json()["authenticated"] is True


@pytest.mark.asyncio
async def test_authenticated_request_via_query_param():
    """Verifies that media elements falling back to ?token=... query param are accepted."""
    test_secret = "token-for-query-test-789"
    settings.ipc_secret = test_secret
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/api/auth/verify?token={test_secret}")
        assert response.status_code == 200
        assert response.json()["authenticated"] is True
