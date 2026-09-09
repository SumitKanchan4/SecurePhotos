"""Automated Tests for 4K Super-Resolution, Social Affinity & Stories."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.social_affinity_service import calculate_affinity_score
from engine.services.super_resolution_service import upscale_and_optimize_to_4k


def test_social_affinity_score_weights():
    """Verifies that mathematical Affinity Score rewards longevity, intimacy, and stars."""
    # Casual wedding guest: 2 photos, 0 span, not intimate, not starred
    guest_score = calculate_affinity_score(photo_count=2, span_years=0.1, intimate_photo_count=0, is_starred=False)
    assert guest_score < 15.0

    # Best friend: 80 photos, 6 years span, 30 intimate photos, starred
    close_score = calculate_affinity_score(photo_count=80, span_years=6.0, intimate_photo_count=30, is_starred=True)
    assert close_score >= 90.0


def test_4k_upscale_and_avif_optimization():
    """Verifies 4K resolution reconstruction and compression."""
    with tempfile.TemporaryDirectory() as tmpdir:
        src = Path(tmpdir) / "lowres.jpg"
        img = Image.new("RGB", (640, 480), color=(100, 150, 200))
        img.save(src, format="JPEG")

        opt_file, w, h, size = upscale_and_optimize_to_4k(src, target_width=3840, target_height=2160)
        assert opt_file.exists()
        assert w == 3840
        assert h == 2880  # Proportional 4:3 aspect ratio maintained
        assert size > 0


@pytest.mark.asyncio
async def test_stories_and_people_apis():
    """Verifies stories and people listing API endpoints."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res_stories = await client.get("/api/stories")
        assert res_stories.status_code == 200
        assert isinstance(res_stories.json(), list)

        res_people = await client.get("/api/people")
        assert res_people.status_code == 200
        assert isinstance(res_people.json(), list)

        res_generate = await client.post("/api/stories/generate")
        assert res_generate.status_code == 200
        assert isinstance(res_generate.json(), list)

