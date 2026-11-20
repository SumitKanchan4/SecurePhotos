"""After-import P3: the vectorised near-duplicate comparison finds exactly what the per-pair
comparison found, and stays fast on a large library."""

import random
import time

from engine.services.duplicate_service import _close_pairs, hamming_distance


def _items(count, seed):
    rng = random.Random(seed)
    base = [rng.getrandbits(64) for _ in range(count // 4)]
    items = []
    for k in range(count):
        value = base[k % len(base)] ^ (1 << rng.randrange(64)) if k % 3 else rng.getrandbits(64)  # Many near-copies.
        items.append({"phash": f"{value:016x}"})
    items.append({"phash": "not-a-hash"})
    items.append({"phash": None})
    return items


def test_same_pairs_as_the_per_pair_comparison():
    items = _items(300, 1)
    expected = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            dist = hamming_distance(items[i]["phash"], items[j]["phash"])
            if dist <= 8:
                expected.append((i, j, dist))
    assert sorted(_close_pairs(items, 8)) == sorted(expected)
    assert expected  # The sample really has near-duplicates.


def test_ten_thousand_photos_in_seconds():
    items = _items(10_000, 2)
    start = time.perf_counter()
    _close_pairs(items, 8)
    assert time.perf_counter() - start < 10  # The per-pair loop took minutes.
