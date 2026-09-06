"""High-Performance Thumbnail and Display Proxy Generation Service.

This module provides sub-10ms micro-thumbnail generation and 2K/4K display proxies
with 2-character prefix hash sharding (thumbnails/{xx}/{hash}.webp) to eliminate
directory bottlenecks on external storage drives.
"""

import hashlib
import io
import logging
from pathlib import Path
from typing import Optional, Tuple
from PIL import Image, ImageOps, ImageFilter

from engine.config import settings

logger = logging.getLogger("securephotos.thumbnail_service")

# Ensure pillow can handle large high-res camera photos
Image.MAX_IMAGE_PIXELS = 200_000_000


def calculate_file_hash(filepath: Path | str) -> str:
    """Calculates full SHA-256 checksum of a file for unique identification.

    Args:
        filepath: Absolute path to target image file.

    Returns:
        Hexadecimal SHA-256 string.
    """
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest()


def get_sharded_thumbnail_path(file_hash: str, is_encrypted: bool = False) -> Path:
    """Computes the 2-character sharded destination path for a micro-thumbnail.

    Args:
        file_hash: 64-character SHA-256 hash.
        is_encrypted: Whether the thumbnail should use .enc extension.

    Returns:
        Path instance pointing to 'thumbnails/{xx}/{hash}.webp' (or .enc).
    """
    prefix = file_hash[:2]
    ext = ".enc" if is_encrypted else ".webp"
    sharded_dir = settings.thumbnails_dir / prefix
    sharded_dir.mkdir(parents=True, exist_ok=True)
    return sharded_dir / f"{file_hash}{ext}"


def get_sharded_preview_path(file_hash: str, is_encrypted: bool = False) -> Path:
    """Computes the 2-character sharded destination path for a 2K/4K display proxy.

    Args:
        file_hash: 64-character SHA-256 string.
        is_encrypted: Whether the preview should use .enc extension.

    Returns:
        Path instance pointing to 'previews/{xx}/{hash}.webp' (or .enc).
    """
    prefix = file_hash[:2].lower()
    ext = ".enc" if is_encrypted else ".webp"
    sharded_dir = settings.previews_dir / prefix
    sharded_dir.mkdir(parents=True, exist_ok=True)
    return sharded_dir / f"{file_hash}{ext}"


def generate_micro_thumbnail(
    source_path: Path | str,
    file_hash: Optional[str] = None,
    size: int = 1024,
    force: bool = False,
) -> Tuple[Path, int, int]:
    """Generates a high-speed 1024px Ultra-Crisp Retina micro-thumbnail for virtualized grid rendering.

    Args:
        source_path: Path to original source image.
        file_hash: Optional pre-calculated SHA-256 hash.
        size: Maximum bounding box dimension in pixels (default 1024px for High-DPI & panoramic crops).
        force: If True, forces regeneration even if cached thumbnail exists.

    Returns:
        Tuple containing (thumbnail_path, width, height).
    """
    src_path = Path(source_path)
    if not file_hash:
        file_hash = calculate_file_hash(src_path)

    dest_path = get_sharded_thumbnail_path(file_hash, is_encrypted=False)

    # Return existing thumbnail if already generated and at least requested size
    if dest_path.exists() and not force:
        with Image.open(dest_path) as img:
            if img.width >= size or img.height >= size:
                return dest_path, img.width, img.height

    dest_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(src_path) as img:
        # Correct orientation from EXIF tags
        img = ImageOps.exif_transpose(img)
        img.thumbnail((size, size), Image.Resampling.LANCZOS)
        
        # Convert RGBA/P to RGB for clean WebP compression
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Apply subtle unsharp mask to restore micro-contrast lost during downsampling
        img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=115, threshold=3))

        # Save with crisp WebP compression (quality 88, method 4)
        img.save(dest_path, "WEBP", quality=88, method=4)
        return dest_path, img.width, img.height


def generate_display_preview(
    source_path: Path | str,
    file_hash: Optional[str] = None,
    max_dimension: int = 2048,
) -> Path:
    """Generates a 2K/4K display proxy for smooth Lightbox zooming with zero lag.

    Args:
        source_path: Path to original image.
        file_hash: Optional pre-calculated SHA-256 hash.
        max_dimension: Max width or height for proxy.

    Returns:
        Path to generated display preview proxy.
    """
    src_path = Path(source_path)
    if not file_hash:
        file_hash = calculate_file_hash(src_path)

    dest_path = get_sharded_preview_path(file_hash, is_encrypted=False)

    if dest_path.exists():
        return dest_path

    with Image.open(src_path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        img.save(dest_path, "WEBP", quality=85, method=4)
        return dest_path
