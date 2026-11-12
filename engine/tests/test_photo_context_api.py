"""Tests for the viewer's details panel lookup: GET /api/photos/{id}/context (redesign R3)."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app


async def _photo(conn, *, encrypted=0, trashed=False, managed=1) -> int:
    name = f"ctx_{uuid.uuid4().hex}.jpg"
    cur = await conn.execute(
        "INSERT INTO photos (filename, filepath, file_hash, file_size, is_encrypted, trashed_at, is_managed, created_at) "
        "VALUES (?, ?, ?, 1, ?, ?, ?, '2026-11-09 10:00:00') RETURNING id;",
        (name, f"photos/{name}", uuid.uuid4().hex, encrypted, "2026-01-01" if trashed else None, managed),
    )
    return (await cur.fetchone())[0]


async def _person(conn, name) -> int:
    cur = await conn.execute("INSERT INTO persons (name) VALUES (?) RETURNING id;", (name,))
    return (await cur.fetchone())[0]


async def _face(conn, photo_id, person_id, quality) -> int:
    cur = await conn.execute(
        "INSERT INTO faces (photo_id, person_id, box_x, box_y, box_w, box_h, quality_score, embedding) "
        "VALUES (?, ?, 0, 0, 0.1, 0.1, ?, '[]') RETURNING id;",
        (photo_id, person_id, quality),
    )
    return (await cur.fetchone())[0]


async def _album(conn, name, photo_id, is_vault=0) -> int:
    cur = await conn.execute("INSERT INTO albums (name, is_vault) VALUES (?, ?) RETURNING id;", (name, is_vault))
    album_id = (await cur.fetchone())[0]
    await conn.execute("INSERT INTO photo_album (photo_id, album_id) VALUES (?, ?);", (photo_id, album_id))
    return album_id


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_context_lists_named_people_with_their_best_face_and_library_albums():
    await run_migrations()
    conn = await get_db_connection()
    try:
        photo = await _photo(conn)
        other = await _photo(conn)
        rohan = await _person(conn, "Rohan")
        asha = await _person(conn, "asha")
        stranger = await _person(conn, "Elsewhere")
        await _face(conn, photo, rohan, 0.4)
        best_rohan = await _face(conn, photo, rohan, 0.9)
        asha_face = await _face(conn, photo, asha, 0.5)
        await _face(conn, photo, None, 0.99)  # unnamed face: not listed
        await _face(conn, other, stranger, 0.9)  # someone in a different photo
        goa = await _album(conn, "Goa 2026", photo)
        await _album(conn, "Secret", photo, is_vault=1)
        await conn.commit()
    finally:
        await conn.close()

    async with _client() as client:
        res = await client.get(f"/api/photos/{photo}/context")
    assert res.status_code == 200
    data = res.json()
    assert data["people"] == [
        {"id": asha, "name": "asha", "face_id": asha_face},
        {"id": rohan, "name": "Rohan", "face_id": best_rohan},
    ]
    assert data["albums"] == [{"id": goa, "name": "Goa 2026"}]
    assert data["imported_at"] == "2026-11-09 10:00:00"
    assert data["copied_into_library"] is True


@pytest.mark.asyncio
async def test_context_refuses_vault_trashed_and_missing_photos():
    await run_migrations()
    conn = await get_db_connection()
    try:
        vaulted = await _photo(conn, encrypted=1)
        trashed = await _photo(conn, trashed=True)
        await conn.commit()
    finally:
        await conn.close()
    async with _client() as client:
        for pid in (vaulted, trashed, 999999999):
            assert (await client.get(f"/api/photos/{pid}/context")).status_code == 404
