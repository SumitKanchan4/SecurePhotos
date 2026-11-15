"""Automated Tests for 4K Super-Resolution, Social Affinity & Stories."""

import tempfile
from datetime import datetime, timezone
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


def test_music_acoustic_analysis_and_genre_tagging():
    """Verifies genuine acoustic DSP waveform analysis and ID3 genre mapping without filename guessing."""
    import math
    import struct
    import wave
    from engine.services.music_service import detect_mood_from_audio, analyze_audio_acoustics

    with tempfile.TemporaryDirectory() as tmpdir:
        dummy_file = Path(tmpdir) / "dummy.mp3"
        dummy_file.write_bytes(b"dummy")

        # 1. ID3 Genre based mapping
        mood, auto_tagged, detected_mood, _ = detect_mood_from_audio(dummy_file, genre="Pop / Dance")
        assert mood == "auto"
        assert auto_tagged is True
        assert detected_mood == "upbeat"

        mood, _, detected_mood, _ = detect_mood_from_audio(dummy_file, genre="Soundtrack / Epic Score")
        assert detected_mood == "cinematic"

        mood, _, detected_mood, _ = detect_mood_from_audio(dummy_file, genre="Acoustic / Folk")
        assert detected_mood == "acoustic"

        mood, _, detected_mood, _ = detect_mood_from_audio(dummy_file, genre="Piano / Ambient Ballad")
        assert detected_mood == "nostalgic"

        # 2. Genuine DSP acoustic waveform analysis on synthetic audio
        sample_rate = 22050
        duration = 2.0
        n_samples = int(sample_rate * duration)
        wav_path = Path(tmpdir) / "synth_acoustic.wav"
        with wave.open(str(wav_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            raw_data = bytearray()
            for n in range(n_samples):
                val = int(32767 * 0.15 * math.sin(2 * math.pi * 440 * n / sample_rate))
                raw_data.extend(struct.pack("<h", val))
            wf.writeframes(raw_data)

        acoustics = analyze_audio_acoustics(wav_path)
        assert "bpm" in acoustics
        assert "rms" in acoustics
        assert "spectral_centroid" in acoustics
        assert acoustics["rms"] > 0
        assert acoustics["spectral_centroid"] < 1000
        assert acoustics["detected_mood"] == "acoustic"


@pytest.mark.asyncio
async def test_music_management_and_streaming_api():
    """Verifies music listing, audio file upload, auto-tagging, patch, deletion, and streaming."""
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
            "file": ("summer_journey.mp3", fake_audio_content, "audio/mpeg")
        }
        res_upload = await client.post("/api/stories/music/upload", files=files)
        assert res_upload.status_code == 200
        track_data = res_upload.json()
        assert track_data["filename"] == "summer_journey.mp3"
        assert track_data["mood"] == "auto"
        assert track_data["auto_tagged"] is True
        track_id = track_data["id"]

        # 3. Patch mood tag to manual override
        res_patch = await client.patch(
            f"/api/stories/music/{track_id}",
            json={"mood": "cinematic"}
        )
        assert res_patch.status_code == 200
        patched_data = res_patch.json()
        assert patched_data["mood"] == "cinematic"
        assert patched_data["auto_tagged"] is False

        # 4. Patch back to auto
        res_patch_auto = await client.patch(
            f"/api/stories/music/{track_id}",
            json={"mood": "auto"}
        )
        assert res_patch_auto.status_code == 200
        assert res_patch_auto.json()["mood"] == "auto"
        assert res_patch_auto.json()["auto_tagged"] is True

        # 5. Stream audio
        res_stream = await client.get(f"/api/stories/music/{track_id}/stream")
        assert res_stream.status_code == 200
        assert len(res_stream.content) > 0

        # 6. Delete audio track
        res_del = await client.delete(f"/api/stories/music/{track_id}")
        assert res_del.status_code == 200
        del_data = res_del.json()
        assert del_data["status"] == "deleted"
        assert del_data["id"] == track_id

        # Verify it no longer exists
        res_stream_404 = await client.get(f"/api/stories/music/{track_id}/stream")
        assert res_stream_404.status_code == 404


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


@pytest.mark.asyncio
async def test_ephemeral_stories_save_delete_and_lifecycle():
    """Verifies Google Photos-style ephemeral retention, save toggling, and clean deletion."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create a test photo
        conn = await get_db_connection()
        photo_id = None
        try:
            cur = await conn.execute(
                """
                INSERT INTO photos (filepath, filename, file_size, taken_at, is_favorite, is_encrypted)
                VALUES ('/dummy/ephemeral.jpg', 'ephemeral.jpg', 2048, '2025-01-01 10:00:00', 0, 0);
                """
            )
            photo_id = cur.lastrowid

            now_iso = datetime.now(timezone.utc).isoformat()
            cur = await conn.execute(
                """
                INSERT INTO stories (title, story_type, vibe_mood, is_saved, created_at)
                VALUES ('Ephemeral Memory Reel', 'milestone', 'cinematic', 0, ?);
                """,
                (now_iso,),
            )
            story_id = cur.lastrowid
            await conn.execute(
                """
                INSERT INTO story_items (story_id, photo_id, sort_order, transition_type, focal_x, focal_y)
                VALUES (?, ?, 0, 'fade', 0.5, 0.5);
                """,
                (story_id, photo_id),
            )
            await conn.commit()
        finally:
            await conn.close()

        try:
            # 1. Verify listing returns slides_count and is_saved
            res = await ac.get("/api/stories")
            assert res.status_code == 200
            stories = res.json()
            assert any(s["id"] == story_id and s["is_saved"] is False and s["slides_count"] >= 1 for s in stories)

            # 2. Toggle Save Story
            res = await ac.patch(f"/api/stories/{story_id}/save", json={"is_saved": True})
            assert res.status_code == 200
            data = res.json()
            assert data["is_saved"] is True

            # Verify persistent save state
            res = await ac.get(f"/api/stories/{story_id}")
            assert res.status_code == 200
            assert res.json()["is_saved"] is True

            # 3. Toggle back to unsaved
            res = await ac.patch(f"/api/stories/{story_id}/save", json={"is_saved": False})
            assert res.status_code == 200
            assert res.json()["is_saved"] is False

            # 4. Delete Story
            res = await ac.delete(f"/api/stories/{story_id}")
            assert res.status_code == 200
            assert res.json()["status"] == "deleted"

            # Verify deleted from DB
            res = await ac.get(f"/api/stories/{story_id}")
            assert res.status_code == 404
        finally:
            # Clean up photo
            conn = await get_db_connection()
            try:
                if photo_id:
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
                await conn.commit()
            finally:
                await conn.close()






@pytest.mark.asyncio
async def test_story_list_gives_the_date_span_of_its_photos():
    """R7e: story cards say when the photos were taken ("2019 – 2026")."""
    await run_migrations()
    conn = await get_db_connection()
    try:
        ids = []
        for k, taken in enumerate(("2019-03-02 10:00:00", "2026-11-12 18:00:00")):
            cur = await conn.execute(
                "INSERT INTO photos (filepath, filename, file_size, taken_at, is_favorite, is_encrypted) VALUES (?, ?, 10, ?, 0, 0);",
                (f"/dummy/span_{k}.jpg", f"span_{k}.jpg", taken),
            )
            ids.append(cur.lastrowid)
        cur = await conn.execute(
            "INSERT INTO stories (title, story_type, vibe_mood, is_saved, created_at) VALUES ('Through the years: Span', 'through_the_years', 'acoustic', 0, ?);",
            (datetime.now(timezone.utc).isoformat(),),
        )
        story_id = cur.lastrowid
        for order, pid in enumerate(ids):
            await conn.execute("INSERT INTO story_items (story_id, photo_id, sort_order) VALUES (?, ?, ?);", (story_id, pid, order))
        await conn.commit()
    finally:
        await conn.close()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            listed = next(s for s in (await ac.get("/api/stories?ephemeral_only=true")).json() if s["id"] == story_id)
        assert listed["slides_count"] == 2
        assert listed["first_taken_at"].startswith("2019-03-02")
        assert listed["last_taken_at"].startswith("2026-11-12")
    finally:
        conn = await get_db_connection()
        await conn.execute("DELETE FROM stories WHERE id = ?;", (story_id,))
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' for _ in ids)});", ids)
        await conn.commit()
        await conn.close()
