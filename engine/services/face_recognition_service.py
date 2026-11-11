"""Face detection, 5-point alignment and identity embeddings for People (backlog H9).

Models (permissively licensed, owner decision 2026-11-11):
- YuNet (OpenCV Zoo, MIT): finds faces and 5 landmarks.
- SFace (OpenCV Zoo, Apache-2.0): 128-D identity embedding of a 112x112 aligned face.

Both run on onnxruntime; the pre/post-processing mirrors OpenCV's
``FaceDetectorYN`` and ``FaceRecognizerSF`` so results match OpenCV's reference
implementation without shipping OpenCV. Model files are downloaded once and
verified by SHA-256 before use.

Replaced: YOLOv8-face (GPL-3.0/AGPL-3.0) and InsightFace ArcFace w600k_r50
(non-commercial research only).
"""

import hashlib
import logging
import math
import os
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

logger = logging.getLogger("securephotos.face_recognition")

# Identifies which model produced a stored embedding; embeddings from different
# models are never compared (see faces.embedding_model).
EMBEDDING_MODEL = "sface-2021dec"
EMBEDDING_DIM = 128

FACE_MODELS = {
    "yunet": {
        "file": "face_detection_yunet_2023mar.onnx",
        "url": "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "license": "MIT",
    },
    "sface": {
        "file": "face_recognition_sface_2021dec.onnx",
        "url": "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "license": "Apache-2.0",
    },
}

# Model files no longer used by the app (non-permissive licences); deleted once
# the People migration has finished (see engine.services.face_model_migration).
RETIRED_MODEL_FILES = ("yoloface_8n.onnx", "arcface_w600k_r50.onnx", "codeformer.onnx", "1x_refocus_cleanly.onnx")

YUNET_INPUT = 640
YUNET_STRIDES = (8, 16, 32)
YUNET_SCORE_THRESHOLD = 0.6   # Found all 72 named faces in the owner's library (H9 measurement).
YUNET_NMS_THRESHOLD = 0.3

# Standard 112x112 face template (same points OpenCV's alignCrop uses), landmark order
# as YuNet returns them: eye, eye, nose tip, mouth corner, mouth corner (image left to right).
ARCFACE_REF_POINTS = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)

_yunet_session = None
_sface_session = None


def get_models_dir() -> Path:
    """Returns the absolute directory path where ONNX neural models are stored."""
    from engine.config import settings
    models_dir = settings.models_dir
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir


