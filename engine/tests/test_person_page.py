"""Person page (R10): profile photo, Close one for family members, photo states."""

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app


@pytest.fixture
async def person():
    """A person 'Kavya' (Family) in two library photos, plus one vault photo and one photo without her."""
    await run_migrations()
    tag = uuid.uuid4().hex[:8]
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO persons (name, relationship_type, is_close_one, confirmed_count) VALUES (?, 'Family', 1, 2);",
            (f"Kavya {tag}",),
        )
        person_id = cur.lastrowid
        photos = {}
        for key, encrypted in (("a", 0), ("b", 0), ("vault", 1), ("other", 0)):
            cur = await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, is_optimized, taken_at) "
                "VALUES (?, ?, 10, 'image/jpeg', ?, 1, '2026-05-01 10:00:00');",
                (f"r10_{key}_{tag}.jpg", f"/dummy/r10_{key}_{tag}.jpg", encrypted),
            )
            photos[key] = cur.lastrowid
        faces = {}
        for key in ("a", "b", "vault"):
            cur = await conn.execute(
                "INSERT INTO faces (photo_id, person_id, box_x, box_y, box_w, box_h, quality_score, embedding) "
                "VALUES (?, ?, 0.1, 0.1, 0.2, 0.2, 0.9, ?);",
                (photos[key], person_id, json.dumps([0.0] * 128)),
            )
            faces[key] = cur.lastrowid
        await conn.execute("UPDATE persons SET cover_face_id = ? WHERE id = ?;", (faces["a"], person_id))
        await conn.commit()
    finally:
        await conn.close()
    yield {"id": person_id, "photos": photos, "faces": faces}
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM persons WHERE id = ?;", (person_id,))
        await conn.execute(f"DELETE FROM photos WHERE id IN ({','.join('?' * len(photos))});", list(photos.values()))
        await conn.commit()
    finally:
        await conn.close()


async def _cover(person_id):
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT cover_face_id FROM persons WHERE id = ?;", (person_id,)) as cur:
            return (await cur.fetchone())["cover_face_id"]
    finally:
        await conn.close()


async def test_choose_profile_photo(person):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(f"/api/people/{person['id']}/cover", json={"photo_id": person["photos"]["b"]})
        assert res.status_code == 200
        assert await _cover(person["id"]) == person["faces"]["b"]
        # A photo she isn't in, or a vault photo, can't become her profile photo.
        for key in ("other", "vault"):
            res = await client.post(f"/api/people/{person['id']}/cover", json={"photo_id": person["photos"][key]})
            assert res.status_code == 404
        assert await _cover(person["id"]) == person["faces"]["b"]


async def test_close_one_can_be_turned_off_for_family(person):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.patch(f"/api/people/{person['id']}", json={"is_close_one": False})
        assert res.json()["is_close_one"] is False
        # Renaming keeps it off (the relationship isn't changing).
        res = await client.patch(f"/api/people/{person['id']}", json={"name": "Kavya R"})
        assert res.json()["is_close_one"] is False
        # Changing the relationship to Friends and back to Family promotes her again.
        await client.patch(f"/api/people/{person['id']}", json={"relationship_type": "Friends"})
        res = await client.patch(f"/api/people/{person['id']}", json={"relationship_type": "Family"})
        assert res.json()["is_close_one"] is True


async def test_person_photos_say_whether_videos_are_ready(person):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/api/people/{person['id']}/photos")
    rows = res.json()
    assert sorted(r["id"] for r in rows) == sorted([person["photos"]["a"], person["photos"]["b"]])
    assert all(r["is_optimized"] == 1 for r in rows)
