"""'Same person?' suggestions for the People screen (redesign R5).

An unnamed face group that looks like an already named person is offered as a merge:
"Rohan (412 photos) and an unnamed group (37 photos) look alike." The owner answers
"Yes, merge" (the group's faces join the person) or "Not the same" (remembered per face
in ``person_face_rejections``, because cluster ids are renumbered on every re-cluster).

Similarity is the cosine between the mean (L2-normalised) SFace embeddings of the person
and of the group. 0.40 sits above OpenCV's published SFace cosine match threshold (0.363)
and below the stricter 0.45 the clustering uses to link two faces automatically, so it
catches groups that are probably the same person but were not joined on their own.
Only library photos count: vault and trashed photos are never used.
"""

import json
from typing import Dict, Iterable, List, Optional, Set, Tuple

import numpy as np

from engine.services.face_recognition_service import EMBEDDING_MODEL

SUGGESTION_SIMILARITY = 0.40
MIN_FACE_QUALITY = 0.25  # Same floor as the unnamed-group list.
MAX_SUGGESTIONS = 5


def centroid(vectors: Iterable[Iterable[float]]) -> Optional[np.ndarray]:
    """Mean of the L2-normalised vectors, normalised again; None when there are none."""
    arr = np.array([list(v) for v in vectors], dtype=np.float32)
    if arr.size == 0 or arr.ndim != 2:
        return None
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    mean = (arr / norms).mean(axis=0)
    length = float(np.linalg.norm(mean))
    return mean / length if length > 0 else None


def rank_merge_suggestions(
    people: Dict[int, np.ndarray],
    groups: Dict[str, np.ndarray],
    rejected: Set[Tuple[int, str]],
    threshold: float = SUGGESTION_SIMILARITY,
    limit: int = MAX_SUGGESTIONS,
) -> List[Tuple[int, str, float]]:
    """(person_id, cluster_id, similarity) pairs, most alike first.

    Each group is offered for at most one person: the most alike one the owner has not
    already turned down for that group.
    """
    if not people or not groups:
        return []
    person_ids = list(people)
    matrix = np.stack([people[pid] for pid in person_ids])
    found: List[Tuple[int, str, float]] = []
    for cluster_id, vector in groups.items():
        sims = matrix @ vector
        for idx in np.argsort(-sims):
            sim = float(sims[idx])
            if sim < threshold:
                break
            pid = person_ids[idx]
            if (pid, cluster_id) not in rejected:
                found.append((pid, cluster_id, sim))
                break
    found.sort(key=lambda item: (-item[2], item[1]))
    return found[:limit]


def _vector(raw) -> Optional[List[float]]:
    try:
        values = json.loads(raw) if isinstance(raw, str) else list(raw)
    except (TypeError, ValueError):
        return None
    return values if values else None


async def load_merge_inputs(conn) -> Tuple[Dict[int, np.ndarray], Dict[str, np.ndarray], Set[Tuple[int, str]]]:
    """Person and unnamed-group centroids from library photos, plus the turned-down pairs."""
    person_vectors: Dict[int, List[List[float]]] = {}
    async with conn.execute(
        """
        SELECT f.person_id, f.embedding FROM faces f
        JOIN photos p ON p.id = f.photo_id
        WHERE f.person_id IS NOT NULL AND f.embedding_model = ?
          AND p.trashed_at IS NULL AND p.is_encrypted = 0;
        """,
        (EMBEDDING_MODEL,),
    ) as cursor:
        for row in await cursor.fetchall():
            vec = _vector(row["embedding"])
            if vec:
                person_vectors.setdefault(row["person_id"], []).append(vec)

    group_vectors: Dict[str, List[List[float]]] = {}
    async with conn.execute(
        """
        SELECT f.cluster_id, f.embedding FROM faces f
        JOIN photos p ON p.id = f.photo_id
        WHERE f.person_id IS NULL AND f.cluster_id IS NOT NULL AND f.embedding_model = ?
          AND f.quality_score >= ? AND p.trashed_at IS NULL AND p.is_encrypted = 0;
        """,
        (EMBEDDING_MODEL, MIN_FACE_QUALITY),
    ) as cursor:
        for row in await cursor.fetchall():
            vec = _vector(row["embedding"])
            if vec:
                group_vectors.setdefault(row["cluster_id"], []).append(vec)

    async with conn.execute(
        """
        SELECT DISTINCT r.person_id, f.cluster_id FROM person_face_rejections r
        JOIN faces f ON f.id = r.face_id
        WHERE f.cluster_id IS NOT NULL AND f.person_id IS NULL;
        """
    ) as cursor:
        rejected = {(row["person_id"], row["cluster_id"]) for row in await cursor.fetchall()}

    people = {pid: c for pid, vecs in person_vectors.items() if (c := centroid(vecs)) is not None}
    groups = {cid: c for cid, vecs in group_vectors.items() if (c := centroid(vecs)) is not None}
    return people, groups, rejected
