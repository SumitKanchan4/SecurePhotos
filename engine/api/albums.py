"""Albums Management & Organization API Router."""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.api.photos import PhotoResponse

logger = logging.getLogger("securephotos.api.albums")

router = APIRouter(prefix="/api/albums", tags=["Albums"])


class AlbumResponse(BaseModel):
    """Album summary metadata payload."""
    id: int
    name: str
    description: Optional[str] = None
    is_vault: bool = False
    vault_type: Optional[str] = None
    is_favorite: bool = False
    cover_photo_id: Optional[int] = None
    cover_thumbnail_path: Optional[str] = None
    photo_count: int = 0
    created_at: Optional[str] = None


class AlbumCreateRequest(BaseModel):
    """Payload to create a new user album."""
    name: str
    description: Optional[str] = None
    photo_ids: Optional[List[int]] = None


class AddPhotosToAlbumRequest(BaseModel):
    """Payload to add multiple photos to an album."""
    photo_ids: List[int]


class SetAlbumCoverRequest(BaseModel):
    """Payload to designate an album cover photo."""
    photo_id: int


class AlbumDetailResponse(BaseModel):
    """Complete album view including member photos."""
    id: int
    name: str
    description: Optional[str] = None
    is_vault: bool = False
    is_favorite: bool = False
    cover_photo_id: Optional[int] = None
    created_at: Optional[str] = None
    photo_count: int = 0
    photos: List[PhotoResponse]


class BatchRemovePhotosRequest(BaseModel):
    """Payload to batch remove photos from an album."""
    photo_ids: List[int]


@router.get("", response_model=List[AlbumResponse], status_code=status.HTTP_200_OK)
async def list_albums() -> List[AlbumResponse]:
    """Lists all user albums with photo counts and cover thumbnails."""
    conn = await get_db_connection()
    try:
        query = """
            SELECT 
                a.id, a.name, a.description, a.is_vault, a.vault_type, a.is_favorite,
                a.created_at, a.cover_photo_id,
                COUNT(pa.photo_id) AS photo_count,
                p.thumbnail_path AS cover_thumbnail_path
            FROM albums a
            LEFT JOIN photo_album pa ON a.id = pa.album_id
            LEFT JOIN photos p ON a.cover_photo_id = p.id
            WHERE a.is_vault = 0
            GROUP BY a.id
            ORDER BY a.is_favorite DESC, a.created_at DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()

        results = []
        for r in rows:
            cover_thumb = r["cover_thumbnail_path"]
            # If cover photo is not set but album has photos, grab latest photo's thumbnail
            if not cover_thumb and r["photo_count"] > 0:
                async with conn.execute(
                    """
                    SELECT p.thumbnail_path 
                    FROM photo_album pa
                    JOIN photos p ON pa.photo_id = p.id
                    WHERE pa.album_id = ? AND p.trashed_at IS NULL
                    ORDER BY p.taken_at DESC, p.id DESC
                    LIMIT 1;
                    """,
                    (r["id"],)
                ) as sub_cursor:
                    sub_row = await sub_cursor.fetchone()
                    if sub_row:
                        cover_thumb = sub_row["thumbnail_path"]

            results.append(
                AlbumResponse(
                    id=r["id"],
                    name=r["name"],
                    description=r["description"],
                    is_vault=bool(r["is_vault"]),
                    vault_type=r["vault_type"],
                    is_favorite=bool(r["is_favorite"]),
                    cover_photo_id=r["cover_photo_id"],
                    cover_thumbnail_path=cover_thumb,
                    photo_count=r["photo_count"],
                    created_at=str(r["created_at"]) if r["created_at"] else None,
                )
            )

        return results
    finally:
        await conn.close()


@router.post("", response_model=AlbumResponse, status_code=status.HTTP_201_CREATED)
async def create_album(payload: AlbumCreateRequest) -> AlbumResponse:
    """Creates a new album and optionally populates initial photos."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Album title cannot be blank")

    conn = await get_db_connection()
    try:
        cover_id = payload.photo_ids[0] if payload.photo_ids else None
        cursor = await conn.execute(
            """
            INSERT INTO albums (name, description, cover_photo_id, is_vault, is_favorite)
            VALUES (?, ?, ?, 0, 0)
            RETURNING id, created_at;
            """,
            (name, payload.description, cover_id),
        )
        row = await cursor.fetchone()
        album_id = row["id"]
        created_at = str(row["created_at"])

        # Associate any initial photos
        added_count = 0
        cover_thumb = None
        if payload.photo_ids:
            for pid in payload.photo_ids:
                await conn.execute(
                    "INSERT OR IGNORE INTO photo_album (photo_id, album_id) VALUES (?, ?);",
                    (pid, album_id),
                )
                added_count += 1

            if cover_id:
                async with conn.execute("SELECT thumbnail_path FROM photos WHERE id = ?;", (cover_id,)) as tc:
                    trow = await tc.fetchone()
                    if trow:
                        cover_thumb = trow["thumbnail_path"]

        await conn.commit()
        return AlbumResponse(
            id=album_id,
            name=name,
            description=payload.description,
            is_vault=False,
            is_favorite=False,
            cover_photo_id=cover_id,
            cover_thumbnail_path=cover_thumb,
            photo_count=added_count,
            created_at=created_at,
        )
    finally:
        await conn.close()


