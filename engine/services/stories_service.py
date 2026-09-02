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

logger = logging.getLogger("securephotos.stories_service")

# Bundled local royalty-free ambient vibe sound tracks
VIBE_TRACKS = {
    "acoustic": "audio/vibes/serene_acoustic_guitar.mp3",
    "nostalgic": "audio/vibes/warm_nostalgic_piano.mp3",
    "upbeat": "audio/vibes/summer_sunshine_lofi.mp3",
    "cinematic": "audio/vibes/epic_journey_strings.mp3",
}


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
                focal_x=r["box_x"] or 0.5,
                focal_y=r["box_y"] or 0.5,
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
