"""API router for Duplicate and Clutter Detection & Space Reclamation.

Provides endpoints to query duplicate groups, evaluate AI-suggested Best Picks,
manually rescan the library, and resolve individual or all groups by soft-deleting
redundant copies into the 30-day Trash safe.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services import duplicate_service

logger = logging.getLogger("securephotos.api.duplicates")

router = APIRouter(prefix="/api/duplicates", tags=["Duplicates"])


class PhotoDetail(BaseModel):
    """Media item details within a duplicate group."""
    id: int
    filename: str
    filepath: str
    file_size: int
    mime_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    taken_at: Optional[str] = None
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None
    is_favorite: bool = False
    is_encrypted: bool = False
    is_optimized: bool = False
    is_enhanced: bool = False
    caption: Optional[str] = None
    thumbnail_path: Optional[str] = None
    preview_path: Optional[str] = None
    blur_score: Optional[float] = None
    quality_score: Optional[float] = None
    file_hash: Optional[str] = None


class DuplicateGroupResponse(BaseModel):
    """Clustered duplicate group response payload."""
    group_id: str
    match_type: str
    distance: int
    suggested_best_photo_id: int
    best_reason: str
    reclaimable_bytes: int
    photos: List[PhotoDetail]


class DuplicateSummaryResponse(BaseModel):
    """High-level summary of reclaimable storage and duplicate groups."""
    total_groups: int
    total_duplicate_photos: int
    reclaimable_bytes: int


class ResolveGroupRequest(BaseModel):
    """Payload to resolve a single duplicate group."""
    group_id: str
    keep_photo_id: int


class ResolveResponse(BaseModel):
    """Response payload for duplicate resolution actions."""
    status: str
    group_id: Optional[str] = None
    kept_photo_id: Optional[int] = None
    resolved_groups: Optional[int] = None
    trashed_count: int
    reclaimed_bytes: int


@router.get("/summary", response_model=DuplicateSummaryResponse, status_code=status.HTTP_200_OK)
async def get_summary() -> DuplicateSummaryResponse:
    """Returns high-level summary telemetry of detected duplicate groups and reclaimable space."""
    conn = await get_db_connection()
    try:
        data = await duplicate_service.get_duplicate_summary(conn)
        return DuplicateSummaryResponse(**data)
    finally:
        await conn.close()


@router.get("/groups", response_model=List[DuplicateGroupResponse], status_code=status.HTTP_200_OK)
async def list_duplicate_groups() -> List[DuplicateGroupResponse]:
    """Returns all current duplicate groups with member photos and AI Best Pick recommendations."""
    conn = await get_db_connection()
    try:
        groups = await duplicate_service.get_duplicate_groups(conn)
        # If no groups currently in table, run an initial scan
        if not groups:
            groups = await duplicate_service.scan_and_cluster_duplicates(conn)
        return [DuplicateGroupResponse(**g) for g in groups]
    finally:
        await conn.close()


@router.post("/scan", response_model=List[DuplicateGroupResponse], status_code=status.HTTP_200_OK)
async def rescan_duplicates() -> List[DuplicateGroupResponse]:
    """Force an active rescan of the photo library to identify exact and near duplicates."""
    conn = await get_db_connection()
    try:
        groups = await duplicate_service.scan_and_cluster_duplicates(conn)
        return [DuplicateGroupResponse(**g) for g in groups]
    finally:
        await conn.close()


@router.post("/resolve", response_model=ResolveResponse, status_code=status.HTTP_200_OK)
async def resolve_group(payload: ResolveGroupRequest) -> ResolveResponse:
    """Resolves a single duplicate group by keeping one designated photo and trashing the rest."""
    conn = await get_db_connection()
    try:
        result = await duplicate_service.resolve_duplicate_group(
            conn, payload.group_id, payload.keep_photo_id
        )
        return ResolveResponse(**result)
    finally:
        await conn.close()


@router.post("/resolve-all-best", response_model=ResolveResponse, status_code=status.HTTP_200_OK)
async def resolve_all_best() -> ResolveResponse:
    """Resolves all duplicate groups at once by automatically keeping the suggested best in each."""
    conn = await get_db_connection()
    try:
        result = await duplicate_service.resolve_all_duplicates_best(conn)
        return ResolveResponse(**result)
    finally:
        await conn.close()
