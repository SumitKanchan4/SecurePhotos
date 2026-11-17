"""Automatic Multi-Dimensional Stories, Vibe Matching, and Intelligent Curation Engine.

Delivers Google Photos-grade temporal and semantic curation:
1. 'Through the Years': Chronological milestone evolution for Close Ones.
2. 'On This Day': Exact calendar flashback anniversaries (1, 2, 3, 5, 10 years ago).
3. 'Vacations & Trips': Density burst detection (multi-day clusters, travel getaways).
4. 'Seasonal Retrospectives': Autumn, Summer, Winter, and Spring memory reels.
5. 'Library Highlights': Recent favorites and golden moments.
6. Automatic pairing with custom user soundtracks by emotional vibe mood.
"""

import datetime
import logging
import struct
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, model_validator

from engine.database import get_db_connection
from engine.services.media_paths import resolve_stored_path
from engine.services.music_service import get_track_for_mood
from engine.services.photo_versions import stack_top


def story_photo(alias: str) -> str:
    """SQL condition (after-import P3, owner-approved rules): a photo good for a dated story.

    - what the library shows (an original stacked behind its improved copy is left out),
    - not a document, receipt or page of text,
    - one photo per group of duplicates (the first one),
    - not an old print brought back by the app: a scan carries the date it was scanned, not
      the year it was taken, so it never makes "this week" or a trip; it goes to "Old photos".
    """
    return (
        f"{stack_top(alias)} AND COALESCE({alias}.is_document, 0) = 0 "
        f"AND NOT EXISTS (SELECT 1 FROM duplicate_groups d1 JOIN duplicate_groups d2 ON d2.group_id = d1.group_id "
        f"                WHERE d1.photo_id = {alias}.id AND d2.photo_id < {alias}.id) "
        f"AND {alias}.ai_kind IS NULL "
        f"AND NOT EXISTS (SELECT 1 FROM restore_jobs rj WHERE rj.photo_id = {alias}.id AND rj.status = 'done')"
    )


STORY_P = story_photo("p")
STORY_PHOTOS = story_photo("photos")

logger = logging.getLogger("securephotos.stories_service")

# Bundled local royalty-free ambient sound tracks
VIBE_TRACKS = {
    "acoustic": "audio/vibes/serene_acoustic_guitar.mp3",
    "nostalgic": "audio/vibes/warm_nostalgic_piano.mp3",
    "upbeat": "audio/vibes/summer_sunshine_lofi.mp3",
    "cinematic": "audio/vibes/epic_journey_strings.mp3",
}


