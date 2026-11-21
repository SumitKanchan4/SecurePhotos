"""Faces in videos (T30, owner 2026-11-21).

A video used to be checked for faces on one picture only (its preview), so anyone not in that
frame was never found. Now a few frames spread through the video are looked at, and each
different face is kept once: faces whose fingerprints match (the same threshold People uses to
group faces) count as one person in that video, and the sharpest view of them is kept, with its
box on the frame it came from.

Frames are read with FFmpeg straight into memory; nothing is written to disk. Runs in a worker
thread (H7).
"""

from __future__ import annotations

import io
import logging
import subprocess
from pathlib import Path
from typing import List

from PIL import Image

from engine.services.face_clustering_service import SIMILARITY_THRESHOLD

logger = logging.getLogger("securephotos.video_faces")

FRAMES = 8              # Frames looked at per video, spread evenly.
EDGE_SHARE = 0.05       # Skip the first and last 5% (fades, black frames).
FRAME_TIMEOUT_S = 20


def frame_times(duration: float, count: int = FRAMES) -> List[float]:
    """Evenly spread times (seconds) between 5% and 95% of the video; one frame for a very short clip."""
    if duration <= 0:
        return [0.0]
    if duration < 2:
        return [duration / 2]
    start, end = duration * EDGE_SHARE, duration * (1 - EDGE_SHARE)
    if count == 1:
        return [(start + end) / 2]
    step = (end - start) / (count - 1)
    return [round(start + i * step, 2) for i in range(count)]


def read_frames(video: Path, duration: float, count: int = FRAMES) -> List[Image.Image]:
    """The video's frames at :func:`frame_times`, upright as played (FFmpeg applies rotation)."""
    from engine.services.video_runtime import get_ffmpeg_path

    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        return []
    frames: List[Image.Image] = []
    for t in frame_times(duration, count):
        cmd = [ffmpeg, "-v", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]
        try:
            res = subprocess.run(cmd, capture_output=True, timeout=FRAME_TIMEOUT_S, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.TimeoutExpired) as err:
            logger.warning("Couldn't read a frame at %.1f s of %s: %s", t, video.name, err)
            continue
        if res.returncode == 0 and res.stdout:
            try:
                frames.append(Image.open(io.BytesIO(res.stdout)).convert("RGB"))
            except OSError:
                continue
    return frames


def _similarity(a: List[float], b: List[float]) -> float:
    return float(sum(x * y for x, y in zip(a, b)))  # Embeddings are L2-normalised: dot = cosine.


def distinct_faces(faces_per_frame: List[List[dict]]) -> List[dict]:
    """One face per person across the frames: the sharpest view (highest quality_score) of each."""
    kept: List[dict] = []
    for faces in faces_per_frame:
        for face in faces:
            match = next((i for i, k in enumerate(kept) if _similarity(face["embedding"], k["embedding"]) >= SIMILARITY_THRESHOLD), None)
            if match is None:
                kept.append(face)
            elif face.get("quality_score", 0) > kept[match].get("quality_score", 0):
                kept[match] = face
    return kept


def faces_in_video(video: Path, duration: float, detect) -> List[dict]:
    """Every different face in the video, or [] when no frame can be read (caller falls back)."""
    frames = read_frames(video, duration)
    if not frames:
        return []
    return distinct_faces([detect(frame) for frame in frames])
