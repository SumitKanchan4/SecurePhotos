"""Stories & Cinematic Montages API Router.

Delivers multi-dimensional story retrieval, intelligent timeline generation,
and custom audio soundtrack management with automatic mood tagging.
"""

import os
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services.music_service import (
    MusicTrack,
    delete_track,
    get_track_by_id,
    scan_music_library,
    save_uploaded_music,
    update_track_mood,
)
from engine.services.stories_service import (
    StoryModel,
    StorySlide,
    _resolve_audio_url_for_mood,
    delete_story,
    generate_on_this_day_stories,
    generate_recent_highlights_story,
    generate_seasonal_retrospectives,
    generate_through_the_years_story,
    generate_vacation_and_trip_stories,
    generate_year_in_review_story,
    prune_ephemeral_stories,
    toggle_save_story,
)

router = APIRouter(prefix="/api/stories", tags=["Stories"])


class SaveStoryRequest(BaseModel):
    """Payload for saving/bookmarking a story."""
    is_saved: bool = True


class UpdateMusicMoodRequest(BaseModel):
    """Payload for updating a track's mood."""
    mood: str


class StoriesInsightsResponse(BaseModel):
    """Photographic intelligence and nostalgia metrics payload."""
    total_stories: int
    most_captured_people: List[dict]
    photos_by_month: List[dict]
    time_of_day_distribution: List[dict]
    camera_breakdown: List[dict]
    top_years: List[dict]


# ── 1. Story Listing & Timeline Synthesizer ──────────────────────────────────

@router.get("", response_model=List[StoryModel], status_code=status.HTTP_200_OK)
async def list_stories(
    limit: int = 50,
    offset: int = 0,
    saved_only: bool = False,
    ephemeral_only: bool = False,
) -> List[StoryModel]:
    """Returns curated cinematic stories with lightweight card metadata, slides_count, and high-scale indexing."""
    conn = await get_db_connection()
    try:
        # Pre-resolve mood audio URLs once upfront across the 4 mood keys (<0.1ms)
        mood_urls = {
            m: _resolve_audio_url_for_mood(m)
            for m in ("acoustic", "upbeat", "nostalgic", "cinematic")
        }

        # Self-healing: if loading initial page and unbounded un-saved stories accumulated, prune down to cap
        if offset == 0 and not saved_only:
            try:
                await prune_ephemeral_stories(keep_cap=15)
            except Exception:
                pass

        where_clause = ""
        if saved_only:
            where_clause = "WHERE COALESCE(s.is_saved, 0) = 1"
        elif ephemeral_only:
            where_clause = "WHERE COALESCE(s.is_saved, 0) = 0"

        query = f"""
            SELECT s.id, s.title, s.story_type, s.vibe_mood, s.music_track_path, s.cover_photo_id,
                   COALESCE(s.is_saved, 0) as is_saved, s.created_at,
                   COUNT(si.id) as slides_count
            FROM stories s
            LEFT JOIN story_items si ON si.story_id = s.id
            {where_clause}
            GROUP BY s.id
            ORDER BY s.is_saved DESC, s.created_at DESC
            LIMIT ? OFFSET ?;
        """
        async with conn.execute(query, (limit, offset)) as cursor:
            rows = await cursor.fetchall()

        stories = []
        for r in rows:
            mood = r["vibe_mood"] or "acoustic"
            stories.append(
                StoryModel(
                    id=r["id"],
                    title=r["title"],
                    story_type=r["story_type"],
                    vibe_mood=mood,
                    music_track_path=r["music_track_path"],
                    audio_url=mood_urls.get(mood),
                    cover_photo_id=r["cover_photo_id"],
                    is_saved=bool(r["is_saved"]),
                    slides_count=r["slides_count"],
                    slides=[],  # Lightweight summary: slides fetched on-demand via GET /api/stories/{id}
                )
            )

        return stories
    finally:
        await conn.close()


@router.post("/generate", response_model=List[StoryModel], status_code=status.HTTP_200_OK)
async def generate_stories() -> List[StoryModel]:
    """Curates and synthesizes multi-dimensional stories, auto-pruning stale un-saved suggestions."""
    conn = await get_db_connection()
    try:
        # 1. Close people 'Through the Years' stories
        async with conn.execute(
            "SELECT id FROM persons ORDER BY is_close_one DESC, affinity_score DESC LIMIT 5;"
        ) as cursor:
            person_rows = await cursor.fetchall()

        for pr in person_rows:
            await generate_through_the_years_story(pr["id"])

        # 2. 'On This Day' Flashback milestones
        await generate_on_this_day_stories()

        # 3. Vacation & trip bursts
        await generate_vacation_and_trip_stories()

        # 4. Seasonal retrospectives
        await generate_seasonal_retrospectives()

        # 5. Year in Review highlight stories
        await generate_year_in_review_story()

        # 6. Recent Highlights / Golden Moments fallback story
        await generate_recent_highlights_story()

        # 7. Prune older un-saved ephemeral stories to maintain a focused 10-15 reel
        await prune_ephemeral_stories(keep_cap=15)
    finally:
        await conn.close()

    return await list_stories()


