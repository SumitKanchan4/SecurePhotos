"""People, Representative Medoids & Social Affinity API Router.

This router manages facial recognition identities, representative medoid clusters,
live scanning workflows, and the 'Name Once, Tag 1,000 Photos' clustering interface.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services.face_recognition_service import get_face_thumbnails_dir
from engine.services.face_scan_worker import (
    get_scan_status,
    run_background_face_scan,
    start_background_scan,
)

router = APIRouter(prefix="/api/people", tags=["People"])


class PersonResponse(BaseModel):
    """Schema representing a recognized individual with social affinity metrics."""
    id: int
    name: str
    affinity_score: float
    relationship_type: Optional[str] = None
    is_close_one: bool
    confirmed_count: int
    cover_face_id: Optional[int] = None


class UnlabeledClusterResponse(BaseModel):
    """Schema representing an unsupervised face cluster ready for one-click naming."""
    cluster_id: str
    photo_count: int
    face_count: int
    medoid_face_id: Optional[int] = None
    anchor_face_ids: List[int] = []


class TagClusterRequest(BaseModel):
    """Request payload to tag an unsupervised cluster with an authentic identity."""
    cluster_id: str
    name: str
    relationship_type: Optional[str] = "Friend"
    is_close_one: Optional[bool] = False


class ScanStatusResponse(BaseModel):
    """Real-time scan progress status."""
    is_scanning: bool
    total_photos: int
    scanned_photos: int
    faces_found: int
    current_photo: Optional[str] = None
    error: Optional[str] = None


@router.get("", response_model=List[PersonResponse], status_code=status.HTTP_200_OK)
async def list_people() -> List[PersonResponse]:
    """Retrieves all recognized people ranked by Social Affinity Score and confirmed photo count."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT p.id, p.name, p.affinity_score, p.relationship_type, p.is_close_one,
                   p.confirmed_count, p.cover_face_id
            FROM persons p
            ORDER BY p.is_close_one DESC, p.confirmed_count DESC, p.affinity_score DESC;
            """
        ) as cursor:
            rows = await cursor.fetchall()

        people = []
        for r in rows:
            # If cover_face_id is not set, try to find the anchor medoid face for this person
            cover_face = r["cover_face_id"]
            if not cover_face:
                async with conn.execute(
                    """
                    SELECT id FROM faces
                    WHERE person_id = ?
                    ORDER BY is_anchor_medoid DESC, quality_score DESC
                    LIMIT 1;
                    """,
                    (r["id"],),
                ) as f_cur:
                    face_row = await f_cur.fetchone()
                    if face_row:
                        cover_face = face_row["id"]

            people.append(
                PersonResponse(
                    id=r["id"],
                    name=r["name"],
                    affinity_score=float(r["affinity_score"] or 0.0),
                    relationship_type=r["relationship_type"],
                    is_close_one=bool(r["is_close_one"]),
                    confirmed_count=int(r["confirmed_count"] or 0),
                    cover_face_id=cover_face,
                )
            )
        return people
    finally:
        await conn.close()


@router.get("/clusters", response_model=List[UnlabeledClusterResponse], status_code=status.HTTP_200_OK)
async def list_unlabeled_clusters() -> List[UnlabeledClusterResponse]:
    """Retrieves unsupervised clusters awaiting naming, providing 4 diverse anchor faces for verification."""
    conn = await get_db_connection()
    try:
        # Fetch distinct clusters that do not yet have a person_id assigned
        async with conn.execute(
            """
            SELECT f.cluster_id,
                   COUNT(DISTINCT f.photo_id) AS photo_count,
                   COUNT(f.id) AS face_count
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.person_id IS NULL AND f.cluster_id IS NOT NULL AND p.trashed_at IS NULL
            GROUP BY f.cluster_id
            ORDER BY photo_count DESC, face_count DESC;
            """
        ) as cursor:
            clusters_meta = await cursor.fetchall()

        results = []
        for c in clusters_meta:
            cluster_id = c["cluster_id"]
            photo_count = c["photo_count"]
            face_count = c["face_count"]

            # Get anchor medoid face
            async with conn.execute(
                """
                SELECT id FROM faces
                WHERE cluster_id = ? AND person_id IS NULL
                ORDER BY is_anchor_medoid DESC, quality_score DESC
                LIMIT 1;
                """,
                (cluster_id,),
            ) as m_cur:
                medoid_row = await m_cur.fetchone()
                medoid_face_id = medoid_row["id"] if medoid_row else None

            # Get up to 4 diverse sample faces in cluster
            async with conn.execute(
                """
                SELECT id FROM faces
                WHERE cluster_id = ? AND person_id IS NULL
                ORDER BY is_anchor_medoid DESC, quality_score DESC
                LIMIT 4;
                """,
                (cluster_id,),
            ) as a_cur:
                anchor_rows = await a_cur.fetchall()
                anchor_face_ids = [r["id"] for r in anchor_rows]

            results.append(
                UnlabeledClusterResponse(
                    cluster_id=cluster_id,
                    photo_count=photo_count,
                    face_count=face_count,
                    medoid_face_id=medoid_face_id,
                    anchor_face_ids=anchor_face_ids,
                )
            )

        return results
    finally:
        await conn.close()


@router.get("/faces/{face_id}/crop", status_code=status.HTTP_200_OK)
async def get_face_crop(face_id: int):
    """Streams the 200x200 WebP face avatar thumbnail for a recognized or candidate face."""
    thumbnails_dir = get_face_thumbnails_dir()
    face_thumb = thumbnails_dir / f"{face_id}.webp"

    if face_thumb.exists():
        return FileResponse(face_thumb, media_type="image/webp")

    # If missing on disk, crop dynamically from source photo and cache it
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT f.box_x, f.box_y, f.box_w, f.box_h, p.filepath
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id = ?;
            """,
            (face_id,),
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Face record not found")

        photo_path = Path(row["filepath"])
        if not photo_path.exists():
            raise HTTPException(status_code=404, detail="Source photo missing on disk")

        from PIL import Image
        with Image.open(photo_path) as raw_img:
            img = raw_img.convert("RGB")
            w, h = img.size
            bx = row["box_x"] * w
            by = row["box_y"] * h
            bw = row["box_w"] * w
            bh = row["box_h"] * h

            margin = 0.25
            x1 = max(0, int(bx - bw * margin))
            y1 = max(0, int(by - bh * margin))
            x2 = min(w, int(bx + bw * (1.0 + margin)))
            y2 = min(h, int(by + bh * (1.0 + margin)))

            crop = img.crop((x1, y1, x2, y2)).resize((200, 200), Image.Resampling.LANCZOS)
            crop.save(face_thumb, format="WEBP", quality=90)

        return FileResponse(face_thumb, media_type="image/webp")
    finally:
        await conn.close()


