"""FastAPI Application Entrypoint for SecurePhotos 2.0 Engine Sidecar.

This module initialises the FastAPI application, executes idempotent database
schema migrations during startup lifespan, configures localhost-only CORS for Tauri,
and mounts API routers.
"""

import argparse
import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine.config import settings
from engine.database import run_migrations
from engine.middleware import LocalIPCSecurityMiddleware
from engine.api import health, system, photos, vault, stories, people, albums, creatives, trash, duplicates, videos, search, documents, auth, restore

# Configure enterprise structured logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("securephotos.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager to run migrations and background tasks."""
    logger.info("Initializing SecurePhotos Engine sidecar...")
    settings.ensure_directories()
    
    # Run idempotent schema migrations on the SQLite WAL engine
    try:
        await run_migrations()
        logger.info("Database schema initialized successfully.")
    except Exception as e:
        logger.critical(f"Database migration failed: {e}", exc_info=True)
        sys.exit(1)

    # Apply the saved vault auto-lock timeout (M8).
    try:
        from engine.api.system import get_app_settings
        from engine.api.vault import set_auto_lock_seconds
        set_auto_lock_seconds((await get_app_settings())["settings"].get("auto_lock_duration"))
    except Exception as e:
        logger.warning(f"Could not load the auto-lock setting; using 5 minutes: {e}")

    # Finish or roll back any vault lock/unlock interrupted by a crash or unplug.
    # Runs before background workers so nothing else touches those files first.
    try:
        from engine.services.vault_storage import reconcile_pending_vault_ops
        await reconcile_pending_vault_ops()
    except Exception as e:
        logger.error(f"Vault recovery sweep failed; leftovers kept for next start: {e}", exc_info=True)

    # Automatically trigger background 4K optimization pass if any unoptimized photos exist
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        asyncio.create_task(photos.run_background_optimization())
        # Permanently delete trash older than 30 days, now and every 6 hours (M7).
        asyncio.create_task(trash.run_trash_purge_loop())
        from engine.services.face_scan_worker import start_background_scan
        start_background_scan()
        from engine.services.video_queue_service import start_video_queue_worker
        start_video_queue_worker()
        # Old-photo improvements (H10): one job at a time on the CPU.
        from engine.services.restore_queue import start_worker as start_restore_worker
        start_restore_worker()
        # One-off: handle video originals left in hidden .trash folders by older versions (R7c2).
        from engine.services.video_leftovers import run_once as clean_up_old_video_originals
        asyncio.create_task(clean_up_old_video_originals())

    # H10: plug in "Add colour" and "Fix faded colours" (the worker runs them; tests use fakes).
    from engine.services import old_photo_processors
    old_photo_processors.register()

    yield

    logger.info("Shutting down SecurePhotos Engine sidecar...")
    # H4: overwrite and drop the vault key on a graceful shutdown. (When the app closes, the shell
    # ends this process and Windows clears its memory, so this mainly covers development stops.)
    from engine.api.vault import purge_vault_key
    purge_vault_key()
    from engine.services.video_queue_service import stop_video_queue_worker
    await stop_video_queue_worker()
    from engine.services.restore_queue import stop_worker as stop_restore_worker
    await stop_restore_worker()


def create_app() -> FastAPI:
    """Factory function to instantiate and configure the FastAPI app."""
    # API docs publish the full API map; only serve them in development (backlog M6).
    installed_build = bool(getattr(sys, "frozen", False))
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Local-first, SLM-powered Desktop Media Library & Digital Vault Engine",
        lifespan=lifespan,
        docs_url=None if installed_build else "/docs",
        redoc_url=None if installed_build else "/redoc",
        openapi_url=None if installed_build else "/openapi.json",
    )

    # Configure zero-trust local IPC security middleware
    app.add_middleware(LocalIPCSecurityMiddleware)

    # Configure strict localhost CORS middleware for Tauri IPC
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount API routers
    app.include_router(auth.router)
    app.include_router(health.router)
    app.include_router(health.router, prefix="/api")
    app.include_router(system.router)
    app.include_router(photos.router)
    app.include_router(vault.router)
    app.include_router(stories.router)
    app.include_router(people.router)
    app.include_router(albums.router)
    app.include_router(creatives.router)
    app.include_router(trash.router)
    app.include_router(duplicates.router)
    app.include_router(videos.router)
    app.include_router(search.router)
    app.include_router(documents.router)
    app.include_router(restore.router)

    return app


app = create_app()


def parse_args() -> argparse.Namespace:
    """Parses command-line arguments for dynamic port and data-dir assignment."""
    parser = argparse.ArgumentParser(description="SecurePhotos 2.0 Backend Sidecar Engine")
    parser.add_argument(
        "--port",
        type=int,
        default=settings.port,
        help="Dynamic TCP port to bind the FastAPI sidecar to (assigned by Tauri)",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=str(settings.data_dir),
        help="Custom storage path for the SQLite database, models, and cache",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=settings.host,
        help="Host address to bind to (strictly 127.0.0.1 for local IPC)",
    )
    parser.add_argument(
        "--ipc-secret",
        type=str,
        default=None,
        help="Shared secret token for local IPC authorization (assigned by Tauri)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    settings.port = args.port
    settings.host = args.host
    settings.data_dir = Path(args.data_dir)
    if args.ipc_secret:
        settings.ipc_secret = args.ipc_secret

    logger.info(f"Starting {settings.app_name} on http://{settings.host}:{settings.port}")
    if settings.ipc_secret:
        logger.info("Local IPC zero-trust token authentication active.")
    logger.info(f"Data Directory: {settings.data_dir}")

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
    )
