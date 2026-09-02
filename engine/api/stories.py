"""Stories & Cinematic Montages API Router."""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services.stories_service import StoryModel, StorySlide

router = APIRouter(prefix="/api/stories", tags=["Stories"])


@router.get("", response_model=List[StoryModel], status_code=status.HTTP_200_OK)
async def list_stories() -> List[StoryModel]:
    """Returns all curated nostalgic stories for the stories carousel."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT s.id, s.title, s.story_type, s.vibe_mood, s.music_track_path, s.cover_photo_id
            FROM stories s
            ORDER BY s.created_at DESC;
            """
        ) as cursor:
            rows = await cursor.fetchall()

        stories = []
        for r in rows:
            story_id = r["id"]
            async with conn.execute(
                """
                SELECT si.photo_id, si.transition_type, si.focal_x, si.focal_y, p.filename, p.taken_at,
                       strftime('%Y', p.taken_at) as yr
                FROM story_items si
                JOIN photos p ON si.photo_id = p.id
                WHERE si.story_id = ?
                ORDER BY si.sort_order ASC;
                """,
                (story_id,),
            ) as s_cursor:
                slide_rows = await s_cursor.fetchall()

            slides = [
                StorySlide(
                    photo_id=sr["photo_id"],
                    filename=sr["filename"],
                    taken_at=sr["taken_at"],
                    year_label=sr["yr"] or "2026",
                    transition_type=sr["transition_type"],
                    focal_x=sr["focal_x"],
                    focal_y=sr["focal_y"],
                )
                for sr in slide_rows
            ]

            stories.append(
                StoryModel(
                    id=story_id,
                    title=r["title"],
                    story_type=r["story_type"],
                    vibe_mood=r["vibe_mood"],
                    music_track_path=r["music_track_path"],
                    cover_photo_id=r["cover_photo_id"],
                    slides=slides,
                )
            )

        return stories
    finally:
        await conn.close()
