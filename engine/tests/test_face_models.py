"""Tests for the permissively licensed face pipeline and its migration (backlog H9)."""

import io
import json
import secrets
import shutil

import numpy as np
import pytest
from PIL import Image

from engine.config import settings
from engine.database import get_db_connection, run_migrations
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


# ── Model integrity ───────────────────────────────────────────────────────────

def test_model_download_with_wrong_hash_is_refused(monkeypatch, tmp_path):
    monkeypatch.setattr(frs, "get_models_dir", lambda: tmp_path)

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(frs.urllib.request, "urlopen", lambda *a, **k: FakeResponse(b"tampered model bytes"))
    spec = {"file": "model.onnx", "url": "https://example.invalid/model.onnx", "sha256": "0" * 64, "license": "MIT"}
    with pytest.raises(IOError):
        frs._ensure_model(spec)
    assert list(tmp_path.iterdir()) == []  # No partial or tampered file left behind.


def test_model_already_present_and_valid_is_not_downloaded(monkeypatch, tmp_path):
    monkeypatch.setattr(frs, "get_models_dir", lambda: tmp_path)
    (tmp_path / "model.onnx").write_bytes(b"good")
    import hashlib
    spec = {"file": "model.onnx", "url": "x", "sha256": hashlib.sha256(b"good").hexdigest(), "license": "MIT"}
    monkeypatch.setattr(frs.urllib.request, "urlopen", lambda *a, **k: pytest.fail("should not download"))
    assert frs._ensure_model(spec) == tmp_path / "model.onnx"


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
    # New model finds A (slightly shifted) and a new face; it misses C and B.
    new = [_new_face(0.11, 0.21), _new_face(0.40, 0.60)]
    inserted, deleted = await worker.save_scanned_faces(conn, env["photo_id"], new, env["folder"])
    await conn.commit()

    assert inserted == 2
    assert sorted(deleted) == sorted([ids["A"], ids["B"]])  # A replaced, B (unnamed) replaced.
    rows = {r["id"]: r for r in await _faces(conn, env["photo_id"])}
    new_rows = [r for r in rows.values() if r["embedding_model"] == frs.EMBEDDING_MODEL]
    assert sorted(r["person_id"] for r in new_rows if r["person_id"]) == [env["asha"]]  # Asha's name carried over.
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
