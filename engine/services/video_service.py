"""Video Ingestion, Transcoding, Quality Preservation, and Enhancement Service.

This module delivers end-to-end video operations for SecurePhotos:
1. `extract_video_metadata`: High-speed ffprobe metadata, codec, duration, and QuickTime EXIF parsing.
2. `generate_video_thumbnail`: Clean frame extraction at optimal timestamps for WebP thumbnails and previews.
3. `analyze_video_candidate`: Categorizes videos into compressible, enhanceable, or already optimized.
4. `compress_video`: Visually lossless H.265/HEVC transcoding (CRF 22-24, untouched audio pass-through, metadata preservation, 30-day trash rollback).
5. `enhance_old_video`: Vintage video restoration with 3D denoising, de-interlacing, color dynamic revival, and Lanczos/Unsharp HD upscaling.
"""

import asyncio
import datetime
import json
import logging
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import aiosqlite

from engine.database import get_db_connection
from engine.services.video_runtime import (
    get_ffmpeg_path,
    get_ffprobe_path,
    probe_hardware_encoder,
)

logger = logging.getLogger("securephotos.video_service")


def extract_video_metadata(filepath: str) -> Dict[str, Any]:
    """Extracts stream metadata, container dimensions, duration, and EXIF dates using ffprobe.

    Args:
        filepath: Absolute path to the video file.

    Returns:
        Dictionary containing width, height, duration (seconds), codec, bitrate, fps, taken_at, rotation.
    """
    ffprobe = get_ffprobe_path()
    if not ffprobe or not os.path.exists(filepath):
        return {
            "width": None,
            "height": None,
            "duration": 0.0,
            "codec": None,
            "bitrate": None,
            "fps": 0.0,
            "taken_at": None,
            "rotation": 0,
        }

    cmd = [
        ffprobe,
        "-v", "error",
        "-show_streams",
        "-show_format",
        "-of", "json",
        filepath,
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=8, check=True)
        data = json.loads(proc.stdout)
    except Exception as e:
        logger.warning(f"ffprobe failed on {filepath}: {e}")
        return {
            "width": None,
            "height": None,
            "duration": 0.0,
            "codec": None,
            "bitrate": None,
            "fps": 0.0,
            "taken_at": None,
            "rotation": 0,
        }

    # Find primary video stream
    video_stream = None
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            video_stream = s
            break

    width = None
    height = None
    codec = None
    fps = 0.0
    rotation = 0
    stream_duration = 0.0

    if video_stream:
        width = video_stream.get("width")
        height = video_stream.get("height")
        codec = video_stream.get("codec_name")

        # Parse frame rate
        r_fps = video_stream.get("r_frame_rate", "")
        if "/" in r_fps:
            try:
                num, den = r_fps.split("/")
                if float(den) > 0:
                    fps = round(float(num) / float(den), 2)
            except (ValueError, ZeroDivisionError):
                pass

        # Parse rotation / display matrix
        side_data = video_stream.get("side_data_list", [])
        for sd in side_data:
            if "rotation" in sd:
                try:
                    rotation = int(sd["rotation"])
                except (ValueError, TypeError):
                    pass
        if not rotation and "tags" in video_stream and "rotate" in video_stream["tags"]:
            try:
                rotation = int(video_stream["tags"]["rotate"])
            except (ValueError, TypeError):
                pass

        # If rotated 90 or 270 degrees, swap display width and height
        if abs(rotation) in (90, 270) and width and height:
            width, height = height, width

        try:
            stream_duration = float(video_stream.get("duration", 0.0))
        except (ValueError, TypeError):
            stream_duration = 0.0

    # Format / container-level metadata
    fmt = data.get("format", {})
    format_duration = 0.0
    try:
        format_duration = float(fmt.get("duration", 0.0))
    except (ValueError, TypeError):
        pass

    duration = format_duration or stream_duration

    bitrate = None
    try:
        bitrate = int(fmt.get("bit_rate") or video_stream.get("bit_rate") or 0)
    except (ValueError, TypeError):
        pass

    # Extract creation timestamp
    tags = fmt.get("tags", {})
    if video_stream and "tags" in video_stream:
        tags = {**tags, **video_stream["tags"]}

    taken_at = None
    for date_key in (
        "creation_time",
        "com.apple.quicktime.creationdate",
        "date",
        "DateTimeOriginal",
    ):
        if date_key in tags:
            raw_val = str(tags[date_key]).strip()
            # Handle ISO formats like 2023-08-15T14:30:22.000000Z
            try:
                raw_clean = raw_val.replace("Z", "+00:00")
                dt = datetime.datetime.fromisoformat(raw_clean)
                taken_at = dt.strftime("%Y-%m-%d %H:%M:%S")
                break
            except Exception:
                pass
            # Handle format like 2023:08:15 14:30:22
            try:
                dt = datetime.datetime.strptime(raw_val[:19], "%Y:%m:%d %H:%M:%S")
                taken_at = dt.strftime("%Y-%m-%d %H:%M:%S")
                break
            except Exception:
                pass

    return {
        "width": width,
        "height": height,
        "duration": round(duration, 2),
        "codec": codec,
        "bitrate": bitrate,
        "fps": fps,
        "taken_at": taken_at,
        "rotation": rotation,
    }


