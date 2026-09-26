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

# Paths that are public for health checking, docs, or initial handshake
EXEMPT_PATHS = {
    "/health",
    "/api/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/favicon.ico",
}


class LocalIPCSecurityMiddleware(BaseHTTPMiddleware):
    """Enforces zero-trust authentication on all incoming HTTP requests."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 1. Allow health checks, API docs, and preflight OPTIONS requests without credentials
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if path in EXEMPT_PATHS or path == "/api/auth/handshake":
            return await call_next(request)

        # 2. Transparent bypass in development if no IPC secret is configured
        if not settings.ipc_secret:
            return await call_next(request)

        expected_secret = settings.ipc_secret

        # 3. Check X-SecurePhotos-Token custom header (primary for API calls)
        auth_header = request.headers.get("X-SecurePhotos-Token")
        if auth_header and hmac.compare_digest(auth_header, expected_secret):
            return await call_next(request)

        # 4. Check securephotos_ipc cookie (for media tags <img>, <video>, <audio>)
        auth_cookie = request.cookies.get("securephotos_ipc")
        if auth_cookie and hmac.compare_digest(auth_cookie, expected_secret):
            return await call_next(request)

        # 5. Check URL query parameter fallback (?token=...)
        query_token = request.query_params.get("token")
        if query_token and hmac.compare_digest(query_token, expected_secret):
            return await call_next(request)

        # 6. Reject unauthorized request
        client_host = request.client.host if request.client else "unknown"
        logger.warning(f"Blocked unauthorized IPC request: {request.method} {path} from {client_host}")
        return JSONResponse(
            status_code=403,
            content={
                "detail": "Unauthorized local IPC access. Valid token or session cookie required.",
                "path": path,
            },
        )
