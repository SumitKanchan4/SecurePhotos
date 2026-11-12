"""Creative Media & Collage Generation API Endpoints."""

import asyncio
import datetime
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from engine.config import settings
from engine.database import get_db_connection
from engine.services.collage_service import (
    render_collage,
    determine_collage_taken_at,
    generate_intelligent_collages,
)
from engine.services.ingestion_service import IN_LIBRARY, ingest_single_photo
from engine.services.media_paths import resolve_stored_path, unique_path

logger = logging.getLogger("securephotos.api.creatives")

router = APIRouter(prefix="/api/creatives", tags=["Creatives"])


class CollageRequest(BaseModel):
    """Payload for generating a multi-photo 4K collage."""
    photo_ids: List[int] = Field(..., description="List of 2 to 9 photo IDs to include in the collage")
    layout: str = Field(default="mosaic", description="Layout mode: 'mosaic' | 'hero_grid' | 'treemap'")
    title: Optional[str] = Field(default=None, description="Optional custom title for the collage")
    date_mode: Optional[str] = Field(default="smart", description="Dating mode: 'smart' (default), 'now', or 'event'")
    custom_date: Optional[str] = Field(default=None, description="Optional ISO timestamp string override")


class SaveCollageSuggestionRequest(BaseModel):
    """Payload for saving an intelligent collage suggestion."""
    suggestion_id: Optional[str] = Field(default=None, description="ID of the suggestion being saved")
    photo_ids: List[int] = Field(..., description="List of 2 to 9 photo IDs to include in the collage")
    layout: str = Field(default="mosaic", description="Layout mode: 'mosaic' | 'hero_grid' | 'treemap'")
    title: Optional[str] = Field(default=None, description="Title for the collage")
    date_mode: Optional[str] = Field(default="smart", description="Dating mode: 'smart' (default), 'now', or 'event'")


class CollageResponse(BaseModel):
    """Response payload after successful collage creation and library ingestion."""
    status: str
    photo_id: int
    album_id: int
    filename: str
    taken_at: Optional[str] = None