def _safe_float(val: object, default: float = 0.5) -> float:
    """Safely coerces int, float, str, or binary struct bytes to float."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, bytes):
        try:
            if len(val) == 4:
                return float(struct.unpack("<f", val)[0])
            elif len(val) == 8:
                return float(struct.unpack("<d", val)[0])
        except Exception:
            return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


class StorySlide(BaseModel):
    """Single photo slide in a dynamic story."""
    photo_id: int
    filename: str = ""
    taken_at: Optional[str] = None
    year_label: str
    transition_type: str = "crossfade"
    focal_x: float = 0.5
    focal_y: float = 0.5
    mime_type: Optional[str] = None


def generate_punchy_title(
    story_type: str,
    *,
    subject: Optional[str] = None,
    year: Optional[str] = None,
    years_ago: Optional[int] = None,
    season: Optional[str] = None,
    seed: int = 0,
) -> str:
    """Generates an emotional, punchy, human-centric story title."""
    if story_type == "vacation_adventure":
        if subject:
            templates = [
                f"Trip to {subject}",
                f"Unforgettable {subject}",
                f"Getaway to {subject}",
                f"Escape to {subject}",
                f"Adventures in {subject}",
                f"Postcards from {subject}",
            ]
            return templates[seed % len(templates)]
        month_str = season or "Summer"
        templates = [
            f"Sun-Drenched Memories • {month_str} {year}" if year else f"Sun-Drenched Memories • {month_str}",
            f"Wanderlust • {month_str} {year}" if year else f"Wanderlust • {month_str}",
            f"Golden Getaway • {month_str} {year}" if year else f"Golden Getaway • {month_str}",
        ]
        return templates[seed % len(templates)]

    if story_type == "on_this_day":
        if years_ago:
            plural = "Years" if years_ago != 1 else "Year"
            # P3: these stories cover this week (3 days either side of today), not one day.
            templates = [
                f"This Week, {years_ago} {plural} Ago",
                f"Remember This Week? ({year})" if year else f"This Week, {years_ago} {plural} Ago",
                f"This Week in {year}" if year else "This Week, Years Ago",
                f"Flashback to {year}" if year else f"This Week, {years_ago} {plural} Ago",
            ]
            return templates[seed % len(templates)]
        return f"This Week in {year}" if year else "This Week, Years Ago"

    if story_type == "seasonal_highlight":
        s = season or "Summer"
        templates = [
            f"Golden Days of {s}",
            f"Sun-Drenched Memories of {s}",
            f"Warmth of {s}",
            f"{s} Splendor ({year})" if year else f"{s} Splendor",
            f"Crisp Days of {s}",
        ]
        return templates[seed % len(templates)]

    if story_type == "through_the_years":
        name = subject or "Loved One"
        templates = [
            f"Growing Up: {name}",
            f"Smiles with {name}",
            f"The Journey with {name}",
            f"{name}: Through the Years",
        ]
        return templates[seed % len(templates)]

    if story_type == "year_in_review":
        y = year or "Past Year"
        templates = [
            f"Best of {y}",
            f"Golden Moments of {y}",
            f"{y} in Review",
            f"Unforgettable Memories of {y}",
        ]
        return templates[seed % len(templates)]

    return f"Curated Memories • {year}" if year else "Curated Memories"



class StoryModel(BaseModel):
    """Full story presentation model."""
    id: int
    title: str
    story_type: str
    vibe_mood: str
    music_track_path: Optional[str] = None
    audio_url: Optional[str] = None
    cover_photo_id: Optional[int] = None
    is_saved: bool = False
    slides_count: int = 0
    first_taken_at: Optional[str] = None  # R7e: story cards say when ("Nov 2026", "2019 – 2026")
    last_taken_at: Optional[str] = None
    slides: List[StorySlide] = []

    @model_validator(mode="after")
    def populate_slides_count(self):
        if not self.slides_count and self.slides:
            self.slides_count = len(self.slides)
        return self


def _resolve_audio_url_for_mood(mood: str) -> Optional[str]:
    """Helper to find matching user audio soundtrack URL."""
    try:
        track = get_track_for_mood(mood)
        return track.stream_url if track else None
    except Exception:
        return None


def _newest_month(rows: List[Any]) -> str:
    """'2026-11' for the newest dated row, or 'undated'."""
    dates = [r["taken_at"] for r in rows if r["taken_at"]]
    return max(dates)[:7] if dates else "undated"


async def _store_story(
    conn: Any,
    *,
    key: str,
    title: str,
    story_type: str,
    mood: str,
    slides: List[StorySlide],
    person_id: Optional[int] = None,
) -> Optional[int]:
    """Stores a made story once (R7f) and returns its id, or None when it is already kept.

    `key` names the story's kind and subject ("on_this_day:2021-11", "through_the_years:7").
    A saved story with the same key (or, for stories saved before keys existed, the same kind
    and the same photos) is never duplicated. An unsaved suggestion with the same key is
    replaced by the fresh one, so making stories again refreshes suggestions instead of
    piling up copies.
    """
    async with conn.execute("SELECT 1 FROM story_dismissals WHERE story_key = ?;", (key,)) as cur:
        if await cur.fetchone():  # The owner deleted this story: never suggested again (P3).
            return None
    async with conn.execute("SELECT id, COALESCE(is_saved, 0) AS is_saved FROM stories WHERE story_key = ?;", (key,)) as cur:
        same_key = await cur.fetchall()
    if any(r["is_saved"] for r in same_key):
        return None

    photo_ids = sorted(slide.photo_id for slide in slides)
    async with conn.execute(
        """
        SELECT s.id, group_concat(si.photo_id) AS ids
        FROM stories s JOIN story_items si ON si.story_id = s.id
        WHERE s.story_key IS NULL AND COALESCE(s.is_saved, 0) = 1 AND s.story_type = ?
        GROUP BY s.id;
        """,
        (story_type,),
    ) as cur:
        for row in await cur.fetchall():
            if sorted(int(x) for x in (row["ids"] or "").split(",") if x) == photo_ids:
                return None

    for row in same_key:
        await conn.execute("DELETE FROM stories WHERE id = ?;", (row["id"],))

    cursor = await conn.execute(
        """
        INSERT INTO stories (title, story_type, vibe_mood, person_id, cover_photo_id, music_track_path, story_key)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """,
        (title, story_type, mood, person_id, slides[0].photo_id, VIBE_TRACKS.get(mood, VIBE_TRACKS["acoustic"]), key),
    )
    story_id = cursor.lastrowid
    for idx, slide in enumerate(slides):
        await conn.execute(
            """
            INSERT INTO story_items (story_id, photo_id, sort_order, transition_type, focal_x, focal_y)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (story_id, slide.photo_id, idx, slide.transition_type, slide.focal_x, slide.focal_y),
        )
    return story_id


