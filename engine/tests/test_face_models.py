"""Tests for the permissively licensed face pipeline and its migration (backlog H9)."""

import json
import secrets
import shutil

import numpy as np
import pytest
from PIL import Image
from httpx import ASGITransport, AsyncClient

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import face_recognition_service as frs
from engine.services import face_scan_worker as worker
from engine.services.face_clustering_service import recluster_all_faces


# ── YuNet decoding ────────────────────────────────────────────────────────────

def _empty_outputs():
    out = {}
    for stride in frs.YUNET_STRIDES:
        n = (frs.YUNET_INPUT // stride) ** 2
        out[f"cls_{stride}"] = np.zeros((1, n, 1), np.float32)
        out[f"obj_{stride}"] = np.zeros((1, n, 1), np.float32)
        out[f"bbox_{stride}"] = np.zeros((1, n, 4), np.float32)
        out[f"kps_{stride}"] = np.zeros((1, n, 10), np.float32)
    return out


def test_decode_yunet_box_score_and_landmarks():
    """One confident cell at stride 8, row 10, col 20 decodes like OpenCV's FaceDetectorYN."""
    out = _empty_outputs()
    cols = frs.YUNET_INPUT // 8
    idx = 10 * cols + 20
    out["cls_8"][0, idx, 0] = 0.81
    out["obj_8"][0, idx, 0] = 1.0
    out["bbox_8"][0, idx] = [0.5, 0.25, np.log(4.0), np.log(5.0)]  # centre offsets, log sizes
    out["kps_8"][0, idx] = [0, 0, 1, 0, 0.5, 0.5, 0, 1, 1, 1]
    out["cls_16"][0, 0, 0] = 0.2  # Below threshold after sqrt(cls*obj): ignored.
    out["obj_16"][0, 0, 0] = 0.2

    boxes, scores, kps = frs.decode_yunet(out)
    assert len(boxes) == 1
    assert scores[0] == pytest.approx(0.9)  # sqrt(0.81 * 1.0)
    cx, cy, w, h = (20 + 0.5) * 8, (10 + 0.25) * 8, 4 * 8, 5 * 8
    assert boxes[0] == pytest.approx([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2])
    assert kps[0][0] == pytest.approx([20 * 8, 10 * 8])
    assert kps[0][2] == pytest.approx([20.5 * 8, 10.5 * 8])


def test_decode_yunet_suppresses_overlapping_duplicates():
    out = _empty_outputs()
    cols = frs.YUNET_INPUT // 8
    for col, score in ((20, 0.9), (21, 0.8)):  # Neighbouring cells, nearly the same box.
        idx = 10 * cols + col
        out["cls_8"][0, idx, 0] = score ** 2
        out["obj_8"][0, idx, 0] = 1.0
        out["bbox_8"][0, idx] = [0.0 if col == 20 else -1.0, 0.0, np.log(6.0), np.log(6.0)]
    boxes, scores, _ = frs.decode_yunet(out)
    assert len(boxes) == 1 and scores[0] == pytest.approx(0.9)


# ── Alignment ─────────────────────────────────────────────────────────────────

def test_alignment_maps_landmarks_onto_template():
    """Landmarks that are a scaled/shifted template come back exactly onto the template."""
    landmarks = frs.ARCFACE_REF_POINTS * 3.0 + np.array([200.0, 150.0], np.float32)
    a, b, c, d, e, f = frs._estimate_affine_matrix(landmarks)
    for (tx, ty), (sx, sy) in zip(frs.ARCFACE_REF_POINTS, landmarks):
        assert (a * tx + b * ty + c, d * tx + e * ty + f) == pytest.approx((sx, sy), abs=1e-3)


def test_warp_samples_the_mapped_pixels():
    img = np.zeros((300, 300, 3), np.uint8)
    img[150:160, 100:110] = 255
    # Identity-like mapping shifted by (100, 150): output (0..9, 0..9) reads the white square.
    crop = np.asarray(frs.warp_to_template(img, (1, 0, 100, 0, 1, 150), size=20))
    assert crop[:10, :10].min() == 255 and crop[12:, 12:].max() == 0


# ── Grouping ──────────────────────────────────────────────────────────────────

def test_grouping_never_puts_two_faces_of_one_photo_together():
    """Look-alike background faces in one crowd photo must not chain into one 'person'."""
    from engine.services.face_clustering_service import cluster_embeddings

    base = np.zeros(8, np.float32)
    base[0] = 1.0
    near = np.array([0.95, 0.31, 0, 0, 0, 0, 0, 0], np.float32)
    near /= np.linalg.norm(near)
    embs = np.stack([base, near, base])  # All three very similar.
    # Without photos: one group. Faces 0 and 1 in the same photo: kept apart.
    assert cluster_embeddings(embs, distance_threshold=0.55) == [[0, 1, 2]]
    groups = cluster_embeddings(embs, distance_threshold=0.55, photo_ids=[10, 10, 20])
    assert all(not ({0, 1} <= set(g)) for g in groups)
    assert sorted(len(g) for g in groups) == [1, 2]


# Model integrity (download, checksum, bundled copy) is tested in test_ai_models.py (H8).


# ── Name-preserving face swap ─────────────────────────────────────────────────

def _new_face(x, y, w=0.1, h=0.1):
    return {
        "box_x": x, "box_y": y, "box_w": w, "box_h": h, "quality_score": 0.9,
        "embedding": [1.0] + [0.0] * (frs.EMBEDDING_DIM - 1), "embedding_model": frs.EMBEDDING_MODEL,
        "crop_thumbnail": Image.new("RGB", (8, 8)),
    }


@pytest.fixture
async def photo_with_legacy_faces():
    """A photo with three legacy (ArcFace) faces: two named (A, C) and one unnamed (B).

    Boxes are stored as float32 blobs, like the old scanner did.
    """
    await run_migrations()
    conn = await get_db_connection()
    folder = settings.thumbnails_dir / "faces"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('h9.jpg', ?, 1, 'image/jpeg');",
            (f"originals/h9_{secrets.token_hex(3)}.jpg",),
        )
        photo_id = cur.lastrowid
        cur = await conn.execute("INSERT INTO persons (name) VALUES ('Asha');")
        asha = cur.lastrowid
        cur = await conn.execute("INSERT INTO persons (name) VALUES ('Chirag');")
        chirag = cur.lastrowid
        blob = lambda v: np.float32(v).tobytes()  # noqa: E731
        ids = {}
        for key, person, x in (("A", asha, 0.10), ("B", None, 0.40), ("C", chirag, 0.70)):
            cur = await conn.execute(
                "INSERT INTO faces (photo_id, person_id, box_x, box_y, box_w, box_h, embedding) VALUES (?, ?, ?, ?, ?, ?, ?);",
                (photo_id, person, blob(x), blob(0.2), blob(0.1), blob(0.1), json.dumps([0.1] * 512)),
            )
            ids[key] = cur.lastrowid
            Image.new("RGB", (8, 8)).save(folder / f"{cur.lastrowid}.webp")
        await conn.commit()
        yield {"conn": conn, "photo_id": photo_id, "ids": ids, "asha": asha, "chirag": chirag, "folder": folder}
    finally:
        await conn.execute("DELETE FROM photos WHERE filename = 'h9.jpg';")
        await conn.execute("DELETE FROM persons WHERE name IN ('Asha', 'Chirag');")
        await conn.commit()
        await conn.close()


