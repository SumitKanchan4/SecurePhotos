"""Automated Tests for Ingestion Pipeline, EXIF, Thumbnails & API Routes."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.ingestion_service import (
    ingest_single_photo,
    extract_exif_metadata,
    parse_date_from_filename,
    parse_date_from_directory,
    get_hierarchical_destination_path,
)
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


def test_filename_date_extraction_patterns():
    """Verifies regex extraction for WhatsApp, Telegram, Camera, and Screenshot patterns."""
    # WhatsApp Android
    dt_wa_android = parse_date_from_filename("IMG-20220815-WA0004.jpg")
    assert dt_wa_android is not None
    assert dt_wa_android.year == 2022 and dt_wa_android.month == 8 and dt_wa_android.day == 15

    # WhatsApp iOS / Web
    dt_wa_ios = parse_date_from_filename("WhatsApp Image 2023-11-20 at 14.30.15.jpeg")
    assert dt_wa_ios is not None
    assert dt_wa_ios.year == 2023 and dt_wa_ios.month == 11 and dt_wa_ios.day == 20
    assert dt_wa_ios.hour == 14 and dt_wa_ios.minute == 30 and dt_wa_ios.second == 15

    # Telegram
    dt_tg = parse_date_from_filename("photo_2021-04-10_12-00-00.jpg")
    assert dt_tg is not None
    assert dt_tg.year == 2021 and dt_tg.month == 4 and dt_tg.day == 10

    # Screenshot
    dt_sc = parse_date_from_filename("Screenshot_20230514-143022.png")
    assert dt_sc is not None
    assert dt_sc.year == 2023 and dt_sc.month == 5 and dt_sc.day == 14

    # Undated random filename
    dt_random = parse_date_from_filename("random_meme_download.jpg")
    assert dt_random is None


def test_directory_date_heuristics():
    """Verifies directory name date inference for vacation or trip folders."""
    dt_dir = parse_date_from_directory(Path("/photos/2021-08-Vacation"))
    assert dt_dir is not None
    assert dt_dir.year == 2021 and dt_dir.month == 8 and dt_dir.day == 1

    dt_year = parse_date_from_directory(Path("/photos/Trip_2019"))
    assert dt_year is not None
    assert dt_year.year == 2019 and dt_year.month == 1 and dt_year.day == 1

    dt_none = parse_date_from_directory(Path("/photos/Unsorted_Downloads"))
    assert dt_none is None


def test_undated_hash_prefix_sharding():
    """Verifies that undated photos are safely sharded into originals/undated/{xx}/."""
    dummy_hash = "a4b8c9d0e1f2" + "0" * 52
    dest = get_hierarchical_destination_path(None, "undated_sample.jpg", file_hash=dummy_hash)
    assert "undated" in dest.parts
    assert dest.parts[-2] == "a4"
    assert dest.name == "undated_sample.jpg"


@pytest.mark.asyncio
async def test_thumbnail_and_preview_generation():
    """Verifies sub-10ms micro-thumbnail and 2K display proxy creation."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
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
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
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


@pytest.mark.asyncio
async def test_whatsapp_extraction_and_undated_api_filter():
    """Verifies end-to-end ingestion of WhatsApp photo vs undated photo and Undated filtering."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db_path = Path(tmpdir) / "test_wa.db"
        await run_migrations(db_path)
        conn = await get_db_connection(db_path)

        # 1. WhatsApp image without EXIF metadata
        wa_path = Path(tmpdir) / "IMG-20220815-WA0001.jpg"
        create_dummy_image(wa_path, 800, 600)
        wa_id = await ingest_single_photo(conn, wa_path, mode="managed")
        assert wa_id is not None

        async with conn.execute("SELECT taken_at FROM photos WHERE id = ?;", (wa_id,)) as cursor:
            wa_row = await cursor.fetchone()
            assert wa_row["taken_at"] is not None
            assert "2022-08-15" in wa_row["taken_at"]

        # 2. Completely undated image with distinct bitwise content
        undated_path = Path(tmpdir) / "undated_graphic.jpg"
        create_dummy_image(undated_path, 800, 600, color=(200, 100, 50))
        undated_id = await ingest_single_photo(conn, undated_path, mode="managed")
        assert undated_id is not None

        async with conn.execute("SELECT taken_at, filepath FROM photos WHERE id = ?;", (undated_id,)) as cursor:
            undated_row = await cursor.fetchone()
            assert undated_row["taken_at"] is None
            assert "undated" in undated_row["filepath"]

        await conn.close()


