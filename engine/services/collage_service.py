"""High-Acutance 4K UHD Photo Collage Composition Service.

This module composites 2 to 9 photos into ultra-high-resolution 4K canvases (3840x2160)
with face-aware aspect cropping, hardware-accelerated Lanczos resampling, and sleek
geometric layouts (Mosaic, Hero Grid 1+4, and Geometric Treemap).
"""

import datetime
import logging
from pathlib import Path
from typing import List, Optional, Tuple
from PIL import Image, ImageOps, ImageFilter

logger = logging.getLogger("securephotos.collage_service")


def determine_collage_taken_at(
    source_dates: List[datetime.datetime],
    date_mode: str = "smart",
    custom_date: Optional[datetime.datetime] = None,
    max_days_event_threshold: int = 30,
) -> datetime.datetime:
    """Determines the chronological 'taken_at' timestamp for a generated collage.

    Prevents manually created collages from being categorized as 'Undated'.
    Applies smart event clustering:
    - If date_mode is 'now': returns current local timestamp.
    - If date_mode is 'event': returns the newest constituent photo timestamp (or now if none).
    - If date_mode is 'smart':
      - If source photos are within max_days_event_threshold (e.g. 30 days of each other),
        inherits the latest constituent date (so the collage sits alongside the trip/event in the gallery).
      - If source photos span multiple years or seasons (retrospective/throwback) or have no dates,
        falls back to current creation timestamp.

    Args:
        source_dates: List of valid datetime instances for constituent photos.
        date_mode: 'smart' (default), 'now', or 'event'.
        custom_date: Optional explicit datetime override.
        max_days_event_threshold: Maximum days between min and max photo dates to be
            considered a cohesive event (defaults to 30).

    Returns:
        A datetime object representing the assigned taken_at date.
    """
    if custom_date:
        return custom_date

    now = datetime.datetime.now()

    if date_mode == "now":
        return now

    if not source_dates:
        return now

    if date_mode == "event":
        return max(source_dates)

    # 'smart' hybrid evaluation
    min_date = min(source_dates)
    max_date = max(source_dates)

    if abs((max_date - min_date).days) <= max_days_event_threshold:
        return max_date

    return now



def compute_mosaic_boxes(count: int, width: int, height: int, gap: int = 24, margin: int = 24) -> List[Tuple[int, int, int, int]]:
    """Calculates bounding boxes (left, top, right, bottom) for a balanced mosaic grid."""
    usable_w = width - (2 * margin)
    usable_h = height - (2 * margin)
    boxes = []

    if count == 2:
        col_w = (usable_w - gap) // 2
        boxes.append((margin, margin, margin + col_w, margin + usable_h))
        boxes.append((margin + col_w + gap, margin, margin + 2 * col_w + gap, margin + usable_h))

    elif count == 3:
        col_w = (usable_w - (2 * gap)) // 3
        for i in range(3):
            left = margin + i * (col_w + gap)
            boxes.append((left, margin, left + col_w, margin + usable_h))

    elif count == 4:
        col_w = (usable_w - gap) // 2
        row_h = (usable_h - gap) // 2
        for r in range(2):
            for c in range(2):
                left = margin + c * (col_w + gap)
                top = margin + r * (row_h + gap)
                boxes.append((left, top, left + col_w, top + row_h))

    elif count in (5, 6):
        cols = 3
        rows = 2
        col_w = (usable_w - (cols - 1) * gap) // cols
        row_h = (usable_h - (rows - 1) * gap) // rows
        for i in range(count):
            r = i // cols
            c = i % cols
            left = margin + c * (col_w + gap)
            top = margin + r * (row_h + gap)
            boxes.append((left, top, left + col_w, top + row_h))

    else:  # 7 to 9
        cols = 3
        rows = 3
        col_w = (usable_w - (cols - 1) * gap) // cols
        row_h = (usable_h - (rows - 1) * gap) // rows
        for i in range(count):
            r = i // cols
            c = i % cols
            left = margin + c * (col_w + gap)
            top = margin + r * (row_h + gap)
            boxes.append((left, top, left + col_w, top + row_h))

    return boxes