async def _faces(conn, photo_id):
    async with conn.execute(
        "SELECT id, person_id, embedding_model, typeof(box_x) AS t, embedding FROM faces WHERE photo_id = ? ORDER BY id;",
        (photo_id,),
    ) as cur:
        return await cur.fetchall()


async def test_rescan_carries_names_over_and_never_mixes_models(photo_with_legacy_faces):
    env = photo_with_legacy_faces
    conn, ids = env["conn"], env["ids"]
    await conn.execute("UPDATE persons SET cover_face_id = ? WHERE id = ?;", (ids["A"], env["asha"]))
    # New model finds A (slightly shifted) and a new face; it misses C and B.
    new = [_new_face(0.11, 0.21), _new_face(0.40, 0.60)]
    inserted, deleted = await worker.save_scanned_faces(conn, env["photo_id"], new, env["folder"])
    await conn.commit()

    assert inserted == 2
    assert sorted(deleted) == sorted([ids["A"], ids["B"]])  # A replaced, B (unnamed) replaced.
    rows = {r["id"]: r for r in await _faces(conn, env["photo_id"])}
    new_rows = [r for r in rows.values() if r["embedding_model"] == frs.EMBEDDING_MODEL]
    assert sorted(r["person_id"] for r in new_rows if r["person_id"]) == [env["asha"]]  # Asha's name carried over.
    # Asha's chosen profile face follows it to the replacement (2026-11-19).
    asha_face = next(r["id"] for r in new_rows if r["person_id"] == env["asha"])
    async with conn.execute("SELECT cover_face_id FROM persons WHERE id = ?;", (env["asha"],)) as cur:
        assert (await cur.fetchone())[0] == asha_face
    assert all(r["t"] == "real" for r in new_rows)  # Boxes stored as numbers, not blobs.

    kept = rows[ids["C"]]  # Chirag's face wasn't re-found: kept, but no legacy fingerprint.
    assert kept["person_id"] == env["chirag"]
    assert kept["embedding_model"] == worker.UNMATCHED_LEGACY_MODEL and kept["embedding"] == "[]"


