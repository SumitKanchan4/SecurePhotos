"""Middleware package for SecurePhotos engine."""
from engine.middleware.auth_middleware import LocalIPCSecurityMiddleware

__all__ = ["LocalIPCSecurityMiddleware"]