async def generate_through_the_years_story(person_id: int) -> Optional[StoryModel]:
    """Generates a chronological 'Through the Years' milestone story for a person.

    Picks the sharpest, highest-quality photo from each calendar year.
    """
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT name FROM persons WHERE id = ?;", (person_id,)) as cursor:
            p_row = await cursor.fetchone()
            if not p_row:
                return None
            person_name = p_row["name"]

        async with conn.execute(
            """
            SELECT p.id, p.filename, p.taken_at, strftime('%Y', p.taken_at) as yr, f.box_x, f.box_y
            FROM photos p
            JOIN faces f ON p.id = f.photo_id
            WHERE f.person_id = ? AND p.is_encrypted = 0 AND p.taken_at IS NOT NULL AND p.trashed_at IS NULL AND """ + STORY_P + """
            GROUP BY yr
            ORDER BY yr ASC;
            """,
            (person_id,),
        ) as s_cursor:
            rows = await s_cursor.fetchall()

        if len(rows) < 2:
            return None

        slides = [
            StorySlide(
                photo_id=r["id"],
                filename=r["filename"],
                taken_at=r["taken_at"],
                year_label=r["yr"],
                transition_type="zoom_in",
                focal_x=_safe_float(r["box_x"]),
                focal_y=_safe_float(r["box_y"]),
            )
            for r in rows
        ]

        title = generate_punchy_title("through_the_years", subject=person_name, seed=person_id)
        story_id = await _store_story(conn, key=f"through_the_years:{person_id}", title=title, story_type="through_the_years", mood="nostalgic", slides=slides, person_id=person_id)
        if story_id is None:
            return None

        await conn.commit()

        return StoryModel(
            id=story_id,
            title=title,
            story_type="through_the_years",
            vibe_mood="nostalgic",
            music_track_path=VIBE_TRACKS["nostalgic"],
            audio_url=_resolve_audio_url_for_mood("nostalgic"),
            cover_photo_id=slides[0].photo_id,
            slides=slides,
        )
    finally:
        await conn.close()


