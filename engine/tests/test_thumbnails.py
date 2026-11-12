"""Automated Tests for 512px Retina Thumbnail Generation and Background Worker."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import run_migrations, get_db_connection
from engine.main import app
from engine.services.thumbnail_service import (
    calculate_file_hash,
    generate_micro_thumbnail,
)
from engine.services.ingestion_service import ingest_single_photo


def create_test_image(filepath: Path, width: int = 1200, height: int = 800) -> Path:
    """Helper to generate a test RGB image."""
    img = Image.new("RGB", (width, height), color=(60, 120, 200))
    img.save(filepath, format="JPEG")
    return filepath


@pytest.mark.asyncio
async def test_1024px_thumbnail_generation():
    """Verifies that generate_micro_thumbnail creates 1024px Retina WebP thumbnails."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        img_path = create_test_image(tmp_path / "camera_photo.jpg", width=1600, height=1200)
        file_hash = calculate_file_hash(img_path)

        thumb_path, tw, th = generate_micro_thumbnail(img_path, file_hash=file_hash, size=1024)

        assert thumb_path.exists()
        assert thumb_path.suffix == ".webp"
        assert tw == 1024
        assert th == round(1200 * (1024 / 1600))

        # Verify image opens cleanly and matches dimensions
        with Image.open(thumb_path) as thumb_img:
            assert thumb_img.width == 1024
            assert thumb_img.format == "WEBP"


@pytest.mark.asyncio
async def test_thumbnail_upgrade_from_legacy_256px():
    """Verifies that an older 256px thumbnail is upgraded to 1024px when requested."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        img_path = create_test_image(tmp_path / "legacy_photo.jpg", width=1600, height=1200)
        file_hash = calculate_file_hash(img_path)

        # 1. Generate older 256px thumbnail
        thumb_path, tw, th = generate_micro_thumbnail(img_path, file_hash=file_hash, size=256, force=True)
        assert tw <= 256 and th <= 256

        # 2. Call generate_micro_thumbnail with size=1024 (default) without force
        # Should detect that cached thumbnail is only 256px and upgrade to 1024px
        upgraded_path, uw, uh = generate_micro_thumbnail(img_path, file_hash=file_hash, size=1024, force=False)
        assert upgraded_path == thumb_path
        assert uw == 1024
        assert uh == round(1200 * (1024 / 1600))


@pytest.mark.asyncio
async def test_thumbnail_regeneration_api():
    """Verifies the /api/photos/regenerate-thumbnails and progress endpoints."""
    await run_migrations()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        img_path = create_test_image(tmp_path / "regen_test.jpg", width=1000, height=1000)

        conn = await get_db_connection()
        photo_id = None
        try:
            photo_id = await ingest_single_photo(conn, img_path, mode="managed")
            assert photo_id is not None

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # Trigger background regeneration
                res_trigger = await client.post("/api/photos/regenerate-thumbnails")
                assert res_trigger.status_code == 202
                assert res_trigger.json()["status"] == "started"

                # Check progress endpoint
                res_progress = await client.get("/api/photos/thumbnail-regeneration-progress")
                assert res_progress.status_code == 200
                data = res_progress.json()
                assert "is_active" in data
                assert "total_count" in data
                assert "completed_count" in data
        finally:
            if photo_id:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
                await conn.commit()
            await conn.close()


@pytest.mark.asyncio
async def test_thumbnail_regeneration_ignores_encrypted_media(caplog):
    """Verifies that thumbnail regeneration skips encrypted vault media without raising errors."""
    await run_migrations()
    from engine.api.photos import run_background_thumbnail_regeneration

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        # Create a dummy .enc file representing encrypted vault ciphertext
        enc_file = tmp_path / "vault_item.jpg.enc"
        enc_file.write_bytes(b"\x00" * 256)

        conn = await get_db_connection()
        enc_photo_id = None
        try:
            cursor = await conn.execute(
                """
                INSERT INTO photos (
                    filename, filepath, file_hash, file_size, mime_type,
                    width, height, is_encrypted, trashed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL);
                """,
                ("vault_item.jpg", str(enc_file), "fakehash_enc_12345", 256, "image/jpeg", 800, 600),
            )
            enc_photo_id = cursor.lastrowid
            await conn.commit()

            # Execute background regeneration pass
            await run_background_thumbnail_regeneration()

            # Check that no ERROR was logged for this photo
            error_logs = [
                record for record in caplog.records 
                if record.levelname == "ERROR" and f"photo {enc_photo_id}" in record.message
            ]
            assert len(error_logs) == 0, f"Unexpected error logged for encrypted photo: {error_logs}"
        finally:
            if enc_photo_id:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (enc_photo_id,))
                await conn.commit()
            await conn.close()