async def test_rescan_with_same_model_keeps_unmatched_named_face_untouched(photo_with_legacy_faces):
    env = photo_with_legacy_faces
    conn = env["conn"]
    await worker.save_scanned_faces(conn, env["photo_id"], [_new_face(0.11, 0.21), _new_face(0.71, 0.21)], env["folder"])
    await conn.commit()
    # Second scan (same model) finds only Asha: Chirag's current-model face must stay as it is.
    before = {r["person_id"]: r for r in await _faces(conn, env["photo_id"]) if r["person_id"]}
    await worker.save_scanned_faces(conn, env["photo_id"], [_new_face(0.11, 0.21)], env["folder"])
    await conn.commit()
    after = {r["person_id"]: r for r in await _faces(conn, env["photo_id"]) if r["person_id"]}
    assert after[env["chirag"]]["id"] == before[env["chirag"]]["id"]
    assert after[env["chirag"]]["embedding_model"] == frs.EMBEDDING_MODEL
    assert len([r for r in await _faces(conn, env["photo_id"]) if r["person_id"] == env["asha"]]) == 1  # No duplicates.


async def test_grouping_ignores_fingerprints_from_other_models(photo_with_legacy_faces):
    env = photo_with_legacy_faces
    await worker.save_scanned_faces(env["conn"], env["photo_id"], [_new_face(0.5, 0.5)], env["folder"])
    await env["conn"].commit()
    result = await recluster_all_faces()  # Would fail stacking 512-D and 128-D vectors if mixed.
    assert result["status"] == "success"


async def test_rescan_marker_queues_photos_exactly_once(photo_with_legacy_faces):
    env = photo_with_legacy_faces
    conn = env["conn"]
    await conn.execute("DELETE FROM applied_migrations WHERE name = '2026_11_h9_rescan_faces_permissive_models';")
    await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (env["photo_id"],))
    await conn.commit()
    await run_migrations()
    async with conn.execute("SELECT faces_scanned FROM photos WHERE id = ?;", (env["photo_id"],)) as cur:
        assert (await cur.fetchone())[0] == 0
    await conn.execute("UPDATE photos SET faces_scanned = 1 WHERE id = ?;", (env["photo_id"],))
    await conn.commit()
    await run_migrations()
    async with conn.execute("SELECT faces_scanned FROM photos WHERE id = ?;", (env["photo_id"],)) as cur:
        assert (await cur.fetchone())[0] == 1


async def test_scan_is_postponed_not_skipped_when_models_unavailable(monkeypatch):
    await run_migrations()
    folder = settings.data_dir / "originals" / f"h9_{secrets.token_hex(3)}"
    folder.mkdir(parents=True)
    Image.new("RGB", (64, 64)).save(folder / "p.jpg")
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type, faces_scanned) VALUES ('h9p.jpg', ?, 1, 'image/jpeg', 0);",
            (f"originals/{folder.name}/p.jpg",),
        )
        photo_id = cur.lastrowid
        await conn.commit()

        def unavailable():
            raise IOError("offline")

        monkeypatch.setattr(frs, "get_inference_sessions", unavailable)
        result = await worker.run_background_face_scan()
        assert result["status"] == "postponed"
        async with conn.execute("SELECT faces_scanned FROM photos WHERE id = ?;", (photo_id,)) as cur:
            assert (await cur.fetchone())[0] == 0  # Still queued for when the models are available.
    finally:
        await conn.execute("DELETE FROM photos WHERE filename = 'h9p.jpg';")
        await conn.commit()
        await conn.close()
        shutil.rmtree(folder, ignore_errors=True)


