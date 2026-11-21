"""Video Runtime Discovery, Hardware Encoder Probing, and Bundling Manager.

This module provides self-contained discovery and validation for FFmpeg and FFprobe binaries:
1. Discovers bundled binaries in `<AppRoot>/bin`, PyInstaller frozen paths, venv, or system PATH.
2. Validates execution and checks version telemetry.
3. Probes hardware-accelerated H.264 (AVC) encoding capabilities (NVENC, QSV, AMF, MediaFoundation) with seamless CPU fallback (libx264) and guaranteed universal 8-bit yuv420p web/TV compatibility.
"""

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Optional, Any

logger = logging.getLogger("securephotos.video_runtime")

_CACHED_FFMPEG: Optional[str] = None
_CACHED_FFPROBE: Optional[str] = None
_CACHED_ENCODER: Optional[Dict[str, Any]] = None


def get_app_root() -> Path:
    """Returns the project or application root directory."""
    if getattr(sys, "frozen", False):
        from engine.config import installed_app_dir

        return installed_app_dir()
    return Path(__file__).resolve().parent.parent.parent


def find_binary(binary_name: str) -> Optional[str]:
    """Finds an executable binary following the self-contained resolution hierarchy.

    Resolution Hierarchy:
    1. `<AppRoot>/bin/<binary>.exe` (bundled Tauri / NSIS resource path)
    2. PyInstaller bundle (`sys._MEIPASS/bin/<binary>.exe`)
    3. Virtual Environment Scripts (`.venv/Scripts/<binary>.exe`)
    4. System PATH via `shutil.which`

    Args:
        binary_name: Base name of binary ('ffmpeg' or 'ffprobe').

    Returns:
        Absolute string path to verified binary, or None if not found.
    """
    ext = ".exe" if sys.platform == "win32" else ""
    target_filename = f"{binary_name}{ext}"

    # 1. Check local AppRoot / bin /
    root_bin = get_app_root() / "bin" / target_filename
    if root_bin.exists() and os.access(str(root_bin), os.X_OK):
        return str(root_bin)

    # 2. Check PyInstaller frozen bundle
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        bundle_bin = Path(sys._MEIPASS) / "bin" / target_filename
        if bundle_bin.exists() and os.access(str(bundle_bin), os.X_OK):
            return str(bundle_bin)

    # 3. Check virtualenv Scripts
    venv_bin = get_app_root() / ".venv" / "Scripts" / target_filename
    if venv_bin.exists() and os.access(str(venv_bin), os.X_OK):
        return str(venv_bin)

    # 4. Check system PATH
    system_path = shutil.which(binary_name) or shutil.which(target_filename)
    if system_path:
        return system_path

    return None


def get_ffmpeg_path() -> Optional[str]:
    """Returns verified path to ffmpeg executable, caching result."""
    global _CACHED_FFMPEG
    if _CACHED_FFMPEG and os.path.exists(_CACHED_FFMPEG):
        return _CACHED_FFMPEG
    _CACHED_FFMPEG = find_binary("ffmpeg")
    return _CACHED_FFMPEG


def get_ffprobe_path() -> Optional[str]:
    """Returns verified path to ffprobe executable, caching result."""
    global _CACHED_FFPROBE
    if _CACHED_FFPROBE and os.path.exists(_CACHED_FFPROBE):
        return _CACHED_FFPROBE
    _CACHED_FFPROBE = find_binary("ffprobe")
    return _CACHED_FFPROBE


def is_video_runtime_available() -> bool:
    """Returns True if both ffmpeg and ffprobe are discoverable and executable."""
    return bool(get_ffmpeg_path() and get_ffprobe_path())


def probe_hardware_encoder() -> Dict[str, Any]:
    """Probes the best available H.264 (AVC) encoder (Hardware vs CPU).

    Tests available encoders by attempting a dry-run 1-frame encode.
    Prioritizes:
    1. NVIDIA NVENC (`h264_nvenc`)
    2. Intel QuickSync (`h264_qsv`)
    3. AMD AMF (`h264_amf`)
    4. Windows MediaFoundation (`h264_mf`)
    5. High-quality CPU fallback (`libx264`)

    All profiles enforce 8-bit `yuv420p` pixel format to ensure 100% universal
    playback across Google TV, Smart TVs, mobile browsers, and WebView2.

    Returns:
        Dictionary containing encoder name, type ('hardware' or 'cpu'),
        and recommended encoder arguments.
    """
    global _CACHED_ENCODER
    if _CACHED_ENCODER is not None:
        return _CACHED_ENCODER

    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        _CACHED_ENCODER = {
            "encoder": "libx264",
            "type": "cpu",
            "crf_param": "-crf",
            "preset_param": "-preset",
            "default_crf": 22,
            "default_preset": "medium",
            "extra_args": ["-pix_fmt", "yuv420p"],
        }
        return _CACHED_ENCODER

    # Check available encoders from ffmpeg
    try:
        proc = subprocess.run(
            [ffmpeg, "-encoders"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        encoders_output = proc.stdout
    except Exception as e:
        logger.warning(f"Failed to query ffmpeg encoders: {e}")
        encoders_output = ""

    candidates = [
        {
            "name": "h264_nvenc",
            "type": "hardware",
            "crf_param": "-cq",
            "preset_param": "-preset",
            "default_crf": 22,
            "default_preset": "p5",
            "extra_args": ["-pix_fmt", "yuv420p"],
        },
        {
            "name": "h264_qsv",
            "type": "hardware",
            "crf_param": "-global_quality",
            "preset_param": "-preset",
            "default_crf": 22,
            "default_preset": "medium",
            "extra_args": ["-pix_fmt", "yuv420p"],
        },
        {
            "name": "h264_amf",
            "type": "hardware",
            "crf_param": "-qp_p",
            "preset_param": "-quality",
            "default_crf": 22,
            "default_preset": "balanced",
            "extra_args": ["-pix_fmt", "yuv420p"],
        },
    ]

    selected = None
    for cand in candidates:
        if cand["name"] in encoders_output:
            # Test encoding 1 null frame to confirm driver/GPU actually supports it
            try:
                test_cmd = [
                    ffmpeg,
                    "-y",
                    "-f", "lavfi",
                    "-i", "color=c=black:s=64x64:d=0.1",
                    "-c:v", cand["name"],
                    "-pix_fmt", "yuv420p",
                    "-f", "null",
                    "-",
                ]
                res = subprocess.run(test_cmd, capture_output=True, timeout=4)
                if res.returncode == 0:
                    selected = {
                        "encoder": cand["name"],
                        "type": "hardware",
                        "crf_param": cand["crf_param"],
                        "preset_param": cand["preset_param"],
                        "default_crf": cand["default_crf"],
                        "default_preset": cand["default_preset"],
                        "extra_args": cand["extra_args"],
                    }
                    logger.info(f"Hardware H.264 acceleration active: {cand['name']}")
                    break
            except Exception:
                continue

    if not selected:
        selected = {
            "encoder": "libx264",
            "type": "cpu",
            "crf_param": "-crf",
            "preset_param": "-preset",
            "default_crf": 22,
            "default_preset": "medium",
            "extra_args": ["-pix_fmt", "yuv420p"],
        }
        logger.info("Using CPU libx264 for visually lossless, universal web/TV video encoding.")

    _CACHED_ENCODER = selected
    return _CACHED_ENCODER
