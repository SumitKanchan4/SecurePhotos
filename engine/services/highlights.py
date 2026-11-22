"""What the Dashboard shows besides the counts (T32, owner-approved mock-up 2026-11-22).

One read-only pass over the library for the Dashboard tiles: On this day, Just added, Brought
back, People, Your year and Trash. Vault photos are never included. Photos in Trash are left
out everywhere except the Trash totals, apart from one case: a restored photo's original kept
in Trash after "Replace" can still be shown as the "before" picture.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

import aiosqlite

from engine.services.after_import import PREPARING
from engine.services.photo_versions import not_superseded, stack_top
from engine.services.stories_service import story_photo

# On this day uses the same week as the "On this day" stories: 3 days either side of today.
ON_THIS_DAY_SPAN_DAYS = 3
ON_THIS_DAY_PHOTOS = 3
JUST_ADDED_HOURS = 24
JUST_ADDED_PHOTOS = 3
TOP_PEOPLE = 6
# Faces too blurry to offer for naming (the same bar as People › "Name these").
NAMEABLE_FACE_QUALITY = 0.25

LIBRARY = "COALESCE({a}.is_encrypted, 0) = 0 AND {a}.trashed_at IS NULL"
IS_VIDEO = "COALESCE({a}.mime_type, '') LIKE 'video/%'"


def _library(alias: str) -> str:
    return LIBRARY.format(a=alias)


async def on_this_day(conn: aiosqlite.Connection, now: datetime.datetime) -> Optional[Dict[str, Any]]:
    """This week in the earlier year with the most photos, or None when no earlier year has two."""
    days = [(now + datetime.timedelta(days=d)).strftime("%m-%d") for d in range(-ON_THIS_DAY_SPAN_DAYS, ON_THIS_DAY_SPAN_DAYS + 1)]
    marks = ",".join("?" * len(days))
    async with conn.execute(
        f"""
        SELECT p.id, strftime('%Y', p.taken_at) AS yr FROM photos p
        WHERE p.taken_at IS NOT NULL AND {_library('p')} AND {story_photo('p')}
          AND NOT {IS_VIDEO.format(a='p')}
          AND strftime('%m-%d', p.taken_at) IN ({marks}) AND strftime('%Y', p.taken_at) < ?
        ORDER BY p.is_favorite DESC, p.taken_at, p.id;
        """,
        (*days, now.strftime("%Y")),
    ) as cur:
        rows = await cur.fetchall()
    by_year: Dict[str, List[int]] = {}
    for r in rows:
        if r["yr"]:
            by_year.setdefault(r["yr"], []).append(r["id"])
    best = max(by_year.items(), key=lambda kv: (len(kv[1]), kv[0]), default=None)
    if not best or len(best[1]) < 2:
        return None
    year, ids = best
    story_id = None
    async with conn.execute(
        "SELECT id FROM stories WHERE story_type = 'on_this_day' AND story_key LIKE ? ORDER BY created_at DESC LIMIT 1;",
        (f"on_this_day:{year}-%",),
    ) as cur:
        row = await cur.fetchone()
        if row:
            story_id = row["id"]
    return {
        "year": int(year),
        "years_ago": now.year - int(year),
        "count": len(ids),
        "photo_ids": ids[:ON_THIS_DAY_PHOTOS],
        "story_id": story_id,
    }


async def just_added(conn: aiosqlite.Connection) -> Optional[Dict[str, Any]]:
    """What came in during the last day (improved copies are not imports), or None."""
    since = f"-{JUST_ADDED_HOURS} hours"
    async with conn.execute(
        f"""
        SELECT p.id, {IS_VIDEO.format(a='p')} AS is_video, CASE WHEN {PREPARING} THEN 1 ELSE 0 END AS preparing
        FROM photos p
        WHERE {_library('p')} AND p.derived_from_id IS NULL AND COALESCE(p.is_document, 0) = 0
          AND p.created_at >= datetime('now', ?)
        ORDER BY p.created_at DESC, p.id DESC;
        """,
        (since,),
    ) as cur:
        rows = await cur.fetchall()
    if not rows:
        return None
    return {
        "photos": sum(1 for r in rows if not r["is_video"]),
        "videos": sum(1 for r in rows if r["is_video"]),
        "preparing": sum(1 for r in rows if r["preparing"]),
        "photo_ids": [r["id"] for r in rows if not r["is_video"]][:JUST_ADDED_PHOTOS],
    }


async def brought_back(conn: aiosqlite.Connection) -> Optional[Dict[str, Any]]:
    """The old photo the app brought back most recently, or None when there is none.

    Owner, 2026-11-22: the newest one whose original still exists (in the library, or in Trash
    for 30 days after "Keep improved") comes with ``before_id`` for the before/after slider.
    Once no original is left, the newest improved photo comes alone (``before_id`` None): Trash
    deleting an original clears ``derived_from_id`` but the copy keeps its ``ai_kind``.
    """
    shown = f"v.ai_kind IS NOT NULL AND {_library('v')} AND {stack_top('v')} AND v.thumbnail_path IS NOT NULL"
    async with conn.execute(
        f"""
        SELECT v.id AS after_id, v.ai_kind, o.id AS before_id FROM photos v
        JOIN photos o ON o.id = v.derived_from_id
        WHERE {shown} AND COALESCE(o.is_encrypted, 0) = 0 AND o.thumbnail_path IS NOT NULL
        ORDER BY v.created_at DESC, v.id DESC LIMIT 1;
        """
    ) as cur:
        row = await cur.fetchone()
    if not row:
        async with conn.execute(
            f"SELECT v.id AS after_id, v.ai_kind, NULL AS before_id FROM photos v WHERE {shown} ORDER BY v.created_at DESC, v.id DESC LIMIT 1;"
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    async with conn.execute(f"SELECT COUNT(*) FROM photos v WHERE {shown};") as cur:
        total = (await cur.fetchone())[0]
    return {
        "before_id": row["before_id"],
        "after_id": row["after_id"],
        "kinds": [k for k in (row["ai_kind"] or "").split(",") if k],
        "total": total,
    }


async def people(conn: aiosqlite.Connection) -> Dict[str, Any]:
    """The people with most photos (close ones first), each with a face to show, and how many
    groups of faces are waiting for a name."""
    shown = f"{_library('ph')} AND {not_superseded('ph')}"
    async with conn.execute(
        f"""
        SELECT p.id, p.name, p.is_close_one, COUNT(DISTINCT ph.id) AS photo_count,
               (SELECT f2.id FROM faces f2 JOIN photos ph ON ph.id = f2.photo_id
                WHERE f2.person_id = p.id AND {shown}
                -- The cover is looked up by the face's own person: older SQLite can't sort by the outer row.
                ORDER BY (f2.id = (SELECT pc.cover_face_id FROM persons pc WHERE pc.id = f2.person_id)) DESC, f2.is_anchor_medoid DESC, f2.quality_score DESC LIMIT 1) AS face_id
        FROM persons p
        JOIN faces f ON f.person_id = p.id
        JOIN photos ph ON ph.id = f.photo_id AND {shown}
        GROUP BY p.id
        ORDER BY p.is_close_one DESC, photo_count DESC, p.id
        LIMIT ?;
        """,
        (TOP_PEOPLE,),
    ) as cur:
        top = [
            {"id": r["id"], "name": r["name"], "close": bool(r["is_close_one"]), "photo_count": r["photo_count"], "face_id": r["face_id"]}
            for r in await cur.fetchall()
        ]
    async with conn.execute(
        f"""
        SELECT COUNT(DISTINCT f.cluster_id) FROM faces f JOIN photos ph ON ph.id = f.photo_id
        WHERE f.person_id IS NULL AND f.cluster_id IS NOT NULL AND f.quality_score >= ? AND {shown};
        """,
        (NAMEABLE_FACE_QUALITY,),
    ) as cur:
        to_name = (await cur.fetchone())[0]
    return {"top": top, "to_name": to_name}


async def months(conn: aiosqlite.Connection, year: int) -> List[int]:
    """Tiles in each month of ``year``, as the Photos grid shows them (12 numbers), so a bar's
    number matches the month it opens. Like the grid, documents are counted."""
    counts = [0] * 12
    async with conn.execute(
        f"""
        SELECT CAST(strftime('%m', taken_at) AS INTEGER) AS mo, COUNT(*) AS n FROM photos
        WHERE {LIBRARY.format(a='photos')} AND {stack_top()}
          AND strftime('%Y', taken_at) = ?
        GROUP BY mo;
        """,
        (str(year),),
    ) as cur:
        for r in await cur.fetchall():
            if r["mo"] and 1 <= r["mo"] <= 12:
                counts[r["mo"] - 1] = r["n"]
    return counts


async def trash(conn: aiosqlite.Connection) -> Dict[str, int]:
    """How many library items are in Trash and their size."""
    async with conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM photos WHERE trashed_at IS NOT NULL AND COALESCE(is_encrypted, 0) = 0;"
    ) as cur:
        count, size = await cur.fetchone()
    return {"count": count, "bytes": size}


async def highlights(conn: aiosqlite.Connection, now: Optional[datetime.datetime] = None) -> Dict[str, Any]:
    """Everything the Dashboard tiles need, in one go."""
    now = now or datetime.datetime.now()
    return {
        "on_this_day": await on_this_day(conn, now),
        "just_added": await just_added(conn),
        "brought_back": await brought_back(conn),
        "people": await people(conn),
        "year": now.year,
        "months": await months(conn, now.year),
        "trash": await trash(conn),
    }
