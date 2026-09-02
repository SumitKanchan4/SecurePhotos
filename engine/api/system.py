"""System & Hardware Management API Routes for SecurePhotos Engine.

This module exposes volume management, drive disconnection status,
and dynamic settings for the Tauri desktop frontend.
"""

from typing import List
from fastapi import APIRouter, status
from pydantic import BaseModel

from engine.volume_tracker import list_connected_volumes, VolumeInfo

router = APIRouter(prefix="/api/system", tags=["System"])


class SystemInfoResponse(BaseModel):
    """System information payload."""
    os: str
    volumes: List[VolumeInfo]


@router.get("/volumes", response_model=List[VolumeInfo], status_code=status.HTTP_200_OK)
async def get_volumes() -> List[VolumeInfo]:
    """Returns all currently connected physical and logical storage volumes."""
    return list_connected_volumes()
