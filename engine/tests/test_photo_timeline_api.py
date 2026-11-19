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
    TIMELINE_AI,
    TIMELINE_KIND_BITS,
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
    ai_kind=None,
    seconds=None,
) -> int:
    conn = await get_db_connection()
    try:
        name = f"tl_{uuid.uuid4().hex}.jpg"
        cursor = await conn.execute(
            """
            INSERT INTO photos (
                filename, filepath, file_hash, file_size, mime_type, width, height, taken_at,
                is_favorite, is_optimized, is_enhanced, is_encrypted, trashed_at, ai_kind, duration_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id;
            """,
            (
                name, f"photos/{name}", uuid.uuid4().hex, 1234, mime, width, height, taken_at,
                favorite, optimized, enhanced, encrypted, "2026-01-01 00:00:00" if trashed else None, ai_kind, seconds,
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
    # The step it is on is packed in too (2026-11-19): 1 = reading text.
    assert rows[newer] == [newer, "2026-05-14 10:00:00", 4000, 3000, "p", TIMELINE_FAVORITE | TIMELINE_ENHANCED | TIMELINE_PREPARING | (1 << 9), 0]
    assert rows[video][4] == "v" and rows[video][5] == TIMELINE_OPTIMIZED | TIMELINE_PREPARING | (2 << 9)  # Finding faces.
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


@pytest.mark.asyncio
async def test_timeline_tells_the_grid_what_an_improved_copy_had_done_and_how_long_videos_are():
    """Owner feedback 2026-11-18: the improved tag shows one icon per fix; videos show their length."""
    await run_migrations()
    copy = await _insert("2026-05-15 10:00:00", ai_kind="colour,scratches")
    video = await _insert("2025-07-02 09:00:00", mime="video/mp4", seconds=94.6)
    unmeasured = await _insert("2025-07-03 09:00:00", mime="video/mp4")
    async with _client() as client:
        rows = {row[0]: row for row in (await client.get("/api/photos/timeline")).json()["items"]}
    flags = rows[copy][5]
    assert flags & TIMELINE_AI
    assert flags & TIMELINE_KIND_BITS["colour"] and flags & TIMELINE_KIND_BITS["scratches"]
    assert not flags & TIMELINE_KIND_BITS["faces"] and not flags & TIMELINE_KIND_BITS["fade"]
    assert rows[video][6] == 95 and rows[unmeasured][6] == 0 and rows[copy][6] == 0


@pytest.mark.asyncio
async def test_videos_from_before_lengths_were_saved_are_measured_once():
    """A video with no length is measured in the background; one that can't be read gets 0 and isn't retried."""
    from engine.services.video_service import fill_video_durations

    await run_migrations()
    missing = await _insert("2025-07-04 09:00:00", mime="video/mp4")
    assert await fill_video_durations() >= 1
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT duration_seconds FROM photos WHERE id = ?;", (missing,)) as cur:
            assert (await cur.fetchone())[0] == 0
    finally:
        await conn.close()
    assert await fill_video_durations() == 0


@pytest.mark.asyncio
async def test_timeline_says_which_step_a_photo_being_prepared_is_on():
    """2026-11-19: the grid's ring names the step (1 text ... 5 enhancing; 0 once ready)."""
    from engine.api.photos import TIMELINE_STEP_SHIFT

    await run_migrations()
    photo = await _insert("2026-05-16 10:00:00")
    steps = [
        ("ocr_text = NULL", 1),
        ("ocr_text = ''", 2),
        ("faces_scanned = 1", 3),
        ("restore_checked = 1, thumbnail_path = 'thumbnails/x.webp'", 4),
        ("phash = 'abc'", 5),
        ("is_optimized = 1", 0),
    ]
    for change, expected in steps:
        conn = await get_db_connection()
        try:
            await conn.execute(f"UPDATE photos SET {change} WHERE id = ?;", (photo,))
            await conn.commit()
        finally:
            await conn.close()
        async with _client() as client:
            flags = {r[0]: r[5] for r in (await client.get("/api/photos/timeline")).json()["items"]}[photo]
        assert (flags >> TIMELINE_STEP_SHIFT) & 7 == expected, change
        assert bool(flags & TIMELINE_PREPARING) == (expected != 0)