def test_retire_old_models_deletes_only_retired_files(monkeypatch, tmp_path):
    monkeypatch.setattr(frs, "get_models_dir", lambda: tmp_path)
    for name in (*frs.RETIRED_MODEL_FILES, frs.FACE_MODELS["sface"]["file"], "realesr_general_x4v3.onnx"):
        (tmp_path / name).write_bytes(b"x")
    worker.retire_old_face_models()
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([frs.FACE_MODELS["sface"]["file"], "realesr_general_x4v3.onnx"])


async def test_not_a_face_is_removed_and_never_added_again(photo_with_legacy_faces):
    """Owner feedback 2026-11-18: a cushion was found as a face. 'Not a face' removes it and a
    rescan of the photo never brings it back; named faces can't be dismissed this way."""
    env = photo_with_legacy_faces
    conn, ids = env["conn"], env["ids"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post(f"/api/people/faces/{ids['A']}/dismiss")).status_code == 409  # Asha's face.
        res = await client.post(f"/api/people/faces/{ids['B']}/dismiss")
        assert res.json()["faces_removed"] == 1
        assert (await client.post(f"/api/people/faces/{ids['B']}/dismiss")).status_code == 404
    assert not (env["folder"] / f"{ids['B']}.webp").exists()

    # A rescan finds the same place (slightly shifted) and a real new face: only the new one is added.
    inserted, _ = await worker.save_scanned_faces(conn, env["photo_id"], [_new_face(0.41, 0.21), _new_face(0.40, 0.60)], env["folder"])
    await conn.commit()
    assert inserted == 1
    async with conn.execute("SELECT box_y FROM faces WHERE photo_id = ? AND person_id IS NULL;", (env["photo_id"],)) as cur:
        assert [round(r[0], 2) for r in await cur.fetchall()] == [0.6]


def test_sideways_faces_are_recognised_by_the_turn_that_lines_them_up():
    """Owner feedback 2026-11-19: faces found on a phone photo stored sideways (EXIF orientation 6)
    must be turned back; boxes that already line up are left alone."""
    upright_face = (0.30, 0.10, 0.60, 0.40)
    # The same face as found on the raw, sideways pixels (turning them clockwise gives upright).
    raw = (0.10, 0.40, 0.40, 0.70)
    assert worker.turn_box(raw, "cw") == pytest.approx(upright_face)
    assert worker.best_turn([raw], [upright_face]) == "cw"
    assert worker.best_turn([upright_face], [upright_face]) == "none"
    assert worker.best_turn([raw], []) == "none"  # Nothing found upright: leave it.
    assert worker.turn_box(worker.turn_box(raw, "cw"), "ccw") == pytest.approx(raw)


async def test_faces_are_found_on_the_upright_picture(monkeypatch, tmp_path):
    """The detector gets the photo turned upright by its EXIF orientation."""
    seen = []
    monkeypatch.setattr(worker, "detect_and_embed_faces", lambda img: seen.append(img.size) or [])
    path = tmp_path / "sideways.jpg"
    exif = Image.Exif()
    exif[0x0112] = 6
    Image.new("RGB", (400, 300)).save(path, exif=exif)  # Stored 400x300, shown 300x400.
    await run_migrations()
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('sideways.jpg', ?, 1, 'image/jpeg');", (str(path),)
        )
        row = {"id": cur.lastrowid, "filename": "sideways.jpg", "filepath": str(path), "mime_type": "image/jpeg",
               "thumbnail_path": None, "preview_path": None, "is_encrypted": 0}
        await worker.scan_photo_faces(conn, row, tmp_path)
        assert seen == [(300, 400)]
        await conn.execute("DELETE FROM photos WHERE id = ?;", (row["id"],))
        await conn.commit()
    finally:
        await conn.close()


async def test_two_scans_of_one_photo_at_once_never_save_its_faces_twice(photo_with_legacy_faces):
    """2026-11-21: two engines on one library found the same faces twice; the duplicates could
    never join a group (one person can't be twice in a photo), so each showed as its own card."""
    import asyncio

    env = photo_with_legacy_faces
    other = await get_db_connection()
    try:
        found = [_new_face(0.5, 0.5), _new_face(0.8, 0.5)]
        await worker.save_scanned_faces(env["conn"], env["photo_id"], found, env["folder"])  # First scan: not committed yet.
        second = asyncio.create_task(worker.save_scanned_faces(other, env["photo_id"], found, env["folder"]))
        await asyncio.sleep(0.3)
        assert not second.done()  # The second scan waits for the first to finish.
        await env["conn"].commit()
        await second
        await other.commit()
    finally:
        await other.close()
    async with env["conn"].execute(
        "SELECT ROUND(box_x, 2) FROM faces WHERE photo_id = ? AND person_id IS NULL ORDER BY box_x;", (env["photo_id"],)
    ) as cur:
        assert [r[0] for r in await cur.fetchall()] == [0.5, 0.8]  # Each face once.