async def generate_on_this_day_stories() -> List[StoryModel]:
    """Generates 'On This Day' and anniversary milestone flashback stories.

    Scans photos taken on the same calendar month & day across previous years.
    """
    conn = await get_db_connection()
    stories: List[StoryModel] = []
    now = datetime.datetime.now()
    cur_year = now.strftime("%Y")
    # P3: this week in earlier years (3 days either side of today), so For you changes as the
    # weeks go by; one story per earlier year and week.
    days = [(now + datetime.timedelta(days=d)).strftime("%m-%d") for d in range(-3, 4)]
    week = f"W{now.isocalendar()[1]:02d}"

    try:
        async with conn.execute(
            """
            SELECT p.id, p.filename, p.taken_at, strftime('%Y', p.taken_at) as yr, strftime('%m', p.taken_at) as mo
            FROM photos p
            WHERE p.taken_at IS NOT NULL 
              AND p.trashed_at IS NULL AND """ + STORY_P + """ 
              AND p.is_encrypted = 0
              AND strftime('%m-%d', p.taken_at) IN (""" + ",".join("?" * len(days)) + """)
              AND strftime('%Y', p.taken_at) != ?
            ORDER BY strftime('%Y', p.taken_at) DESC, p.is_favorite DESC, p.id DESC;
            """,
            (*days, cur_year),
        ) as cursor:
            rows = await cursor.fetchall()

        if not rows:
            return stories

        # Group by previous year
        photos_by_year: Dict[str, List[Any]] = {}
        for r in rows:
            yr = r["yr"]
            if yr:
                photos_by_year.setdefault(yr, []).append(r)

        # Generate stories for years with at least 3 photos
        for yr, p_list in list(photos_by_year.items())[:3]:
            if len(p_list) < 2:
                continue

            years_ago = int(cur_year) - int(yr)
            if years_ago <= 0:
                continue

            title = generate_punchy_title("on_this_day", years_ago=years_ago, year=yr, seed=int(yr) if yr.isdigit() else years_ago)
            slides = [
                StorySlide(
                    photo_id=r["id"],
                    filename=r["filename"],
                    taken_at=r["taken_at"],
                    year_label=yr,
                    transition_type="crossfade",
                    focal_x=0.5,
                    focal_y=0.5,
                )
                for r in p_list[:12]
            ]

            story_id = await _store_story(conn, key=f"on_this_day:{yr}-{week}", title=title, story_type="on_this_day", mood="nostalgic", slides=slides)
            if story_id is None:
                continue

            stories.append(
                StoryModel(
                    id=story_id,
                    title=title,
                    story_type="on_this_day",
                    vibe_mood="nostalgic",
                    music_track_path=VIBE_TRACKS["nostalgic"],
                    audio_url=_resolve_audio_url_for_mood("nostalgic"),
                    cover_photo_id=slides[0].photo_id,
                    slides=slides,
                )
            )

        await conn.commit()
        return stories
    finally:
        await conn.close()


# Folder names that say nothing about a trip or event (P3): such photos get a month title and
# need more of them to make a story.
GENERIC_FOLDERS = {
    "originals", "data", "photos", "downloads", "dcim", "misc", "camera", "camera roll", "pictures", "images",
    "screenshots", "whatsapp", "whatsapp images", "new folder", "import", "imports", "backup", "temp", "desktop",
    "documents", "phone", "mobile", "100andro", "100apple", "burst", "unsorted", "other", "others",
}
GENERIC_TRIP_MIN = 5


def _generic_folder(name: str) -> bool:
    import re

    clean = (name or "").strip().lower()
    return not clean or clean in GENERIC_FOLDERS or bool(re.fullmatch(r"[\d\s._-]+", clean))


