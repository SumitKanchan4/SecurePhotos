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


@router.post("/generate", response_model=List[StoryModel], status_code=status.HTTP_200_OK)
async def generate_stories() -> List[StoryModel]:
    """Generates AI-curated nostalgia and milestone stories from library photos.

    Evaluates close people for 'Through the Years' stories and generates
    'Year in Review' milestone stories for prominent timeline years.

    Returns:
        List of all active StoryModel instances.
    """
    from engine.services.stories_service import (
        generate_through_the_years_story,
        generate_year_in_review_story,
        generate_recent_highlights_story,
    )

    conn = await get_db_connection()
    try:
        # 1. Generate for close persons
        async with conn.execute(
            "SELECT id FROM persons ORDER BY is_close_one DESC, affinity_score DESC LIMIT 5;"
        ) as cursor:
            person_rows = await cursor.fetchall()

        for pr in person_rows:
            await generate_through_the_years_story(pr["id"])

        # 2. Generate Year in Review highlight stories
        await generate_year_in_review_story()

        # 3. Generate Recent Highlights / Golden Moments fallback story
        await generate_recent_highlights_story()
    finally:
        await conn.close()

    return await list_stories()


@router.get("/{story_id}", response_model=StoryModel, status_code=status.HTTP_200_OK)
async def get_story(story_id: int) -> StoryModel:
    """Returns a specific curated story with its ordered slide items and transitions."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT s.id, s.title, s.story_type, s.vibe_mood, s.music_track_path, s.cover_photo_id
            FROM stories s
            WHERE s.id = ?;
            """,
            (story_id,),
        ) as cursor:
            r = await cursor.fetchone()
            if not r:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Story with ID {story_id} was not found.",
                )

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

        return StoryModel(
            id=r["id"],
            title=r["title"],
            story_type=r["story_type"],
            vibe_mood=r["vibe_mood"],
            music_track_path=r["music_track_path"],
            cover_photo_id=r["cover_photo_id"],
            slides=slides,
        )
    finally:
        await conn.close()



class StoriesInsightsResponse(BaseModel):
    """Photographic intelligence and nostalgia metrics payload."""
    total_stories: int
    most_captured_people: List[dict]
    photos_by_month: List[dict]
    time_of_day_distribution: List[dict]
    camera_breakdown: List[dict]
    top_years: List[dict]


@router.get("/insights", response_model=StoriesInsightsResponse, status_code=status.HTTP_200_OK)
async def get_stories_insights() -> StoriesInsightsResponse:
    """Returns aggregated memory velocity, camera insights, and social presence metrics."""
    conn = await get_db_connection()
    try:
        # 1. Total stories
        async with conn.execute("SELECT count(*) as cnt FROM stories;") as c:
            story_count = (await c.fetchone())["cnt"]

        # 2. Most captured people
        async with conn.execute(
            """
            SELECT p.id, p.name, p.relationship_type, p.is_close_one, count(f.id) as photo_count
            FROM persons p
            JOIN faces f ON f.person_id = p.id
            GROUP BY p.id
            ORDER BY photo_count DESC
            LIMIT 5;
            """
        ) as c:
            people_rows = await c.fetchall()
            top_people = [dict(r) for r in people_rows]

        # 3. Monthly distribution (01..12)
        async with conn.execute(
            """
            SELECT strftime('%m', taken_at) as month, count(*) as count
            FROM photos
            WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0
            GROUP BY month
            ORDER BY month ASC;
            """
        ) as c:
            monthly_rows = await c.fetchall()
            months = [dict(r) for r in monthly_rows]

        # 4. Time of Day breakdown
        async with conn.execute(
            """
            SELECT 
                CASE 
                    WHEN cast(strftime('%H', taken_at) as integer) BETWEEN 5 AND 11 THEN 'Morning'
                    WHEN cast(strftime('%H', taken_at) as integer) BETWEEN 12 AND 16 THEN 'Afternoon'
                    WHEN cast(strftime('%H', taken_at) as integer) BETWEEN 17 AND 20 THEN 'Golden Hour'
                    ELSE 'Night'
                END as period,
                count(*) as count
            FROM photos
            WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0
            GROUP BY period
            ORDER BY count DESC;
            """
        ) as c:
            period_rows = await c.fetchall()
            periods = [dict(r) for r in period_rows]

        # 5. Camera Breakdown
        async with conn.execute(
            """
            SELECT COALESCE(camera_model, camera_make, 'Direct Upload / Phone') as camera, count(*) as count
            FROM photos
            WHERE trashed_at IS NULL AND is_encrypted = 0
            GROUP BY camera
            ORDER BY count DESC
            LIMIT 5;
            """
        ) as c:
            cam_rows = await c.fetchall()
            cameras = [dict(r) for r in cam_rows]

        # 6. Top Years
        async with conn.execute(
            """
            SELECT strftime('%Y', taken_at) as yr, count(*) as count
            FROM photos
            WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0
            GROUP BY yr
            ORDER BY yr DESC
            LIMIT 6;
            """
        ) as c:
            year_rows = await c.fetchall()
            top_years = [dict(r) for r in year_rows]

        return StoriesInsightsResponse(
            total_stories=story_count,
            most_captured_people=top_people,
            photos_by_month=months,
            time_of_day_distribution=periods,
            camera_breakdown=cameras,
            top_years=top_years,
        )
    finally:
        await conn.close()