def generate_video_thumbnail(
    video_path: str,
    thumb_path: str,
    preview_path: Optional[str] = None,
    timestamp_sec: float = 1.0,
) -> bool:
    """Extracts a sharp representative frame at a given timestamp for WebP thumbnail and preview.

    Args:
        video_path: Path to source video.
        thumb_path: Destination path for micro-thumbnail (.webp).
        preview_path: Optional destination path for display preview (.webp).
        timestamp_sec: Offset in seconds to seek to (default: 1.0s).

    Returns:
        True if generation succeeded, False otherwise.
    """
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg or not os.path.exists(video_path):
        return False

    os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
    if preview_path:
        os.makedirs(os.path.dirname(preview_path), exist_ok=True)

    # 1. Generate micro-thumbnail (400x400 max bounding box)
    cmd_thumb = [
        ffmpeg,
        "-y",
        "-ss", str(timestamp_sec),
        "-i", video_path,
        "-vframes", "1",
        "-vf", "scale=400:400:force_original_aspect_ratio=decrease",
        "-c:v", "libwebp",
        "-quality", "85",
        thumb_path,
    ]

    try:
        res = subprocess.run(cmd_thumb, capture_output=True, timeout=10)
        if res.returncode != 0 or not os.path.exists(thumb_path) or os.path.getsize(thumb_path) == 0:
            # If seeking to timestamp_sec failed or produced an empty file (e.g. short clip), retry seeking to 0.0s
            cmd_thumb[3] = "0.0"
            res = subprocess.run(cmd_thumb, capture_output=True, timeout=10)
            if res.returncode != 0 or not os.path.exists(thumb_path) or os.path.getsize(thumb_path) == 0:
                logger.warning(f"Failed to generate video thumbnail for {video_path}: {res.stderr.decode('utf-8', 'ignore')}")
                return False
    except Exception as e:
        logger.warning(f"Thumbnail extraction exception: {e}")
        return False

    # 2. Generate display preview (1920x1080 max bounding box)
    if preview_path:
        cmd_prev = [
            ffmpeg,
            "-y",
            "-ss", str(timestamp_sec),
            "-i", video_path,
            "-vframes", "1",
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease",
            "-c:v", "libwebp",
            "-quality", "88",
            preview_path,
        ]
        try:
            res_prev = subprocess.run(cmd_prev, capture_output=True, timeout=10)
            if res_prev.returncode != 0 or not os.path.exists(preview_path) or os.path.getsize(preview_path) == 0:
                cmd_prev[3] = "0.0"
                subprocess.run(cmd_prev, capture_output=True, timeout=10)
        except Exception as e:
            logger.warning(f"Preview extraction exception: {e}")

    return os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0


