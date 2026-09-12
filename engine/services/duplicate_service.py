"""Duplicate and Clutter Detection & Space Reclaim Service for SecurePhotos.

This service identifies exact duplicates (SHA-256 file hash collisions) and
perceptually near-identical / burst shot photos (64-bit dHash perceptual hashing),
evaluates and scores each photo to determine the AI-suggested "Best Pick",
and safely orchestrates space reclamation via the 30-day soft-delete trash.
"""

import itertools
import logging
import struct
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from PIL import Image
import aiosqlite

logger = logging.getLogger("securephotos.services.duplicates")


def _to_float(val: Any) -> float:
    """Safely converts numerical or 4-byte packed float to Python float."""
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, (bytes, bytearray)) and len(val) == 4:
        return float(struct.unpack("<f", val)[0])
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0



def compute_image_dhash(image_path: str | Path, hash_size: int = 8) -> Optional[str]:
    """Computes a 64-bit difference hash (dHash) for an image.
    
    The algorithm converts the image to grayscale, resizes it to (hash_size + 1, hash_size),
    and compares adjacent horizontal pixels. This produces hash_size * hash_size bits
    resilient to scaling, aspect ratio shifts, and minor compression artifacts.

    Args:
        image_path: Path to the image file on disk.
        hash_size: Width/height dimension for hashing (default 8 yields 64 bits).

    Returns:
        16-character hex representation of the 64-bit hash, or None if unreadable.
    """
    path = Path(image_path)
    if not path.is_file():
        return None

    try:
        with Image.open(path) as img:
            # Convert to grayscale 8-bit
            gray = img.convert("L")
            # Resize to 9x8 for an 8x8 comparison grid
            resized = gray.resize((hash_size + 1, hash_size), Image.Resampling.BILINEAR)
            pixels = list(resized.tobytes())

            # Row-by-row horizontal difference comparison
            bits = []
            width = hash_size + 1
            for row in range(hash_size):
                row_offset = row * width
                for col in range(hash_size):
                    left = pixels[row_offset + col]
                    right = pixels[row_offset + col + 1]
                    bits.append("1" if left > right else "0")

            hash_int = int("".join(bits), 2)
            return f"{hash_int:016x}"
    except Exception as exc:
        logger.warning(f"Failed to compute dHash for {path}: {exc}")
        return None


def hamming_distance(hash1: str, hash2: str) -> int:
    """Calculates the bitwise Hamming distance between two 16-character hex dHashes.

    Args:
        hash1: 16-character hexadecimal hash string.
        hash2: 16-character hexadecimal hash string.

    Returns:
        Number of bit positions where the two hashes differ (0 to 64).
    """
    try:
        val1 = int(hash1, 16)
        val2 = int(hash2, 16)
        return bin(val1 ^ val2).count("1")
    except (ValueError, TypeError):
        return 64