async def generate_vacation_and_trip_stories() -> List[StoryModel]:
    """Generates vacation, getaway, and trip burst stories.

    Identifies photo clusters with descriptive folder names or high-density monthly bursts.
    """
    conn = await get_db_connection()
    stories: List[StoryModel] = []
    try:
        # Detect candidate folders or monthly clusters
        async with conn.execute(
            """
            SELECT folder_name, strftime('%Y', taken_at) as yr, strftime('%m', taken_at) as mo, COUNT(*) as cnt
            FROM photos
            WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """
            GROUP BY folder_name, yr, mo
            HAVING cnt >= 3
            ORDER BY (CASE WHEN folder_name IS NOT NULL AND folder_name != '' THEN 1 ELSE 0 END) DESC, cnt DESC
            LIMIT 8;
            """
        ) as cursor:
            clusters = await cursor.fetchall()

        for cl in clusters:
            folder = cl["folder_name"] or ""
            yr = cl["yr"] or "2025"
            mo = cl["mo"] or "07"

            # Clean folder name (preserve mixed-case names like TestTrip)
            clean_name = folder.replace("_", " ").replace("-", " ")
            if clean_name.islower() or clean_name.isupper():
                clean_name = clean_name.title()
            generic = _generic_folder(clean_name)
            if generic and cl["cnt"] < GENERIC_TRIP_MIN:
                continue  # A handful of photos in "Camera" or "misc" is not a trip (P3: good taste).
            if generic:
                month_names = {
                    "01": "January", "02": "February", "03": "March", "04": "April",
                    "05": "May", "06": "June", "07": "July", "08": "August",
                    "09": "September", "10": "October", "11": "November", "12": "December",
                }
                title = generate_punchy_title("vacation_adventure", season=month_names.get(mo, "Summer"), year=yr, seed=int(mo) if mo.isdigit() else 0)
            else:
                title = generate_punchy_title("vacation_adventure", subject=clean_name, year=yr, seed=len(folder))

            # Fetch cluster photos
            async with conn.execute(
                """
                SELECT id, filename, taken_at, strftime('%Y', taken_at) as yr
                FROM photos
                WHERE folder_name = ? AND trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """
                ORDER BY is_favorite DESC, id ASC
                LIMIT 12;
                """,
                (folder,),
            ) as p_cur:
                p_rows = await p_cur.fetchall()

            if len(p_rows) < 2:
                continue

            slides = [
                StorySlide(
                    photo_id=r["id"],
                    filename=r["filename"],
                    taken_at=r["taken_at"],
                    year_label=r["yr"] or yr,
                    transition_type="zoom_in",
                    focal_x=0.5,
                    focal_y=0.5,
                )
                for r in p_rows
            ]

            story_id = await _store_story(conn, key=f"vacation_adventure:{folder}:{yr}-{mo}", title=title, story_type="vacation_adventure", mood="upbeat", slides=slides)
            if story_id is None:
                continue

            stories.append(
                StoryModel(
                    id=story_id,
                    title=title,
                    story_type="vacation_adventure",
                    vibe_mood="upbeat",
                    music_track_path=VIBE_TRACKS["upbeat"],
                    audio_url=_resolve_audio_url_for_mood("upbeat"),
                    cover_photo_id=slides[0].photo_id,
                    slides=slides,
                )
            )

        await conn.commit()
        return stories
    finally:
        await conn.close()


async def generate_seasonal_retrospectives() -> List[StoryModel]:
    """Generates meteorological seasonal retrospective stories (Autumn, Summer, Winter, Spring)."""
    conn = await get_db_connection()
    stories: List[StoryModel] = []
    try:
        seasons = [
            ("Summer", ["06", "07", "08"], "upbeat"),
            ("Autumn", ["09", "10", "11"], "acoustic"),
            ("Spring", ["03", "04", "05"], "acoustic"),
            ("Winter", ["12", "01", "02"], "nostalgic"),
        ]

        for season_name, months, mood in seasons:
            placeholders = ",".join("?" * len(months))
            async with conn.execute(
                f"""
                SELECT strftime('%Y', taken_at) as yr, COUNT(*) as cnt
                FROM photos
                WHERE strftime('%m', taken_at) IN ({placeholders})
                  AND taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """
                GROUP BY yr
                HAVING cnt >= 4
                ORDER BY yr DESC
                LIMIT 1;
                """,
                months,
            ) as cursor:
                cl = await cursor.fetchone()

            if not cl:
                continue

            yr = cl["yr"]
            title = generate_punchy_title("seasonal_highlight", season=season_name, year=yr, seed=int(yr) if yr.isdigit() else 0)

            async with conn.execute(
                f"""
                SELECT id, filename, taken_at, strftime('%Y', taken_at) as yr
                FROM photos
                WHERE strftime('%m', taken_at) IN ({placeholders})
                  AND strftime('%Y', taken_at) = ?
                  AND trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """
                ORDER BY is_favorite DESC, id ASC
                LIMIT 10;
                """,
                (*months, yr),
            ) as p_cur:
                p_rows = await p_cur.fetchall()

            if len(p_rows) < 2:
                continue

            slides = [
                StorySlide(
                    photo_id=r["id"],
                    filename=r["filename"],
                    taken_at=r["taken_at"],
                    year_label=yr,
                    transition_type="crossfade",
                    focal_x=0.5,
                    focal_y=0.5,
                )
                for r in p_rows
            ]

            story_id = await _store_story(conn, key=f"seasonal_highlight:{season_name}:{yr}", title=title, story_type="seasonal_highlight", mood=mood, slides=slides)
            if story_id is None:
                continue

            stories.append(
                StoryModel(
                    id=story_id,
                    title=title,
                    story_type="seasonal_highlight",
                    vibe_mood=mood,
                    music_track_path=VIBE_TRACKS.get(mood, VIBE_TRACKS["acoustic"]),
                    audio_url=_resolve_audio_url_for_mood(mood),
                    cover_photo_id=slides[0].photo_id,
                    slides=slides,
                )
            )

        await conn.commit()
        return stories
    finally:
        await conn.close()