def analyze_video_candidate(photo_record: Dict[str, Any]) -> Dict[str, Any]:
    """Analyzes a video's storage footprint and quality profile to produce an optimization plan.

    Args:
        photo_record: Row dictionary from the `photos` table.

    Returns:
        Dictionary detailing candidate category ('compressible', 'enhanceable', 'optimized'),
        reasoning, projected size reduction, and recommended actions.
    """
    file_size = photo_record.get("file_size") or 0
    width = photo_record.get("width") or 0
    height = photo_record.get("height") or 0
    filepath = photo_record.get("filepath", "")
    is_optimized = bool(photo_record.get("is_optimized", 0))
    is_enhanced = bool(photo_record.get("is_enhanced", 0))

    # Fast check: already processed
    if is_optimized:
        return {
            "status": "already_optimized",
            "action": "none",
            "label": "Optimized H.265",
            "projected_savings_bytes": 0,
            "projected_savings_pct": 0,
            "reason": "Already compressed using high-efficiency H.265/HEVC.",
        }

    # Extract metadata if needed
    meta = extract_video_metadata(filepath)
    codec = (meta.get("codec") or "").lower()
    duration = meta.get("duration") or 0.0
    bitrate = meta.get("bitrate") or 0

    # 1. Vintage / Low-Resolution Enhancement Candidate (< 720p)
    min_dim = min(width, height) if width and height else 0
    if min_dim > 0 and min_dim < 720 and not is_enhanced:
        return {
            "status": "enhanceable",
            "action": "enhance",
            "label": "Vintage / Low-Res Clip",
            "target_resolution": "720p HD",
            "projected_savings_bytes": 0,
            "projected_savings_pct": 0,
            "reason": f"Low-resolution ({width}x{height}) vintage video. Can be denoised and upscaled to 720p HD.",
        }

    # 2. Already high-efficiency codec check
    if codec in ("hevc", "h265", "av1", "vp9") and bitrate and bitrate < 6_000_000:
        return {
            "status": "already_optimized",
            "action": "none",
            "label": f"Optimized ({codec.upper()})",
            "projected_savings_bytes": 0,
            "projected_savings_pct": 0,
            "reason": f"Already encoded in {codec.upper()} with efficient bitrate ({round(bitrate / 1_000_000, 1)} Mbps).",
        }

    # 3. Compressible Candidate (Heavy H.264 / MPEG-4 / ProRes)
    if file_size > 20_000_000 or (bitrate and bitrate > 8_000_000):
        # Projected savings at CRF 23 is typically 55% to 70%
        est_savings_pct = 60
        projected_savings = int(file_size * (est_savings_pct / 100.0))
        return {
            "status": "compressible",
            "action": "compress",
            "label": "High-Bitrate Heavy Video",
            "projected_savings_bytes": projected_savings,
            "projected_savings_pct": est_savings_pct,
            "reason": f"Heavy {codec.upper()} video ({round(file_size / (1024 * 1024), 1)} MB). Lossless H.265 compression can reclaim ~{est_savings_pct}%.",
        }

    return {
        "status": "standard",
        "action": "none",
        "label": "Standard Clip",
        "projected_savings_bytes": 0,
        "projected_savings_pct": 0,
        "reason": "Compact file size with standard bitrate.",
    }


