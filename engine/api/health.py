"""System Health & Diagnostics API Routes for SecurePhotos Engine.

This module provides bidirectional health checking for the Tauri desktop shell,
reporting database connectivity, active volume status, and engine readiness.
"""

from fastapi import APIRouter, status
from pydantic import BaseModel

from engine.config import settings
from engine.database import get_db_connection
from engine.volume_tracker import list_connected_volumes

router = APIRouter(prefix="", tags=["Health"])


class HealthResponse(BaseModel):
    """Payload returned by the /health endpoint."""
    status: str
    app_name: str
    app_version: str
    database_ok: bool
    data_dir: str
    connected_volumes: int


@router.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health_check() -> HealthResponse:
    """Performs a comprehensive health check on the engine and database connection."""
    db_ok = False
    try:
        conn = await get_db_connection()
        async with conn.execute("SELECT 1;") as cursor:
            row = await cursor.fetchone()
            if row and row[0] == 1:
                db_ok = True
        await conn.close()
    except Exception:
        db_ok = False

    volumes = list_connected_volumes()

    return HealthResponse(
        status="healthy" if db_ok else "degraded",
        app_name=settings.app_name,
        app_version=settings.app_version,
        database_ok=db_ok,
        data_dir=str(settings.data_dir),
        connected_volumes=len(volumes),
    )
