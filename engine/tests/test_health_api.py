"""Integration Tests for FastAPI Health and Diagnostics Endpoints."""

import pytest
from httpx import ASGITransport, AsyncClient

from engine.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    """Verifies that the /health endpoint returns HTTP 200 and healthy status."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ("healthy", "degraded")
        assert data["app_name"] == "SecurePhotos Engine"
        assert "connected_volumes" in data
