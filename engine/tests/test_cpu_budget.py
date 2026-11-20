"""After-import P2: one heavy job at a time (owner D2), what the user asked for first."""

import asyncio

import pytest

from engine.services import cpu_budget


async def test_one_heavy_job_at_a_time_in_priority_order():
    ran, running = [], []

    async def job(priority, name, started=None):
        async with cpu_budget.heavy(priority, name):
            running.append(name)
            assert len(running) == 1  # Never two at once.
            ran.append(name)
            if started:
                started.set()
            await asyncio.sleep(0.01)
            running.remove(name)

    started = asyncio.Event()
    first = asyncio.create_task(job(cpu_budget.ENHANCE, "8k-1", started))
    await started.wait()  # The 8K photo is running; the others queue behind it.
    tasks = [
        asyncio.create_task(job(cpu_budget.BACKGROUND, "video")),
        asyncio.create_task(job(cpu_budget.ENHANCE, "8k-2")),
        asyncio.create_task(job(cpu_budget.AUTO_RESTORE, "auto-fix")),
        asyncio.create_task(job(cpu_budget.USER, "asked")),
    ]
    await asyncio.gather(first, *tasks)
    # The running job is never cut off; then the user's, the automatic fix, 8K, video.
    assert ran == ["8k-1", "asked", "auto-fix", "8k-2", "video"]


async def test_a_cancelled_waiter_doesnt_block_the_queue():
    gate = asyncio.Event()

    async def holder():
        async with cpu_budget.heavy(cpu_budget.ENHANCE, "holder"):
            await gate.wait()

    async def waiter(name, out):
        async with cpu_budget.heavy(cpu_budget.ENHANCE, name):
            out.append(name)

    out = []
    h = asyncio.create_task(holder())
    await asyncio.sleep(0)
    gone = asyncio.create_task(waiter("gone", out))
    stays = asyncio.create_task(waiter("stays", out))
    await asyncio.sleep(0)
    gone.cancel()
    gate.set()
    await h
    await stays
    with pytest.raises(asyncio.CancelledError):
        await gone
    assert out == ["stays"]
    async with cpu_budget.heavy(cpu_budget.USER, "after"):  # Free again.
        pass


async def test_an_error_inside_releases_the_slot():
    with pytest.raises(RuntimeError):
        async with cpu_budget.heavy(cpu_budget.USER, "boom"):
            raise RuntimeError("boom")
    await asyncio.wait_for(_take_and_release(), timeout=1)


async def _take_and_release():
    async with cpu_budget.heavy(cpu_budget.USER, "next"):
        pass
