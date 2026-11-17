"""H10 / A4: Activity's "Pause all" also pauses photo enhancement (it had no pause before)."""

import asyncio

from httpx import ASGITransport, AsyncClient

from engine.api import photos as photos_api
from engine.main import app
from engine.services import video_queue_service


async def test_pause_all_pauses_enhancement_and_resume_lets_it_go_on():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post("/api/system/optimization/pause")).status_code == 200
        assert photos_api.enhancement_paused_by_user is True
        assert video_queue_service._is_paused is True

        waiter = asyncio.create_task(photos_api._wait_while_paused_by_user())
        await asyncio.sleep(0.05)
        assert not waiter.done() and photos_api.optimization_state["paused_reason"] == "by_user"

        assert (await client.post("/api/system/optimization/resume")).status_code == 200
        await asyncio.wait_for(waiter, timeout=3)
        assert photos_api.enhancement_paused_by_user is False
        assert photos_api.optimization_state["paused_reason"] is None


async def test_not_paused_means_no_wait():
    photos_api.pause_enhancement(False)
    await asyncio.wait_for(photos_api._wait_while_paused_by_user(), timeout=0.5)
