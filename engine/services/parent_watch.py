"""The engine stops when the app that started it is gone (T1).

The desktop app passes its process id in ``SECUREPHOTOS_PARENT_PID``. The engine checks once a
second that this very process is still running (psutil compares the start time too, so a new
program that happens to get the same id doesn't count). When the app is gone, after a crash or
a forced close, the engine asks itself to shut down normally and exits for good a few seconds
later, so nothing keeps files on the drive open.

The app's kill-on-close job (``src-tauri/src/job.rs``) normally stops the engine first; this is
the second line for when that job couldn't be set up. Without the variable (the engine started
on its own for development) nothing is watched.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import threading
from typing import Awaitable, Callable, Optional

import psutil

logger = logging.getLogger("securephotos.parent_watch")

PARENT_PID_ENV = "SECUREPHOTOS_PARENT_PID"
CHECK_SECONDS = 1.0
# Time for a normal shutdown before the process ends regardless.
GRACE_SECONDS = 5.0


def parent_from_env() -> Optional[int]:
    """Returns the app's process id from the environment, or None when it isn't set or valid."""
    raw = os.environ.get(PARENT_PID_ENV, "").strip()
    if not raw:
        return None
    try:
        pid = int(raw)
    except ValueError:
        logger.warning("Ignoring %s=%r: not a process id.", PARENT_PID_ENV, raw)
        return None
    return pid if pid > 0 else None


def _alive(parent: Optional[psutil.Process]) -> bool:
    if parent is None:
        return False
    try:
        return parent.is_running() and parent.status() != psutil.STATUS_ZOMBIE
    except psutil.Error:
        return False


async def watch_parent(
    pid: int,
    on_gone: Callable[[], Awaitable[None] | None],
    interval: float = CHECK_SECONDS,
) -> None:
    """Waits until process ``pid`` has ended, then calls ``on_gone`` once.

    Args:
        pid: The app's process id.
        on_gone: Called when the process is gone (also when it was gone before the watch began).
        interval: Seconds between checks.
    """
    try:
        parent: Optional[psutil.Process] = psutil.Process(pid)
    except psutil.Error:
        parent = None
    while _alive(parent):
        await asyncio.sleep(interval)
    logger.warning("The app (process %s) is gone; stopping the engine.", pid)
    result = on_gone()
    if asyncio.iscoroutine(result):
        await result


def stop_engine() -> None:
    """Asks the server to shut down normally, and ends the process if that takes too long."""
    timer = threading.Timer(GRACE_SECONDS, os._exit, args=(0,))
    timer.daemon = True
    timer.start()
    # Uvicorn handles Ctrl+C by finishing requests and running the shutdown steps.
    signal.raise_signal(signal.SIGINT)


def start() -> Optional[asyncio.Task]:
    """Starts watching the app named in the environment; returns the task, or None if unset."""
    pid = parent_from_env()
    if pid is None:
        return None
    logger.info("Watching the app (process %s); the engine stops when it ends.", pid)
    return asyncio.create_task(watch_parent(pid, stop_engine))