@router.post("/scan", response_model=ScanStatusResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_face_scan() -> ScanStatusResponse:
    """Manually triggers or resumes the background face recognition scan worker."""
    start_background_scan()
    return ScanStatusResponse(**get_scan_status())


@router.get("/scan-progress", response_model=ScanStatusResponse, status_code=status.HTTP_200_OK)
async def get_face_scan_progress() -> ScanStatusResponse:
    """Polls real-time progress of the background face detection & embedding worker."""
    return ScanStatusResponse(**get_scan_status())


@router.post("/tag-cluster", status_code=status.HTTP_200_OK)
async def tag_medoid_cluster(payload: TagClusterRequest) -> dict:
    """Tags an entire unsupervised cluster in 1 click ('Name Once, Tag 1,000 Photos')."""
    name_clean = payload.name.strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Name cannot be blank")

    conn = await get_db_connection()
    try:
        # Check if person already exists (case-insensitive)
        async with conn.execute(
            "SELECT id, cover_face_id FROM persons WHERE LOWER(name) = LOWER(?);",
            (name_clean,),
        ) as cursor:
            existing = await cursor.fetchone()

        if existing:
            person_id = existing["id"]
        else:
            # Create new person
            cur = await conn.execute(
                """
                INSERT INTO persons (name, relationship_type, is_close_one, affinity_score)
                VALUES (?, ?, ?, 50.0);
                """,
                (name_clean, payload.relationship_type or "Friend", 1 if payload.is_close_one else 0),
            )
            person_id = cur.lastrowid

        # Associate all faces in this cluster to person
        await conn.execute(
            "UPDATE faces SET person_id = ? WHERE cluster_id = ?;",
            (person_id, payload.cluster_id),
        )

        # Update confirmed count
        async with conn.execute(
            "SELECT COUNT(DISTINCT photo_id) AS cnt FROM faces WHERE person_id = ?;",
            (person_id,),
        ) as c_cur:
            cnt_row = await c_cur.fetchone()
            total_photos = cnt_row["cnt"] if cnt_row else 1

        # Pick best medoid face as cover
        async with conn.execute(
            """
            SELECT id FROM faces
            WHERE person_id = ?
            ORDER BY is_anchor_medoid DESC, quality_score DESC
            LIMIT 1;
            """,
            (person_id,),
        ) as f_cur:
            face_row = await f_cur.fetchone()
            cover_face = face_row["id"] if face_row else None

        await conn.execute(
            """
            UPDATE persons
            SET confirmed_count = ?, cover_face_id = COALESCE(cover_face_id, ?)
            WHERE id = ?;
            """,
            (total_photos, cover_face, person_id),
        )

        await conn.commit()
        return {
            "status": "tagged",
            "person_id": person_id,
            "name": name_clean,
            "cluster_id": payload.cluster_id,
            "photos_tagged": total_photos,
        }
    finally:
        await conn.close()


@router.get("/{person_id}/photos", status_code=status.HTTP_200_OK)
async def get_person_photos(person_id: int):
    """Retrieves all photos in which a specified person appears."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT p.id, p.filename, p.filepath, p.thumbnail_path, p.preview_path,
                   p.width, p.height, p.taken_at, p.created_at, p.is_favorite
            FROM photos p
            JOIN faces f ON f.photo_id = p.id
            WHERE f.person_id = ? AND p.trashed_at IS NULL
            GROUP BY p.id
            ORDER BY p.taken_at DESC, p.id DESC;
            """,
            (person_id,),
        ) as cursor:
            rows = await cursor.fetchall()

        return [dict(r) for r in rows]
    finally:
        await conn.close()