async def generate_year_in_review_story(year: Optional[str] = None) -> Optional[StoryModel]:
    """Generates a dynamic 'Year in Review' highlight story from library photos."""
    conn = await get_db_connection()
    try:
        if not year:
            async with conn.execute(
                """
                SELECT strftime('%Y', taken_at) as yr 
                FROM photos 
                WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """ 
                GROUP BY yr 
                ORDER BY COUNT(*) DESC 
                LIMIT 1;
                """
            ) as cursor:
                row = await cursor.fetchone()
                if not row or not row["yr"]:
                    return None
                year = row["yr"]

        async with conn.execute(
            """
            SELECT id, filename, taken_at, strftime('%Y', taken_at) as yr
            FROM photos
            WHERE strftime('%Y', taken_at) = ? AND trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """
            ORDER BY is_favorite DESC, id ASC
            LIMIT 10;
            """,
            (year,),
        ) as cursor:
            rows = await cursor.fetchall()

        if len(rows) < 2:
            return None

        slides = [
            StorySlide(
                photo_id=r["id"],
                filename=r["filename"],
                taken_at=r["taken_at"],
                year_label=r["yr"] or year,
                transition_type="zoom_in",
                focal_x=0.5,
                focal_y=0.5,
            )
            for r in rows
        ]

        title = generate_punchy_title("year_in_review", year=year, seed=int(year) if year.isdigit() else 0)
        story_id = await _store_story(conn, key=f"year_in_review:{year}", title=title, story_type="year_in_review", mood="upbeat", slides=slides)
        if story_id is None:
            return None

        await conn.commit()

        return StoryModel(
            id=story_id,
            title=title,
            story_type="year_in_review",
            vibe_mood="upbeat",
            music_track_path=VIBE_TRACKS["upbeat"],
            audio_url=_resolve_audio_url_for_mood("upbeat"),
            cover_photo_id=slides[0].photo_id,
            slides=slides,
        )
    finally:
        await conn.close()


async def generate_recent_highlights_story() -> Optional[StoryModel]:
    """Generates a dynamic 'Library Highlights' story from top photos."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, filename, taken_at, strftime('%Y', taken_at) as yr
            FROM photos
            WHERE trashed_at IS NULL AND is_encrypted = 0 AND """ + STORY_PHOTOS + """
            ORDER BY is_favorite DESC, id DESC
            LIMIT 12;
            """
        ) as cursor:
            rows = await cursor.fetchall()

        if len(rows) < 2:
            return None

        slides = [
            StorySlide(
                photo_id=r["id"],
                filename=r["filename"],
                taken_at=r["taken_at"],
                year_label=r["yr"] or "Highlights",
                transition_type="zoom_in",
                focal_x=0.5,
                focal_y=0.5,
            )
            for r in rows
        ]

        title = "Golden Moments & Highlights"
        story_id = await _store_story(conn, key=f"highlights:{_newest_month(rows)}", title=title, story_type="highlights", mood="acoustic", slides=slides)
        if story_id is None:
            return None

        await conn.commit()

        return StoryModel(
            id=story_id,
            title=title,
            story_type="highlights",
            vibe_mood="acoustic",
            music_track_path=VIBE_TRACKS["acoustic"],
            audio_url=_resolve_audio_url_for_mood("acoustic"),
            cover_photo_id=slides[0].photo_id,
            is_saved=False,
            slides_count=len(slides),
            slides=slides,
        )
    finally:
        await conn.close()


