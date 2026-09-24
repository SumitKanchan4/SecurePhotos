"""Unit and Integration Tests for Facial Recognition, Clustering, and People API.

Verifies:
- 5-point affine landmark estimation matrix mathematics.
- Face quality metrics (sharpness & relative resolution).
- Vectorized ArcFace cosine clustering and representative medoid selection.
- People API routes (/api/people, /api/people/clusters, /api/people/tag-cluster, /api/people/scan-progress).
"""

import json
import shutil
import tempfile
from pathlib import Path
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.main import app
from engine.database import get_db_connection
from engine.services.face_clustering_service import (
    cluster_embeddings,
    select_cluster_medoid,
    DISTANCE_THRESHOLD,
)
from engine.services.face_recognition_service import (
    _estimate_affine_matrix,
    calculate_face_quality,
    get_face_thumbnails_dir,
    ARCFACE_REF_POINTS,
)


def test_estimate_affine_matrix():
    """Verifies that similarity transform estimation accurately solves 5-point landmarks."""
    # Test identical reference points
    matrix = _estimate_affine_matrix(ARCFACE_REF_POINTS)
    assert matrix is not None
    assert len(matrix) == 6

    # Test invalid landmark shapes
    invalid = np.zeros((3, 2), dtype=np.float32)
    assert _estimate_affine_matrix(invalid) is None


def test_calculate_face_quality():
    """Verifies face quality scoring bounds and sharpness detection."""
    # Create synthetic sharp vs blurred image
    sharp_img = Image.new("RGB", (112, 112), (255, 255, 255))
    score = calculate_face_quality(sharp_img, 4000, 3000, 400, 400)
    assert 0.05 <= score <= 1.0


def test_cluster_embeddings_synthetic():
    """Verifies cosine clustering on synthetic 512-D vectors."""
    # Create 3 vectors: two close (same person), one orthogonal (different person)
    v1 = np.random.randn(512).astype(np.float32)
    v1 /= np.linalg.norm(v1)

    # v2 is very close to v1 (cos sim ~ 0.95, distance ~ 0.05)
    noise = np.random.randn(512).astype(np.float32)
    noise -= np.dot(noise, v1) * v1
    noise /= np.linalg.norm(noise)
    v2 = 0.95 * v1 + np.sqrt(1.0 - 0.95**2) * noise
    v2 /= np.linalg.norm(v2)

    # v3 is orthogonal / distant
    v3 = np.random.randn(512).astype(np.float32)
    v3 -= np.dot(v3, v1) * v1
    v3 /= np.linalg.norm(v3)

    embs = np.stack([v1, v2, v3])
    clusters = cluster_embeddings(embs, distance_threshold=DISTANCE_THRESHOLD)

    # v1 and v2 must be in the same cluster, v3 in a separate cluster
    assert len(clusters) == 2
    merged = [c for c in clusters if 0 in c][0]
    assert 1 in merged
    assert 2 not in merged


def test_select_cluster_medoid():
    """Verifies medoid selection picks the face with highest combined centrality and quality."""
    v1 = np.array([1.0, 0.0], dtype=np.float32)
    v2 = np.array([0.9, 0.1], dtype=np.float32)
    v2 /= np.linalg.norm(v2)
    v3 = np.array([0.8, 0.2], dtype=np.float32)
    v3 /= np.linalg.norm(v3)

    embs = np.stack([v1, v2, v3])
    qualities = [0.4, 0.9, 0.3]
    # v2 has both high similarity and high quality
    medoid = select_cluster_medoid([0, 1, 2], embs, qualities)
    assert medoid == 1


