"""People, Representative Medoids & Social Affinity API Router.

This router manages facial recognition identities, representative medoid clusters,
live scanning workflows, and the 'Name Once, Tag 1,000 Photos' clustering interface.
"""

import asyncio
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.config import resolve_media_path
from engine.services.face_recognition_service import get_face_thumbnails_dir
from engine.services.people_merge_service import load_merge_inputs, rank_merge_suggestions
from engine.services.face_scan_worker import (
    get_scan_status,
    reset_scan_state,
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
    relationship_type: Optional[str] = "Friends"
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
    """Retrieves all recognized people with active unencrypted photos, ranked by Social Affinity Score and photo count."""
    conn = await get_db_connection()
    try:
        # Dynamically aggregate active, non-trashed, non-encrypted photos per person
        async with conn.execute(
            """
            SELECT p.id, p.name, p.affinity_score, p.relationship_type, p.is_close_one,
                   COUNT(DISTINCT ph.id) AS active_photo_count, p.cover_face_id
            FROM persons p
            JOIN faces f ON f.person_id = p.id
            JOIN photos ph ON f.photo_id = ph.id AND ph.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = ph.id AND v.trashed_at IS NULL) AND ph.is_encrypted = 0
            GROUP BY p.id
            HAVING active_photo_count > 0
            ORDER BY p.is_close_one DESC, active_photo_count DESC, p.affinity_score DESC;
            """
        ) as cursor:
            rows = await cursor.fetchall()

        people = []
        for r in rows:
            # If cover_face_id is not set or belongs to a trashed/encrypted/deleted photo, self-heal to best active medoid
            cover_face = r["cover_face_id"]
            if cover_face:
                async with conn.execute(
                    """
                    SELECT f.id FROM faces f
                    JOIN photos ph ON f.photo_id = ph.id
                    WHERE f.id = ? AND ph.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = ph.id AND v.trashed_at IS NULL) AND ph.is_encrypted = 0;
                    """,
                    (cover_face,),
                ) as chk_cur:
                    if not await chk_cur.fetchone():
                        cover_face = None

            if not cover_face:
                async with conn.execute(
                    """
                    SELECT f.id FROM faces f
                    JOIN photos ph ON f.photo_id = ph.id
                    WHERE f.person_id = ? AND ph.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = ph.id AND v.trashed_at IS NULL) AND ph.is_encrypted = 0
                    ORDER BY f.is_anchor_medoid DESC, f.quality_score DESC
                    LIMIT 1;
                    """,
                    (r["id"],),
                ) as f_cur:
                    face_row = await f_cur.fetchone()
                    if face_row:
                        cover_face = face_row["id"]
                        await conn.execute("UPDATE persons SET cover_face_id = ? WHERE id = ?;", (cover_face, r["id"]))
                        await conn.commit()

            active_cnt = int(r["active_photo_count"] or 0)
            people.append(
                PersonResponse(
                    id=r["id"],
                    name=r["name"],
                    affinity_score=float(r["affinity_score"] or 0.0),
                    relationship_type=r["relationship_type"],
                    is_close_one=bool(r["is_close_one"]),
                    confirmed_count=active_cnt,
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
        # Fetch distinct clusters that do not yet have a person_id assigned, excluding blurry proposals (<0.25)
        async with conn.execute(
            """
            SELECT f.cluster_id,
                   COUNT(DISTINCT f.photo_id) AS photo_count,
                   COUNT(f.id) AS face_count
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.person_id IS NULL AND f.cluster_id IS NOT NULL
              AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0 AND f.quality_score >= 0.25
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

            # Get anchor medoid face (high quality)
            async with conn.execute(
                """
                SELECT f.id FROM faces f
                JOIN photos p ON p.id = f.photo_id
                WHERE f.cluster_id = ? AND f.person_id IS NULL AND f.quality_score >= 0.25
                  AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0
                ORDER BY f.is_anchor_medoid DESC, f.quality_score DESC
                LIMIT 1;
                """,
                (cluster_id,),
            ) as m_cur:
                medoid_row = await m_cur.fetchone()
                medoid_face_id = medoid_row["id"] if medoid_row else None

            # Get up to 4 diverse sample faces in cluster, drawn from distinct photos
            async with conn.execute(
                """
                SELECT f.id FROM faces f
                JOIN photos p ON p.id = f.photo_id
                WHERE f.cluster_id = ? AND f.person_id IS NULL AND f.quality_score >= 0.25
                  AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0
                GROUP BY f.photo_id
                ORDER BY f.is_anchor_medoid DESC, f.quality_score DESC
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


class MergeSuggestion(BaseModel):
    """'Same person?': a named person and an unnamed group that look alike (redesign R5)."""
    person_id: int
    person_name: str
    person_photo_count: int
    person_face_id: Optional[int] = None
    cluster_id: str
    cluster_photo_count: int
    cluster_face_id: Optional[int] = None
    similarity: float


class MergeAnswer(BaseModel):
    person_id: int
    cluster_id: str


class MergeClusterRequest(BaseModel):
    cluster_id: str


async def _library_photo_count(conn, column: str, value) -> int:
    async with conn.execute(
        f"""
        SELECT COUNT(DISTINCT f.photo_id) FROM faces f
        JOIN photos p ON p.id = f.photo_id
        WHERE f.{column} = ? AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0
        {"AND f.person_id IS NULL" if column == "cluster_id" else ""};
        """,
        (value,),
    ) as cursor:
        row = await cursor.fetchone()
    return int(row[0] or 0) if row else 0


async def _best_face(conn, column: str, value) -> Optional[int]:
    async with conn.execute(
        f"""
        SELECT f.id FROM faces f
        JOIN photos p ON p.id = f.photo_id
        WHERE f.{column} = ? AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0
        {"AND f.person_id IS NULL" if column == "cluster_id" else ""}
        ORDER BY f.is_anchor_medoid DESC, f.quality_score DESC, f.id
        LIMIT 1;
        """,
        (value,),
    ) as cursor:
        row = await cursor.fetchone()
    return row["id"] if row else None


@router.get("/merge-suggestions", response_model=List[MergeSuggestion], status_code=status.HTTP_200_OK)
async def list_merge_suggestions() -> List[MergeSuggestion]:
    """Unnamed groups that probably belong to a named person, most alike first (at most 5)."""
    conn = await get_db_connection()
    try:
        people, groups, rejected = await load_merge_inputs(conn)
        ranked = await asyncio.to_thread(rank_merge_suggestions, people, groups, rejected)
        results: List[MergeSuggestion] = []
        for person_id, cluster_id, similarity in ranked:
            async with conn.execute("SELECT name, cover_face_id FROM persons WHERE id = ?;", (person_id,)) as cursor:
                person = await cursor.fetchone()
            if not person:
                continue
            results.append(
                MergeSuggestion(
                    person_id=person_id,
                    person_name=person["name"],
                    person_photo_count=await _library_photo_count(conn, "person_id", person_id),
                    person_face_id=person["cover_face_id"] or await _best_face(conn, "person_id", person_id),
                    cluster_id=cluster_id,
                    cluster_photo_count=await _library_photo_count(conn, "cluster_id", cluster_id),
                    cluster_face_id=await _best_face(conn, "cluster_id", cluster_id),
                    similarity=round(similarity, 3),
                )
            )
        return results
    finally:
        await conn.close()


@router.post("/merge-suggestions/reject", status_code=status.HTTP_200_OK)
async def reject_merge_suggestion(payload: MergeAnswer) -> dict:
    """'Not the same': remembers, per face, that this group is not this person."""
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            """
            INSERT OR IGNORE INTO person_face_rejections (person_id, face_id)
            SELECT ?, id FROM faces WHERE cluster_id = ? AND person_id IS NULL;
            """,
            (payload.person_id, payload.cluster_id),
        )
        await conn.commit()
        return {"status": "rejected", "faces_remembered": cur.rowcount}
    finally:
        await conn.close()


@router.post("/{person_id}/merge-cluster", status_code=status.HTTP_200_OK)
async def merge_cluster_into_person(person_id: int, payload: MergeClusterRequest) -> dict:
    """'Yes, merge': every unnamed face of the group joins this person. Name and settings are kept."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT id FROM persons WHERE id = ?;", (person_id,)) as cursor:
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Person not found")
        cur = await conn.execute(
            "UPDATE faces SET person_id = ? WHERE cluster_id = ? AND person_id IS NULL;",
            (person_id, payload.cluster_id),
        )
        merged = cur.rowcount
        photos = await _library_photo_count(conn, "person_id", person_id)
        await conn.execute("UPDATE persons SET confirmed_count = ? WHERE id = ?;", (photos, person_id))
        await conn.commit()
        return {"status": "merged", "person_id": person_id, "faces_merged": merged, "photo_count": photos}
    finally:
        await conn.close()


def _parse_box_float(val: Any) -> float:
    """Safely parses face bounding box coordinates whether stored as floats or 4-byte packed binary blobs."""
    if isinstance(val, (bytes, bytearray)):
        import struct
        try:
            return round(float(struct.unpack("<f", val)[0]), 6)
        except Exception:
            return 0.0
    try:
        return round(float(val), 6)
    except (TypeError, ValueError):
        return 0.0


@router.get("/faces/{face_id}", status_code=status.HTTP_200_OK)
async def get_face_details(face_id: int):
    """Retrieves coordinate geometry, quality score, and photo reference for face inspection preview."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT f.id, f.photo_id, f.box_x, f.box_y, f.box_w, f.box_h, f.quality_score,
                   p.filename, p.width, p.height, p.preview_path, p.thumbnail_path
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.id = ?;
            """,
            (face_id,),
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Face record not found")

        return {
            "id": row["id"],
            "photo_id": row["photo_id"],
            "box_x": _parse_box_float(row["box_x"]),
            "box_y": _parse_box_float(row["box_y"]),
            "box_w": _parse_box_float(row["box_w"]),
            "box_h": _parse_box_float(row["box_h"]),
            "quality_score": round(float(row["quality_score"] or 1.0), 4),
            "filename": row["filename"] or "",
            "width": row["width"] or 0,
            "height": row["height"] or 0,
            "preview_path": str(row["preview_path"]) if row["preview_path"] else "",
            "thumbnail_path": str(row["thumbnail_path"]) if row["thumbnail_path"] else "",
        }
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
            WHERE f.id = ? AND p.is_encrypted = 0;
            """,
            (face_id,),
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Face record not found")

        photo_path = resolve_media_path(row["filepath"])
        if not photo_path.exists():
            raise HTTPException(status_code=404, detail="Source photo missing on disk")

        from PIL import Image
        def _write_face_crop() -> None:  # H7: image work runs off the event loop.
            with Image.open(photo_path) as raw_img:
                img = raw_img.convert("RGB")
                w, h = img.size
                bx = _parse_box_float(row["box_x"]) * w
                by = _parse_box_float(row["box_y"]) * h
                bw = _parse_box_float(row["box_w"]) * w
                bh = _parse_box_float(row["box_h"]) * h

                margin = 0.25
                x1 = max(0, int(bx - bw * margin))
                y1 = max(0, int(by - bh * margin))
                x2 = min(w, int(bx + bw * (1.0 + margin)))
                y2 = min(h, int(by + bh * (1.0 + margin)))

                crop = img.crop((x1, y1, x2, y2)).resize((200, 200), Image.Resampling.LANCZOS)
                crop.save(face_thumb, format="WEBP", quality=90)

        await asyncio.to_thread(_write_face_crop)

        return FileResponse(face_thumb, media_type="image/webp")
    finally:
        await conn.close()


@router.post("/scan", response_model=ScanStatusResponse, status_code=status.HTTP_202_ACCEPTED)
async def trigger_face_scan(force: bool = False) -> ScanStatusResponse:
    """Manually triggers or resumes the background face recognition scan worker."""
    start_background_scan(force=force)
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

        close_relationships = {
            "Family", "Spouse", "Child", "Parent", "Sibling", "Extended Family",
            "Wife", "Husband", "Partner", "Son", "Daughter", "Mother", "Father", "Brother", "Sister",
        }
        new_rel = (payload.relationship_type or "Friends").strip()
        new_close = bool(payload.is_close_one)
        if new_rel in close_relationships:
            new_close = True

        if existing:
            person_id = existing["id"]
            if payload.relationship_type:
                await conn.execute(
                    "UPDATE persons SET relationship_type = ?, is_close_one = ? WHERE id = ?;",
                    (new_rel, 1 if new_close else 0, person_id),
                )
        else:
            # Create new person
            cur = await conn.execute(
                """
                INSERT INTO persons (name, relationship_type, is_close_one, affinity_score)
                VALUES (?, ?, ?, 50.0);
                """,
                (name_clean, new_rel, 1 if new_close else 0),
            )
            person_id = cur.lastrowid

        # Associate all faces in this cluster to person
        await conn.execute(
            "UPDATE faces SET person_id = ? WHERE cluster_id = ?;",
            (person_id, payload.cluster_id),
        )

        # Update confirmed count
        async with conn.execute(
            """
            SELECT COUNT(DISTINCT f.photo_id) AS cnt 
            FROM faces f 
            JOIN photos p ON f.photo_id = p.id 
            WHERE f.person_id = ? AND p.is_encrypted = 0 AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL);
            """,
            (person_id,),
        ) as c_cur:
            cnt_row = await c_cur.fetchone()
            total_photos = cnt_row["cnt"] if cnt_row else 1

        # Pick best medoid face as cover
        async with conn.execute(
            """
            SELECT f.id FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.person_id = ? AND p.is_encrypted = 0 AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL)
            ORDER BY f.is_anchor_medoid DESC, f.quality_score DESC
            LIMIT 1;
            """,
            (person_id,),
        ) as f_cur:
            face_row = await f_cur.fetchone()
            cover_face = face_row["id"] if face_row else None

        await conn.execute(
            """
            UPDATE persons
            SET confirmed_count = ?, cover_face_id = COALESCE(?, cover_face_id)
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


@router.post("/clusters/{cluster_id}/dismiss", status_code=status.HTTP_200_OK)
async def dismiss_unlabeled_cluster(cluster_id: str) -> dict:
    """Dismisses a false-positive cluster (e.g. shoe, artifact, or unwanted face), deleting its face records."""
    conn = await get_db_connection()
    try:
        thumbnails_dir = get_face_thumbnails_dir()
        async with conn.execute(
            "SELECT id FROM faces WHERE cluster_id = ? AND person_id IS NULL;",
            (cluster_id,),
        ) as cur:
            rows = await cur.fetchall()

        deleted_count = 0
        for r in rows:
            face_id = r["id"]
            thumb_file = thumbnails_dir / f"{face_id}.webp"
            if thumb_file.exists():
                try:
                    thumb_file.unlink()
                except OSError:
                    pass
            deleted_count += 1

        await conn.execute("DELETE FROM faces WHERE cluster_id = ? AND person_id IS NULL;", (cluster_id,))
        await conn.commit()
        return {"status": "dismissed", "cluster_id": cluster_id, "faces_removed": deleted_count}
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
                   p.width, p.height, p.taken_at, p.created_at, p.is_favorite, p.mime_type,
                   p.is_optimized, p.is_enhanced
            FROM photos p
            JOIN faces f ON f.photo_id = p.id
            WHERE f.person_id = ? AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0
            GROUP BY p.id
            ORDER BY p.taken_at DESC, p.id DESC;
            """,
            (person_id,),
        ) as cursor:
            rows = await cursor.fetchall()

        return [dict(r) for r in rows]
    finally:
        await conn.close()


class UpdatePersonRequest(BaseModel):
    """Request schema for updating person metadata, relationships, or VIP status."""
    name: Optional[str] = None
    relationship_type: Optional[str] = None
    is_close_one: Optional[bool] = None


@router.patch("/{person_id}", response_model=PersonResponse, status_code=status.HTTP_200_OK)
async def update_person(person_id: int, payload: UpdatePersonRequest) -> PersonResponse:
    """Updates a recognized person's granular relationship, display name, or Close One flag."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, name, relationship_type, is_close_one, affinity_score,
                   confirmed_count, cover_face_id
            FROM persons
            WHERE id = ?;
            """,
            (person_id,),
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Person not found")

        new_name = payload.name.strip() if payload.name is not None and payload.name.strip() else row["name"]
        new_rel = payload.relationship_type.strip() if payload.relationship_type is not None else row["relationship_type"]
        new_close = payload.is_close_one if payload.is_close_one is not None else bool(row["is_close_one"])

        # Auto-promote close family and spouse to Close One (VIP)
        close_relationships = {
            "Spouse", "Child", "Parent", "Sibling", "Family", "Extended Family",
            # Backwards-compatible aliases
            "Wife", "Husband", "Partner", "Son", "Daughter", "Mother", "Father", "Brother", "Sister",
        }
        # Only when the relationship is being changed (and Close one isn't set in the same request):
        # otherwise turning Close one off for a Family member was silently undone (R10).
        relationship_changed = payload.relationship_type is not None and new_rel != row["relationship_type"]
        if relationship_changed and payload.is_close_one is None and new_rel in close_relationships:
            new_close = True

        await conn.execute(
            """
            UPDATE persons
            SET name = ?, relationship_type = ?, is_close_one = ?
            WHERE id = ?;
            """,
            (new_name, new_rel, 1 if new_close else 0, person_id),
        )
        await conn.commit()

        return PersonResponse(
            id=person_id,
            name=new_name,
            affinity_score=float(row["affinity_score"] or 0.0),
            relationship_type=new_rel,
            is_close_one=new_close,
            confirmed_count=int(row["confirmed_count"] or 0),
            cover_face_id=row["cover_face_id"],
        )
    finally:
        await conn.close()


@router.delete("/{person_id}", status_code=status.HTTP_200_OK)
async def delete_person(person_id: int) -> dict:
    """Safely removes a recognized person identity, unlinking all associated faces without deleting source photos."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT name FROM persons WHERE id = ?;", (person_id,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Person not found")
        name = row["name"]

        # Unlink all faces so they return to unlabeled state
        await conn.execute("UPDATE faces SET person_id = NULL WHERE person_id = ?;", (person_id,))
        # Delete person record
        await conn.execute("DELETE FROM persons WHERE id = ?;", (person_id,))
        await conn.commit()
        return {"status": "deleted", "person_id": person_id, "name": name}
    finally:
        await conn.close()


@router.post("/{person_id}/unlink-photo/{photo_id}", status_code=status.HTTP_200_OK)
async def unlink_photo_from_person(person_id: int, photo_id: int) -> dict:
    """Disassociates a photo from a person (e.g. incorrectly tagged or false positive)."""
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "UPDATE faces SET person_id = NULL WHERE photo_id = ? AND person_id = ?;",
            (photo_id, person_id),
        )
        unlinked_faces = cur.rowcount

        # Recount remaining confirmed photos
        async with conn.execute(
            """
            SELECT COUNT(DISTINCT f.photo_id) AS cnt
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.person_id = ? AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0;
            """,
            (person_id,),
        ) as c_cur:
            cnt_row = await c_cur.fetchone()
            remaining_photos = cnt_row["cnt"] if cnt_row else 0

        # Self-heal cover face if it belonged to the unlinked photo
        async with conn.execute("SELECT cover_face_id FROM persons WHERE id = ?;", (person_id,)) as p_cur:
            p_row = await p_cur.fetchone()
            current_cover = p_row["cover_face_id"] if p_row else None

        new_cover = current_cover
        if current_cover:
            async with conn.execute(
                "SELECT id FROM faces WHERE id = ? AND person_id = ?;", (current_cover, person_id)
            ) as chk:
                if not await chk.fetchone():
                    async with conn.execute(
                        """
                        SELECT f.id FROM faces f
                        JOIN photos p ON f.photo_id = p.id
                        WHERE f.person_id = ? AND p.trashed_at IS NULL AND NOT EXISTS (SELECT 1 FROM photos v WHERE v.derived_from_id = p.id AND v.trashed_at IS NULL) AND p.is_encrypted = 0
                        ORDER BY f.is_anchor_medoid DESC, f.quality_score DESC
                        LIMIT 1;
                        """,
                        (person_id,),
                    ) as n_cur:
                        n_row = await n_cur.fetchone()
                        new_cover = n_row["id"] if n_row else None

        await conn.execute(
            "UPDATE persons SET confirmed_count = ?, cover_face_id = ? WHERE id = ?;",
            (remaining_photos, new_cover, person_id),
        )
        await conn.commit()

        return {
            "status": "unlinked",
            "person_id": person_id,
            "photo_id": photo_id,
            "unlinked_faces": unlinked_faces,
            "remaining_photos": remaining_photos,
        }
    finally:
        await conn.close()


class CoverPhotoRequest(BaseModel):
    """The photo whose face of this person becomes their profile photo."""
    photo_id: int


@router.post("/{person_id}/cover", status_code=status.HTTP_200_OK)
async def set_person_cover(person_id: int, payload: CoverPhotoRequest) -> dict:
    """Uses this person's face in the chosen photo as their profile photo (person page, R10).

    The photo must be a library photo (not in Trash or the vault) in which the person appears.
    """
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT f.id FROM faces f
            JOIN photos p ON p.id = f.photo_id
            WHERE f.person_id = ? AND f.photo_id = ? AND p.trashed_at IS NULL AND p.is_encrypted = 0
            ORDER BY f.quality_score DESC
            LIMIT 1;
            """,
            (person_id, payload.photo_id),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="This person isn't in that photo.")
        await conn.execute("UPDATE persons SET cover_face_id = ? WHERE id = ?;", (row["id"], person_id))
        await conn.commit()
        return {"status": "ok", "person_id": person_id, "cover_face_id": row["id"]}
    finally:
        await conn.close()


@router.post("/prune-blurry", status_code=status.HTTP_200_OK)
async def prune_blurry_faces() -> dict:
    """Purges low-quality / heavily blurred unassigned face detections (< 0.25) and reclusters."""
    conn = await get_db_connection()
    try:
        thumbnails_dir = get_face_thumbnails_dir()
        async with conn.execute(
            "SELECT id FROM faces WHERE quality_score < 0.25 AND person_id IS NULL;"
        ) as cur:
            rows = await cur.fetchall()

        deleted_count = 0
        for r in rows:
            fid = r["id"]
            thumb_file = thumbnails_dir / f"{fid}.webp"
            if thumb_file.exists():
                try:
                    thumb_file.unlink()
                except OSError:
                    pass
            deleted_count += 1

        await conn.execute("DELETE FROM faces WHERE quality_score < 0.25 AND person_id IS NULL;")
        await conn.commit()
    finally:
        await conn.close()

    from engine.services.face_clustering_service import recluster_all_faces
    recluster_res = await recluster_all_faces()

    return {
        "status": "pruned",
        "blurry_faces_removed": deleted_count,
        "recluster": recluster_res,
    }


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_all_people_and_faces() -> dict:
    """Safely purges all face detections, identity clusters, and persons to start over fresh."""
    conn = await get_db_connection()
    try:
        # Count records before deleting
        async with conn.execute("SELECT COUNT(*) FROM faces;") as cur:
            row = await cur.fetchone()
            faces_count = row[0] if row else 0
        async with conn.execute("SELECT COUNT(*) FROM persons;") as cur:
            row = await cur.fetchone()
            persons_count = row[0] if row else 0

        # Purge faces and persons
        await conn.execute("DELETE FROM faces;")
        await conn.execute("DELETE FROM persons;")
        # Reset photos faces_scanned flag so library photos can be cleanly re-scanned
        await conn.execute("UPDATE photos SET faces_scanned = 0;")
        await conn.commit()

        # Delete all face avatar thumbnails from disk
        thumbnails_dir = get_face_thumbnails_dir()
        deleted_thumbs = 0
        if thumbnails_dir.exists():
            for f in thumbnails_dir.glob("*.webp"):
                try:
                    f.unlink()
                    deleted_thumbs += 1
                except OSError:
                    pass

        # Reset in-memory scan status
        reset_scan_state()

        return {
            "status": "reset",
            "faces_cleared": faces_count,
            "persons_cleared": persons_count,
            "thumbnails_deleted": deleted_thumbs,
        }
    finally:
        await conn.close()