def classify_video_for_ingestion(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Classifies an ingested video to decide whether it needs enhancement, compression, or is already optimized.

    Args:
        meta: Extracted video metadata (width, height, file_size, codec, bitrate, duration).

    Returns:
        Dict with keys:
            - 'action': 'none' | 'enhance' | 'compress'
            - 'target_height': Optional target height (e.g. 1080 or 2160)
            - 'reason': Human-readable description
            - 'is_already_optimized': bool
    """
    width = meta.get("width") or 0
    height = meta.get("height") or 0
    codec = (meta.get("codec") or "").lower()
    file_size = meta.get("file_size") or 0
    max_dim = max(width, height)
    min_dim = min(width, height) if min(width, height) > 0 else max_dim

    # 1. Already 4K UHD (>= 2160p or width >= 3840)
    if min_dim >= 2160 or max_dim >= 3840:
        return {
            "action": "none",
            "is_already_optimized": True,
            "target_height": None,
            "reason": "Already pristine 4K UHD. Preserving original camera master.",
        }

    # 2. Modern 1080p in efficient codec (H.265 / HEVC / AV1 / VP9)
    if min_dim >= 1080 and codec in ("hevc", "h265", "av1", "vp9"):
        return {
            "action": "none",
            "is_already_optimized": True,
            "target_height": None,
            "reason": "Already modern high-definition H.265/AV1. No re-encode required.",
        }

    # 3. Vintage / Low-Res clip (under 720p vertical or under 1280 horizontal)
    if min_dim < 720 and max_dim < 1280:
        return {
            "action": "enhance",
            "is_already_optimized": False,
            "target_height": 1080,
            "reason": f"Vintage {min_dim}p video. Scheduled for AI upscaling to 1080p HD.",
        }

    # 4. Heavy legacy video (> 35MB with legacy H.264 / MPEG-4 / ProRes)
    if file_size > 35_000_000 and codec not in ("hevc", "h265", "av1", "vp9"):
        return {
            "action": "compress",
            "is_already_optimized": False,
            "target_height": None,
            "reason": f"Heavy {codec.upper()} video. Scheduled for visually lossless H.265 space saving.",
        }

    # 5. Standard compact clip
    return {
        "action": "none",
        "is_already_optimized": True,
        "target_height": None,
        "reason": "Standard compact video clip.",
    }


async def compress_video(
    photo_id: int,
    crf: Optional[int] = None,
    preset: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcodes a video to H.265/HEVC with visually lossless CRF, untouched audio copy, and 30-day trash safety.

    Args:
        photo_id: ID of the photo record in the database.
        crf: Optional Constant Rate Factor override (default: 23).
        preset: Optional encoding preset override.

    Returns:
        Result dictionary containing success status, original/compressed sizes, and bytes saved.
    """
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        return {"success": False, "error": "FFmpeg runtime binary is not available."}

    # Fetch photo record
    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)) as cursor:
            photo = await cursor.fetchone()
    finally:
        await conn.close()

    if not photo:
        return {"success": False, "error": f"Photo with ID {photo_id} not found."}

    orig_path = photo["filepath"]
    if not os.path.exists(orig_path):
        return {"success": False, "error": f"Source video file not found at {orig_path}"}

    orig_size = os.path.getsize(orig_path)
    enc_info = probe_hardware_encoder()

    actual_crf = crf if crf is not None else enc_info["default_crf"]
    actual_preset = preset if preset is not None else enc_info["default_preset"]

    orig_p = Path(orig_path)
    # Output file using .mp4 container
    target_path = orig_p.with_name(f"{orig_p.stem}_opt.mp4")
    temp_path = orig_p.with_name(f"{orig_p.stem}_transcoding.tmp.mp4")

    # Constrain threads to 50% CPU cores so user UI stays smooth at 60fps
    thread_count = max(1, (os.cpu_count() or 4) // 2)
    creation_flags = 0x00004000 if sys.platform == "win32" else 0

    # Construct ffmpeg command
    cmd = [
        ffmpeg,
        "-y",
        "-threads", str(thread_count),
        "-i", orig_path,
        "-c:v", enc_info["encoder"],
    ]

    if enc_info["crf_param"]:
        cmd.extend([enc_info["crf_param"], str(actual_crf)])
    if actual_preset and enc_info["preset_param"]:
        cmd.extend([enc_info["preset_param"], actual_preset])
    if enc_info.get("extra_args"):
        cmd.extend(enc_info["extra_args"])

    # Pass audio untouched and retain QuickTime metadata
    cmd.extend([
        "-c:a", "copy",
        "-map_metadata", "0",
        "-movflags", "+faststart",
        str(temp_path),
    ])

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=900,
            creationflags=creation_flags,
        )
        if proc.returncode != 0 or not temp_path.exists() or temp_path.stat().st_size == 0:
            if temp_path.exists():
                temp_path.unlink()
            err_msg = proc.stderr[-400:] if proc.stderr else "Unknown transcoding error"
            logger.error(f"Transcoding failed for photo {photo_id}: {err_msg}")
            return {"success": False, "error": f"Encoding failed: {err_msg}"}

        compressed_size = temp_path.stat().st_size

        # Verification Guard: Ensure transcode actually saved space (> 10% reduction)
        if compressed_size >= (orig_size * 0.90):
            temp_path.unlink()
            logger.info(f"Transcoding did not yield >= 10% space savings for photo {photo_id}. Keeping original.")
            return {
                "success": False,
                "error": "Original is already more compact than re-encode. Original preserved.",
                "original_bytes": orig_size,
                "compressed_bytes": compressed_size,
            }

        # Finalize output file
        if target_path.exists():
            target_path.unlink()
        os.replace(temp_path, target_path)

        # Move original to 30-Day Trash for safety rollback
        trash_dir = Path(orig_path).parent / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        trash_orig_path = trash_dir / f"{orig_p.name}.orig_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
        shutil.move(orig_path, str(trash_orig_path))

        # Re-extract accurate dimensions & metadata
        new_meta = extract_video_metadata(str(target_path))

        # Update database record
        saved_bytes = orig_size - compressed_size
        conn = await get_db_connection()
        try:
            await conn.execute(
                """
                UPDATE photos 
                SET filepath = ?,
                    filename = ?,
                    file_size = ?,
                    width = coalesce(?, width),
                    height = coalesce(?, height),
                    mime_type = 'video/mp4',
                    is_optimized = 1
                WHERE id = ?;
                """,
                (
                    str(target_path),
                    target_path.name,
                    compressed_size,
                    new_meta.get("width"),
                    new_meta.get("height"),
                    photo_id,
                ),
            )
            await conn.commit()
        finally:
            await conn.close()

        # Refresh thumbnails for the new file
        if photo["thumbnail_path"]:
            generate_video_thumbnail(str(target_path), photo["thumbnail_path"], photo["preview_path"])

        logger.info(f"Successfully compressed video #{photo_id}: {orig_size} -> {compressed_size} bytes (saved {saved_bytes} bytes).")
        return {
            "success": True,
            "photo_id": photo_id,
            "original_bytes": orig_size,
            "compressed_bytes": compressed_size,
            "saved_bytes": saved_bytes,
            "savings_pct": round((saved_bytes / orig_size) * 100, 1),
            "new_filepath": str(target_path),
        }

    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        logger.exception(f"Exception during video compression #{photo_id}: {e}")
        return {"success": False, "error": str(e)}


