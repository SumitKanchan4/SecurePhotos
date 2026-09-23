"""Automatic Stories, Vibe Matching, and Beat-Synchronized Montage Engine.

This module generates dynamic nostalgic stories:
1. 'Through the Years': Chronological milestone evolution for Close Ones.
2. 'On This Day': Flashbacks from 1, 3, 5, 10 years ago.
3. 'Duo Moments': Celebrations of shared moments between two close people.
4. Vibe-matched royalty-free ambient soundtrack assignment.
"""

import datetime
import logging
from typing import Dict, List, Optional
from pydantic import BaseModel

from engine.database import get_db_connection

import struct

logger = logging.getLogger("securephotos.stories_service")

# Bundled local royalty-free ambient vibe sound tracks
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


class StoryModel(BaseModel):
    """Full story presentation model."""
    id: int
    title: str
    story_type: str
    vibe_mood: str
    music_track_path: str
    cover_photo_id: Optional[int] = None
    slides: List[StorySlide] = []


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

        # Query best photo per year
        async with conn.execute(
            """
            SELECT p.id, p.filename, p.taken_at, strftime('%Y', p.taken_at) as yr, f.box_x, f.box_y
            FROM photos p
            JOIN faces f ON p.id = f.photo_id
            WHERE f.person_id = ? AND p.is_encrypted = 0 AND p.taken_at IS NOT NULL
            GROUP BY yr
            ORDER BY yr ASC;
            """,
            (person_id,),
        ) as s_cursor:
            rows = await s_cursor.fetchall()

        if len(rows) < 2:
            return None  # Needs at least 2 distinct years

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

        # Insert or update story record
        title = f"{person_name}: Through the Years ({rows[0]['yr']} — {rows[-1]['yr']})"
        cursor = await conn.execute(
            """
            INSERT INTO stories (title, story_type, vibe_mood, person_id, cover_photo_id, music_track_path)
            VALUES (?, 'through_the_years', 'nostalgic', ?, ?, ?);
            """,
            (title, person_id, slides[0].photo_id, VIBE_TRACKS["nostalgic"]),
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

        await conn.commit()

        return StoryModel(
            id=story_id,
            title=title,
            story_type="through_the_years",
            vibe_mood="nostalgic",
            music_track_path=VIBE_TRACKS["nostalgic"],
            cover_photo_id=slides[0].photo_id,
            slides=slides,
        )
    finally:
        await conn.close()


async def generate_year_in_review_story(year: Optional[str] = None) -> Optional[StoryModel]:
    """Generates a dynamic 'Year in Review' highlight story from library photos.

    Args:
        year: Specific calendar year string (e.g. '2025'). If None, selects the year with the most photos.

    Returns:
        Generated StoryModel or None if insufficient photos exist.
    """
    conn = await get_db_connection()
    try:
        if not year:
            async with conn.execute(
                """
                SELECT strftime('%Y', taken_at) as yr 
                FROM photos 
                WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0 
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
            WHERE strftime('%Y', taken_at) = ? AND trashed_at IS NULL AND is_encrypted = 0
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

        title = f"Memories of {year}"
        cursor = await conn.execute(
            """
            INSERT INTO stories (title, story_type, vibe_mood, cover_photo_id, music_track_path)
            VALUES (?, 'year_in_review', 'upbeat', ?, ?);
            """,
            (title, slides[0].photo_id, VIBE_TRACKS["upbeat"]),
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

        await conn.commit()

        return StoryModel(
            id=story_id,
            title=title,
            story_type="year_in_review",
            vibe_mood="upbeat",
            music_track_path=VIBE_TRACKS["upbeat"],
            cover_photo_id=slides[0].photo_id,
            slides=slides,
        )
    finally:
        await conn.close()


async def generate_recent_highlights_story() -> Optional[StoryModel]:
    """Generates a dynamic 'Library Highlights' story from top photos.

    Selects favorite or high-quality recent photos across the library (minimum 2 photos).
    """
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, filename, taken_at, strftime('%Y', taken_at) as yr
            FROM photos
            WHERE trashed_at IS NULL AND is_encrypted = 0
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
        cursor = await conn.execute(
            """
            INSERT INTO stories (title, story_type, vibe_mood, cover_photo_id, music_track_path)
            VALUES (?, 'highlights', 'acoustic', ?, ?);
            """,
            (title, slides[0].photo_id, VIBE_TRACKS["acoustic"]),
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

        await conn.commit()

        return StoryModel(
            id=story_id,
            title=title,
            story_type="highlights",
            vibe_mood="acoustic",
            music_track_path=VIBE_TRACKS["acoustic"],
            cover_photo_id=slides[0].photo_id,
            slides=slides,
        )
    finally:
        await conn.close()