def score_candidate_photo(
    photo: Dict[str, Any],
    faces: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[float, str]:
    """Evaluates and scores a candidate photo to recommend the AI 'Best Pick'.

    Scoring hierarchy:
    1. User Favorite: +5000 pts (Human intention explicitly overrides heuristics)
    2. Super-Resolution Enhanced: +1000 pts
    3. 4K Optimized / Lossless: +250 pts
    4. Human Subject & Facial Clarity:
       - Detected face quality: quality_score * 1000.0 pts
       - VIP Close-One multiplier: +300.0 * quality_score for family / close ones
       - Named person multiplier: +150.0 * quality_score
       - Face prominence: (box_w * box_h) * 500.0 pts
    5. Image Resolution: 50.0 pts per Megapixel
    6. Overall Sharpness: blur_score * 0.5 (capped at 50 pts)
    7. SLM Aesthetic Quality: quality_score * 10.0 pts
    8. File Size: Pure tie-breaker (0.01 pts per MB) to prevent compression noise
       from overriding facial quality or frontality.

    Args:
        photo: Dictionary containing photo attributes.
        faces: Optional list of detected faces associated with this photo.

    Returns:
        A tuple of (computed_score, human_readable_reason).
    """
    score = 0.0
    reasons: List[str] = []

    # 1. Favorite flag (strongest signal of human preference)
    if photo.get("is_favorite"):
        score += 5000.0
        reasons.append("Marked Favorite")

    # 2. Enhanced status
    if photo.get("is_enhanced"):
        score += 1000.0
        reasons.append("AI Enhanced")
    elif photo.get("is_optimized"):
        score += 250.0
        reasons.append("Optimized")

    # 3. Human Subject & Facial Clarity (Dominates technical compression metrics)
    if faces:
        total_face_score = 0.0
        best_face_name = ""
        best_face_clarity = 0.0
        close_one_names: List[str] = []

        for f in faces:
            q = _to_float(f.get("quality_score") or 0.0)
            is_close = bool(f.get("is_close_one"))
            name = f.get("name")
            bw = _to_float(f.get("box_w"))
            bh = _to_float(f.get("box_h"))
            face_area = max(0.0, min(1.0, bw * bh))

            face_pts = q * 1000.0
            if is_close:
                face_pts += 300.0 * q
                if name and name not in close_one_names:
                    close_one_names.append(name)
            if name:
                face_pts += 150.0 * q
            face_pts += face_area * 500.0

            total_face_score += face_pts

            if q > best_face_clarity:
                best_face_clarity = q
                if name:
                    best_face_name = name

        score += total_face_score

        if best_face_name and best_face_clarity >= 0.70:
            reasons.append(f"Front Portrait ({best_face_name}: {round(best_face_clarity, 2)})")
        elif close_one_names:
            reasons.append(f"Clear Subject ({', '.join(close_one_names)})")
        elif best_face_clarity >= 0.85:
            reasons.append(f"High Face Clarity ({round(best_face_clarity, 2)})")
        elif len(faces) > 0:
            reasons.append(f"Detected Faces ({len(faces)})")

    # 4. Image Resolution (50 pts per MP)
    width = photo.get("width") or 0
    height = photo.get("height") or 0
    pixels = width * height
    if pixels > 0:
        mp = pixels / 1_000_000.0
        score += mp * 50.0
        if mp >= 1.0:
            reasons.append(f"{width}x{height} ({round(mp, 1)} MP)")
        else:
            reasons.append(f"{width}x{height}")

    # 5. Sharpness / Blur score
    blur = photo.get("blur_score") or 0.0
    if blur > 0:
        score += min(50.0, blur * 0.5)
        if blur > 50.0:
            reasons.append("High Sharpness")

    # 6. SLM Quality score
    quality = photo.get("quality_score") or 0.0
    if quality > 0:
        score += quality * 10.0

    # 7. File size (pure tie-breaker, never outweighs facial clarity or resolution)
    size = photo.get("file_size") or 0
    if size > 0:
        score += (size / 1_000_000.0) * 0.01

    reason_str = " • ".join(reasons) if reasons else "Best Available Resolution"
    return score, reason_str


async def fetch_faces_for_photos(
    conn: aiosqlite.Connection,
    photo_ids: List[int],
) -> Dict[int, List[Dict[str, Any]]]:
    """Fetches all face detections and associated person metadata for a list of photo IDs in a single batch query.

    Args:
        conn: Open aiosqlite database connection.
        photo_ids: List of photo IDs to query.

    Returns:
        Dictionary mapping photo_id to list of face records.
    """
    if not photo_ids:
        return {}

    faces_by_photo: Dict[int, List[Dict[str, Any]]] = {}
    conn.row_factory = aiosqlite.Row
    placeholders = ",".join("?" for _ in photo_ids)
    query = f"""
        SELECT 
            f.id, f.photo_id, f.person_id, p.name, p.is_close_one, p.relationship_type,
            f.quality_score, f.box_x, f.box_y, f.box_w, f.box_h
        FROM faces f
        LEFT JOIN persons p ON f.person_id = p.id
        WHERE f.photo_id IN ({placeholders})
        ORDER BY f.photo_id ASC, f.quality_score DESC;
    """
    async with conn.execute(query, photo_ids) as cursor:
        rows = await cursor.fetchall()
        for r in rows:
            faces_by_photo.setdefault(r["photo_id"], []).append(dict(r))

    return faces_by_photo



class UnionFind:
    """Disjoint-set data structure for clustering near-duplicate photos."""

    def __init__(self) -> None:
        self.parent: Dict[int, int] = {}

    def find(self, item: int) -> int:
        if item not in self.parent:
            self.parent[item] = item
            return item
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def union(self, item1: int, item2: int) -> None:
        root1 = self.find(item1)
        root2 = self.find(item2)
        if root1 != root2:
            self.parent[root2] = root1


async def scan_and_cluster_duplicates(conn: aiosqlite.Connection) -> List[Dict[str, Any]]:
    """Scans all active media items, clusters exact and near duplicates, and syncs DB.

    1. Gathers all non-encrypted, active (untrashed) photos.
    2. Clusters exact duplicates by SHA-256 `file_hash`.
    3. For remaining unclustered photos, checks/computes perceptual `phash`.
    4. Clusters near-duplicate and burst shots with Hamming distance <= 8.
    5. Clears stale records in `duplicate_groups` and persists updated groupings.

    Args:
        conn: Open aiosqlite database connection.

    Returns:
        List of structured duplicate group objects.
    """
    conn.row_factory = aiosqlite.Row
    query = """
        SELECT 
            id, filename, filepath, file_size, mime_type, width, height,
            taken_at, camera_make, camera_model, is_favorite, is_encrypted,
            is_optimized, is_enhanced, caption, thumbnail_path, preview_path,
            blur_score, quality_score, phash, file_hash, folder_name
        FROM photos
        WHERE trashed_at IS NULL AND is_encrypted = 0
        ORDER BY id ASC;
    """
    cursor = await conn.execute(query)
    rows = await cursor.fetchall()
    photos = [dict(r) for r in rows]

    if len(photos) < 2:
        await conn.execute("DELETE FROM duplicate_groups;")
        await conn.commit()
        return []

    # ── 0. Load Persistent Duplicate Dismissals ──────────────────────────────
    dismissed_pairs: Set[Tuple[int, int]] = set()
    async with conn.execute("SELECT photo_id_1, photo_id_2 FROM duplicate_dismissals;") as cur:
        drows = await cur.fetchall()
        for dr in drows:
            p1, p2 = int(dr[0]), int(dr[1])
            dismissed_pairs.add((min(p1, p2), max(p1, p2)))

    # ── 1. Exact Duplicate Clustering (by file_hash) ─────────────────────────
    hash_groups: Dict[str, List[Dict[str, Any]]] = {}
    for p in photos:
        fhash = p.get("file_hash")
        if fhash and len(fhash) >= 16:
            hash_groups.setdefault(fhash, []).append(p)

    grouped_photo_ids: Set[int] = set()
    clusters: List[Dict[str, Any]] = []

    for fhash, members in hash_groups.items():
        if len(members) >= 2:
            # Respect pairwise dismissals within exact hash matches
            exact_uf = UnionFind()
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    pk = (min(members[i]["id"], members[j]["id"]), max(members[i]["id"], members[j]["id"]))
                    if pk not in dismissed_pairs:
                        exact_uf.union(members[i]["id"], members[j]["id"])

            subgroups: Dict[int, List[Dict[str, Any]]] = {}
            for m in members:
                root = exact_uf.find(m["id"])
                subgroups.setdefault(root, []).append(m)

            for root, sub_members in subgroups.items():
                if len(sub_members) >= 2:
                    group_id = f"exact_{fhash[:8]}_{root}"
                    for m in sub_members:
                        grouped_photo_ids.add(m["id"])
                    clusters.append({
                        "group_id": group_id,
                        "match_type": "exact",
                        "distance": 0,
                        "members": sub_members,
                    })

    # ── 2. Perceptual Near-Duplicate Clustering ──────────────────────────────
    remaining_photos = [p for p in photos if p["id"] not in grouped_photo_ids]

    # Populate missing phashes if feasible
    for p in remaining_photos:
        if not p.get("phash"):
            # Check original file or preview/thumbnail
            candidate_paths = [p.get("filepath"), p.get("preview_path"), p.get("thumbnail_path")]
            computed_phash = None
            for cp in candidate_paths:
                if cp:
                    computed_phash = compute_image_dhash(cp)
                    if computed_phash:
                        break
            if computed_phash:
                p["phash"] = computed_phash
                await conn.execute("UPDATE photos SET phash = ? WHERE id = ?;", (computed_phash, p["id"]))

    await conn.commit()

    # Build near-duplicate clusters using Union-Find
    uf = UnionFind()
    phash_photos = [p for p in remaining_photos if p.get("phash")]
    distances: Dict[Tuple[int, int], int] = {}

    # Pairwise comparison with Hamming distance <= 8 (over 64 bits = ~87.5%+ visual match)
    for i in range(len(phash_photos)):
        p1 = phash_photos[i]
        h1 = p1["phash"]
        for j in range(i + 1, len(phash_photos)):
            p2 = phash_photos[j]
            pair_key = (min(p1["id"], p2["id"]), max(p1["id"], p2["id"]))
            if pair_key in dismissed_pairs:
                continue
            h2 = p2["phash"]
            dist = hamming_distance(h1, h2)
            if dist <= 8:
                uf.union(p1["id"], p2["id"])
                distances[pair_key] = dist

    # Group connected components
    components: Dict[int, List[Dict[str, Any]]] = {}
    for p in phash_photos:
        root = uf.find(p["id"])
        components.setdefault(root, []).append(p)

    for root, members in components.items():
        if len(members) >= 2:
            group_id = f"near_{root}"
            # Average distance in cluster
            cluster_dists = []
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    pk = (min(members[i]["id"], members[j]["id"]), max(members[i]["id"], members[j]["id"]))
                    if pk in distances:
                        cluster_dists.append(distances[pk])
            avg_dist = round(sum(cluster_dists) / len(cluster_dists)) if cluster_dists else 4

            clusters.append({
                "group_id": group_id,
                "match_type": "near",
                "distance": avg_dist,
                "members": members,
            })

    # ── 3. Evaluate Best Picks, Reclaimable Bytes, and Sync DB ───────────────
    await conn.execute("DELETE FROM duplicate_groups;")

    # Batch fetch faces for all cluster members in a single query
    all_cluster_photo_ids = [m["id"] for cluster in clusters for m in cluster["members"]]
    faces_by_photo = await fetch_faces_for_photos(conn, all_cluster_photo_ids)

    result_groups: List[Dict[str, Any]] = []

    for cluster in clusters:
        group_id = cluster["group_id"]
        match_type = cluster["match_type"]
        distance = cluster["distance"]
        members = cluster["members"]

        # Score members to choose suggested best
        best_photo = None
        best_score = -1.0
        best_reason = ""

        for m in members:
            faces = faces_by_photo.get(m["id"], [])
            score, reason = score_candidate_photo(m, faces)
            if score > best_score:
                best_score = score
                best_photo = m
                best_reason = reason

        best_id = best_photo["id"] if best_photo else members[0]["id"]

        # Reclaimable bytes is total size of all duplicate copies except the kept one
        total_bytes = sum(m.get("file_size") or 0 for m in members)
        kept_bytes = (best_photo.get("file_size") or 0) if best_photo else (members[0].get("file_size") or 0)
        reclaimable_bytes = max(0, total_bytes - kept_bytes)

        # Persist to duplicate_groups table
        for m in members:
            await conn.execute(
                """
                INSERT INTO duplicate_groups (group_id, photo_id, match_type, distance)
                VALUES (?, ?, ?, ?);
                """,
                (group_id, m["id"], match_type, distance),
            )

        result_groups.append({
            "group_id": group_id,
            "match_type": match_type,
            "distance": distance,
            "suggested_best_photo_id": best_id,
            "best_reason": best_reason,
            "reclaimable_bytes": reclaimable_bytes,
            "photos": members,
        })

    await conn.commit()
    return result_groups


async def get_duplicate_groups(conn: aiosqlite.Connection) -> List[Dict[str, Any]]:
    """Retrieves current duplicate groups with their photo items and best pick suggestion.

    Args:
        conn: Open aiosqlite database connection.

    Returns:
        List of duplicate groups with fully hydrated photo items.
    """
    conn.row_factory = aiosqlite.Row

    # Query groups and photo details
    query = """
        SELECT 
            dg.group_id, dg.match_type, dg.distance,
            p.id, p.filename, p.filepath, p.file_size, p.mime_type, p.width, p.height,
            p.taken_at, p.camera_make, p.camera_model, p.is_favorite, p.is_encrypted,
            p.is_optimized, p.is_enhanced, p.caption, p.thumbnail_path, p.preview_path,
            p.blur_score, p.quality_score, p.file_hash, p.folder_name
        FROM duplicate_groups dg
        JOIN photos p ON dg.photo_id = p.id
        WHERE p.trashed_at IS NULL AND p.is_encrypted = 0
        ORDER BY dg.group_id ASC, p.id ASC;
    """
    cursor = await conn.execute(query)
    rows = await cursor.fetchall()

    grouped: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        gid = r["group_id"]
        if gid not in grouped:
            grouped[gid] = {
                "group_id": gid,
                "match_type": r["match_type"],
                "distance": r["distance"],
                "photos": [],
            }
        photo_dict = {
            "id": r["id"],
            "filename": r["filename"] or "",
            "filepath": r["filepath"],
            "file_size": r["file_size"],
            "mime_type": r["mime_type"],
            "width": r["width"],
            "height": r["height"],
            "taken_at": r["taken_at"],
            "camera_make": r["camera_make"],
            "camera_model": r["camera_model"],
            "is_favorite": bool(r["is_favorite"]),
            "is_encrypted": bool(r["is_encrypted"]),
            "is_optimized": bool(r["is_optimized"]),
            "is_enhanced": bool(r["is_enhanced"]),
            "caption": r["caption"],
            "thumbnail_path": r["thumbnail_path"],
            "preview_path": r["preview_path"],
            "blur_score": r["blur_score"],
            "quality_score": r["quality_score"],
            "file_hash": r["file_hash"],
        }
        grouped[gid]["photos"].append(photo_dict)

    # Batch fetch faces for all member photos
    all_photo_ids = [r["id"] for r in rows]
    faces_by_photo = await fetch_faces_for_photos(conn, all_photo_ids)

    # Filter out any groups that now have fewer than 2 active photos
    valid_groups = []
    for gid, gdata in grouped.items():
        members = gdata["photos"]
        if len(members) >= 2:
            best_photo = None
            best_score = -1.0
            best_reason = ""
            for m in members:
                faces = faces_by_photo.get(m["id"], [])
                score, reason = score_candidate_photo(m, faces)
                if score > best_score:
                    best_score = score
                    best_photo = m
                    best_reason = reason

            best_id = best_photo["id"] if best_photo else members[0]["id"]
            total_bytes = sum(m.get("file_size") or 0 for m in members)
            kept_bytes = (best_photo.get("file_size") or 0) if best_photo else (members[0].get("file_size") or 0)
            reclaimable_bytes = max(0, total_bytes - kept_bytes)

            valid_groups.append({
                "group_id": gid,
                "match_type": gdata["match_type"],
                "distance": gdata["distance"],
                "suggested_best_photo_id": best_id,
                "best_reason": best_reason,
                "reclaimable_bytes": reclaimable_bytes,
                "photos": members,
            })

    return valid_groups


async def get_duplicate_summary(conn: aiosqlite.Connection) -> Dict[str, Any]:
    """Retrieves high-level summary metrics of detected duplicates and reclaimable space.

    Args:
        conn: Open aiosqlite database connection.

    Returns:
        Summary dict containing total_groups, total_duplicate_photos, and reclaimable_bytes.
    """
    groups = await get_duplicate_groups(conn)
    total_groups = len(groups)
    total_duplicate_photos = sum(len(g["photos"]) - 1 for g in groups)
    total_reclaimable_bytes = sum(g["reclaimable_bytes"] for g in groups)

    return {
        "total_groups": total_groups,
        "total_duplicate_photos": total_duplicate_photos,
        "reclaimable_bytes": total_reclaimable_bytes,
    }


async def resolve_duplicate_group(
    conn: aiosqlite.Connection,
    group_id: str,
    keep_photo_ids: Any,
) -> Dict[str, Any]:
    """Resolves a duplicate group by keeping designated photo(s) and soft-trashing the rest.

    If multiple photos are kept (e.g. 'Keep Both' or multiple selected burst shots),
    persists pairwise dismissals into `duplicate_dismissals` to guarantee they will
    never appear together as duplicates in future scans or library operations.

    Args:
        conn: Open aiosqlite database connection.
        group_id: Identifier of the duplicate cluster.
        keep_photo_ids: Single int photo ID or list of int photo IDs to keep.

    Returns:
        Status dictionary with count of kept, trashed photos and reclaimed bytes.
    """
    conn.row_factory = aiosqlite.Row

    # Normalize keep_photo_ids to list of integers
    if isinstance(keep_photo_ids, (int, str)):
        try:
            keep_ids = [int(keep_photo_ids)]
        except (ValueError, TypeError):
            keep_ids = []
    elif isinstance(keep_photo_ids, (list, tuple, set)):
        keep_ids = [int(x) for x in keep_photo_ids]
    else:
        keep_ids = []

    # Find members of this group
    cursor = await conn.execute(
        """
        SELECT p.id, p.file_size 
        FROM duplicate_groups dg
        JOIN photos p ON dg.photo_id = p.id
        WHERE dg.group_id = ? AND p.trashed_at IS NULL;
        """,
        (group_id,),
    )
    rows = await cursor.fetchall()

    trash_ids = [r["id"] for r in rows if r["id"] not in keep_ids]
    reclaimed_bytes = sum(r["file_size"] for r in rows if r["id"] in trash_ids)

    # 1. Soft-delete unkept photos into 30-day Trash
    if trash_ids:
        placeholders = ",".join("?" for _ in trash_ids)
        await conn.execute(
            f"UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders});",
            trash_ids,
        )

    # 2. If 2 or more photos are kept, record persistent dismissals so they never reappear
    if len(keep_ids) >= 2:
        for p1, p2 in itertools.combinations(keep_ids, 2):
            p_min, p_max = min(p1, p2), max(p1, p2)
            await conn.execute(
                """
                INSERT OR IGNORE INTO duplicate_dismissals (photo_id_1, photo_id_2)
                VALUES (?, ?);
                """,
                (p_min, p_max),
            )

    # 3. Clean up group from duplicate_groups
    await conn.execute("DELETE FROM duplicate_groups WHERE group_id = ?;", (group_id,))
    await conn.commit()

    return {
        "status": "ok",
        "group_id": group_id,
        "kept_photo_ids": keep_ids,
        "trashed_count": len(trash_ids),
        "reclaimed_bytes": reclaimed_bytes,
    }


async def resolve_all_duplicates_best(conn: aiosqlite.Connection) -> Dict[str, Any]:
    """Resolves all duplicate groups at once by automatically keeping the AI Best Pick.

    Args:
        conn: Open aiosqlite database connection.

    Returns:
        Summary dict of total resolved groups, trashed items, and reclaimed bytes.
    """
    groups = await get_duplicate_groups(conn)
    total_trashed = 0
    total_reclaimed = 0

    all_trash_ids: List[int] = []

    for g in groups:
        best_id = g["suggested_best_photo_id"]
        for p in g["photos"]:
            if p["id"] != best_id:
                all_trash_ids.append(p["id"])
                total_reclaimed += p.get("file_size") or 0

    if all_trash_ids:
        placeholders = ",".join("?" for _ in all_trash_ids)
        await conn.execute(
            f"UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders});",
            all_trash_ids,
        )
        total_trashed = len(all_trash_ids)

    # Clear all duplicate groups
    await conn.execute("DELETE FROM duplicate_groups;")
    await conn.commit()

    return {
        "status": "ok",
        "resolved_groups": len(groups),
        "trashed_count": total_trashed,
        "reclaimed_bytes": total_reclaimed,
    }
