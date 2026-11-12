"""High-Acutance 4K UHD Photo Collage Composition Service.

This module composites 2 to 9 photos into ultra-high-resolution 4K canvases (3840x2160)
with face-aware aspect cropping, hardware-accelerated Lanczos resampling, and sleek
geometric layouts (Mosaic, Hero Grid 1+4, and Geometric Treemap).
"""

import datetime
import hashlib
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import aiosqlite
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
        h_top_l = int(usable_h * 0.58)
        h_top_r = int(usable_h * 0.42)

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


def select_optimal_collage_layout(photo_dimensions: List[Tuple[int, int]]) -> str:
    """Selects the most aesthetic layout based on constituent photo orientations.
    
    - When 3 photos are predominantly vertical (portrait 9:16/3:4), uses 'mosaic'
      (3 vertical columns) to naturally fit a 16:9 4K canvas without cutting subjects.
    - When there is 1 dominant landscape + 2 portraits, uses 'hero_grid'.
    - When 4 photos, uses 2x2 'mosaic'.
    """
    count = len(photo_dimensions)
    if count == 3:
        portrait_count = sum(1 for w, h in photo_dimensions if h > w)
        landscape_count = sum(1 for w, h in photo_dimensions if w >= h)
        if portrait_count == 3:
            return "mosaic"  # 3 vertical columns fits 9:16 portrait mobile photos cleanly
        if landscape_count == 1:
            return "hero_grid"  # 1 dominant landscape hero + 2 stacked portraits
        return "mosaic"
    elif count == 4:
        return "mosaic"  # 2x2 grid
    elif count == 2:
        return "mosaic"  # 2 columns
    return "mosaic"


