"""When to suggest which stories (after-import P3; rules approved by the owner, 2026-11-17).

Stories are about the whole library and old memories, not only the latest import:

- **Every day** (the first check of the day): "This week, years ago" from any earlier year,
  so For you changes even when nothing new arrives.
- **After an import is ready** (text, faces and the old-photo rules done for it): the trip or
  event the new photos belong to, "Through the years" for the people who matter most,
  highlights, and "Old photos, brought back" for prints the app improved.
- **At their time**: "Year in review" around the turn of the year (15 Dec - 15 Jan); a season's
  highlights in the two weeks after it ends.
- **Good taste**: For you keeps the newest ~6 suggestions (saved stories are never touched);
  never the same story twice, never one the owner deleted (``story_dismissals``); only photos
  good for a story (``stories_service.story_photo``).

Suggestions never change the library; nothing is saved unless the owner saves it.
"""

from __future__ import annotations

import datetime
import logging
from typing import Optional

from engine.database import db_connection

logger = logging.getLogger("securephotos.stories_planner")

FOR_YOU = 6  # Unsaved suggestions kept at a time.
DAILY_KEY = "stories_daily_on"
SEASON_STARTS = ((3, 1), (6, 1), (9, 1), (12, 1))  # Winter, spring, summer, autumn end here.


async def _get(key: str) -> Optional[str]:
    async with db_connection() as conn:
        async with conn.execute("SELECT value FROM app_settings WHERE key = ?;", (key,)) as cur:
            row = await cur.fetchone()
    return row[0] if row else None


async def _set(key: str, value: str) -> None:
    async with db_connection() as conn:
        await conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;",
            (key, value),
        )
        await conn.commit()


def year_in_review_due(today: datetime.date) -> Optional[str]:
    """The year to review around the turn of the year, or None."""
    if today.month == 12 and today.day >= 15:
        return str(today.year)
    if today.month == 1 and today.day <= 15:
        return str(today.year - 1)
    return None


def season_just_ended(today: datetime.date) -> bool:
    return any(today.month == m and d <= today.day < d + 14 for m, d in SEASON_STARTS)


async def _try(label: str, make) -> None:
    try:
        await make()
    except Exception as err:  # One story kind failing never stops the others.
        logger.warning("Couldn't make %s stories: %s", label, err)


async def daily_if_due(today: Optional[datetime.date] = None) -> bool:
    """The day's stories, once per calendar day. Returns True when they were made now."""
    from engine.services import stories_service as stories

    today = today or datetime.date.today()
    if await _get(DAILY_KEY) == f'"{today.isoformat()}"':
        return False
    await _try("this-week", stories.generate_on_this_day_stories)
    year = year_in_review_due(today)
    if year:
        await _try("year-in-review", lambda: stories.generate_year_in_review_story(year))
    if season_just_ended(today):
        await _try("season", stories.generate_seasonal_retrospectives)
    await stories.prune_ephemeral_stories(keep_cap=FOR_YOU)
    await _set(DAILY_KEY, f'"{today.isoformat()}"')  # JSON, like every other setting.
    return True


async def after_import() -> None:
    """Stories the newly ready photos make possible (called when an import has been prepared)."""
    from engine.services import stories_service as stories

    async with db_connection() as conn:
        async with conn.execute("SELECT id FROM persons ORDER BY is_close_one DESC, affinity_score DESC LIMIT 5;") as cur:
            people = [r[0] for r in await cur.fetchall()]
    await _try("old-photos", stories.generate_old_photos_story)
    await _try("trips", stories.generate_vacation_and_trip_stories)
    for person_id in people:
        await _try("through-the-years", lambda pid=person_id: stories.generate_through_the_years_story(pid))
    await _try("highlights", stories.generate_recent_highlights_story)
    await stories.prune_ephemeral_stories(keep_cap=FOR_YOU)
