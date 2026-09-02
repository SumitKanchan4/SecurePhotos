"""People, Representative Medoids & Social Affinity API Router."""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from engine.database import get_db_connection

router = APIRouter(prefix="/api/people", tags=["People"])


class PersonResponse(BaseModel):
    id: int
    name: str
    affinity_score: float
    relationship_type: Optional[str] = None
    is_close_one: bool
    confirmed_count: int
    cover_face_id: Optional[int] = None


class TagClusterRequest(BaseModel):
    cluster_id: str
    name: str
    relationship_type: Optional[str] = "Friend"


@router.get("", response_model=List[PersonResponse], status_code=status.HTTP_200_OK)
async def list_people() -> List[PersonResponse]:
    """Retrieves all recognized people ranked by Social Affinity Score."""
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, name, affinity_score, relationship_type, is_close_one, confirmed_count, cover_face_id
            FROM persons
            ORDER BY is_close_one DESC, affinity_score DESC, confirmed_count DESC;
            """
        ) as cursor:
            rows = await cursor.fetchall()

        return [
            PersonResponse(
                id=r["id"],
                name=r["name"],
                affinity_score=r["affinity_score"],
                relationship_type=r["relationship_type"],
                is_close_one=bool(r["is_close_one"]),
                confirmed_count=r["confirmed_count"],
                cover_face_id=r["cover_face_id"],
            )
            for r in rows
        ]
    finally:
        await conn.close()


@router.post("/tag-cluster", status_code=status.HTTP_200_OK)
async def tag_medoid_cluster(payload: TagClusterRequest) -> dict:
    """Tags an entire unsupervised cluster in 1 click ('Name Once, Tag 1,000 Photos')."""
    conn = await get_db_connection()
    try:
        # Create person
        cursor = await conn.execute(
            "INSERT INTO persons (name, relationship_type, is_close_one) VALUES (?, ?, 0);",
            (payload.name, payload.relationship_type),
        )
        person_id = cursor.lastrowid

        # Associate all faces in cluster
        await conn.execute(
            "UPDATE faces SET person_id = ? WHERE cluster_id = ?;",
            (person_id, payload.cluster_id),
        )
        await conn.commit()
        return {"status": "tagged", "person_id": person_id, "cluster_id": payload.cluster_id}
    finally:
        await conn.close()