async def enhance_old_video(
    photo_id: int,
    target_height: int = 720,
) -> Dict[str, Any]:
    """Restores a low-resolution or vintage video using 3D denoising, de-interlacing, and Lanczos/Unsharp HD upscaling.

    Args:
        photo_id: ID of the photo record in the database.
        target_height: Target vertical resolution (default: 720p).

    Returns:
        Result dictionary containing success status, new dimensions, and file paths.
    """
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        return {"success": False, "error": "FFmpeg runtime binary is not available."}

    conn = await get_db_connection()
    try:
        conn.row_factory = aiosqlite.Row
        async with conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)) as cursor:
            photo = await cursor.fetchone()
    finally:
        await conn.close()

    if not photo:
        return {"success": False, "error": f"Photo with ID {photo_id} not found."}

    if photo["is_enhanced"]:
        return {
            "success": True,
            "already_enhanced": True,
            "photo_id": photo_id,
            "height": photo["height"] or target_height,
            "width": photo["width"] or 0,
            "message": "Video is already enhanced.",
        }

    orig_path = photo["filepath"]
    if not os.path.exists(orig_path):
        return {"success": False, "error": f"Source video file not found at {orig_path}"}

    orig_p = Path(orig_path)
    target_path = orig_p.with_name(f"{orig_p.stem}_enhanced.mp4")
    temp_path = orig_p.with_name(f"{orig_p.stem}_enhancing_{uuid.uuid4().hex[:6]}.tmp.mp4")

    # Multi-stage restoration filter graph:
    # 1. yadif=1:-1:0 (deinterlacing)
    # 2. hqdn3d=4:3:6:4.5 (temporal 3D denoising)
    # 3. scale: Lanczos upscaling to target_height preserving aspect ratio
    # 4. unsharp: edge contrast enhancement
    # 5. eq: color and contrast revival
    filter_chain = (
        f"yadif=1:-1:0,"
        f"hqdn3d=4:3:6:4.5,"
        f"scale=-2:{target_height}:flags=lanczos,"
        f"unsharp=5:5:0.8:3:3:0.4,"
        f"eq=contrast=1.05:brightness=0.01:saturation=1.12"
    )

    # Constrain threads to 50% CPU cores and lower Windows process priority
    thread_count = max(1, (os.cpu_count() or 4) // 2)
    creation_flags = 0x00004000 if sys.platform == "win32" else 0

    cmd = [
        ffmpeg,
        "-y",
        "-threads", str(thread_count),
        "-i", orig_path,
        "-vf", filter_chain,
        "-c:v", "libx265",
        "-crf", "20",
        "-preset", "medium",
        "-tag:v", "hvc1",
        "-c:a", "copy",
        "-map_metadata", "0",
        "-movflags", "+faststart",
        str(temp_path),
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1200,
            creationflags=creation_flags,
        )
        if proc.returncode != 0 or not temp_path.exists() or temp_path.stat().st_size == 0:
            if temp_path.exists():
                temp_path.unlink()
            err_msg = proc.stderr[-400:] if proc.stderr else "Unknown enhancement error"
            return {"success": False, "error": f"Enhancement failed: {err_msg}"}

        if target_path.exists():
            target_path.unlink()
        os.replace(temp_path, target_path)

        # Move original to 30-Day Trash (with Windows file lock resilience)
        trash_dir = Path(orig_path).parent / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        trash_orig_path = trash_dir / f"{orig_p.name}.vintage_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
        moved = False
        for attempt in range(5):
            try:
                shutil.move(orig_path, str(trash_orig_path))
                moved = True
                break
            except (PermissionError, OSError):
                await asyncio.sleep(0.3)

        if not moved:
            try:
                shutil.copy2(orig_path, str(trash_orig_path))
                try:
                    os.unlink(orig_path)
                except OSError:
                    pass
            except Exception:
                pass

        new_meta = extract_video_metadata(str(target_path))
        new_size = target_path.stat().st_size

        conn = await get_db_connection()
        try:
            await conn.execute(
                """
                UPDATE photos 
                SET filepath = ?,
                    filename = ?,
                    file_size = ?,
                    width = ?,
                    height = ?,
                    mime_type = 'video/mp4',
                    is_enhanced = 1,
                    is_optimized = 1
                WHERE id = ?;
                """,
                (
                    str(target_path),
                    target_path.name,
                    new_size,
                    new_meta.get("width"),
                    new_meta.get("height"),
                    photo_id,
                ),
            )
            await conn.commit()
        finally:
            await conn.close()

        if photo["thumbnail_path"]:
            generate_video_thumbnail(str(target_path), photo["thumbnail_path"], photo["preview_path"])

        return {
            "success": True,
            "photo_id": photo_id,
            "width": new_meta.get("width"),
            "height": new_meta.get("height"),
            "file_size": new_size,
            "new_filepath": str(target_path),
        }

    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        return {"success": False, "error": str(e)}
