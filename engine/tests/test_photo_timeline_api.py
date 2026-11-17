"""Tests for the compact photo timeline and the details lookup (redesign R2).

The photo grid used to load only the newest 500 photos. It now loads every library
photo as compact rows from /api/photos/timeline and fetches full records with
/api/photos/details only for the photos around the one being opened.
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from engine.api.photos import (
    DETAILS_MAX_IDS,
    TIMELINE_ENHANCED,
    TIMELINE_FAVORITE,
    TIMELINE_OPTIMIZED,
    TIMELINE_PREPARING,
)
from engine.database import get_db_connection, run_migrations
from engine.main import app


async def _insert(
    taken_at=None,
    *,
    mime="image/jpeg",
    width=4000,
    height=3000,
    favorite=0,
    optimized=0,
    enhanced=0,
    encrypted=0,
    trashed=False,
) -> int:
    conn = await get_db_connection()
    try:
        name = f"tl_{uuid.uuid4().hex}.jpg"
        cursor = await conn.execute(
            """
            INSERT INTO photos (
                filename, filepath, file_hash, file_size, mime_type, width, height, taken_at,
                is_favorite, is_optimized, is_enhanced, is_encrypted, trashed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id;
            """,
            (
                name, f"photos/{name}", uuid.uuid4().hex, 1234, mime, width, height, taken_at,
                favorite, optimized, enhanced, encrypted, "2026-01-01 00:00:00" if trashed else None,
            ),
        )
        photo_id = (await cursor.fetchone())[0]
        await conn.commit()
        return photo_id
    finally:
        await conn.close()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_timeline_returns_compact_rows_in_display_order():
    await run_migrations()
    older = await _insert("2024-03-01 10:00:00", width=3000, height=4000)
    newer = await _insert("2026-05-14 10:00:00", favorite=1, enhanced=1)
    video = await _insert("2025-07-01 09:00:00", mime="video/mp4", optimized=1)
    undated = await _insert(None, width=None, height=None)
    trashed = await _insert("2026-06-01 00:00:00", trashed=True)
    vaulted = await _insert("2026-06-02 00:00:00", encrypted=1)

    async with _client() as client:
        res = await client.get("/api/photos/timeline")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == len(data["items"])

    rows = {row[0]: row for row in data["items"]}
    assert trashed not in rows and vaulted not in rows

    # After-import P4: these test rows haven't been through the after-import steps, so they are
    # still "preparing" (16): text, faces and the old-photo check not done.
    assert rows[newer] == [newer, "2026-05-14 10:00:00", 4000, 3000, "p", TIMELINE_FAVORITE | TIMELINE_ENHANCED | TIMELINE_PREPARING]
    assert rows[video][4] == "v" and rows[video][5] == TIMELINE_OPTIMIZED | TIMELINE_PREPARING
    assert rows[older][2:4] == [3000, 4000]
    # Missing dimensions come back as 0 so the grid can fall back to a square tile.
    assert rows[undated][1] is None and rows[undated][2:4] == [0, 0]

    # Same order as the old list endpoint: newest first, undated last.
    order = [row[0] for row in data["items"] if row[0] in (older, newer, video, undated)]
    assert order == [newer, video, older, undated]


@pytest.mark.asyncio
async def test_timeline_is_not_capped_like_the_old_list():
    await run_migrations()
    conn = await get_db_connection()
    try:
        await conn.executemany(
            "INSERT INTO photos (filename, filepath, file_hash, file_size, mime_type, taken_at) VALUES (?, ?, ?, 1, 'image/jpeg', '2020-01-01 00:00:00');",
            [(f"bulk_{i}.jpg", f"photos/bulk_{uuid.uuid4().hex}.jpg", uuid.uuid4().hex) for i in range(1100)],
        )
        await conn.commit()
        async with conn.execute("SELECT COUNT(*) FROM photos WHERE is_encrypted = 0 AND trashed_at IS NULL;") as cur:
            expected = (await cur.fetchone())[0]
    finally:
        await conn.close()

    async with _client() as client:
        res = await client.get("/api/photos/timeline")
    assert res.json()["total"] == expected
    assert expected > 1000


@pytest.mark.asyncio
async def test_details_keep_the_requested_order_and_skip_hidden_photos():
    await run_migrations()
    a = await _insert("2026-01-01 00:00:00", favorite=1)
    b = await _insert("2025-01-01 00:00:00", mime="video/mp4")
    trashed = await _insert("2026-02-01 00:00:00", trashed=True)
    vaulted = await _insert("2026-02-02 00:00:00", encrypted=1)

    async with _client() as client:
        res = await client.get("/api/photos/details", params={"ids": f"{b},{trashed},{a},{vaulted},999999999"})
    assert res.status_code == 200
    data = res.json()
    assert [p["id"] for p in data] == [b, a]
    assert data[0]["mime_type"] == "video/mp4"
    assert data[1]["is_favorite"] is True
    assert data[1]["original_file_size"] == 1234  # falls back to file_size


@pytest.mark.asyncio
async def test_details_reject_bad_or_oversized_requests():
    async with _client() as client:
        bad = await client.get("/api/photos/details", params={"ids": "1,abc"})
        too_many = await client.get("/api/photos/details", params={"ids": ",".join(str(i) for i in range(DETAILS_MAX_IDS + 1))})
        empty = await client.get("/api/photos/details", params={"ids": ""})
    assert bad.status_code == 400
    assert too_many.status_code == 400
    assert empty.status_code == 200 and empty.json() == []
