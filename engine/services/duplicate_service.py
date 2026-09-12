"""Duplicate and Clutter Detection & Space Reclaim Service for SecurePhotos.

This service identifies exact duplicates (SHA-256 file hash collisions) and
perceptually near-identical / burst shot photos (64-bit dHash perceptual hashing),
evaluates and scores each photo to determine the AI-suggested "Best Pick",
and safely orchestrates space reclamation via the 30-day soft-delete trash.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from PIL import Image
import aiosqlite

logger = logging.getLogger("securephotos.services.duplicates")


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


def score_candidate_photo(photo: Dict[str, Any]) -> Tuple[float, str]:
    """Evaluates and scores a candidate photo to recommend the AI 'Best Pick'.

    Scoring factors:
    - User Favorite: +5000 pts (User intention strongly overrides heuristics)
    - Super-Resolution Enhanced: +1000 pts
    - 4K Optimized / Lossless: +250 pts
    - Resolution (Megapixels): Proportional to width * height (50 pts per MP)
    - Sharpness / Blur score: High blur_score indicates crisp edge detail
    - Aesthetic Quality score: Higher SLM aesthetic ranking
    - File size: Larger files generally retain greater uncompressed sensor detail

    Args:
        photo: Dictionary containing photo attributes.

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

    # 3. Image Resolution (50 pts per MP)
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

    # 4. Sharpness / Blur score
    blur = photo.get("blur_score") or 0.0
    if blur > 0:
        score += blur * 2.0
        if blur > 50.0:
            reasons.append("High Sharpness")

    # 5. SLM Quality score
    quality = photo.get("quality_score") or 0.0
    if quality > 0:
        score += quality * 10.0

    # 6. File size detail
    size = photo.get("file_size") or 0
    if size > 0:
        score += (size / 1_000_000.0) * 10.0

    reason_str = " • ".join(reasons) if reasons else "Best Available Resolution"
    return score, reason_str


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
            group_id = f"exact_{fhash[:12]}"
            for m in members:
                grouped_photo_ids.add(m["id"])
            clusters.append({
                "group_id": group_id,
                "match_type": "exact",
                "distance": 0,
                "members": members,
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
            h2 = p2["phash"]
            dist = hamming_distance(h1, h2)
            if dist <= 8:
                uf.union(p1["id"], p2["id"])
                pair_key = (min(p1["id"], p2["id"]), max(p1["id"], p2["id"]))
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
            score, reason = score_candidate_photo(m)
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

    # Filter out any groups that now have fewer than 2 active photos
    valid_groups = []
    for gid, gdata in grouped.items():
        members = gdata["photos"]
        if len(members) >= 2:
            best_photo = None
            best_score = -1.0
            best_reason = ""
            for m in members:
                score, reason = score_candidate_photo(m)
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
    conn: aiosqlite.Connection, group_id: str, keep_photo_id: int
) -> Dict[str, Any]:
    """Resolves a single duplicate group by keeping one photo and trashing the rest.

    Photos to be removed are marked with trashed_at = CURRENT_TIMESTAMP (soft delete),
    allowing 30-day recovery in the Trash view.

    Args:
        conn: Open aiosqlite database connection.
        group_id: Unique duplicate group identifier.
        keep_photo_id: ID of the photo user explicitly chooses to retain.

    Returns:
        Status dictionary with count of trashed photos and reclaimed bytes.
    """
    conn.row_factory = aiosqlite.Row

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

    trash_ids = [r["id"] for r in rows if r["id"] != keep_photo_id]
    reclaimed_bytes = sum(r["file_size"] for r in rows if r["id"] in trash_ids)

    if trash_ids:
        placeholders = ",".join("?" for _ in trash_ids)
        await conn.execute(
            f"UPDATE photos SET trashed_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders});",
            trash_ids,
        )

    # Clean up group from duplicate_groups
    await conn.execute("DELETE FROM duplicate_groups WHERE group_id = ?;", (group_id,))
    await conn.commit()

    return {
        "status": "ok",
        "group_id": group_id,
        "kept_photo_id": keep_photo_id,
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
