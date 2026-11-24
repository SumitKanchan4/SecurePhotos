"""Songs that come with SecurePhotos (owner, 2026-11-24)."""

import shutil

import pytest
from httpx import ASGITransport, AsyncClient

from engine.config import settings
from engine.main import app
from engine.services import music_service


@pytest.fixture(autouse=True)
def fresh_library():
    """An empty music folder and no cached scan, before and after each test."""
    shutil.rmtree(settings.music_dir, ignore_errors=True)
    settings.music_dir.mkdir(parents=True, exist_ok=True)
    music_service.invalidate_music_cache()
    yield
    shutil.rmtree(settings.music_dir, ignore_errors=True)
    music_service.invalidate_music_cache()


def test_the_included_songs_are_there_with_fixed_ids():
    tracks = music_service.scan_music_library()
    included = [t for t in tracks if t.included]
    assert [t.title for t in included] == ["Between the Frames", "Sunday on the Veranda", "Where We Once Stood"]
    assert [t.id for t in included] == ["included-between-the-frames", "included-sunday-on-the-veranda", "included-where-we-once-stood"]
    assert all(t.artist == "Sumit Kanchan" and t.mood == "auto" and t.duration_seconds > 170 for t in included)


def test_a_story_uses_an_included_song_when_the_person_has_none():
    track = music_service.get_track_for_mood("nostalgic")
    assert track is not None and track.included


def test_the_persons_own_songs_come_first(monkeypatch):
    own = music_service.MusicTrack(
        id="mine", filename="mine.mp3", filepath="x", title="Mine", artist="Me", mood="nostalgic", auto_tagged=False,
        duration_seconds=60, duration_formatted="1:00", file_size_formatted="1 MB", file_size_bytes=1, stream_url="/s",
    )
    real = music_service.scan_music_library()
    monkeypatch.setattr(music_service, "scan_music_library", lambda: [own, *real])
    assert music_service.get_track_for_mood("nostalgic").id == "mine"
    # No own song for this mood and none on Auto: still the person's own song comes before an included one.
    assert music_service.get_track_for_mood("upbeat").id == "mine"


def test_a_mood_can_be_chosen_but_an_included_song_cant_be_removed():
    assert music_service.update_track_mood("included-where-we-once-stood", "nostalgic")
    track = music_service.get_track_by_id("included-where-we-once-stood")
    assert track.mood == "nostalgic"
    assert music_service.get_track_for_mood("nostalgic").id == "included-where-we-once-stood"
    assert music_service.delete_track("included-where-we-once-stood") is False
    assert (music_service.INCLUDED_MUSIC_DIR / "where_we_once_stood.mp3").is_file()


async def test_api_lists_streams_and_refuses_removal():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listed = (await client.get("/api/stories/music")).json()
        assert sum(1 for t in listed if t["included"]) == 3
        res = await client.get("/api/stories/music/included-between-the-frames/stream")
        assert res.status_code in (200, 206) and len(res.content) > 1000
        res = await client.delete("/api/stories/music/included-between-the-frames")
        assert res.status_code == 400 and "can't be removed" in res.json()["detail"]
