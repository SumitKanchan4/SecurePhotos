"""Tests for 'Same person?' merge suggestions on the People screen (redesign R5)."""

import json
import uuid

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.face_recognition_service import EMBEDDING_MODEL
from engine.services.people_merge_service import SUGGESTION_SIMILARITY, centroid, rank_merge_suggestions

DIM = 128


def unit(seed: int, base: np.ndarray | None = None, mix: float = 0.0) -> np.ndarray:
    """A random unit vector; with `base`, (1 - mix) * base + mix * noise, normalised."""
    rng = np.random.default_rng(seed)
    v = rng.normal(size=DIM).astype(np.float32)
    v /= np.linalg.norm(v)
    if base is not None:
        v = (1 - mix) * base + mix * v
        v /= np.linalg.norm(v)
    return v


# ── Pure ranking ─────────────────────────────────────────────────────────────

def test_centroid_normalises_and_handles_empty_input():
    c = centroid([[3, 0, 0], [0, 4, 0]])
    assert np.isclose(np.linalg.norm(c), 1.0)
    assert np.allclose(c, [np.sqrt(0.5), np.sqrt(0.5), 0], atol=1e-6)
    assert centroid([]) is None


def test_ranking_offers_each_group_once_to_its_most_alike_person():
    rohan, asha = unit(1), unit(2)
    groups = {
        "cluster_a": unit(10, rohan, 0.3),  # clearly Rohan
        "cluster_b": unit(11, asha, 0.5),   # probably Asha
        "cluster_c": unit(12),              # a stranger
    }
    ranked = rank_merge_suggestions({1: rohan, 2: asha}, groups, set())
    assert [(p, c) for p, c, _ in ranked] == [(1, "cluster_a"), (2, "cluster_b")]
    assert ranked[0][2] > ranked[1][2] >= SUGGESTION_SIMILARITY


def test_ranking_skips_a_turned_down_person_and_tries_the_next_one():
    rohan = unit(1)
    brother = unit(3, rohan, 0.35)  # looks a lot like Rohan
    group = unit(10, rohan, 0.25)
    ranked = rank_merge_suggestions({1: rohan, 3: brother}, {"cluster_a": group}, {(1, "cluster_a")})
    assert [(p, c) for p, c, _ in ranked] == [(3, "cluster_a")]
    assert rank_merge_suggestions({1: rohan}, {"cluster_a": group}, {(1, "cluster_a")}) == []


def test_ranking_respects_the_limit_and_empty_inputs():
    rohan = unit(1)
    groups = {f"cluster_{i}": unit(100 + i, rohan, 0.2) for i in range(8)}
    assert len(rank_merge_suggestions({1: rohan}, groups, set(), limit=5)) == 5
    assert rank_merge_suggestions({}, groups, set()) == []
    assert rank_merge_suggestions({1: rohan}, {}, set()) == []


# ── API ──────────────────────────────────────────────────────────────────────

async def _photo(conn, *, encrypted=0) -> int:
    name = f"pm_{uuid.uuid4().hex}.jpg"
    cur = await conn.execute(
        "INSERT INTO photos (filename, filepath, file_hash, file_size, is_encrypted) VALUES (?, ?, ?, 1, ?) RETURNING id;",
        (name, f"photos/{name}", uuid.uuid4().hex, encrypted),
    )
    return (await cur.fetchone())[0]


async def _face(conn, photo_id, vector, *, person_id=None, cluster_id=None, quality=0.9) -> int:
    cur = await conn.execute(
        "INSERT INTO faces (photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding, embedding_model) "
        "VALUES (?, ?, ?, 0, 0, 0.1, 0.1, ?, ?, ?) RETURNING id;",
        (photo_id, person_id, cluster_id, quality, json.dumps([float(x) for x in vector]), EMBEDDING_MODEL),
    )
    return (await cur.fetchone())[0]


