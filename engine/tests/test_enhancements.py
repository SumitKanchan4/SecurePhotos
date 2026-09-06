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


@pytest.mark.asyncio
async def test_face_restore_endpoint_success():
    """Verifies that POST /api/photos/{id}/face-restore triggers restoration and preview is retrievable."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_test_photo(tmp_path)

        def dummy_face_restore(src, dest, fidelity=0.85):
            dest_p = Path(dest)
            dest_p.parent.mkdir(parents=True, exist_ok=True)
            img = Image.new("RGB", (320, 240), color=(255, 200, 180))
            img.save(dest_p, "WEBP")
            return dest_p, 320, 240, dest_p.stat().st_size

        transport = ASGITransport(app=app)
        with patch("engine.services.face_restore_service.restore_faces_in_image", side_effect=dummy_face_restore):
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post(f"/api/photos/{photo_id}/face-restore")
                assert res.status_code == 200
                data = res.json()
                assert data["status"] == "ok"
                assert data["photo_id"] == photo_id
                assert data["width"] == 320
                assert data["height"] == 240

                # Verify face restore preview stream
                prev_res = await client.get(f"/api/photos/{photo_id}/face-restore-preview")
                assert prev_res.status_code == 200
                assert prev_res.headers["content-type"] == "image/webp"


@pytest.mark.asyncio
async def test_get_photo_original_endpoint():
    """Verifies that GET /api/photos/{id}/original streams the unmodified original media file."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        photo_id = await create_test_photo(tmp_path)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(f"/api/photos/{photo_id}/original")
            assert res.status_code == 200
            assert res.headers["content-type"] == "image/jpeg"
            assert len(res.content) > 0


@pytest.mark.asyncio
async def test_enhancements_nonexistent_photo():
    """Verifies 404 responses for non-existent photo IDs."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res_orig = await client.get("/api/photos/999999/original")
        assert res_orig.status_code == 404

        res_neural = await client.post("/api/photos/999999/neural-enhance")
        assert res_neural.status_code == 404

        res_face = await client.post("/api/photos/999999/face-restore")
        assert res_face.status_code == 404

        res_neural_prev = await client.get("/api/photos/999999/neural-preview")
        assert res_neural_prev.status_code == 404

        res_face_prev = await client.get("/api/photos/999999/face-restore-preview")
        assert res_face_prev.status_code == 404

