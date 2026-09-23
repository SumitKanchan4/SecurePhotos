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
        generated = res_generate.json()
        assert isinstance(generated, list)

        if len(generated) > 0:
            story_id = generated[0]["id"]
            res_single = await client.get(f"/api/stories/{story_id}")
            assert res_single.status_code == 200
            data = res_single.json()
            assert data["id"] == story_id
            assert "slides" in data
            assert isinstance(data["slides"], list)


def test_music_auto_tagging_logic():
    """Verifies automated mood deduction from filename keywords and genre metadata."""
    from engine.services.music_service import auto_detect_mood

    # Keyword based
    assert auto_detect_mood(filename="summer_beach_upbeat_dance.mp3", genre=None) == "upbeat"
    assert auto_detect_mood(filename="grandma_childhood_nostalgic_piano.mp3", genre=None) == "nostalgic"
    assert auto_detect_mood(filename="morning_coffee_acoustic_guitar.wav", genre=None) == "acoustic"
    assert auto_detect_mood(filename="epic_orchestra_cinematic_trailer.flac", genre=None) == "cinematic"

    # Genre based
    assert auto_detect_mood(filename="track01.mp3", genre="Pop / Dance") == "upbeat"
    assert auto_detect_mood(filename="track02.mp3", genre="Soundtrack / Cinematic Score") == "cinematic"
    assert auto_detect_mood(filename="track03.mp3", genre="Folk & Acoustic") == "acoustic"
    assert auto_detect_mood(filename="track04.mp3", genre="Classic Oldies / Ballad") == "nostalgic"

    # Fallback default
    assert auto_detect_mood(filename="mystery_audio.wav", genre=None) == "nostalgic"


@pytest.mark.asyncio
async def test_music_management_and_streaming_api():
    """Verifies music listing, audio file upload, auto-tagging response, patch, and streaming."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. List music tracks
        res_list = await client.get("/api/stories/music")
        assert res_list.status_code == 200
        assert isinstance(res_list.json(), list)

        # 2. Upload dummy audio track
        fake_audio_content = b"ID3\x03\x00\x00\x00\x00\x00#TIT2\x00\x00\x00\r\x00\x00\x00Summer Journey\xff\xfb\x90\x04"
        files = {
            "file": ("upbeat_summer_vibes.mp3", fake_audio_content, "audio/mpeg")
        }
        res_upload = await client.post("/api/stories/music/upload", files=files)
        assert res_upload.status_code == 200
        track_data = res_upload.json()
        assert track_data["filename"] == "upbeat_summer_vibes.mp3"
        assert track_data["mood"] == "upbeat"
        assert track_data["auto_tagged"] is True
        track_id = track_data["id"]

        # 3. Patch mood tag
        res_patch = await client.patch(
            f"/api/stories/music/{track_id}",
            json={"mood": "cinematic"}
        )
        assert res_patch.status_code == 200
        patched_data = res_patch.json()
        assert patched_data["mood"] == "cinematic"
        assert patched_data["auto_tagged"] is False

        # 4. Stream audio
        res_stream = await client.get(f"/api/stories/music/{track_id}/stream")
        assert res_stream.status_code == 200
        assert len(res_stream.content) > 0


@pytest.mark.asyncio
async def test_multidimensional_stories_curation():
    """Verifies On This Day, Vacation Bursts, and Seasonal Retrospective generation."""
    import uuid
    from datetime import datetime, timezone
    from engine.services.stories_service import (
        generate_on_this_day_stories,
        generate_vacation_and_trip_stories,
        generate_seasonal_retrospectives,
    )

    await run_migrations()
    conn = await get_db_connection()

    now = datetime.now(timezone.utc)
    target_mo = f"{now.month:02d}"
    target_day = f"{now.day:02d}"
    past_year = now.year - 2

    # Insert test photos for "On This Day" (2 years ago)
    p_ids = []
    try:
        for i in range(3):
            taken_at = f"{past_year}-{target_mo}-{target_day} 14:0{i}:00"
            cur = await conn.execute(
                """
                INSERT INTO photos (filepath, filename, file_size, taken_at, folder_name, is_favorite, is_encrypted)
                VALUES (?, ?, 1024, ?, 'TestTrip', 1, 0);
                """,
                (f"/dummy/{uuid.uuid4().hex}.jpg", f"trip_{i}.jpg", taken_at),
            )
            p_ids.append(cur.lastrowid)

        # Insert test photos for seasonal retrospective (Summer of past year)
        for i in range(4):
            cur = await conn.execute(
                """
                INSERT INTO photos (filepath, filename, file_size, taken_at, folder_name, is_favorite, is_encrypted)
                VALUES (?, ?, 1024, ?, 'SummerFun', 1, 0);
                """,
                (f"/dummy/{uuid.uuid4().hex}.jpg", f"summer_{i}.jpg", f"{past_year}-07-15 12:0{i}:00"),
            )
            p_ids.append(cur.lastrowid)

        await conn.commit()
    finally:
        await conn.close()

    try:
        # Test On This Day
        on_this_day_stories = await generate_on_this_day_stories()
        assert isinstance(on_this_day_stories, list)
        matching_otd = [s for s in on_this_day_stories if s.story_type == "on_this_day"]
        assert len(matching_otd) >= 1
        assert matching_otd[0].vibe_mood == "nostalgic"
        assert len(matching_otd[0].slides) >= 2

        # Test Vacation & Trip Bursts
        vacation_stories = await generate_vacation_and_trip_stories()
        assert isinstance(vacation_stories, list)
        matching_vac = [s for s in vacation_stories if "TestTrip" in s.title or "Trip" in s.title]
        assert len(matching_vac) >= 1
        assert matching_vac[0].vibe_mood == "upbeat"

        # Test Seasonal Retrospectives
        seasonal_stories = await generate_seasonal_retrospectives()
        assert isinstance(seasonal_stories, list)
        matching_sea = [s for s in seasonal_stories if s.story_type == "seasonal_highlight"]
        assert len(matching_sea) >= 1
    finally:
        # Cleanup inserted test photos
        conn = await get_db_connection()
        try:
            placeholders = ",".join("?" * len(p_ids))
            await conn.execute(f"DELETE FROM story_items WHERE photo_id IN ({placeholders});", p_ids)
            await conn.execute(f"DELETE FROM photos WHERE id IN ({placeholders});", p_ids)
            await conn.commit()
        finally:
            await conn.close()



