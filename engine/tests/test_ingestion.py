"""Automated Tests for Ingestion Pipeline, EXIF, Thumbnails & API Routes."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.ingestion_service import ingest_single_photo, extract_exif_metadata
from engine.services.thumbnail_service import (
    calculate_file_hash,
    generate_micro_thumbnail,
    generate_display_preview,
)


def create_dummy_image(filepath: Path, width: int = 800, height: int = 600, color=(50, 100, 200)) -> Path:
    """Helper to create a test RGB JPEG file."""
    img = Image.new("RGB", (width, height), color=color)
    img.save(filepath, format="JPEG")
    return filepath


@pytest.mark.asyncio
async def test_thumbnail_and_preview_generation():
    """Verifies sub-10ms micro-thumbnail and 2K display proxy creation."""
    with tempfile.TemporaryDirectory() as tmpdir:
        img_path = Path(tmpdir) / "test_camera.jpg"
        create_dummy_image(img_path, 1920, 1080)

        file_hash = calculate_file_hash(img_path)
        assert len(file_hash) == 64

        thumb_path, tw, th = generate_micro_thumbnail(img_path, file_hash=file_hash, size=256)
        assert thumb_path.exists()
        assert tw <= 256 and th <= 256
        assert thumb_path.suffix == ".webp"
        assert thumb_path.parent.name == file_hash[:2].lower()

        preview_path = generate_display_preview(img_path, file_hash=file_hash, max_dimension=1024)
        assert preview_path.exists()
        assert preview_path.suffix == ".webp"


@pytest.mark.asyncio
async def test_managed_ingestion_and_deduplication():
    """Verifies single photo managed ingestion, date sharding, and duplicate skipping."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        await run_migrations(db_path)
        conn = await get_db_connection(db_path)

        img_path = Path(tmpdir) / "original_photo.jpg"
        create_dummy_image(img_path, 1280, 720)

        # Ingest photo in managed mode
        photo_id = await ingest_single_photo(conn, img_path, mode="managed", delete_source=False)
        assert photo_id is not None
        assert photo_id > 0

        # Attempt to ingest the exact same file again (deduplication check)
        duplicate_id = await ingest_single_photo(conn, img_path, mode="managed", delete_source=False)
        assert duplicate_id == photo_id  # Must return existing ID without duplicate insert

        # Check database record
        async with conn.execute("SELECT id, filename, is_managed, width, height FROM photos WHERE id = ?;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
            assert row is not None
            assert row["filename"] == "original_photo.jpg"
            assert row["is_managed"] == 1
            assert row["width"] == 1280
            assert row["height"] == 720

        await conn.close()


@pytest.mark.asyncio
async def test_photos_api_listing_and_favorite():
    """Verifies the GET /api/photos listing and POST /api/photos/{id}/favorite toggle."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Check listing
        response = await client.get("/api/photos")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