def test_a_face_saved_twice_is_found_and_the_right_copy_kept():
    """2026-11-21 cleanup: named copies win, then the older one; two different names are left alone."""
    def face(fid, x, person=None):
        return {"id": fid, "person_id": person, "box_x": x, "box_y": 0.2, "box_w": 0.1, "box_h": 0.1}

    assert worker.duplicate_faces_to_remove([face(1, 0.1), face(2, 0.1)]) == [(2, 1)]
    assert worker.duplicate_faces_to_remove([face(1, 0.1), face(2, 0.1, person=7)]) == [(1, 2)]
    assert worker.duplicate_faces_to_remove([face(1, 0.1, person=7), face(2, 0.1, person=8)]) == []
    assert worker.duplicate_faces_to_remove([face(1, 0.1), face(2, 0.6)]) == []  # Two different faces.
    assert worker.duplicate_faces_to_remove([face(1, 0.1), face(2, 0.1), face(3, 0.1)]) == [(2, 1), (3, 1)]


async def test_duplicates_already_saved_are_removed_once(photo_with_legacy_faces):
    env = photo_with_legacy_faces
    conn = env["conn"]
    await conn.execute("DELETE FROM app_settings WHERE key = ?;", (worker.DUPLICATES_REPAIR_KEY,))
    asha_face = env["ids"]["A"]
    cur = await conn.execute(  # A second, unnamed copy of Asha's face.
        "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding) SELECT photo_id, box_x, box_y, box_w, box_h, embedding FROM faces WHERE id = ?;",
        (asha_face,),
    )
    copy_id = cur.lastrowid
    await conn.commit()
    assert await worker.remove_duplicate_faces() >= 1
    async with conn.execute("SELECT id FROM faces WHERE id IN (?, ?);", (asha_face, copy_id)) as c:
        assert [r[0] for r in await c.fetchall()] == [asha_face]
    assert await worker.remove_duplicate_faces() == 0  # Only once per library.


async def test_a_groups_id_stays_the_same_when_faces_are_regrouped(photo_with_legacy_faces):
    """2026-11-21: ids were positions, so a card loaded before a regrouping could close another group."""
    env = photo_with_legacy_faces
    conn = env["conn"]
    vec = json.dumps([1.0] + [0.0] * (frs.EMBEDDING_DIM - 1))
    photos = []
    for _ in range(3):
        cur = await conn.execute(
            "INSERT INTO photos (filename, filepath, file_size, mime_type) VALUES ('h9.jpg', ?, 1, 'image/jpeg');",
            (f"originals/h9_{secrets.token_hex(3)}.jpg",),
        )
        photos.append(cur.lastrowid)
    first = await conn.execute(
        "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding, embedding_model) VALUES (?, 0.1, 0.1, 0.2, 0.2, ?, ?);",
        (photos[0], vec, frs.EMBEDDING_MODEL),
    )
    first_id = first.lastrowid
    await conn.execute(
        "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding, embedding_model) VALUES (?, 0.1, 0.1, 0.2, 0.2, ?, ?);",
        (photos[1], vec, frs.EMBEDDING_MODEL),
    )
    await conn.commit()
    await recluster_all_faces()
    async with conn.execute("SELECT cluster_id FROM faces WHERE id = ?;", (first_id,)) as c:
        group = (await c.fetchone())[0]
    assert group == f"cluster_{first_id}"
    # A new photo of the same face joins the group; the group keeps its id.
    await conn.execute(
        "INSERT INTO faces (photo_id, box_x, box_y, box_w, box_h, embedding, embedding_model) VALUES (?, 0.1, 0.1, 0.2, 0.2, ?, ?);",
        (photos[2], vec, frs.EMBEDDING_MODEL),
    )
    await conn.commit()
    await recluster_all_faces()
    async with conn.execute("SELECT DISTINCT cluster_id FROM faces WHERE photo_id IN (?, ?, ?);", photos) as c:
        assert [r[0] for r in await c.fetchall()] == [group]