async def render_and_persist_collage(
    conn,
    photo_ids: List[int],
    layout: str = "mosaic",
    title: Optional[str] = None,
    date_mode: Optional[str] = "smart",
    custom_date: Optional[str] = None,
) -> CollageResponse:
    """Core logic to composite a 4K UHD collage, save to settings.collages_dir, and ingest into library."""
    if len(photo_ids) < 2:
        raise HTTPException(status_code=400, detail="A collage requires at least 2 photos.")
    if len(photo_ids) > 9:
        raise HTTPException(status_code=400, detail="A collage cannot exceed 9 photos.")

    # 1. Fetch source photo paths and taken_at in preserved selection order
    placeholders = ",".join("?" for _ in photo_ids)
    query = f"SELECT id, filepath, taken_at FROM photos WHERE id IN ({placeholders}) AND trashed_at IS NULL;"
    async with conn.execute(query, photo_ids) as cursor:
        rows = await cursor.fetchall()

    rows_by_id = {r["id"]: r for r in rows if r["filepath"]}
    # Stored paths are relative to the library folder, not the engine's working folder.
    resolved = {pid: resolve_stored_path(rows_by_id[pid]["filepath"]) for pid in photo_ids if pid in rows_by_id}
    photo_paths = [path for path in (resolved.get(pid) for pid in photo_ids) if path]

    if len(photo_paths) < 2:
        raise HTTPException(status_code=400, detail="At least 2 valid source photo files on disk are required.")

    # Extract parsed datetimes for dating determination
    source_dates: List[datetime.datetime] = []
    for pid in photo_ids:
        if pid in rows_by_id and rows_by_id[pid]["taken_at"]:
            raw_dt = rows_by_id[pid]["taken_at"]
            try:
                parsed_dt = datetime.datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00"))
                source_dates.append(parsed_dt.replace(tzinfo=None))
            except (ValueError, TypeError):
                pass

    custom_dt = None
    if custom_date:
        try:
            custom_dt = datetime.datetime.fromisoformat(custom_date.replace("Z", "+00:00")).replace(tzinfo=None)
        except (ValueError, TypeError):
            pass

    collage_taken_at = determine_collage_taken_at(
        source_dates=source_dates,
        date_mode=date_mode or "smart",
        custom_date=custom_dt,
    )

    # 2. Render 4K UHD composite canvas
    canvas = await asyncio.to_thread(  # H7: 4K render runs off the event loop.
        render_collage, photo_paths, layout=layout, canvas_width=3840, canvas_height=2160
    )

    # 3. Save to dedicated collages directory (data/originals/collages)
    timestamp_str = collage_taken_at.strftime("%Y%m%d_%H%M%S")
    clean_title = (title or f"Collage_{layout}").strip().replace(" ", "_")
    safe_title = "".join(c for c in clean_title if c.isalnum() or c in ("_", "-")) or "Collage"
    filename = f"{safe_title}_{timestamp_str}.webp"

    # collages/YYYY/MM (by the collage's date) keeps every folder small (M4, owner decision).
    collages_dir = settings.collages_dir / collage_taken_at.strftime("%Y") / collage_taken_at.strftime("%m")
    collages_dir.mkdir(parents=True, exist_ok=True)
    dest_path = unique_path(collages_dir / filename)

    await asyncio.to_thread(canvas.save, dest_path, "WEBP", quality=92, method=4)  # H7

    # 4. Ingest into the SecurePhotos library
    new_photo_id = await ingest_single_photo(conn, dest_path, mode=IN_LIBRARY)
    if not new_photo_id:
        raise HTTPException(status_code=500, detail="Failed to ingest generated collage into library.")

    # Update caption and guarantee taken_at timestamp (never undated)
    taken_at_db_str = collage_taken_at.strftime("%Y-%m-%d %H:%M:%S")
    caption_text = f"4K Collage ({layout.title()}): {title}" if title else f"4K Collage ({layout.title()})"
    await conn.execute(
        "UPDATE photos SET caption = ?, taken_at = ? WHERE id = ?;",
        (caption_text, taken_at_db_str, new_photo_id),
    )

    # 5. Ensure "Collages" system album exists and associate the new collage
    async with conn.execute("SELECT id, cover_photo_id FROM albums WHERE name = 'Collages';") as cursor:
        album_row = await cursor.fetchone()

    if album_row:
        album_id = album_row["id"]
        await conn.execute(
            "INSERT OR IGNORE INTO photo_album (photo_id, album_id) VALUES (?, ?);",
            (new_photo_id, album_id),
        )
        if not album_row["cover_photo_id"]:
            await conn.execute("UPDATE albums SET cover_photo_id = ? WHERE id = ?;", (new_photo_id, album_id))
    else:
        cursor = await conn.execute(
            "INSERT INTO albums (name, description, cover_photo_id) VALUES ('Collages', 'System collection for generated photo collages', ?);",
            (new_photo_id,),
        )
        album_id = cursor.lastrowid
        await conn.execute(
            "INSERT INTO photo_album (photo_id, album_id) VALUES (?, ?);",
            (new_photo_id, album_id),
        )

    await conn.commit()
    return CollageResponse(
        status="ok",
        photo_id=new_photo_id,
        album_id=album_id,
        filename=filename,
        taken_at=taken_at_db_str,
    )


@router.post("/collage", response_model=CollageResponse, status_code=status.HTTP_201_CREATED)
async def create_photo_collage(payload: CollageRequest) -> CollageResponse:
    """Generates a 4K UHD composite collage from 2 to 9 photos and ingests it into the Collages album."""
    conn = await get_db_connection()
    try:
        return await render_and_persist_collage(
            conn=conn,
            photo_ids=payload.photo_ids,
            layout=payload.layout,
            title=payload.title,
            date_mode=payload.date_mode,
            custom_date=payload.custom_date,
        )
    finally:
        await conn.close()


@router.get("/suggestions")
async def get_collage_suggestions():
    """Generates dynamic AI collage suggestions based on library faces, events, and highlights."""
    conn = await get_db_connection()
    try:
        suggestions = await generate_intelligent_collages(conn)
        return {"suggestions": suggestions}
    finally:
        await conn.close()


@router.post("/suggestions/save", response_model=CollageResponse, status_code=status.HTTP_201_CREATED)
async def save_collage_suggestion(payload: SaveCollageSuggestionRequest) -> CollageResponse:
    """Renders a suggested collage, saves it directly to data/originals/collages, and ingests it."""
    conn = await get_db_connection()
    try:
        return await render_and_persist_collage(
            conn=conn,
            photo_ids=payload.photo_ids,
            layout=payload.layout,
            title=payload.title,
            date_mode=payload.date_mode,
        )
    finally:
        await conn.close()
