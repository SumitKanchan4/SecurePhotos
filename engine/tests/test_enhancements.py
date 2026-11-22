"""Integration and Unit Tests for AI Enhancements & Optimization Progress APIs."""

import tempfile
from pathlib import Path
from unittest.mock import patch
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.thumbnail_service import calculate_file_hash


async def create_test_photo(tmp_path: Path) -> int:
    """Helper to create a temporary photo on disk and register it in SQLite."""
    img_path = tmp_path / "test_photo.jpg"
    img = Image.new("RGB", (320, 240), color=(120, 80, 200))
    img.save(img_path, format="JPEG")

    file_hash = calculate_file_hash(img_path)
    conn = await get_db_connection()
    cursor = await conn.execute(
        """
        INSERT INTO photos (
            filename, filepath, file_hash, file_size, mime_type, width, height,
            is_encrypted, is_optimized, is_enhanced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
        RETURNING id;
        """,
        (img_path.name, str(img_path), file_hash, img_path.stat().st_size, "image/jpeg", 320, 240),
    )
    row = await cursor.fetchone()
    photo_id = row[0]
    await conn.commit()
    await conn.close()
    return photo_id


@pytest.mark.asyncio
async def test_get_optimization_progress():
    """Verifies that GET /api/photos/optimization-progress returns a valid state."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/photos/optimization-progress")
        assert res.status_code == 200
        data = res.json()
        assert "total_count" in data
        assert "completed_count" in data
        assert "is_active" in data
        assert "item_progress" in data


@pytest.mark.asyncio
async def test_trigger_optimization():
    """Verifies that POST /api/photos/start-optimization returns 202 accepted."""
    await run_migrations()
    transport = ASGITransport(app=app)
    with patch("engine.api.photos.run_background_optimization"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/api/photos/start-optimization")
            assert res.status_code == 202
            assert res.json() == {"status": "started"}


@pytest.mark.asyncio
async def test_neural_enhance_endpoint_success():
    """Verifies that POST /api/photos/{id}/neural-enhance triggers synthesis and preview is retrievable."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_test_photo(tmp_path)

        def dummy_neural_enhance(src, dest):
            dest_p = Path(dest)
            dest_p.parent.mkdir(parents=True, exist_ok=True)
            img = Image.new("RGB", (640, 480), color=(10, 20, 30))
            img.save(dest_p, "WEBP")
            return dest_p, 640, 480, dest_p.stat().st_size

        transport = ASGITransport(app=app)
        try:
            with patch("engine.services.neural_sr_service.neural_enhance_image", side_effect=dummy_neural_enhance):
                async with AsyncClient(transport=transport, base_url="http://test") as client:
                    res = await client.post(f"/api/photos/{photo_id}/neural-enhance")
                    assert res.status_code == 200
                    data = res.json()
                    assert data["status"] == "ok"
                    assert data["photo_id"] == photo_id
                    assert data["width"] == 640
                    assert data["height"] == 480

                    # Verify neural preview stream
                    prev_res = await client.get(f"/api/photos/{photo_id}/neural-preview")
                    assert prev_res.status_code == 200
                    assert prev_res.headers["content-type"] == "image/webp"
        finally:
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_get_photo_original_endpoint():
    """Verifies that GET /api/photos/{id}/original streams the unmodified original media file."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_test_photo(tmp_path)

        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.get(f"/api/photos/{photo_id}/original")
                assert res.status_code == 200
                assert res.headers["content-type"] == "image/jpeg"
                assert len(res.content) > 0
        finally:
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_enhancements_nonexistent_photo():
    """Verifies 404 responses for non-existent photo IDs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res_orig = await client.get("/api/photos/999999/original")
        assert res_orig.status_code == 404

        res_neural = await client.post("/api/photos/999999/neural-enhance")
        assert res_neural.status_code == 404

        res_neural_prev = await client.get("/api/photos/999999/neural-preview")
        assert res_neural_prev.status_code == 404


@pytest.mark.asyncio
async def test_download_studio_print_300dpi():
    """Verifies that download?mode=studio_print embeds 300 DPI metadata and returns a valid JPEG."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_test_photo(tmp_path)

        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.get(f"/api/photos/{photo_id}/download?mode=studio_print")
                assert res.status_code == 200
                assert res.headers["content-type"] == "image/jpeg"
                assert res.headers.get("x-print-dpi") == "300"
                assert "attachment" in res.headers["content-disposition"]
                assert "_print_8k_300dpi.jpg" in res.headers["content-disposition"]

                # Verify PIL decodes and reads embedded (300, 300) DPI, at 8K (T28).
                import io
                with Image.open(io.BytesIO(res.content)) as img:
                    assert img.format == "JPEG"
                    assert img.info.get("dpi") == (300, 300)
                    assert max(img.size) == 7680
                # The temporary print file stayed in the library and is gone afterwards.
                from engine.config import settings as _settings

                assert not list((_settings.data_dir / "tmp").glob(f"securephotos_print_{photo_id}_*.jpg"))
        finally:
            conn = await get_db_connection()
            try:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_print_copy_is_made_with_real_esrgan_when_it_can_be(monkeypatch):
    """T28 (owner, 2026-11-21): the 8K print copy uses Real-ESRGAN; the library's own enhancement
    doesn't change. Without the model it falls back to the standard resize."""
    from engine.api import photos as photos_api
    from engine.services import neural_sr_service

    used = []

    def fake_neural(img, **_):
        used.append(img.size)
        return img.resize((img.width * 4, img.height * 4))

    monkeypatch.setattr(neural_sr_service, "neural_upscale", fake_neural)
    small = Image.new("RGB", (1600, 1200), (120, 80, 40))
    out = photos_api._print_upscale(small)
    assert used == [(1600, 1200)] and max(out.size) == 7680

    def broken(img, **_):
        raise RuntimeError("model missing")

    monkeypatch.setattr(neural_sr_service, "neural_upscale", broken)
    out = photos_api._print_upscale(small)
    assert max(out.size) == 7680  # still made, with the standard resize
