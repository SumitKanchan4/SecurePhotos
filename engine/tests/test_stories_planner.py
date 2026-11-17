"""After-import P3: when stories are suggested (rules approved by the owner)."""

import datetime

import pytest

from engine.database import db_connection, run_migrations
from engine.services import stories_planner as planner
from engine.services import stories_service


def test_year_in_review_around_the_turn_of_the_year():
    assert planner.year_in_review_due(datetime.date(2026, 12, 20)) == "2026"
    assert planner.year_in_review_due(datetime.date(2027, 1, 10)) == "2026"
    assert planner.year_in_review_due(datetime.date(2027, 1, 20)) is None
    assert planner.year_in_review_due(datetime.date(2026, 7, 1)) is None


def test_a_season_is_reviewed_in_the_two_weeks_after_it_ends():
    assert planner.season_just_ended(datetime.date(2026, 3, 5))
    assert planner.season_just_ended(datetime.date(2026, 9, 14))
    assert not planner.season_just_ended(datetime.date(2026, 9, 15))
    assert not planner.season_just_ended(datetime.date(2026, 7, 10))


@pytest.fixture
async def calls(monkeypatch):
    await run_migrations()
    made = []

    def fake(name):
        async def run(*args):
            made.append(name if not args else f"{name}:{args[0]}")

        return run

    for name in ("generate_on_this_day_stories", "generate_year_in_review_story", "generate_seasonal_retrospectives",
                 "generate_old_photos_story", "generate_vacation_and_trip_stories", "generate_through_the_years_story",
                 "generate_recent_highlights_story"):
        monkeypatch.setattr(stories_service, name, fake(name))

    async def prune(keep_cap):
        made.append(f"prune:{keep_cap}")

    monkeypatch.setattr(stories_service, "prune_ephemeral_stories", prune)
    async with db_connection() as conn:
        await conn.execute("DELETE FROM app_settings WHERE key = ?;", (planner.DAILY_KEY,))
        await conn.commit()
    yield made


async def test_the_days_stories_are_made_once_per_day(calls):
    today = datetime.date(2026, 12, 20)
    assert await planner.daily_if_due(today)
    assert calls == ["generate_on_this_day_stories", "generate_year_in_review_story:2026", f"prune:{planner.FOR_YOU}"]
    calls.clear()
    assert not await planner.daily_if_due(today)  # Already done today.
    assert calls == []
    assert await planner.daily_if_due(today + datetime.timedelta(days=1))  # A new day.


async def test_after_an_import_the_new_photos_stories(calls):
    await planner.after_import()
    assert calls[0] == "generate_old_photos_story"
    assert "generate_vacation_and_trip_stories" in calls and "generate_recent_highlights_story" in calls
    assert calls[-1] == f"prune:{planner.FOR_YOU}"


async def test_a_story_the_owner_deleted_is_never_suggested_again():
    from engine.services.stories_service import StorySlide, _store_story, delete_story

    await run_migrations()
    async with db_connection() as conn:
        cur = await conn.execute("INSERT INTO photos (filename, filepath, file_size) VALUES ('p3.jpg', 'originals/p3.jpg', 1);")
        photo_id = cur.lastrowid
        import aiosqlite

        conn.row_factory = aiosqlite.Row
        slides = [StorySlide(photo_id=photo_id, filename="p3.jpg", taken_at=None, year_label="2020")]
        story_id = await _store_story(conn, key="trip:p3-test", title="Trip", story_type="vacation_adventure", mood="upbeat", slides=slides)
        await conn.commit()
    try:
        assert story_id and await delete_story(story_id, remember=True)
        async with db_connection() as conn:
            conn.row_factory = aiosqlite.Row
            assert await _store_story(conn, key="trip:p3-test", title="Trip", story_type="vacation_adventure", mood="upbeat", slides=slides) is None
    finally:
        async with db_connection() as conn:
            await conn.execute("DELETE FROM story_dismissals WHERE story_key = 'trip:p3-test';")
            await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            await conn.commit()


def test_generic_folders_are_not_trips():
    from engine.services.stories_service import _generic_folder

    for name in ("", "misc", "Camera", "WhatsApp Images", "2024-05-12", "100ANDRO", "New folder"):
        assert _generic_folder(name), name
    for name in ("Goa", "Shimla 1984", "Diwali at Nani's"):
        assert not _generic_folder(name), name


def test_week_story_titles_say_this_week():
    from engine.services.stories_service import generate_punchy_title

    titles = {generate_punchy_title("on_this_day", years_ago=2, year="2024", seed=s) for s in range(4)}
    assert all("Today" not in t and "Day" not in t for t in titles)