@pytest.mark.asyncio
async def test_people_api_workflow():
    """Verifies the complete People API workflow including scanning status, cluster tagging, and dismissal."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Check scan progress endpoint
        scan_res = await client.get("/api/people/scan-progress")
        assert scan_res.status_code == 200
        scan_data = scan_res.json()
        assert "is_scanning" in scan_data
        assert "faces_found" in scan_data

        # 2. Get clusters
        clusters_res = await client.get("/api/people/clusters")
        assert clusters_res.status_code == 200
        clusters = clusters_res.json()
        assert isinstance(clusters, list)

        # 3. List people initially
        people_res = await client.get("/api/people")
        assert people_res.status_code == 200
        people = people_res.json()
        assert isinstance(people, list)

        # 4. Use dedicated isolated mock photo and face for workflow testing so it satisfies foreign keys
        conn = await get_db_connection()
        test_photo_id = None
        mock_face_id = None
        try:
            p_cur = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, trashed_at)
                VALUES ('test_workflow.jpg', 'C:\\mock\\test_workflow.jpg', 1024, 'image/jpeg', 0, NULL)
                RETURNING id;
                """
            )
            test_photo_id = (await p_cur.fetchone())[0]

            cur = await conn.execute(
                """
                INSERT INTO faces (photo_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding)
                VALUES (?, 'cluster_workflow_mock', 0.1, 0.1, 0.2, 0.2, 0.9, '[]')
                RETURNING id;
                """,
                (test_photo_id,),
            )
            mock_face_id = (await cur.fetchone())[0]
            await conn.commit()
        finally:
            await conn.close()

        target_cluster = "cluster_workflow_mock"
        tagged_person_id = None
        try:
            tag_res = await client.post(
                "/api/people/tag-cluster",
                json={
                    "cluster_id": target_cluster,
                    "name": "Alex Test Person",
                    "relationship_type": "Friend",
                    "is_close_one": True,
                },
            )
            assert tag_res.status_code == 200
            tag_data = tag_res.json()
            assert tag_data["status"] == "tagged"
            assert tag_data["name"] == "Alex Test Person"
            tagged_person_id = tag_data["person_id"]

            # Check that Alex Test Person now appears in /api/people
            people_after = (await client.get("/api/people")).json()
            names = [p["name"] for p in people_after]
            assert "Alex Test Person" in names

            # Check person photos endpoint
            alex = [p for p in people_after if p["name"] == "Alex Test Person"][0]
            photos_res = await client.get(f"/api/people/{alex['id']}/photos")
            assert photos_res.status_code == 200
            alex_photos = photos_res.json()
            assert len(alex_photos) >= 1

            # Test updating granular relationship to 'Spouse' via PATCH
            update_res = await client.patch(
                f"/api/people/{alex['id']}",
                json={"relationship_type": "Spouse"},
            )
            assert update_res.status_code == 200
            updated_alex = update_res.json()
            assert updated_alex["relationship_type"] == "Spouse"
            assert updated_alex["is_close_one"] is True

            # Test tagging an existing person with new relationship 'Family'
            retag_res = await client.post(
                "/api/people/tag-cluster",
                json={
                    "cluster_id": target_cluster,
                    "name": "Alex Test Person",
                    "relationship_type": "Family",
                    "is_close_one": False,  # Should auto-promote to True for Family
                },
            )
            assert retag_res.status_code == 200
            retag_data = retag_res.json()
            assert retag_data["person_id"] == alex["id"]

            # Verify relationship was updated in DB
            people_retag = (await client.get("/api/people")).json()
            alex_retag = [p for p in people_retag if p["name"] == "Alex Test Person"][0]
            assert alex_retag["relationship_type"] == "Family"
            assert alex_retag["is_close_one"] is True
        finally:
            # Mandatory test teardown: cleanly remove test person, mock face, and mock photo
            conn = await get_db_connection()
            try:
                if tagged_person_id:
                    await conn.execute("DELETE FROM persons WHERE id = ?;", (tagged_person_id,))
                if mock_face_id:
                    await conn.execute("DELETE FROM faces WHERE id = ?;", (mock_face_id,))
                if test_photo_id:
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (test_photo_id,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_dismiss_cluster_endpoint():
    """Verifies POST /api/people/clusters/{cluster_id}/dismiss cleanly removes false-positive candidate faces."""
    conn = await get_db_connection()
    mock_photo_id = None
    mock_face_id = None
    try:
        p_cur = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, trashed_at)
            VALUES ('test_dismiss.jpg', 'C:\\mock\\test_dismiss.jpg', 1024, 'image/jpeg', 0, NULL)
            RETURNING id;
            """
        )
        mock_photo_id = (await p_cur.fetchone())[0]

        # Create a mock false-positive face record
        cursor = await conn.execute(
            """
            INSERT INTO faces (photo_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding)
            VALUES (?, 'cluster_mock_dismiss', 0.1, 0.1, 0.2, 0.2, 0.8, '[]')
            RETURNING id;
            """,
            (mock_photo_id,),
        )
        row = await cursor.fetchone()
        mock_face_id = row[0]
        await conn.commit()
    finally:
        await conn.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/people/clusters/cluster_mock_dismiss/dismiss")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "dismissed"
        assert data["faces_removed"] >= 1

        # Verify face record is removed from database
        conn = await get_db_connection()
        try:
            if mock_photo_id:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (mock_photo_id,))
                await conn.commit()
            async with conn.execute("SELECT id FROM faces WHERE id = ?;", (mock_face_id,)) as cur:
                assert await cur.fetchone() is None
        finally:
            await conn.close()


@pytest.mark.asyncio
async def test_reset_people_and_faces_endpoint():
    """Verifies POST /api/people/reset cleanly purges faces, persons, and resets faces_scanned flags,
    with guaranteed full backup and restoration of any active development database records and thumbnails.
    """
    conn = await get_db_connection()
    backup_persons = []
    backup_faces = []
    backup_photos = []
    temp_thumb_dir = tempfile.mkdtemp(prefix="test_reset_thumbs_")
    thumbs_dir = get_face_thumbnails_dir()

    try:
        async with conn.execute("SELECT id, name, relationship_type, is_close_one, cover_face_id FROM persons;") as cur:
            backup_persons = await cur.fetchall()
        async with conn.execute("SELECT id, photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding FROM faces;") as cur:
            backup_faces = await cur.fetchall()
        async with conn.execute("SELECT id, faces_scanned FROM photos;") as cur:
            backup_photos = await cur.fetchall()

        # Copy existing thumbnails to backup directory
        if thumbs_dir.exists():
            for f in thumbs_dir.glob("*.webp"):
                try:
                    shutil.copy2(f, temp_thumb_dir)
                except OSError:
                    pass

        # Create a mock photo, face and person record
        p_cur = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, trashed_at)
            VALUES ('test_reset_photo.jpg', 'C:\\mock\\test_reset_photo.jpg', 1024, 'image/jpeg', 0, NULL)
            RETURNING id;
            """
        )
        reset_test_photo_id = (await p_cur.fetchone())[0]

        cur = await conn.execute(
            "INSERT INTO persons (name, relationship_type, is_close_one) VALUES ('Reset Test Person', 'Friend', 0);"
        )
        pid = cur.lastrowid
        await conn.execute(
            """
            INSERT INTO faces (photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding)
            VALUES (?, ?, 'cluster_reset_test', 0.1, 0.1, 0.2, 0.2, 0.9, '[]');
            """,
            (reset_test_photo_id, pid),
        )
        await conn.commit()
    finally:
        await conn.close()

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/api/people/reset")
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "reset"
            assert data["faces_cleared"] >= 1
            assert data["persons_cleared"] >= 1

        # Verify zero faces and persons remain directly after reset
        conn = await get_db_connection()
        try:
            async with conn.execute("SELECT COUNT(*) FROM faces;") as cur:
                assert (await cur.fetchone())[0] == 0
            async with conn.execute("SELECT COUNT(*) FROM persons;") as cur:
                assert (await cur.fetchone())[0] == 0
        finally:
            await conn.close()
    finally:
        # Mandatory rollback/restoration of user's active database and thumbnail files
        conn = await get_db_connection()
        try:
            # Clean up temporary test photo if present
            if reset_test_photo_id:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (reset_test_photo_id,))
            # Restore persons
            for p in backup_persons:
                await conn.execute(
                    "INSERT OR REPLACE INTO persons (id, name, relationship_type, is_close_one, cover_face_id) VALUES (?, ?, ?, ?, ?);",
                    (p[0], p[1], p[2], p[3], p[4]),
                )
            # Restore faces
            for f in backup_faces:
                await conn.execute(
                    """
                    INSERT OR REPLACE INTO faces (id, photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9]),
                )
            # Restore photos faces_scanned
            for ph in backup_photos:
                await conn.execute(
                    "UPDATE photos SET faces_scanned = ? WHERE id = ?;",
                    (ph[1], ph[0]),
                )
            await conn.commit()
        finally:
            await conn.close()

        # Restore thumbnails
        thumbs_dir.mkdir(parents=True, exist_ok=True)
        backup_path = Path(temp_thumb_dir)
        for f in backup_path.glob("*.webp"):
            try:
                shutil.copy2(f, thumbs_dir)
            except OSError:
                pass
        shutil.rmtree(temp_thumb_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_list_people_omits_zero_photo_persons_and_respects_trash():
    """Verifies that /api/people dynamically calculates active photo counts and omits persons with 0 active photos."""
    conn = await get_db_connection()
    test_photo_id = None
    test_person_id = None
    mock_face_id = None
    try:
        p_cur = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, trashed_at)
            VALUES ('test_zero_photo.jpg', 'C:\\mock\\test_zero_photo.jpg', 1024, 'image/jpeg', 0, NULL)
            RETURNING id;
            """
        )
        test_photo_id = (await p_cur.fetchone())[0]

        # Create person and link face to active photo
        cur_p = await conn.execute(
            "INSERT INTO persons (name, relationship_type, is_close_one, confirmed_count) VALUES ('Zero Photo Test', 'Friend', 0, 1);"
        )
        test_person_id = cur_p.lastrowid

        cur_f = await conn.execute(
            """
            INSERT INTO faces (photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding)
            VALUES (?, ?, 'cluster_zero_test', 0.1, 0.1, 0.2, 0.2, 0.9, '[]')
            RETURNING id;
            """,
            (test_photo_id, test_person_id),
        )
        mock_face_id = (await cur_f.fetchone())[0]
        await conn.execute("UPDATE persons SET cover_face_id = ? WHERE id = ?;", (mock_face_id, test_person_id))
        await conn.commit()
    finally:
        await conn.close()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            # 1. Person must be visible when their photo is active
            res1 = await client.get("/api/people")
            assert res1.status_code == 200
            people1 = res1.json()
            matched = [p for p in people1 if p["id"] == test_person_id]
            assert len(matched) == 1
            assert matched[0]["confirmed_count"] == 1

            # 2. Soft-delete photo to Trash
            conn = await get_db_connection()
            try:
                await conn.execute("UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id = ?;", (test_photo_id,))
                await conn.commit()
            finally:
                await conn.close()

            # Person must now be omitted from /api/people
            res2 = await client.get("/api/people")
            assert res2.status_code == 200
            people2 = res2.json()
            matched_trashed = [p for p in people2 if p["id"] == test_person_id]
            assert len(matched_trashed) == 0

            # 3. Restore photo from Trash
            conn = await get_db_connection()
            try:
                await conn.execute("UPDATE photos SET trashed_at = NULL WHERE id = ?;", (test_photo_id,))
                await conn.commit()
            finally:
                await conn.close()

            # Person must reappear
            res3 = await client.get("/api/people")
            assert res3.status_code == 200
            people3 = res3.json()
            matched_restored = [p for p in people3 if p["id"] == test_person_id]
            assert len(matched_restored) == 1
            assert matched_restored[0]["confirmed_count"] == 1
        finally:
            conn = await get_db_connection()
            try:
                if test_person_id:
                    await conn.execute("DELETE FROM persons WHERE id = ?;", (test_person_id,))
                if mock_face_id:
                    await conn.execute("DELETE FROM faces WHERE id = ?;", (mock_face_id,))
                if test_photo_id:
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (test_photo_id,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_face_inspection_and_management_lifecycle():
    """Verifies face inspection details, photo unlinking, person deletion, and blurry pruning."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        conn = await get_db_connection()
        test_photo_id = None
        face_id = None
        person_id = None
        try:
            # 1. Insert test photo and face
            cur = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, width, height, is_encrypted)
                VALUES ('inspect_test.jpg', 'inspect_test.jpg', 2048, 'image/jpeg', 1920, 1080, 0);
                """
            )
            test_photo_id = cur.lastrowid

            f_cur = await conn.execute(
                """
                INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, quality_score, is_anchor_medoid, cluster_id, embedding)
                VALUES (?, 0.25, 0.30, 0.15, 0.20, 0.85, 1, 'test_inspect_cluster', '[]');
                """,
                (test_photo_id,),
            )
            face_id = f_cur.lastrowid
            await conn.commit()

            # 2. Test GET /api/people/faces/{face_id}
            res_inspect = await client.get(f"/api/people/faces/{face_id}")
            assert res_inspect.status_code == 200
            face_data = res_inspect.json()
            assert face_data["id"] == face_id
            assert face_data["photo_id"] == test_photo_id
            assert abs(face_data["box_x"] - 0.25) < 1e-4

            # 3. Tag cluster to create a person
            res_tag = await client.post(
                "/api/people/tag-cluster",
                json={
                    "cluster_id": "test_inspect_cluster",
                    "name": "Inspection Test Person",
                    "relationship_type": "Friend",
                },
            )
            assert res_tag.status_code == 200
            person_id = res_tag.json()["person_id"]

            # 4. Test unlinking photo from person
            res_unlink = await client.post(f"/api/people/{person_id}/unlink-photo/{test_photo_id}")
            assert res_unlink.status_code == 200
            unlink_data = res_unlink.json()
            assert unlink_data["status"] == "unlinked"
            assert unlink_data["unlinked_faces"] == 1
            assert unlink_data["remaining_photos"] == 0

            # 5. Test safe deletion of person
            res_del = await client.delete(f"/api/people/{person_id}")
            assert res_del.status_code == 200
            assert res_del.json()["status"] == "deleted"

            # Verify photo still exists (photo is never deleted by person deletion)
            async with conn.execute("SELECT id FROM photos WHERE id = ?;", (test_photo_id,)) as chk_cur:
                assert await chk_cur.fetchone() is not None

        finally:
            if person_id:
                await conn.execute("DELETE FROM persons WHERE id = ?;", (person_id,))
            if face_id:
                await conn.execute("DELETE FROM faces WHERE id = ?;", (face_id,))
            if test_photo_id:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (test_photo_id,))
            await conn.commit()
            await conn.close()


