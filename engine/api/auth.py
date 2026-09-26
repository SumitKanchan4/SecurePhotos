"""Zero-Trust Local IPC Handshake & Session API Router for SecurePhotos."""

import hmac
import logging
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel

from engine.config import settings

logger = logging.getLogger("securephotos.auth_api")
router = APIRouter(prefix="/api/auth", tags=["Auth"])


class HandshakeResponse(BaseModel):
    status: str
    version: str
    message: str


@router.post("/handshake", response_model=HandshakeResponse, status_code=status.HTTP_200_OK)
async def perform_handshake(
    response: Response,
    request: Request,
    x_securephotos_token: Optional[str] = Header(None, alias="X-SecurePhotos-Token"),
    token: Optional[str] = Query(None),
) -> HandshakeResponse:
    """Authenticates the native frontend client and issues an HttpOnly session cookie.

    The session cookie ensures that standard HTML media elements (<img src>, <video src>)
    can load thumbnails and preview streams without requiring query parameter token leaks.
    """
    provided_token = x_securephotos_token or token

    # In dev mode without an IPC secret configured, handshake succeeds unconditionally
    if not settings.ipc_secret:
        return HandshakeResponse(
            status="authenticated",
            version=settings.app_version,
            message="Dev mode: authentication bypass active",
        )

    if not provided_token or not hmac.compare_digest(provided_token, settings.ipc_secret):
        logger.warning("Rejected handshake attempt with missing or invalid token.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing local IPC authorization token.",
        )

    # Issue secure session cookie for media requests
    response.set_cookie(
        key="securephotos_ipc",
        value=settings.ipc_secret,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=86400 * 30,  # 30 days
    )

    logger.info("Successfully completed local IPC handshake and issued session cookie.")
    return HandshakeResponse(
        status="authenticated",
        version=settings.app_version,
        message="Handshake successful",
    )


@router.get("/verify", status_code=status.HTTP_200_OK)
async def verify_auth_status() -> dict:
    """Lightweight endpoint to confirm the current connection is fully authenticated."""
    return {
        "status": "authenticated",
        "authenticated": True,
        "app": settings.app_name,
        "version": settings.app_version,
    }