@router.get("/{album_id}", response_model=AlbumDetailResponse, status_code=status.HTTP_200_OK)
async def get_album_detail(album_id: int) -> AlbumDetailResponse:
    """Retrieves an album and all active member photos."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT * FROM albums WHERE id = ?;", (album_id,)) as cursor:
            album = await cursor.fetchone()

        if not album:
            raise HTTPException(status_code=404, detail="Album not found")

        # Fetch non-trashed photos inside this album
        query = """
            SELECT 
                p.id, p.filename, p.filepath, p.file_size, p.mime_type, p.width, p.height,
                p.taken_at, p.camera_make, p.camera_model,
                p.latitude, p.longitude, p.iso, p.aperture, p.shutter_speed, p.focal_length,
                p.is_favorite, p.is_encrypted,
                p.is_optimized, p.is_enhanced, p.caption, p.thumbnail_path, p.preview_path
            FROM photo_album pa
            JOIN photos p ON pa.photo_id = p.id
            WHERE pa.album_id = ? AND p.trashed_at IS NULL
            ORDER BY pa.added_at DESC, p.taken_at DESC;
        """
        async with conn.execute(query, (album_id,)) as cursor:
            rows = await cursor.fetchall()

        photos = [
            PhotoResponse(
                id=r["id"],
                filename=r["filename"],
                filepath=r["filepath"],
                file_size=r["file_size"],
                mime_type=r["mime_type"],
                width=r["width"],
                height=r["height"],
                taken_at=r["taken_at"],
                camera_make=r["camera_make"],
                camera_model=r["camera_model"],
                latitude=r["latitude"],
                longitude=r["longitude"],
                iso=r["iso"],
                aperture=r["aperture"],
                shutter_speed=r["shutter_speed"],
                focal_length=r["focal_length"],
                is_favorite=bool(r["is_favorite"]),
                is_encrypted=bool(r["is_encrypted"]),
                is_optimized=bool(r["is_optimized"]),
                is_enhanced=bool(r["is_enhanced"]),
                caption=r["caption"],
                thumbnail_path=r["thumbnail_path"],
                preview_path=r["preview_path"],
            )
            for r in rows
        ]

        return AlbumDetailResponse(
            id=album["id"],
            name=album["name"],
            description=album["description"],
            is_vault=bool(album["is_vault"]),
            is_favorite=bool(album["is_favorite"]),
            cover_photo_id=album["cover_photo_id"],
            created_at=str(album["created_at"]) if album["created_at"] else None,
            photo_count=len(photos),
            photos=photos,
        )
    finally:
        await conn.close()


@router.post("/{album_id}/photos", status_code=status.HTTP_200_OK)
async def add_photos_to_album(album_id: int, payload: AddPhotosToAlbumRequest) -> dict:
    """Adds a batch of photo IDs to an album."""
    if not payload.photo_ids:
        return {"status": "ok", "added_count": 0, "album_id": album_id}

    conn = await get_db_connection()
    try:
        # Check album exists
        async with conn.execute("SELECT id, cover_photo_id FROM albums WHERE id = ?;", (album_id,)) as cursor:
            album = await cursor.fetchone()
        if not album:
            raise HTTPException(status_code=404, detail="Album not found")

        added_count = 0
        for pid in payload.photo_ids:
            cursor = await conn.execute(
                "INSERT OR IGNORE INTO photo_album (photo_id, album_id) VALUES (?, ?);",
                (pid, album_id),
            )
            if cursor.rowcount > 0:
                added_count += 1

        # Set cover_photo_id if currently null
        if not album["cover_photo_id"] and payload.photo_ids:
            await conn.execute(
                "UPDATE albums SET cover_photo_id = ? WHERE id = ?;",
                (payload.photo_ids[0], album_id),
            )

        await conn.commit()
        return {"status": "ok", "added_count": added_count, "album_id": album_id}
    finally:
        await conn.close()


@router.delete("/{album_id}/photos/{photo_id}", status_code=status.HTTP_200_OK)
async def remove_photo_from_album(album_id: int, photo_id: int) -> dict:
    """Removes a single photo association from an album."""
    conn = await get_db_connection()
    try:
        cursor = await conn.execute(
            "DELETE FROM photo_album WHERE album_id = ? AND photo_id = ?;",
            (album_id, photo_id),
        )
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Photo is not in this album")

        return {"status": "ok", "removed_photo_id": photo_id, "album_id": album_id}
    finally:
        await conn.close()


@router.post("/{album_id}/photos/batch-remove", status_code=status.HTTP_200_OK)
async def batch_remove_photos_from_album(album_id: int, payload: BatchRemovePhotosRequest) -> dict:
    """Removes a list of photo IDs from an album in a single atomic transaction."""
    if not payload.photo_ids:
        return {"status": "ok", "removed_count": 0, "album_id": album_id}

    conn = await get_db_connection()
    try:
        placeholders = ",".join("?" for _ in payload.photo_ids)
        cursor = await conn.execute(
            f"DELETE FROM photo_album WHERE album_id = ? AND photo_id IN ({placeholders});",
            (album_id, *payload.photo_ids),
        )
        await conn.commit()
        return {"status": "ok", "removed_count": cursor.rowcount, "album_id": album_id}
    finally:
        await conn.close()


@router.delete("/{album_id}", status_code=status.HTTP_200_OK)
async def delete_album(album_id: int) -> dict:
    """Deletes an album and unlinks member photos without deleting the source photos."""
    conn = await get_db_connection()
    try:
        # Foreign key CASCADE handles photo_album, but let's be explicit
        await conn.execute("DELETE FROM photo_album WHERE album_id = ?;", (album_id,))
        cursor = await conn.execute("DELETE FROM albums WHERE id = ?;", (album_id,))
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Album not found")

        return {"status": "ok", "deleted_album_id": album_id}
    finally:
        await conn.close()


@router.post("/{album_id}/toggle-favorite", status_code=status.HTTP_200_OK)
async def toggle_album_favorite(album_id: int) -> dict:
    """Toggles favorite star status for an album."""
    conn = await get_db_connection()
    try:
        cursor = await conn.execute(
            "UPDATE albums SET is_favorite = NOT is_favorite WHERE id = ? RETURNING is_favorite;",
            (album_id,),
        )
        row = await cursor.fetchone()
        await conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Album not found")

        return {"status": "ok", "album_id": album_id, "is_favorite": bool(row["is_favorite"])}
    finally:
        await conn.close()


@router.post("/{album_id}/cover", status_code=status.HTTP_200_OK)
async def set_album_cover(album_id: int, payload: SetAlbumCoverRequest) -> dict:
    """Sets a specific photo as the album cover image."""
    conn = await get_db_connection()
    try:
        # Verify photo is associated with this album
        async with conn.execute(
            "SELECT photo_id FROM photo_album WHERE album_id = ? AND photo_id = ?;",
            (album_id, payload.photo_id),
        ) as cursor:
            assoc = await cursor.fetchone()
        if not assoc:
            raise HTTPException(status_code=400, detail="Photo is not a member of this album")

        cursor = await conn.execute(
            "UPDATE albums SET cover_photo_id = ? WHERE id = ?;",
            (payload.photo_id, album_id),
        )
        await conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Album not found")

        return {"status": "ok", "album_id": album_id, "cover_photo_id": payload.photo_id}
    finally:
        await conn.close()