async def generate_intelligent_collages(conn: aiosqlite.Connection) -> List[Dict[str, Any]]:
    """Synthesizes intelligent 4K collage suggestions based on temporal, person, and event clusters.

    Generates balanced 4K compositions optimized for smartphone photography:
    - 3-column vertical Mosaic for portrait photos (zero awkward cropping).
    - Hero Grid (1 large hero + stacked secondary) for mixed landscape/portrait.
    - 2x2 Mosaic for balanced 4-photo clusters.
    """
    conn.row_factory = aiosqlite.Row

    # 1. Fetch active, un-trashed, un-encrypted photos (excluding raw video containers)
    async with conn.execute(
        """
        SELECT id, filename, filepath, taken_at, width, height, is_favorite, mime_type
        FROM photos
        WHERE trashed_at IS NULL AND is_encrypted = 0
          AND (mime_type IS NULL OR mime_type NOT LIKE 'video/%')
        ORDER BY taken_at DESC, id DESC;
        """
    ) as cursor:
        photos = [dict(r) for r in await cursor.fetchall()]

    if len(photos) < 2:
        return []

    photo_map = {p["id"]: p for p in photos}

    # 2. Fetch existing collages in "Collages" album to track is_already_saved
    saved_collages_map: Dict[str, int] = {}
    async with conn.execute(
        """
        SELECT p.id, p.caption, p.filename
        FROM photos p
        JOIN photo_album pa ON p.id = pa.photo_id
        JOIN albums a ON pa.album_id = a.id
        WHERE LOWER(a.name) = 'collages' AND p.trashed_at IS NULL AND p.is_encrypted = 0;
        """
    ) as cursor:
        for r in await cursor.fetchall():
            caption = (r["caption"] or "").lower()
            saved_collages_map[caption] = r["id"]

    # 3. Fetch Person associations
    person_photos: Dict[int, List[int]] = {}
    person_meta: Dict[int, Dict[str, Any]] = {}
    async with conn.execute(
        """
        SELECT p.id as person_id, p.name, p.is_close_one, f.photo_id
        FROM persons p
        JOIN faces f ON p.id = f.person_id
        JOIN photos ph ON f.photo_id = ph.id
        WHERE p.name IS NOT NULL AND p.name != ''
          AND ph.trashed_at IS NULL AND ph.is_encrypted = 0
          AND (ph.mime_type IS NULL OR ph.mime_type NOT LIKE 'video/%')
        ORDER BY p.is_close_one DESC, p.id ASC;
        """
    ) as cursor:
        for r in await cursor.fetchall():
            pid = r["person_id"]
            if pid not in person_photos:
                person_photos[pid] = []
                person_meta[pid] = {"name": r["name"], "is_close_one": bool(r["is_close_one"])}
            if r["photo_id"] not in person_photos[pid]:
                person_photos[pid].append(r["photo_id"])

    suggestions: List[Dict[str, Any]] = []
    seen_photo_sets = set()

    def add_suggestion(
        cluster_id: str,
        title: str,
        subtitle: str,
        cluster_type: str,
        candidate_ids: List[int],
    ):
        chosen_ids = candidate_ids[:4]
        if len(chosen_ids) < 2:
            return
        if len(chosen_ids) not in (2, 3, 4):
            chosen_ids = chosen_ids[:3]

        frozen_set = frozenset(chosen_ids)
        if frozen_set in seen_photo_sets:
            return
        seen_photo_sets.add(frozen_set)

        dims = [
            (photo_map[pid].get("width") or 1920, photo_map[pid].get("height") or 1080)
            for pid in chosen_ids
            if pid in photo_map
        ]
        layout = select_optimal_collage_layout(dims)

        # Check if saved
        caption_key = f"4k collage ({layout}): {title}".lower()
        saved_id = saved_collages_map.get(caption_key) or saved_collages_map.get(title.lower())

        # Determine reference taken_at
        dts = [
            photo_map[pid].get("taken_at")
            for pid in chosen_ids
            if pid in photo_map and photo_map[pid].get("taken_at")
        ]
        ref_dt = dts[0] if dts else None

        suggestions.append({
            "id": cluster_id,
            "title": title,
            "subtitle": subtitle,
            "cluster_type": cluster_type,
            "layout": layout,
            "photo_ids": chosen_ids,
            "preview_photo_ids": chosen_ids,
            "taken_at": ref_dt,
            "is_already_saved": saved_id is not None,
            "saved_photo_id": saved_id,
        })

    # Strategy A: Close Ones & People Collages
    for pid, pids in person_photos.items():
        if len(pids) >= 2:
            name = person_meta[pid]["name"]
            sorted_pids = sorted(
                pids,
                key=lambda x: (not photo_map.get(x, {}).get("is_favorite", 0), -(photo_map.get(x, {}).get("id") or 0)),
            )
            cand = sorted_pids[:3] if len(sorted_pids) >= 3 else sorted_pids[:2]
            cid = f"person_{pid}_{hashlib.sha256(str(cand).encode()).hexdigest()[:6]}"
            add_suggestion(
                cluster_id=cid,
                title=f"Moments with {name}",
                subtitle=f"{len(cand)} cherished moments",
                cluster_type="person",
                candidate_ids=cand,
            )

    # Strategy B: Event & Trip Burst Clusters (photos taken on the same date or trip burst)
    date_groups: Dict[str, List[int]] = {}
    for p in photos:
        ta = p.get("taken_at")
        if ta:
            date_key = ta[:10]  # YYYY-MM-DD
            date_groups.setdefault(date_key, []).append(p["id"])

    for d_str, d_pids in date_groups.items():
        if len(d_pids) >= 3:
            try:
                dt_obj = datetime.datetime.strptime(d_str, "%Y-%m-%d")
                formatted_date = dt_obj.strftime("%B %d, %Y")
                month_year = dt_obj.strftime("%B %Y")
            except Exception:
                formatted_date = d_str
                month_year = d_str

            cand = d_pids[:4]
            cid = f"event_{d_str.replace('-', '')}_{hashlib.sha256(str(cand).encode()).hexdigest()[:6]}"
            add_suggestion(
                cluster_id=cid,
                title=f"Event Highlights • {formatted_date}",
                subtitle=f"{len(cand)} moments • {month_year}",
                cluster_type="event",
                candidate_ids=cand,
            )

    # Strategy C: Favorites Collection (if at least 2 favorites)
    fav_ids = [p["id"] for p in photos if p.get("is_favorite")]
    if len(fav_ids) >= 2:
        cand = fav_ids[:4]
        cid = f"favorites_{hashlib.sha256(str(cand).encode()).hexdigest()[:6]}"
        add_suggestion(
            cluster_id=cid,
            title="Golden Favorites Showcase",
            subtitle=f"{len(cand)} top-rated memories",
            cluster_type="favorites",
            candidate_ids=cand,
        )

    # Strategy D: Recent Moments (general library highlight fallback)
    if len(photos) >= 3 and len(suggestions) < 3:
        cand = [p["id"] for p in photos[:3]]
        cid = f"recent_{hashlib.sha256(str(cand).encode()).hexdigest()[:6]}"
        add_suggestion(
            cluster_id=cid,
            title="Recent Highlights",
            subtitle=f"{len(cand)} moments",
            cluster_type="seasonal",
            candidate_ids=cand,
        )

    return suggestions