async def _clear_people(conn):
    await conn.execute("DELETE FROM faces;")
    await conn.execute("DELETE FROM persons;")


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_suggest_reject_survives_reclustering_and_merge():
    await run_migrations()
    rohan_vec = unit(1)
    tag = uuid.uuid4().hex[:6]
    conn = await get_db_connection()
    try:
        await _clear_people(conn)
        rohan = (await (await conn.execute("INSERT INTO persons (name) VALUES (?) RETURNING id;", (f"Rohan {tag}",))).fetchone())[0]
        for i in range(3):
            await _face(conn, await _photo(conn), unit(20 + i, rohan_vec, 0.2), person_id=rohan)
        group_a = [await _face(conn, await _photo(conn), unit(30 + i, rohan_vec, 0.3), cluster_id="cluster_7") for i in range(2)]
        # A group that exists only in vault photos is never suggested (or listed).
        await _face(conn, await _photo(conn, encrypted=1), unit(40, rohan_vec, 0.2), cluster_id="cluster_9")
        await conn.commit()
    finally:
        await conn.close()

    async with _client() as client:
        res = await client.get("/api/people/merge-suggestions")
        assert res.status_code == 200
        suggestions = res.json()
        assert [(s["person_id"], s["cluster_id"]) for s in suggestions] == [(rohan, "cluster_7")]
        first = suggestions[0]
        assert first["person_photo_count"] == 3 and first["cluster_photo_count"] == 2
        assert first["cluster_face_id"] in group_a and first["person_face_id"] is not None
        # Several examples per side, one per photo (round 1, #24).
        assert sorted(first["cluster_face_ids"]) == sorted(group_a) and first["cluster_face_ids"][0] == first["cluster_face_id"]
        assert len(first["person_face_ids"]) == 3 and first["person_face_ids"][0] == first["person_face_id"]
        assert first["similarity"] >= SUGGESTION_SIMILARITY

        clusters = (await client.get("/api/people/clusters")).json()
        assert "cluster_9" not in [c["cluster_id"] for c in clusters]

        # "Not the same" hides it, and still does after the groups are renumbered.
        assert (await client.post("/api/people/merge-suggestions/reject", json={"person_id": rohan, "cluster_id": "cluster_7"})).json()["faces_remembered"] == 2
        assert (await client.get("/api/people/merge-suggestions")).json() == []
        conn = await get_db_connection()
        try:
            await conn.execute("UPDATE faces SET cluster_id = 'cluster_2' WHERE cluster_id = 'cluster_7';")
            await conn.commit()
        finally:
            await conn.close()
        assert (await client.get("/api/people/merge-suggestions")).json() == []

        # "Yes, merge" moves the group's faces to the person and keeps the name.
        merged = await client.post(f"/api/people/{rohan}/merge-cluster", json={"cluster_id": "cluster_2"})
        assert merged.status_code == 200
        assert merged.json()["faces_merged"] == 2 and merged.json()["photo_count"] == 5
        people = {p["id"]: p for p in (await client.get("/api/people")).json()}
        assert people[rohan]["name"] == f"Rohan {tag}" and people[rohan]["confirmed_count"] == 5

        assert (await client.post("/api/people/999999/merge-cluster", json={"cluster_id": "cluster_2"})).status_code == 404


@pytest.mark.asyncio
async def test_people_reset_forgets_turned_down_suggestions():
    await run_migrations()
    conn = await get_db_connection()
    try:
        await _clear_people(conn)
        pid = (await (await conn.execute("INSERT INTO persons (name) VALUES ('Asha') RETURNING id;")).fetchone())[0]
        face = await _face(conn, await _photo(conn), unit(5), cluster_id="cluster_1")
        await conn.execute("INSERT INTO person_face_rejections (person_id, face_id) VALUES (?, ?);", (pid, face))
        await conn.commit()
    finally:
        await conn.close()
    async with _client() as client:
        assert (await client.post("/api/people/reset")).status_code == 200
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT COUNT(*) FROM person_face_rejections;") as cur:
            assert (await cur.fetchone())[0] == 0
    finally:
        await conn.close()
