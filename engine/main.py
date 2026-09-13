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
from engine.api import health, system, photos, vault, stories, people, albums, creatives, trash, duplicates, videos

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

    # Automatically trigger background 4K optimization pass if any unoptimized photos exist
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        asyncio.create_task(photos.run_background_optimization())
        from engine.services.face_scan_worker import start_background_scan
        start_background_scan()
        from engine.services.video_queue_service import start_video_queue_worker
        start_video_queue_worker()

    yield

    logger.info("Shutting down SecurePhotos Engine sidecar...")


def create_app() -> FastAPI:
    """Factory function to instantiate and configure the FastAPI app."""
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Local-first, SLM-powered Desktop Media Library & Digital Vault Engine",
        lifespan=lifespan,
    )

    # Configure strict localhost CORS middleware for Tauri IPC
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount API routers
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
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    settings.port = args.port
    settings.host = args.host
    settings.data_dir = Path(args.data_dir)

    logger.info(f"Starting {settings.app_name} on http://{settings.host}:{settings.port}")
    logger.info(f"Data Directory: {settings.data_dir}")

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
    )
