"""High-Performance FTS5 Full-Text & Smart Categorical Search API Router.

Provides unified lexical, temporal, OCR, people, and album search with zero-trust
vault isolation and sub-10ms response times.
"""

import logging
import re
from typing import List, Optional
from fastapi import APIRouter, Query, status
from pydantic import BaseModel

from engine.database import get_db_connection

logger = logging.getLogger("securephotos.api.search")
router = APIRouter(prefix="/api/search", tags=["Search"])


class SearchPhotoItem(BaseModel):
    """Represents a media item returned from search with relevance metadata."""
    id: int
    filename: str = ""
    filepath: str
    file_size: int
    original_file_size: Optional[int] = None
    mime_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    taken_at: Optional[str] = None
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    iso: Optional[int] = None
    aperture: Optional[float] = None
    shutter_speed: Optional[str] = None
    focal_length: Optional[float] = None
    is_favorite: bool = False
    is_encrypted: bool = False
    is_optimized: bool = False
    is_enhanced: bool = False
    caption: Optional[str] = None
    thumbnail_path: Optional[str] = None
    preview_path: Optional[str] = None
    match_reason: Optional[str] = None


class SearchAlbumItem(BaseModel):
    """Represents an album matching search criteria."""
    id: int
    name: str
    cover_photo_id: Optional[int] = None
    cover_thumbnail_path: Optional[str] = None
    photo_count: int = 0


class SearchPersonItem(BaseModel):
    """Represents a person matching search criteria."""
    id: int
    name: str
    relationship_type: Optional[str] = None
    confirmed_count: int = 0
    cover_face_id: Optional[int] = None


class SearchResponse(BaseModel):
    """Unified search payload containing photos, matching albums, and recognized people."""
    query: str
    total_photos: int
    photos: List[SearchPhotoItem]
    albums: List[SearchAlbumItem]
    people: List[SearchPersonItem]
    suggestions: List[str]


# Words that only choose a filter (favourites, videos, documents, a year or a month).
KEYWORD_RE = re.compile(
    r"\b(?:favou?rites?|starred|liked|videos?|movies?|documents?|pdfs?|19\d\d|20\d\d|"
    r"january|february|march|april|may|june|july|august|september|october|november|december)\b",
    re.IGNORECASE,
)
# Filler words in natural queries ("photos of Rohan from 2025"); text matching works on the rest.
FILLER_RE = re.compile(r"\b(?:photos?|pictures?|pics?|of|in|from|with|and|my|the)\b", re.IGNORECASE)


def sanitize_fts_query(raw_query: str) -> str:
    """Sanitizes user input for safe SQLite FTS5 matching.

    Strips special FTS5 operators/syntax (quotes, asterisks, parentheses, colons)
    and formats tokens with prefix wildcards (e.g. 'hawaii sunset' -> 'hawaii* sunset*').
    """
    cleaned = re.sub(r'[^\w\s]', ' ', raw_query).strip()
    if not cleaned:
        return ""
    tokens = cleaned.split()
    return " ".join(f"{t}*" for t in tokens if t)


