"""One-at-a-time queues for heavy file work (H7).

Heavy file work (encryption, copying, hashing) runs on background threads so the
engine keeps answering other requests. That also means two such operations could
now overlap on the same files (e.g. a double-clicked "Move to Vault", or the same
folder imported twice), so each kind waits for the previous one to finish.

The locks are created per event loop, because each test runs its own loop.
"""

import asyncio
import weakref

_QUEUES: "dict[str, weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]]" = {}


def _queue(name: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    per_loop = _QUEUES.setdefault(name, weakref.WeakKeyDictionary())
    lock = per_loop.get(loop)
    if lock is None:
        lock = per_loop[loop] = asyncio.Lock()
    return lock


def vault_files() -> asyncio.Lock:
    """Vault lock, unlock, vault enhancement and vault reset, one at a time."""
    return _queue("vault_files")


def imports() -> asyncio.Lock:
    """Library imports (photos and documents), one batch at a time."""
    return _queue("imports")