def get_face_thumbnails_dir() -> Path:
    """Returns the absolute directory path where face crop avatar thumbnails are cached."""
    from engine.config import settings
    faces_dir = settings.thumbnails_dir / "faces"
    faces_dir.mkdir(parents=True, exist_ok=True)
    return faces_dir


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _ensure_model(spec: Dict[str, str]) -> Path:
    """Returns the verified model file, downloading it once if needed.

    Raises:
        IOError: If the downloaded file doesn't match the pinned SHA-256.
    """
    path = get_models_dir() / spec["file"]
    if path.is_file() and _sha256(path) == spec["sha256"]:
        return path
    logger.info("Downloading %s (%s licence)...", spec["file"], spec["license"])
    tmp = path.with_name(path.name + ".download")
    req = urllib.request.Request(spec["url"], headers={"User-Agent": "SecurePhotos"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
        for block in iter(lambda: resp.read(1024 * 1024), b""):
            fh.write(block)
    actual = _sha256(tmp)
    if actual != spec["sha256"]:
        tmp.unlink(missing_ok=True)
        raise IOError(f"{spec['file']} failed its integrity check (got {actual[:12]}..., expected {spec['sha256'][:12]}...).")
    os.replace(tmp, path)
    return path


def ensure_face_models() -> Tuple[Path, Path]:
    """Returns verified paths to the YuNet and SFace model files."""
    return _ensure_model(FACE_MODELS["yunet"]), _ensure_model(FACE_MODELS["sface"])


def get_inference_sessions():
    """Returns cached onnxruntime sessions (yunet, sface), creating them on first use.

    Thread allocation is capped to prevent CPU starvation of the UI and API.
    """
    global _yunet_session, _sface_session
    if _yunet_session is None or _sface_session is None:
        import onnxruntime as ort

        yunet_path, sface_path = ensure_face_models()
        sess_options = ort.SessionOptions()
        cpu_count = os.cpu_count() or 4
        sess_options.intra_op_num_threads = min(4, max(1, cpu_count // 2))
        sess_options.inter_op_num_threads = 1
        sess_options.log_severity_level = 3
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        available = ort.get_available_providers()
        providers = [p for p in ("DmlExecutionProvider", "CPUExecutionProvider") if p in available] or ["CPUExecutionProvider"]
        logger.info("Initializing face models with providers: %s", providers)
        _yunet_session = ort.InferenceSession(str(yunet_path), sess_options=sess_options, providers=providers)
        _sface_session = ort.InferenceSession(str(sface_path), sess_options=sess_options, providers=providers)
    return _yunet_session, _sface_session


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> List[int]:
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep: List[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][iou <= iou_threshold]
    return keep


def decode_yunet(outputs: Dict[str, np.ndarray], score_threshold: float = YUNET_SCORE_THRESHOLD) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Decodes YuNet's raw outputs (640x640 input) into boxes, scores and landmarks.

    Mirrors OpenCV ``FaceDetectorYN`` (2023mar model): score = sqrt(cls * obj),
    box centre = (grid + offset) * stride, size = exp(log_size) * stride,
    landmarks = (grid + offset) * stride.

    Args:
        outputs: Mapping of output name (``cls_8``, ``obj_8``, ``bbox_8``, ``kps_8``, ...) to arrays.
        score_threshold: Minimum face score.

    Returns:
        (boxes Nx4 as x1,y1,x2,y2; scores N; landmarks Nx5x2), in 640x640 input pixels, after NMS.
    """
    all_boxes, all_scores, all_kps = [], [], []
    for stride in YUNET_STRIDES:
        cols = rows = YUNET_INPUT // stride
        cls = np.clip(outputs[f"cls_{stride}"].reshape(-1), 0.0, 1.0)
        obj = np.clip(outputs[f"obj_{stride}"].reshape(-1), 0.0, 1.0)
        bbox = outputs[f"bbox_{stride}"].reshape(-1, 4)
        kps = outputs[f"kps_{stride}"].reshape(-1, 10)
        scores = np.sqrt(cls * obj)
        idx = np.where(scores >= score_threshold)[0]
        if idx.size == 0:
            continue
        gx = (idx % cols).astype(np.float32)
        gy = (idx // cols).astype(np.float32)
        cx = (gx + bbox[idx, 0]) * stride
        cy = (gy + bbox[idx, 1]) * stride
        w = np.exp(bbox[idx, 2]) * stride
        h = np.exp(bbox[idx, 3]) * stride
        all_boxes.append(np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1))
        all_scores.append(scores[idx])
        lx = (kps[idx][:, 0::2] + gx[:, None]) * stride
        ly = (kps[idx][:, 1::2] + gy[:, None]) * stride
        all_kps.append(np.stack([lx, ly], axis=2))
        del rows
    if not all_boxes:
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.float32), np.zeros((0, 5, 2), np.float32)
    boxes, scores, kps = np.concatenate(all_boxes), np.concatenate(all_scores), np.concatenate(all_kps)
    keep = _nms(boxes, scores, YUNET_NMS_THRESHOLD)
    return boxes[keep], scores[keep], kps[keep]


def detect_faces(image: Image.Image) -> List[Tuple[Tuple[float, float, float, float], float, np.ndarray]]:
    """Finds faces in an RGB image with YuNet.

    The image is scaled so its long side is 640 px and padded at the bottom/right,
    like OpenCV does; results are mapped back to original pixels.

    Returns:
        List of ((x1, y1, x2, y2), score, landmarks 5x2) in original image pixels.
    """
    yunet, _ = get_inference_sessions()
    w, h = image.size
    scale = min(YUNET_INPUT / w, YUNET_INPUT / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    canvas = np.zeros((YUNET_INPUT, YUNET_INPUT, 3), dtype=np.float32)
    rgb = np.asarray(image.resize((nw, nh), Image.Resampling.BILINEAR), dtype=np.float32)
    canvas[:nh, :nw] = rgb[:, :, ::-1]  # YuNet expects BGR, 0-255.
    blob = np.transpose(canvas, (2, 0, 1))[None]
    names = [o.name for o in yunet.get_outputs()]
    outputs = dict(zip(names, yunet.run(None, {yunet.get_inputs()[0].name: blob})))
    boxes, scores, kps = decode_yunet(outputs)
    faces = []
    for box, score, lm in zip(boxes, scores, kps):
        x1, y1, x2, y2 = (float(v) / scale for v in box)
        faces.append(((max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2)), float(score), (lm / scale).astype(np.float32)))
    return faces


def warp_to_template(image_rgb: np.ndarray, coeffs: Tuple[float, ...], size: int = 112) -> Image.Image:
    """Samples a size x size crop like OpenCV ``warpAffine`` (INTER_LINEAR, black border).

    PIL's own affine sampling differs slightly from OpenCV's; SFace was trained on
    OpenCV-aligned crops, so matching OpenCV here keeps embeddings comparable.

    Args:
        image_rgb: HxWx3 uint8/float RGB array of the whole photo.
        coeffs: Inverse mapping (a, b, c, d, e, f): src = (a x + b y + c, d x + e y + f).
        size: Output side length.
    """
    a, b, c, d, e, f = coeffs
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float64)
    sx = a * xs + b * ys + c
    sy = d * xs + e * ys + f
    h, w = image_rgb.shape[:2]
    x0, y0 = np.floor(sx).astype(np.int64), np.floor(sy).astype(np.int64)
    fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]
    src = image_rgb.astype(np.float32)

    def px(yy, xx):
        inside = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h)
        out = np.zeros(xx.shape + (3,), dtype=np.float32)
        out[inside] = src[yy[inside], xx[inside]]
        return out

    top = px(y0, x0) * (1 - fx) + px(y0, x0 + 1) * fx
    bottom = px(y0 + 1, x0) * (1 - fx) + px(y0 + 1, x0 + 1) * fx
    out = top * (1 - fy) + bottom * fy
    return Image.fromarray(np.clip(np.rint(out), 0, 255).astype(np.uint8))


def embed_aligned_face(aligned_112: Image.Image) -> List[float]:
    """Returns the L2-normalised 128-D SFace embedding of a 112x112 aligned RGB face.

    Matches OpenCV ``FaceRecognizerSF.feature``: RGB, 0-255 floats, no normalisation.
    """
    _, sface = get_inference_sessions()
    x = np.transpose(np.asarray(aligned_112.convert("RGB"), dtype=np.float32), (2, 0, 1))[None]
    emb = sface.run(None, {sface.get_inputs()[0].name: x})[0][0].astype(np.float32)
    norm = float(np.linalg.norm(emb))
    return (emb / norm if norm > 1e-6 else emb).tolist()


# 200x200 Portrait reference template for upright, centered avatar thumbnails
_SCALE_200 = 200.0 / 112.0 * 0.72
_CENTER_112 = np.array([56.0, 68.0], dtype=np.float32)
_TARGET_CENTER_200 = np.array([100.0, 102.0], dtype=np.float32)
AVATAR_REF_POINTS_200 = (ARCFACE_REF_POINTS - _CENTER_112) * _SCALE_200 + _TARGET_CENTER_200


def _estimate_affine_matrix(
    src_landmarks: np.ndarray,
    dst_ref: Optional[np.ndarray] = None,
) -> Optional[Tuple[float, float, float, float, float, float]]:
    """Calculates the 2D similarity transform mapping 5 facial landmarks to reference points.

    Solves the least-squares linear system:
        [x_src]   [a  -b  tx] [x_dst]
        [y_src] = [b   a  ty] [y_dst]
    for PIL's native affine transform inverse mapping.

    Args:
        src_landmarks: (5, 2) numpy array of detected facial keypoints in source image space.
        dst_ref: Optional (5, 2) destination points. Defaults to ARCFACE_REF_POINTS (112x112).

    Returns:
        6-tuple of affine coefficients for PIL.Image.transform, or None if underdetermined.
    """
    if src_landmarks.shape != (5, 2):
        return None

    dst = np.asarray(dst_ref if dst_ref is not None else ARCFACE_REF_POINTS, dtype=np.float64)
    src = np.asarray(src_landmarks, dtype=np.float64)

    # Umeyama similarity estimate src -> dst, exactly as OpenCV FaceRecognizerSF.alignCrop
    # does (SFace was trained on crops made this way), then inverted for PIL, which
    # maps output (dst) pixels back to input (src) pixels.
    try:
        src_mean, dst_mean = src.mean(axis=0), dst.mean(axis=0)
        src_d, dst_d = src - src_mean, dst - dst_mean
        cov = dst_d.T @ src_d / len(src)
        d = np.ones(2)
        if np.linalg.det(cov) < 0:
            d[1] = -1.0
        u, s, vt = np.linalg.svd(cov)
        rot = u @ np.diag(d) @ vt
        var_src = (src_d ** 2).sum() / len(src)
        if var_src < 1e-9:
            return None
        scale = float((s * d).sum() / var_src)
        fwd = np.zeros((2, 3))
        fwd[:, :2] = scale * rot
        fwd[:, 2] = dst_mean - fwd[:, :2] @ src_mean
        inv_lin = np.linalg.inv(fwd[:, :2])
        inv_t = -inv_lin @ fwd[:, 2]
        return (
            float(inv_lin[0, 0]), float(inv_lin[0, 1]), float(inv_t[0]),
            float(inv_lin[1, 0]), float(inv_lin[1, 1]), float(inv_t[1]),
        )
    except (np.linalg.LinAlgError, ValueError) as err:
        logger.warning(f"Failed to solve landmark similarity transform: {err}")
        return None


def calculate_face_quality(crop: Image.Image, orig_w: int, orig_h: int, box_w: int, box_h: int) -> float:
    """Calculates an objective face quality score combining sharpness and relative resolution.

    Args:
        crop: PIL Image of the cropped face.
        orig_w: Original photo width.
        orig_h: Original photo height.
        box_w: Face bounding box width.
        box_h: Face bounding box height.

    Returns:
        Float quality score bounded in [0.05, 1.0].
    """
    try:
        gray = crop.convert("L").resize((112, 112), Image.Resampling.BILINEAR)
        gray_arr = np.array(gray, dtype=np.float32)

        # 3x3 Discrete Laplacian kernel convolution for high-frequency sharpness variance
        kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
        # Fast discrete convolution on 112x112
        padded = np.pad(gray_arr, 1, mode="edge")
        laplacian = (
            padded[:-2, 1:-1] * kernel[0, 1] +
            padded[1:-1, :-2] * kernel[1, 0] +
            padded[1:-1, 1:-1] * kernel[1, 1] +
            padded[1:-1, 2:]   * kernel[1, 2] +
            padded[2:, 1:-1]   * kernel[2, 1]
        )
        variance = float(np.var(laplacian))
        # Normalize sharpness: 100+ is reasonably sharp, 400+ is tack sharp
        sharpness_score = min(1.0, math.sqrt(variance) / 25.0)

        # Area score: reward faces that occupy meaningful real estate (>4% of photo dimension)
        rel_size = math.sqrt((box_w * box_h) / max(1, orig_w * orig_h))
        size_score = min(1.0, rel_size / 0.15)

        # Combined quality metric: 70% sharpness, 30% resolution
        quality = float(0.70 * sharpness_score + 0.30 * size_score)
        return round(max(0.05, min(1.0, quality)), 4)
    except Exception as e:
        logger.debug(f"Quality calculation error: {e}")
        return 0.50


def detect_and_embed_faces(image: Image.Image) -> List[Dict[str, Any]]:
    """Finds faces, aligns them on 5 landmarks and computes SFace identity embeddings.

    Args:
        image: Source PIL Image in RGB format.

    Returns:
        List of face dicts:
        - box_x, box_y, box_w, box_h: relative coordinates in [0, 1] (plain Python floats).
        - pixel_box: (x1, y1, x2, y2) in original pixels.
        - quality_score: sharpness & size score in [0.05, 1.0].
        - embedding: 128-D L2-normalised list of floats.
        - embedding_model: :data:`EMBEDDING_MODEL`.
        - crop_thumbnail: 200x200 upright avatar crop.
    """
    orig_w, orig_h = image.size
    image_arr = np.asarray(image)  # For OpenCV-identical face alignment (see warp_to_template).
    detected_faces: List[Dict[str, Any]] = []

    for (x1, y1, x2, y2), _score, landmarks in detect_faces(image):
        box_w_px = max(4.0, x2 - x1)
        box_h_px = max(4.0, y2 - y1)

        # Human faces have aspect ratios roughly in [0.55, 1.70]; rejects odd proposals.
        aspect_ratio = box_w_px / max(1.0, box_h_px)
        if aspect_ratio < 0.55 or aspect_ratio > 1.70:
            continue
        # Collapsed or spurious landmarks: eyes must be at least ~1% of the long side apart.
        if float(np.linalg.norm(landmarks[0] - landmarks[1])) < max(orig_w, orig_h) / 100.0:
            continue

        affine = _estimate_affine_matrix(landmarks)
        if affine is not None:
            aligned_112 = warp_to_template(image_arr, affine)
        else:
            mx, my = box_w_px * 0.15, box_h_px * 0.15
            aligned_112 = image.crop(
                (max(0, int(x1 - mx)), max(0, int(y1 - my)), min(orig_w, int(x2 + mx)), min(orig_h, int(y2 + my)))
            ).resize((112, 112), Image.Resampling.BILINEAR)

        avatar_affine = _estimate_affine_matrix(landmarks, dst_ref=AVATAR_REF_POINTS_200)
        if avatar_affine is not None:
            thumb_crop = image.transform((200, 200), Image.Transform.AFFINE, avatar_affine, Image.Resampling.BICUBIC)
        else:
            m = 0.25
            thumb_crop = image.crop(
                (
                    max(0, int(x1 - box_w_px * m)), max(0, int(y1 - box_h_px * m)),
                    min(orig_w, int(x2 + box_w_px * m)), min(orig_h, int(y2 + box_h_px * m)),
                )
            ).resize((200, 200), Image.Resampling.LANCZOS)

        quality = calculate_face_quality(thumb_crop, orig_w, orig_h, int(box_w_px), int(box_h_px))
        # Reject heavily blurred, tiny or out-of-focus background faces.
        if quality < 0.25:
            continue

        detected_faces.append(
            {
                # float(): numpy float32 would be stored by SQLite as a 4-byte blob.
                "box_x": round(float(x1) / orig_w, 6),
                "box_y": round(float(y1) / orig_h, 6),
                "box_w": round(float(box_w_px) / orig_w, 6),
                "box_h": round(float(box_h_px) / orig_h, 6),
                "pixel_box": (int(x1), int(y1), int(x2), int(y2)),
                "quality_score": float(quality),
                "embedding": embed_aligned_face(aligned_112),
                "embedding_model": EMBEDDING_MODEL,
                "crop_thumbnail": thumb_crop,
            }
        )

    return detected_faces
