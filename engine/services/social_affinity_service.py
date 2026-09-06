"""Social Affinity Graph & Close Ones Engine for SecurePhotos 2.0.

This module computes mathematical affinity scores (0.0 to 100.0) for every tagged
person to identify true 'Close Ones' (family, partner, best friends) and filter out
one-off event/party guests from story feeds.
"""

import datetime
import json
import logging
from typing import Dict, List, Optional
import aiosqlite

from engine.database import get_db_connection

logger = logging.getLogger("securephotos.social_affinity")

# Threshold above which a person is categorized as a Close One
CLOSE_ONE_AFFINITY_THRESHOLD = 60.0


def calculate_affinity_score(
    photo_count: int,
    span_years: float,
    intimate_photo_count: int,
    is_starred: bool,
    manual_close_override: bool = False,
) -> float:
    """Calculates mathematical Social Affinity Score (0.0 to 100.0).

    Weights:
    - Temporal Longevity (30%): How many years this person has appeared in photos.
    - Group Intimacy (25%): Photos taken in intimate settings (<= 3 people).
    - Photo Frequency (20%): Total number of photos.
    - User Star / Favorite (25%): Whether person is explicitly favorited.

    Args:
        photo_count: Total photos containing this person.
        span_years: Time span between earliest and latest photo in years.
        intimate_photo_count: Photos where this person appears in small groups (<= 3).
        is_starred: Whether the user explicitly starred the person.
        manual_close_override: Explicit user override.

    Returns:
        Score between 0.0 and 100.0.
    """
    if manual_close_override:
        return 95.0

    # Longevity score (Max 30 pts for 5+ years span)
    longevity_score = min(span_years / 5.0, 1.0) * 30.0

    # Intimacy score (Max 25 pts for 20+ intimate photos)
    intimacy_score = min(intimate_photo_count / 20.0, 1.0) * 25.0

    # Frequency score (Max 20 pts for 50+ photos)
    frequency_score = min(photo_count / 50.0, 1.0) * 20.0

    # Star boost (25 pts)
    star_score = 25.0 if is_starred else 0.0

    total_score = longevity_score + intimacy_score + frequency_score + star_score
    return round(min(total_score, 100.0), 1)


async def refresh_all_social_affinities() -> int:
    """Recalculates social affinity scores for all people in the database."""
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT id, name, relationship_type, is_close_one FROM persons;") as cursor:
            persons = await cursor.fetchall()

        updated_count = 0
        for person in persons:
            p_id = person["id"]
            
            # Query photo count and date span
            async with conn.execute(
                """
                SELECT COUNT(p.id) as cnt, MIN(p.taken_at) as first_date, MAX(p.taken_at) as last_date
                FROM photos p
                JOIN faces f ON p.id = f.photo_id
                WHERE f.person_id = ? AND p.is_encrypted = 0;
                """,
                (p_id,),
            ) as p_cursor:
                stats = await p_cursor.fetchone()

            cnt = stats["cnt"] if stats else 0
            span_years = 0.0
            if stats and stats["first_date"] and stats["last_date"]:
                try:
                    d1 = datetime.datetime.fromisoformat(stats["first_date"])
                    d2 = datetime.datetime.fromisoformat(stats["last_date"])
                    span_years = max(0.0, (d2 - d1).days / 365.25)
                except ValueError:
                    pass

            # Query intimate photos (where total faces on photo <= 3)
            async with conn.execute(
                """
                SELECT COUNT(p.id)
                FROM photos p
                JOIN faces f ON p.id = f.photo_id
                WHERE f.person_id = ?
                  AND (SELECT COUNT(f2.id) FROM faces f2 WHERE f2.photo_id = p.id) <= 3;
                """,
                (p_id,),
            ) as int_cursor:
                int_row = await int_cursor.fetchone()
                intimate_cnt = int_row[0] if int_row else 0

            close_relationships = {
                "Spouse", "Child", "Parent", "Sibling", "Extended Family",
                # Backwards-compatible aliases
                "Wife", "Husband", "Partner", "Son", "Daughter", "Mother", "Father", "Brother", "Sister",
            }
            is_close_rel = person["relationship_type"] in close_relationships
            score = calculate_affinity_score(
                photo_count=cnt,
                span_years=span_years,
                intimate_photo_count=intimate_cnt,
                is_starred=bool(person["is_close_one"]),
                manual_close_override=is_close_rel,
            )

            is_close = score >= CLOSE_ONE_AFFINITY_THRESHOLD or is_close_rel

            await conn.execute(
                "UPDATE persons SET affinity_score = ?, is_close_one = ?, confirmed_count = ? WHERE id = ?;",
                (score, 1 if is_close else 0, cnt, p_id),
            )
            updated_count += 1

        await conn.commit()
        return updated_count
    finally:
        await conn.close()
