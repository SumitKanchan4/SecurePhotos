"""Dashboard tiles (T32): /api/system/highlights and engine.services.highlights."""

import datetime
import itertools

import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import highlights as hl

NOW = datetime.datetime(2026, 11, 22, 12, 0, 0)
_seq = itertools.count(1)


@pytest.fixture
async def conn(tmp_path):
    db = tmp_path / "library.db"
    await run_migrations(db)
    c = await get_db_connection(db)
    try:
        yield c
    finally:
        await c.close()


async def add(conn, **cols) -> int:
    n = next(_seq)
    row = {
        "filename": f"p{n}.jpg",
        "filepath": f"originals/p{n}.jpg",
        "file_size": 1000,
        "mime_type": "image/jpeg",
        "thumbnail_path": f"thumbs/p{n}.webp",
        **cols,
    }
    keys = ",".join(row)
    cur = await conn.execute(f"INSERT INTO photos ({keys}) VALUES ({','.join('?' * len(row))});", tuple(row.values()))
    await conn.commit()
    return cur.lastrowid


async def test_on_this_day_picks_the_earlier_year_with_most_photos(conn):
    await add(conn, taken_at="2023-11-21 10:00:00")
    best = [await add(conn, taken_at=f"2023-11-2{d} 10:00:00") for d in (2, 3)]
    await add(conn, taken_at="2020-11-22 09:00:00")
    await add(conn, taken_at="2020-11-23 09:00:00")
    await add(conn, taken_at="2026-11-22 09:00:00")  # this year: never a memory
    await add(conn, taken_at="2023-06-01 09:00:00")  # another week
    await add(conn, taken_at="2023-11-22 11:00:00", is_encrypted=1)  # vault
    await add(conn, taken_at="2023-11-22 11:00:00", trashed_at="2026-11-01")
    got = await hl.on_this_day(conn, NOW)
    assert got["year"] == 2023 and got["years_ago"] == 3 and got["count"] == 3
    assert set(best) <= set(got["photo_ids"])


async def test_on_this_day_needs_two_photos(conn):
    await add(conn, taken_at="2023-11-22 10:00:00")
    assert await hl.on_this_day(conn, NOW) is None


async def test_just_added_counts_the_last_day_only(conn):
    a = await add(conn)  # created now
    await add(conn, mime_type="video/mp4", filename="v.mp4")
    await add(conn, created_at="2026-01-01 00:00:00")
    await add(conn, is_encrypted=1)
    await add(conn, derived_from_id=a, ai_kind="colour")  # improved copy: not an import
    got = await hl.just_added(conn)
    assert got["photos"] == 1 and got["videos"] == 1
    assert got["photo_ids"] == [a]
    assert got["preparing"] == 2  # nothing has been prepared yet in a bare test row


async def test_just_added_is_none_when_nothing_new(conn):
    await add(conn, created_at="2026-01-01 00:00:00")
    assert await hl.just_added(conn) is None


async def test_brought_back_pairs_the_newest_restored_photo_with_its_original(conn):
    old = await add(conn)
    await add(conn, derived_from_id=old, ai_kind="colour", created_at="2026-11-01 00:00:00")
    replaced = await add(conn, trashed_at="2026-11-20")  # original kept in Trash after Replace
    newest = await add(conn, derived_from_id=replaced, ai_kind="fade,colour", created_at="2026-11-21 00:00:00")
    vault_old = await add(conn, is_encrypted=1)
    await add(conn, derived_from_id=vault_old, ai_kind="colour", is_encrypted=1, created_at="2026-11-22 00:00:00")
    got = await hl.brought_back(conn)
    assert got == {"before_id": replaced, "after_id": newest, "kinds": ["fade", "colour"], "total": 2}


async def test_brought_back_is_none_without_restored_photos(conn):
    await add(conn)
    assert await hl.brought_back(conn) is None


async def test_people_close_ones_first_and_faces_to_name(conn):
    async def person(name, close=0):
        cur = await conn.execute("INSERT INTO persons (name, is_close_one) VALUES (?, ?);", (name, close))
        return cur.lastrowid

    async def face(photo, person_id=None, cluster=None, quality=0.9):
        cur = await conn.execute(
            "INSERT INTO faces (photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, embedding, quality_score) "
            "VALUES (?, ?, ?, 0, 0, 0.1, 0.1, '[]', ?);",
            (photo, person_id, cluster, quality),
        )
        return cur.lastrowid

    asha, ravi = await person("Asha"), await person("Ravi", close=1)
    photos = [await add(conn) for _ in range(3)]
    for p in photos:
        await face(p, asha)
    ravi_face = await face(photos[0], ravi)
    hidden = await add(conn, is_encrypted=1)
    await face(hidden, ravi)
    await face(photos[1], cluster="c1")
    await face(photos[2], cluster="c1")
    await face(photos[2], cluster="c2")
    await face(photos[2], cluster="blurry", quality=0.1)
    await face(hidden, cluster="c3")
    await conn.commit()
    got = await hl.people(conn)
    assert [p["name"] for p in got["top"]] == ["Ravi", "Asha"]
    assert got["top"][0] == {"id": ravi, "name": "Ravi", "close": True, "photo_count": 1, "face_id": ravi_face}
    assert got["top"][1]["photo_count"] == 3
    assert got["to_name"] == 2


async def test_months_counts_this_year_as_the_library_shows_it(conn):
    a = await add(conn, taken_at="2026-08-03 10:00:00")
    await add(conn, taken_at="2026-08-04 10:00:00", derived_from_id=a, ai_kind="colour")  # stacked: counts once
    await add(conn, taken_at="2026-01-15 10:00:00")
    await add(conn, taken_at="2025-08-03 10:00:00")
    await add(conn, taken_at="2026-08-05 10:00:00", is_document=1)  # the grid shows documents too
    await add(conn, taken_at="2026-08-05 10:00:00", trashed_at="2026-11-01")
    await add(conn, taken_at="2026-08-05 10:00:00", is_encrypted=1)
    got = await hl.months(conn, 2026)
    assert len(got) == 12 and got[0] == 1 and got[7] == 2 and sum(got) == 3


async def test_trash_totals(conn):
    await add(conn, trashed_at="2026-11-01", file_size=300)
    await add(conn, trashed_at="2026-11-01", file_size=200)
    await add(conn, trashed_at="2026-11-01", file_size=999, is_encrypted=1)
    await add(conn)
    assert await hl.trash(conn) == {"count": 2, "bytes": 500}


async def test_highlights_route_shape():
    await run_migrations()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/system/highlights")
    assert res.status_code == 200
    data = res.json()
    assert set(data) == {"on_this_day", "just_added", "brought_back", "people", "year", "months", "trash"}
    assert len(data["months"]) == 12
    assert set(data["people"]) == {"top", "to_name"}
