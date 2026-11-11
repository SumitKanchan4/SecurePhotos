"""Zero-Trust Local IPC Handshake & Session API Router for SecurePhotos.

The app proves itself with the IPC secret (header ``X-SecurePhotos-Token``) once,
at handshake. Media elements (``<img>``, ``<video>``) can't send headers, so the
handshake also sets a cookie. That cookie holds a **separate random session
value** (never the IPC secret), lives only in this engine process's memory, and
dies when the engine restarts (backlog H6).

The cookie is ``SameSite=None; Secure; HttpOnly``: the app page (``tauri.localhost``
or ``localhost:1420``) and the engine (``127.0.0.1``) are different sites, and
WebView2 rejects ``SameSite=Lax`` cookies set across sites, which made every
thumbnail fail with 403 in the real app. ``Secure`` is allowed on plain-HTTP
``127.0.0.1`` because browsers treat loopback as a secure origin.
"""

import hmac
import logging
import secrets
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from pydantic import BaseModel

from engine.config import settings

logger = logging.getLogger("securephotos.auth_api")
router = APIRouter(prefix="/api/auth", tags=["Auth"])

SESSION_COOKIE = "securephotos_session"
# Session values issued by this engine process (handshakes from app reloads add more).
_MAX_SESSIONS = 16
_active_sessions: list = []


def is_valid_session(value: Optional[str]) -> bool:
    """Constant-time check of a session cookie value against the issued ones."""
    if not value:
        return False
    found = False
    for issued in _active_sessions:
        found |= hmac.compare_digest(value, issued)
    return found


def _issue_session() -> str:
    value = secrets.token_hex(32)
    _active_sessions.append(value)
    del _active_sessions[:-_MAX_SESSIONS]  # Keep only the most recent ones.
    return value


class HandshakeResponse(BaseModel):
    status: str
    version: str
    message: str


@router.post("/handshake", response_model=HandshakeResponse, status_code=status.HTTP_200_OK)
async def perform_handshake(
    response: Response,
    request: Request,
    x_securephotos_token: Optional[str] = Header(None, alias="X-SecurePhotos-Token"),
) -> HandshakeResponse:
    """Authenticates the native frontend client and issues an HttpOnly session cookie.

    The session cookie ensures that standard HTML media elements (<img src>, <video src>)
    can load thumbnails and preview streams without requiring query parameter token leaks.
    """
    provided_token = x_securephotos_token

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

    # Session cookie for media requests: random per handshake, valid until the engine restarts.
    response.set_cookie(
        key=SESSION_COOKIE,
        value=_issue_session(),
        httponly=True,
        samesite="none",
        secure=True,
        path="/",
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