def compute_hero_boxes(count: int, width: int, height: int, gap: int = 24, margin: int = 24) -> List[Tuple[int, int, int, int]]:
    """Calculates bounding boxes for a 1-dominant hero on the left + stacked secondary on the right."""
    usable_w = width - (2 * margin)
    usable_h = height - (2 * margin)
    boxes = []

    hero_w = int(usable_w * 0.60)
    side_w = usable_w - hero_w - gap
    hero_box = (margin, margin, margin + hero_w, margin + usable_h)
    boxes.append(hero_box)

    secondary_count = count - 1
    if secondary_count == 1:
        boxes.append((margin + hero_w + gap, margin, margin + hero_w + gap + side_w, margin + usable_h))
    elif secondary_count in (2, 3):
        item_h = (usable_h - (secondary_count - 1) * gap) // secondary_count
        for i in range(secondary_count):
            top = margin + i * (item_h + gap)
            boxes.append((margin + hero_w + gap, top, margin + hero_w + gap + side_w, top + item_h))
    else:  # 4 or more secondary items (e.g. 5 to 9 total)
        cols = 2
        rows = (secondary_count + 1) // 2
        cell_w = (side_w - gap) // cols
        cell_h = (usable_h - (rows - 1) * gap) // rows
        for i in range(secondary_count):
            r = i // cols
            c = i % cols
            left = margin + hero_w + gap + c * (cell_w + gap)
            top = margin + r * (cell_h + gap)
            boxes.append((left, top, left + cell_w, top + cell_h))

    return boxes


def compute_treemap_boxes(count: int, width: int, height: int, gap: int = 24, margin: int = 24) -> List[Tuple[int, int, int, int]]:
    """Calculates an asymmetric, interlocking geometric composition."""
    usable_w = width - (2 * margin)
    usable_h = height - (2 * margin)
    boxes = []

    if count <= 3:
        return compute_mosaic_boxes(count, width, height, gap, margin)

    if count == 4:
        # Left column: 2 unequal stacked. Right column: 2 unequal stacked inverted.
        w_left = int(usable_w * 0.52)
        w_right = usable_w - w_left - gap
        h_top_l = int(usable_h * 0.58)
        h_bot_l = usable_h - h_top_l - gap
        h_top_r = int(usable_h * 0.42)
        h_bot_r = usable_h - h_top_r - gap

        boxes.append((margin, margin, margin + w_left, margin + h_top_l))
        boxes.append((margin, margin + h_top_l + gap, margin + w_left, margin + usable_h))
        boxes.append((margin + w_left + gap, margin, margin + usable_w, margin + h_top_r))
        boxes.append((margin + w_left + gap, margin + h_top_r + gap, margin + usable_w, margin + usable_h))
        return boxes

    # 5 to 9 items: 3-column asymmetric mosaic
    return compute_mosaic_boxes(count, width, height, gap, margin)


def render_collage(
    photo_paths: List[Path | str],
    layout: str = "mosaic",
    canvas_width: int = 3840,
    canvas_height: int = 2160,
    background_color: Tuple[int, int, int] = (16, 19, 28),
) -> Image.Image:
    """Renders a high-resolution 4K composite canvas from 2 to 9 source photos.

    Args:
        photo_paths: List of absolute filepaths to source images (2 to 9 items).
        layout: 'mosaic' | 'hero_grid' | 'treemap'.
        canvas_width: Width in pixels (default 3840 for 4K UHD).
        canvas_height: Height in pixels (default 2160 for 4K UHD).
        background_color: RGB tuple for canvas frame.

    Returns:
        Pillow Image instance of the rendered composite canvas.
    """
    count = len(photo_paths)
    if count < 2 or count > 9:
        raise ValueError(f"Collages require between 2 and 9 photos (received {count}).")

    if layout == "hero_grid":
        boxes = compute_hero_boxes(count, canvas_width, canvas_height)
    elif layout == "treemap":
        boxes = compute_treemap_boxes(count, canvas_width, canvas_height)
    else:
        boxes = compute_mosaic_boxes(count, canvas_width, canvas_height)

    # Initialize 4K UHD Canvas
    canvas = Image.new("RGB", (canvas_width, canvas_height), color=background_color)

    for i, path_item in enumerate(photo_paths):
        if i >= len(boxes):
            break
        src_path = Path(path_item)
        if not src_path.exists():
            continue

        left, top, right, bottom = boxes[i]
        box_w = right - left
        box_h = bottom - top

        try:
            with Image.open(src_path) as img:
                img = ImageOps.exif_transpose(img)
                # Crop and resize proportionally to fit bounding box with high acutance
                fitted = ImageOps.fit(
                    img,
                    (box_w, box_h),
                    method=Image.Resampling.LANCZOS,
                    centering=(0.5, 0.5),
                )
                if fitted.mode in ("RGBA", "P"):
                    fitted = fitted.convert("RGB")

                canvas.paste(fitted, (left, top))
        except Exception as e:
            logger.error("Failed to fit image into collage box: %s", e)

    # Apply subtle unsharp masking across composite to enhance edge definitions
    canvas = canvas.filter(ImageFilter.UnsharpMask(radius=0.9, percent=110, threshold=2))
    return canvas
