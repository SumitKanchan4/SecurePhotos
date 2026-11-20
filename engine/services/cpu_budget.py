"""One heavy job at a time (after-import plan, owner decision D2).

8K enhancement, old-photo improvements, video preparation and the vault enhancer each used to
run their own worker with up to 4 threads, all at once: the CPU was saturated and the app felt
slow. Each of them now takes this one slot per item. Waiting jobs go in priority order (then
first come, first served), so what the user asked for runs next:

- ``USER`` (0): an improvement or video the user started.
- ``AUTO_RESTORE`` (1): automatic old-photo fixes (before 8K: the fix works on the scan's own size).
- ``ENHANCE`` (2): 8K enhancement of library photos.
- ``BACKGROUND`` (3): automatic video preparation and the vault enhancer.

Quick wins first (owner, 2026-11-18): while plain photos are getting 8K, automatic old-print
fixes don't ask for the slot at all (``photos.plain_photos_first``), so the photos needing least
work are done first.

A job is never interrupted: the slot is handed on when it finishes. Quick steps (reading text,
finding faces) don't take the slot.
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import weakref
from contextlib import asynccontextmanager
from typing import AsyncIterator, Dict, List, Optional, Tuple

USER = 0
AUTO_RESTORE = 1
ENHANCE = 2
BACKGROUND = 3


class PriorityLock:
    """An asyncio lock whose waiters are served lowest priority number first."""

    def __init__(self) -> None:
        self._held = False
        self._waiters: List[Tuple[int, int, asyncio.Future]] = []
        self._order = itertools.count()
        self.holder: Optional[str] = None

    @property
    def locked(self) -> bool:
        return self._held

    def waiting(self) -> int:
        return sum(1 for _, _, f in self._waiters if not f.done())

    async def acquire(self, priority: int, name: str) -> None:
        if not self._held and not self.waiting():
            self._held, self.holder = True, name
            return
        future = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (priority, next(self._order), future))
        try:
            await future
        except asyncio.CancelledError:
            if future.done() and not future.cancelled():  # Handed over just as it was cancelled.
                self.release()
            raise
        self.holder = name

    def release(self) -> None:
        while self._waiters:
            _, _, future = heapq.heappop(self._waiters)
            if not future.done():
                future.set_result(None)  # The slot passes straight on; _held stays True.
                return
        self._held, self.holder = False, None


_LOCKS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, PriorityLock]" = weakref.WeakKeyDictionary()


def _lock() -> PriorityLock:
    loop = asyncio.get_running_loop()
    lock = _LOCKS.get(loop)
    if lock is None:
        lock = _LOCKS[loop] = PriorityLock()
    return lock


@asynccontextmanager
async def heavy(priority: int, name: str) -> AsyncIterator[None]:
    """Holds the one heavy-work slot for the body (one item: a photo, a video)."""
    lock = _lock()
    await lock.acquire(priority, name)
    try:
        yield
    finally:
        lock.release()


def status() -> Dict[str, object]:
    lock = _LOCKS.get(asyncio.get_event_loop()) if _LOCKS else None
    return {"busy": bool(lock and lock.locked), "holder": lock.holder if lock else None, "waiting": lock.waiting() if lock else 0}
