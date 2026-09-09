"""Creative Media & Collage Generation API Endpoints."""

import datetime
import logging
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from engine.config import settings
from engine.database import get_db_connection
from engine.services.collage_service import render_collage, determine_collage_taken_at
from engine.services.ingestion_service import ingest_single_photo

logger = logging.getLogger("securephotos.api.creatives")

router = APIRouter(prefix="/api/creatives", tags=["Creatives"])


class CollageRequest(BaseModel):
    """Payload for generating a multi-photo 4K collage."""
    photo_ids: List[int] = Field(..., description="List of 2 to 9 photo IDs to include in the collage")
    layout: str = Field(default="mosaic", description="Layout mode: 'mosaic' | 'hero_grid' | 'treemap'")
    title: Optional[str] = Field(default=None, description="Optional custom title for the collage")
    date_mode: Optional[str] = Field(default="smart", description="Dating mode: 'smart' (default), 'now', or 'event'")
    custom_date: Optional[str] = Field(default=None, description="Optional ISO timestamp string override")


class CollageResponse(BaseModel):
    """Response payload after successful collage creation and library ingestion."""
    status: str
    photo_id: int
    album_id: int
    filename: str
    taken_at: Optional[str] = None


@router.post("/collage", response_model=CollageResponse, status_code=status.HTTP_201_CREATED)
async def create_photo_collage(payload: CollageRequest) -> CollageResponse:
    """Generates a 4K UHD composite collage from 2 to 9 photos and ingests it into the Collages album."""
    if len(payload.photo_ids) < 2:
        raise HTTPException(status_code=400, detail="A collage requires at least 2 photos.")
    if len(payload.photo_ids) > 9:
        raise HTTPException(status_code=400, detail="A collage cannot exceed 9 photos.")

    conn = await get_db_connection()
    try:
        # 1. Fetch source photo paths and taken_at in preserved selection order
        placeholders = ",".join("?" for _ in payload.photo_ids)
        query = f"SELECT id, filepath, taken_at FROM photos WHERE id IN ({placeholders}) AND trashed_at IS NULL;"
        async with conn.execute(query, payload.photo_ids) as cursor:
            rows = await cursor.fetchall()

        rows_by_id = {r["id"]: r for r in rows if r["filepath"]}
        photo_paths = [
            Path(rows_by_id[pid]["filepath"])
            for pid in payload.photo_ids
            if pid in rows_by_id and Path(rows_by_id[pid]["filepath"]).exists()
        ]

        if len(photo_paths) < 2:
            raise HTTPException(status_code=400, detail="At least 2 valid source photo files on disk are required.")

        # Extract parsed datetimes for dating determination
        source_dates: List[datetime.datetime] = []
        for pid in payload.photo_ids:
            if pid in rows_by_id and rows_by_id[pid]["taken_at"]:
                raw_dt = rows_by_id[pid]["taken_at"]
                try:
                    parsed_dt = datetime.datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00"))
                    source_dates.append(parsed_dt.replace(tzinfo=None))
                except (ValueError, TypeError):
                    pass

        custom_dt = None
        if payload.custom_date:
            try:
                custom_dt = datetime.datetime.fromisoformat(payload.custom_date.replace("Z", "+00:00")).replace(tzinfo=None)
            except (ValueError, TypeError):
                pass

        collage_taken_at = determine_collage_taken_at(
            source_dates=source_dates,
            date_mode=payload.date_mode or "smart",
            custom_date=custom_dt,
        )

        # 2. Render 4K UHD composite canvas
        canvas = render_collage(photo_paths, layout=payload.layout, canvas_width=3840, canvas_height=2160)

        # 3. Save to managed creatives directory
        timestamp_str = collage_taken_at.strftime("%Y%m%d_%H%M%S")
        safe_title = (payload.title or f"Collage_{payload.layout}").strip().replace(" ", "_")
        filename = f"{safe_title}_{timestamp_str}.webp"

        creatives_dir = settings.originals_dir / "creatives" / "collages"
        creatives_dir.mkdir(parents=True, exist_ok=True)
        dest_path = creatives_dir / filename

        canvas.save(dest_path, "WEBP", quality=92, method=4)

        # 4. Ingest into the SecurePhotos library
        new_photo_id = await ingest_single_photo(conn, dest_path, mode="in_place")
        if not new_photo_id:
            raise HTTPException(status_code=500, detail="Failed to ingest generated collage into library.")

        # Update caption and guarantee taken_at timestamp (never undated)
        taken_at_db_str = collage_taken_at.strftime("%Y-%m-%d %H:%M:%S")
        await conn.execute(
            "UPDATE photos SET caption = ?, taken_at = ? WHERE id = ?;",
            (f"4K Collage ({payload.layout.title()})", taken_at_db_str, new_photo_id),
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

    finally:
        await conn.close()