@router.get("", response_model=SearchResponse, status_code=status.HTTP_200_OK)
async def search_media(
    q: str = Query(default="", description="Search query string"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    type_filter: Optional[str] = Query(default=None, description="Optional type filter: all, photos, videos, documents, favorites"),
) -> SearchResponse:
    """Executes a hybrid FTS5 and metadata search across unencrypted photos, albums, and people."""
    query_str = q.strip()
    default_suggestions = ["Favorites", "Videos", "Documents", "Screenshots", "Recent"]

    if not query_str:
        return SearchResponse(
            query="",
            total_photos=0,
            photos=[],
            albums=[],
            people=[],
            suggestions=default_suggestions,
        )

    conn = await get_db_connection()
    try:
        # Detect year patterns (e.g. 2021, 2024)
        year_match = re.search(r'\b(19\d\d|20\d\d)\b', query_str)
        detected_year = year_match.group(1) if year_match else None

        # Detect month names
        month_map = {
            "january": "01", "february": "02", "march": "03", "april": "04",
            "may": "05", "june": "06", "july": "07", "august": "08",
            "september": "09", "october": "10", "november": "11", "december": "12"
        }
        detected_month = None
        for m_name, m_num in month_map.items():
            if re.search(rf'\b{m_name}\b', query_str, re.IGNORECASE):
                detected_month = m_num
                break

        # Detect filter keywords
        q_lower = query_str.lower()
        filter_favorites = (
            type_filter == "favorites" or "favorite" in q_lower or "favourite" in q_lower or "starred" in q_lower or "liked" in q_lower
        )
        filter_videos = type_filter == "videos" or "video" in q_lower or "videos" in q_lower or "movie" in q_lower
        filter_documents = type_filter == "documents" or "document" in q_lower or "receipt" in q_lower or "invoice" in q_lower or "pdf" in q_lower

        # The words that only pick a filter ("videos", "favourites", "2025", "may") are not text to
        # look for: "videos" means every video, not videos whose name contains "videos".
        text_query = FILLER_RE.sub(" ", KEYWORD_RE.sub(" ", query_str))
        text_query = re.sub(r"\s+", " ", text_query).strip()

        fts_pattern = sanitize_fts_query(text_query)
        like_pattern = f"%{text_query}%"

        # ── 1. Search Albums ──────────────────────────────────────────────────
        matching_albums: List[SearchAlbumItem] = []
        async with conn.execute(
            """
            SELECT a.id, a.name, a.cover_photo_id,
                   (SELECT p.thumbnail_path FROM photos p WHERE p.id = a.cover_photo_id) AS cover_thumbnail_path,
                   (SELECT COUNT(*) FROM photo_album pa JOIN photos p ON pa.photo_id = p.id WHERE pa.album_id = a.id AND p.trashed_at IS NULL AND p.is_encrypted = 0) AS photo_count
            FROM albums a
            WHERE ? != '%%' AND a.name LIKE ? AND a.is_vault = 0
            ORDER BY photo_count DESC, a.name ASC
            LIMIT 5;
            """,
            (like_pattern, like_pattern),
        ) as cursor:
            album_rows = await cursor.fetchall()
            for r in album_rows:
                matching_albums.append(
                    SearchAlbumItem(
                        id=r["id"],
                        name=r["name"],
                        cover_photo_id=r["cover_photo_id"],
                        cover_thumbnail_path=r["cover_thumbnail_path"],
                        photo_count=r["photo_count"] or 0,
                    )
                )

        # ── 2. Search People ──────────────────────────────────────────────────
        matching_people: List[SearchPersonItem] = []
        async with conn.execute(
            """
            SELECT p.id, p.name, p.relationship_type,
                   COUNT(DISTINCT ph.id) AS active_photo_count,
                   (
                       SELECT f2.id FROM faces f2
                       JOIN photos ph2 ON f2.photo_id = ph2.id
                       WHERE f2.person_id = p.id AND ph2.trashed_at IS NULL AND ph2.is_encrypted = 0
                       ORDER BY f2.is_anchor_medoid DESC, f2.quality_score DESC
                       LIMIT 1
                   ) AS cover_face_id
            FROM persons p
            JOIN faces f ON f.person_id = p.id
            JOIN photos ph ON f.photo_id = ph.id AND ph.trashed_at IS NULL AND ph.is_encrypted = 0
            WHERE ? != '%%' AND p.name LIKE ?
            GROUP BY p.id
            HAVING active_photo_count > 0
            ORDER BY active_photo_count DESC, p.name ASC
            LIMIT 5;
            """,
            (like_pattern, like_pattern),
        ) as cursor:
            people_rows = await cursor.fetchall()
            for r in people_rows:
                matching_people.append(
                    SearchPersonItem(
                        id=r["id"],
                        name=r["name"],
                        relationship_type=r["relationship_type"],
                        confirmed_count=r["active_photo_count"] or 0,
                        cover_face_id=r["cover_face_id"],
                    )
                )

        # ── 3. Search Photos via FTS5 & Fallback Metadata ────────────────────
        # Strictly enforce: is_encrypted = 0 AND trashed_at IS NULL
        base_where_clauses = ["p.is_encrypted = 0", "p.trashed_at IS NULL"]
        params: List[any] = []

        if filter_favorites:
            base_where_clauses.append("p.is_favorite = 1")

        if filter_videos:
            base_where_clauses.append("p.mime_type LIKE 'video/%'")
        elif filter_documents:
            base_where_clauses.append("(p.is_document = 1 OR p.mime_type = 'application/pdf' OR p.filename LIKE '%.pdf')")

        if detected_year:
            base_where_clauses.append("strftime('%Y', p.taken_at) = ?")
            params.append(detected_year)

        if detected_month:
            base_where_clauses.append("strftime('%m', p.taken_at) = ?")
            params.append(detected_month)

        # FTS5 subquery if valid tokens exist
        fts_clause = ""
        fts_params: List[any] = []
        if fts_pattern:
            fts_clause = "p.id IN (SELECT rowid FROM photos_fts WHERE photos_fts MATCH ?)"
            fts_params.append(fts_pattern)

        like_clause = """
            (p.filename LIKE ? OR p.caption LIKE ? OR p.camera_make LIKE ? OR p.camera_model LIKE ? OR p.ocr_text LIKE ?)
        """
        like_params = [like_pattern, like_pattern, like_pattern, like_pattern, like_pattern]

        # Combine text match (FTS5 OR LIKE); only keywords typed means the filters alone decide.
        if not text_query:
            match_condition = "1 = 1"
            search_params = []
        elif fts_clause:
            match_condition = f"({fts_clause} OR {like_clause})"
            search_params = fts_params + like_params
        else:
            match_condition = like_clause
            search_params = like_params

        # If user searched specifically for people, include photos tagged with matching people
        if matching_people:
            person_ids = [str(peep.id) for peep in matching_people]
            placeholders = ",".join("?" for _ in person_ids)
            match_condition = f"({match_condition} OR p.id IN (SELECT photo_id FROM faces WHERE person_id IN ({placeholders})))"
            search_params.extend(person_ids)

        # If user searched specifically for albums, include photos inside matching albums
        if matching_albums:
            album_ids = [str(alb.id) for alb in matching_albums]
            placeholders = ",".join("?" for _ in album_ids)
            match_condition = f"({match_condition} OR p.id IN (SELECT photo_id FROM photo_album WHERE album_id IN ({placeholders})))"
            search_params.extend(album_ids)

        all_clauses = base_where_clauses + [match_condition]
        where_sql = " AND ".join(all_clauses)
        final_params = params + search_params

        # Get total matching count
        count_sql = f"SELECT COUNT(*) FROM photos p WHERE {where_sql};"
        async with conn.execute(count_sql, final_params) as cursor:
            count_row = await cursor.fetchone()
            total_photos = count_row[0] if count_row else 0

        # Retrieve page results
        select_sql = f"""
            SELECT p.id, p.filename, p.filepath, p.file_size, p.original_file_size, p.mime_type, p.width, p.height,
                   p.taken_at, p.camera_make, p.camera_model, p.latitude, p.longitude, p.iso, p.aperture,
                   p.shutter_speed, p.focal_length, p.is_favorite, p.is_encrypted, p.is_optimized, p.is_enhanced,
                   p.caption, p.thumbnail_path, p.preview_path, p.ocr_text
            FROM photos p
            WHERE {where_sql}
            ORDER BY p.taken_at DESC, p.id DESC
            LIMIT ? OFFSET ?;
        """
        query_params = final_params + [limit, offset]

        matching_photos: List[SearchPhotoItem] = []
        async with conn.execute(select_sql, query_params) as cursor:
            rows = await cursor.fetchall()
            for row in rows:
                # Determine match reason for UI highlights
                fname = (row["filename"] or "").lower()
                cap = (row["caption"] or "").lower()
                ocr = (row["ocr_text"] or "").lower()
                cam = (row["camera_model"] or "").lower()
                q_low = query_str.lower()

                reason = "Matched Library"
                if q_low in fname:
                    reason = f"Filename: {row['filename']}"
                elif q_low in cap:
                    snippet = cap[:45] + "..." if len(cap) > 45 else cap
                    reason = f"Caption: {snippet}"
                elif ocr and q_low in ocr:
                    start_idx = max(0, ocr.find(q_low) - 10)
                    snippet = ocr[start_idx:start_idx + 40]
                    reason = f"OCR: ...{snippet}..."
                elif cam and q_low in cam:
                    reason = f"Camera: {row['camera_model']}"
                elif detected_year and str(row["taken_at"] or "").startswith(detected_year):
                    reason = f"Taken in {detected_year}"

                matching_photos.append(
                    SearchPhotoItem(
                        id=row["id"],
                        filename=row["filename"],
                        filepath=row["filepath"],
                        file_size=row["file_size"],
                        original_file_size=row["original_file_size"] if "original_file_size" in row.keys() and row["original_file_size"] is not None else row["file_size"],
                        mime_type=row["mime_type"],
                        width=row["width"],
                        height=row["height"],
                        taken_at=row["taken_at"],
                        camera_make=row["camera_make"],
                        camera_model=row["camera_model"],
                        latitude=row["latitude"],
                        longitude=row["longitude"],
                        iso=row["iso"],
                        aperture=row["aperture"],
                        shutter_speed=row["shutter_speed"],
                        focal_length=row["focal_length"],
                        is_favorite=bool(row["is_favorite"]),
                        is_encrypted=bool(row["is_encrypted"]),
                        is_optimized=bool(row["is_optimized"]),
                        is_enhanced=bool(row["is_enhanced"]),
                        caption=row["caption"],
                        thumbnail_path=row["thumbnail_path"],
                        preview_path=row["preview_path"],
                        match_reason=reason,
                    )
                )

        return SearchResponse(
            query=query_str,
            total_photos=total_photos,
            photos=matching_photos,
            albums=matching_albums,
            people=matching_people,
            suggestions=default_suggestions,
        )

    finally:
        await conn.close()