async def generate_old_photos_story() -> Optional[StoryModel]:
    """'Old photos, brought back' (P3): old prints the app improved in the last weeks.

    Their dates are scan dates, so they stay out of dated stories (``story_photo``) and are
    shown here instead, the improved version (what the library shows), newest first.
    """
    conn = await get_db_connection()
    try:
        async with conn.execute(
            f"""
            SELECT id, filename, taken_at, edited_at FROM photos p
            WHERE p.ai_kind IS NOT NULL AND p.trashed_at IS NULL AND p.is_encrypted = 0 AND {stack_top('p')}
              AND COALESCE(p.is_document, 0) = 0 AND p.edited_at >= datetime('now', '-30 days')
            ORDER BY p.edited_at DESC, p.id DESC
            LIMIT 12;
            """
        ) as cursor:
            rows = await cursor.fetchall()
        if len(rows) < 2:
            return None
        slides = [
            StorySlide(photo_id=r["id"], filename=r["filename"], taken_at=r["taken_at"], year_label="Old photos",
                       transition_type="crossfade", focal_x=0.5, focal_y=0.5)
            for r in rows
        ]
        title = "Old photos, brought back"
        key = f"old_photos:{(rows[0]['edited_at'] or '')[:7] or 'recent'}"
        story_id = await _store_story(conn, key=key, title=title, story_type="old_photos", mood="nostalgic", slides=slides)
        if story_id is None:
            return None
        await conn.commit()
        return StoryModel(
            id=story_id, title=title, story_type="old_photos", vibe_mood="nostalgic",
            music_track_path=VIBE_TRACKS["nostalgic"], audio_url=_resolve_audio_url_for_mood("nostalgic"),
            cover_photo_id=slides[0].photo_id, slides=slides,
        )
    finally:
        await conn.close()


async def delete_story(story_id: int, remember: bool = False) -> bool:
    """Deletes a story from database, cascading to story_items and unlinking cached video export.

    ``remember`` (the owner deleted it): its kind and subject are never suggested again (P3).
    """
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT rendered_video_path, story_key FROM stories WHERE id = ?;", (story_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                return False
            if remember and row["story_key"]:
                await conn.execute("INSERT OR IGNORE INTO story_dismissals (story_key) VALUES (?);", (row["story_key"],))
            # Cached export, if any (path relative to the data folder; safe lookup).
            v_path = resolve_stored_path(row["rendered_video_path"])
            if v_path is not None:
                v_path.unlink(missing_ok=True)

        await conn.execute("DELETE FROM story_items WHERE story_id = ?;", (story_id,))
        await conn.execute("DELETE FROM stories WHERE id = ?;", (story_id,))
        await conn.commit()
        return True
    finally:
        await conn.close()


async def toggle_save_story(story_id: int, is_saved: bool) -> bool:
    """Toggles the permanent saved state of a story."""
    conn = await get_db_connection()
    try:
        cursor = await conn.execute(
            "UPDATE stories SET is_saved = ? WHERE id = ?;",
            (1 if is_saved else 0, story_id),
        )
        await conn.commit()
        return cursor.rowcount > 0
    finally:
        await conn.close()


async def prune_ephemeral_stories(keep_cap: int = 15) -> int:
    """Prunes older un-saved ephemeral stories beyond the keep_cap, preserving all saved stories permanently."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, rendered_video_path
            FROM stories
            WHERE is_saved = 0
            ORDER BY created_at DESC
            LIMIT -1 OFFSET ?;
            """,
            (keep_cap,),
        ) as cur:
            stale_rows = await cur.fetchall()

        if not stale_rows:
            return 0

        stale_ids = [r["id"] for r in stale_rows]
        for r in stale_rows:
            vp = resolve_stored_path(r["rendered_video_path"])
            if vp is not None:
                vp.unlink(missing_ok=True)

        placeholders = ",".join("?" * len(stale_ids))
        await conn.execute(f"DELETE FROM story_items WHERE story_id IN ({placeholders});", stale_ids)
        await conn.execute(f"DELETE FROM stories WHERE id IN ({placeholders});", stale_ids)
        await conn.commit()
        logger.info(f"Pruned {len(stale_ids)} stale ephemeral stories beyond keep_cap of {keep_cap}.")
        return len(stale_ids)
    finally:
        await conn.close()
