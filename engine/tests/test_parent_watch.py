"""T1: the engine stops when the desktop app that started it is gone."""

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from engine.services import parent_watch

ROOT = Path(__file__).resolve().parents[2]


def _sleeper() -> subprocess.Popen:
    """A stand-in for the desktop app."""
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])


def test_parent_id_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv(parent_watch.PARENT_PID_ENV, raising=False)
    assert parent_watch.parent_from_env() is None
    monkeypatch.setenv(parent_watch.PARENT_PID_ENV, "not a number")
    assert parent_watch.parent_from_env() is None
    monkeypatch.setenv(parent_watch.PARENT_PID_ENV, "0")
    assert parent_watch.parent_from_env() is None
    monkeypatch.setenv(parent_watch.PARENT_PID_ENV, " 4242 ")
    assert parent_watch.parent_from_env() == 4242


def test_nothing_is_watched_without_the_variable(monkeypatch):
    monkeypatch.delenv(parent_watch.PARENT_PID_ENV, raising=False)
    assert parent_watch.start() is None


async def test_reacts_only_once_the_app_is_gone():
    app = _sleeper()
    gone = asyncio.Event()
    calls = []

    def on_gone():
        calls.append(1)
        gone.set()

    task = asyncio.create_task(parent_watch.watch_parent(app.pid, on_gone, interval=0.05))
    try:
        await asyncio.sleep(0.5)
        assert not calls, "stopped while the app was still running"
        app.kill()
        await asyncio.wait_for(gone.wait(), timeout=3)
        await asyncio.wait_for(task, timeout=1)
        assert calls == [1]
    finally:
        app.kill()
        task.cancel()


async def test_an_app_that_already_ended_counts_as_gone():
    app = _sleeper()
    app.kill()
    app.wait()
    called = []
    await asyncio.wait_for(parent_watch.watch_parent(app.pid, lambda: called.append(1), interval=0.05), timeout=3)
    assert called == [1]


def test_an_engine_process_exits_when_its_app_is_killed(tmp_path):
    """End to end: a process running the watch with the real stop ends after its app is killed."""
    app = _sleeper()
    engine_code = (
        "import asyncio\n"
        "from engine.services import parent_watch\n"
        "async def main():\n"
        "    parent_watch.start()\n"
        "    await asyncio.sleep(60)\n"
        "asyncio.run(main())\n"
    )
    env = dict(os.environ, PYTHONPATH=str(ROOT), SECUREPHOTOS_DATA_DIR=str(tmp_path))
    env[parent_watch.PARENT_PID_ENV] = str(app.pid)
    engine = subprocess.Popen([sys.executable, "-c", engine_code], env=env, cwd=str(ROOT),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        assert engine.poll() is None, "the engine stopped while its app was running"
        app.kill()
        engine.wait(timeout=parent_watch.GRACE_SECONDS + 5)
    except subprocess.TimeoutExpired:
        pytest.fail("the engine kept running after its app was killed")
    finally:
        app.kill()
        engine.kill()