@router.get("/insights", response_model=StoriesInsightsResponse, status_code=status.HTTP_200_OK)
async def get_stories_insights() -> StoriesInsightsResponse:
    """Returns aggregated memory velocity, camera insights, and social presence metrics."""
    conn = await get_db_connection()
    try:
        # 1. Total stories
        async with conn.execute("SELECT count(*) as cnt FROM stories;") as c:
            story_count = (await c.fetchone())["cnt"]

        # 2. Most captured people (strictly active, unencrypted library photos)
        async with conn.execute(
            """
            SELECT p.id, p.name, p.relationship_type, p.is_close_one, count(DISTINCT ph.id) as photo_count
            FROM persons p
            JOIN faces f ON f.person_id = p.id
            JOIN photos ph ON f.photo_id = ph.id
            WHERE ph.trashed_at IS NULL AND ph.is_encrypted = 0
            GROUP BY p.id
            HAVING photo_count > 0
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

        # 4. Time of day breakdown
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
            GROUP BY period;
            """
        ) as c:
            time_rows = await c.fetchall()

        # 5. Camera breakdown
        async with conn.execute(
            """
            SELECT COALESCE(camera_model, 'Smartphone / Other') as camera, count(*) as count
            FROM photos
            WHERE trashed_at IS NULL AND is_encrypted = 0
            GROUP BY camera
            ORDER BY count DESC
            LIMIT 5;
            """
        ) as c:
            cam_rows = await c.fetchall()

        # 6. Top years
        async with conn.execute(
            """
            SELECT strftime('%Y', taken_at) as yr, count(*) as count
            FROM photos
            WHERE taken_at IS NOT NULL AND trashed_at IS NULL AND is_encrypted = 0
            GROUP BY yr
            ORDER BY count DESC
            LIMIT 5;
            """
        ) as c:
            year_rows = await c.fetchall()

        return StoriesInsightsResponse(
            total_stories=story_count,
            most_captured_people=top_people,
            photos_by_month=[dict(r) for r in monthly_rows],
            time_of_day_distribution=[dict(r) for r in time_rows],
            camera_breakdown=[dict(r) for r in cam_rows],
            top_years=[dict(r) for r in year_rows],
        )
    finally:
        await conn.close()


# ── 2. Music & Custom Soundtracks Endpoints ──────────────────────────────────

@router.get("/music", response_model=List[MusicTrack], status_code=status.HTTP_200_OK)
async def get_music_library() -> List[MusicTrack]:
    """Returns all available user soundtracks categorized by mood with auto-tag info."""
    return scan_music_library()


@router.post("/music/upload", response_model=MusicTrack, status_code=status.HTTP_200_OK)
async def upload_music_track(
    file: UploadFile = File(...),
    mood: Optional[str] = Form(default=None),
) -> MusicTrack:
    """Uploads an audio soundtrack, auto-tagging its mood from genre and filename cues."""
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    track = save_uploaded_music(
        file_bytes=file_bytes,
        filename=file.filename or "soundtrack.mp3",
        explicit_mood=mood,
    )
    return track


@router.patch("/music/{track_id}", response_model=MusicTrack, status_code=status.HTTP_200_OK)
async def update_track(
    track_id: str,
    payload: UpdateMusicMoodRequest,
) -> MusicTrack:
    """Manually overrides or updates the mood of a music track."""
    success = update_track_mood(track_id=track_id, new_mood=payload.mood)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid mood or track not found.",
        )
    track = get_track_by_id(track_id)
    if not track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found.",
        )
    return track


@router.delete("/music/{track_id}", status_code=status.HTTP_200_OK)
async def delete_music_track(track_id: str):
    """Deletes an audio soundtrack from the music library and manifest."""
    success = delete_track(track_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found or could not be deleted.",
        )
    return {"status": "deleted", "id": track_id, "track_id": track_id}


@router.get("/music/{track_id}/stream", status_code=status.HTTP_200_OK)
async def stream_music_track(track_id: str):
    """Streams the audio file for the story player with HTML5 audio compatibility."""
    track = get_track_by_id(track_id)
    if not track or not os.path.exists(track.filepath):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio track file not found on disk.",
        )

    ext = Path(track.filepath).suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
    }
    media_type = media_types.get(ext, "audio/mpeg")

    return FileResponse(
        path=track.filepath,
        media_type=media_type,
        filename=track.filename,
    )


# ── 3. Single Story Details Endpoint ─────────────────────────────────────────

@router.get("/{story_id}", response_model=StoryModel, status_code=status.HTTP_200_OK)
async def get_story(story_id: int) -> StoryModel:
    """Returns a specific curated story with its ordered slide items and transitions."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT s.id, s.title, s.story_type, s.vibe_mood, s.music_track_path, s.cover_photo_id,
                   COALESCE(s.is_saved, 0) as is_saved
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
                   p.mime_type, strftime('%Y', p.taken_at) as yr
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
                mime_type=sr["mime_type"],
            )
            for sr in slide_rows
        ]

        mood = r["vibe_mood"] or "acoustic"
        return StoryModel(
            id=r["id"],
            title=r["title"],
            story_type=r["story_type"],
            vibe_mood=mood,
            music_track_path=r["music_track_path"],
            audio_url=_resolve_audio_url_for_mood(mood),
            cover_photo_id=r["cover_photo_id"],
            is_saved=bool(r["is_saved"]),
            slides_count=len(slides),
            slides=slides,
        )
    finally:
        await conn.close()


@router.delete("/{story_id}", status_code=status.HTTP_200_OK)
async def remove_story(story_id: int):
    """Deletes a story from database, cascading to slide items and unlinking cached exports."""
    success = await delete_story(story_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Story with ID {story_id} was not found or could not be deleted.",
        )
    return {"status": "deleted", "id": story_id}


@router.patch("/{story_id}/save", response_model=StoryModel, status_code=status.HTTP_200_OK)
async def save_story_toggle(story_id: int, payload: SaveStoryRequest):
    """Toggles the permanent saved state of a story (Google Photos-style keep)."""
    success = await toggle_save_story(story_id, payload.is_saved)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Story with ID {story_id} was not found.",
        )
    return await get_story(story_id)
