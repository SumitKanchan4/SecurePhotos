"""Zero-Trust Local IPC Authentication Middleware for SecurePhotos Engine Sidecar.

This middleware guarantees that only the authorized native desktop host
(possessing the ephemeral 256-bit secret token) can invoke sidecar API routes.
All unauthorized local processes, rogue scripts, or foreign browser contexts
attempting to probe localhost are rejected with HTTP 403 Forbidden.
"""

import hmac
import logging
from typing import Callable
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from engine.config import settings

logger = logging.getLogger("securephotos.auth_middleware")

# Paths reachable without credentials: liveness checks and the handshake itself.
# API docs (/docs, /redoc, /openapi.json) are only served in development builds,
# where requests are not checked anyway (see engine.main.create_app).
EXEMPT_PATHS = {
    "/health",
    "/api/health",
    "/api/auth/handshake",
}


def _is_installed_build() -> bool:
    """True when running as the packaged (PyInstaller) engine."""
    import sys

    return bool(getattr(sys, "frozen", False))


class LocalIPCSecurityMiddleware(BaseHTTPMiddleware):
    """Enforces zero-trust authentication on all incoming HTTP requests (backlog H6).

    Accepted credentials:
    - ``X-SecurePhotos-Token`` header equal to the IPC secret (API calls);
    - ``securephotos_session`` cookie issued by the handshake (media elements).
    Tokens in the URL (``?token=``) are not accepted: URLs end up in logs.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)  # CORS preflight carries no credentials.

        path = request.url.path
        if path in EXEMPT_PATHS:
            return await call_next(request)

        if not settings.ipc_secret:
            if _is_installed_build():
                # Fail closed: an installed engine must never run without a secret.
                logger.error("Rejected %s %s: engine started without an IPC secret.", request.method, path)
                return JSONResponse(status_code=403, content={"detail": "Engine is not configured for secure access."})
            return await call_next(request)  # Development only.

        auth_header = request.headers.get("X-SecurePhotos-Token")
        if auth_header and hmac.compare_digest(auth_header, settings.ipc_secret):
            return await call_next(request)

        from engine.api.auth import SESSION_COOKIE, is_valid_session

        if is_valid_session(request.cookies.get(SESSION_COOKIE)):
            return await call_next(request)

        client_host = request.client.host if request.client else "unknown"
        logger.warning(f"Blocked unauthorized IPC request: {request.method} {path} from {client_host}")
        return JSONResponse(
            status_code=403,
            content={"detail": "Unauthorized local IPC access. Valid token or session cookie required.", "path": path},
        )
