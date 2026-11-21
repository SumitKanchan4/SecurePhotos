"""T3: every computer the drive is plugged into is listed, with whether it does the background work."""

import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import db_connection
from engine.main import app
from engine.services import computers

HOME = {"id": computers.scrambled_id("home-guid"), "name": "HOME-PC"}
FRIEND = {"id": computers.scrambled_id("friend-guid"), "name": "FRIEND-LAPTOP"}


async def _clear() -> None:
    async with db_connection() as conn:
        await conn.execute("DELETE FROM computers;")
        await conn.commit()
    computers._this.update(id=None, name=None, choice=None, session=None)


@pytest.fixture(autouse=True)
async def empty_list():
    # Before and after: the test library is shared, and an engine started by a later test would
    # otherwise find these sample computers and take this machine for a new one.
    await _clear()
    yield
    await _clear()


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_the_first_computer_does_the_work_without_being_asked():
    await computers.register_this_computer(HOME)
    assert computers.may_do_background_work()
    assert not computers.needs_answer()
    listing = await computers.list_computers()
    assert [(c["name"], c["choice"], c["is_this"]) for c in listing["computers"]] == [("HOME-PC", "always", True)]


async def test_a_new_computer_waits_until_it_is_answered():
    await computers.register_this_computer(HOME)
    await computers.register_this_computer(FRIEND)
    assert computers.needs_answer()
    assert computers.hold_reason() == "other_computer"


@pytest.mark.parametrize(
    "answer, saved, works_now",
    [("remember", "always", True), ("this_time", "ask", True), ("view", "view", False)],
)
async def test_each_answer_is_saved_and_applies_at_once(answer, saved, works_now):
    await computers.register_this_computer(HOME)
    await computers.register_this_computer(FRIEND)
    async with await _client() as client:
        res = await client.post("/api/computers/this/answer", json={"answer": answer})
    assert res.status_code == 200
    body = res.json()
    assert body["this_computer"]["does_work_now"] is works_now
    assert body["this_computer"]["needs_answer"] is False
    friend = next(c for c in body["computers"] if c["name"] == "FRIEND-LAPTOP")
    assert friend["choice"] == saved


async def test_just_this_time_asks_again_at_the_next_start():
    await computers.register_this_computer(HOME)
    await computers.register_this_computer(FRIEND)
    await computers.answer("this_time")
    await computers.register_this_computer(FRIEND)  # the drive is plugged in again another day
    assert computers.needs_answer()
    assert not computers.may_do_background_work()


async def test_a_view_only_computer_is_not_asked_again():
    await computers.register_this_computer(HOME)
    await computers.register_this_computer(FRIEND)
    await computers.answer("view")
    await computers.register_this_computer(FRIEND)
    assert not computers.needs_answer()
    assert computers.hold_reason() == "other_computer"


async def test_settings_can_switch_any_computer_either_way():
    await computers.register_this_computer(HOME)
    await computers.register_this_computer(FRIEND)
    await computers.answer("view")
    async with await _client() as client:
        res = await client.put(f"/api/computers/{FRIEND['id']}", json={"choice": "always"})
        assert res.status_code == 200 and res.json()["this_computer"]["does_work_now"] is True
        res = await client.put(f"/api/computers/{HOME['id']}", json={"choice": "view"})
        assert res.status_code == 200
        choices = {c["name"]: c["choice"] for c in res.json()["computers"]}
        assert choices == {"HOME-PC": "view", "FRIEND-LAPTOP": "always"}
        assert (await client.put("/api/computers/not-a-computer", json={"choice": "view"})).status_code == 404
        assert (await client.put(f"/api/computers/{HOME['id']}", json={"choice": "sometimes"})).status_code == 422


async def test_only_views_from_settings_stops_the_work_at_once():
    await computers.register_this_computer(HOME)
    assert computers.may_do_background_work()
    await computers.set_choice(HOME["id"], "view")
    assert computers.hold_reason() == "other_computer"


async def test_forgetting_a_computer_asks_it_again():
    await computers.register_this_computer(HOME)
    await computers.register_this_computer(FRIEND)
    await computers.answer("remember")
    async with await _client() as client:
        res = await client.delete(f"/api/computers/{FRIEND['id']}")
    assert res.status_code == 200
    assert [c["name"] for c in res.json()["computers"]] == ["HOME-PC"]
    await computers.register_this_computer(FRIEND)
    assert computers.needs_answer()


async def test_only_a_scrambled_id_is_stored():
    await computers.register_this_computer(HOME)
    async with db_connection() as conn:
        async with conn.execute("SELECT id FROM computers;") as cur:
            (stored,) = await cur.fetchone()
    assert "home-guid" not in stored and len(stored) == 32
    assert computers.scrambled_id("home-guid") == stored  # the same computer is recognised again


async def test_this_computer_is_recognised_by_windows_own_id():
    me = computers.detect_this_computer()
    assert len(me["id"]) == 32 and me["name"]
    assert computers.detect_this_computer() == me


async def test_enhancing_waits_on_a_computer_that_only_views(monkeypatch):
    """The 8K loop holds with the new reason instead of starting the next photo."""
    import asyncio

    from engine.api import photos

    await computers.register_this_computer(HOME)
    await computers.set_choice(HOME["id"], "view")
    waiter = asyncio.create_task(photos._wait_while_on_battery())
    await asyncio.sleep(0.3)
    assert not waiter.done()
    assert photos.optimization_state["paused_reason"] == "other_computer"
    await computers.set_choice(HOME["id"], "always")
    await asyncio.wait_for(waiter, timeout=5)
    assert photos.optimization_state["paused_reason"] is None


async def test_automatic_old_photo_fixes_and_videos_wait_too():
    from engine.services import restore_queue, video_queue_service

    await computers.register_this_computer(HOME)
    await computers.set_choice(HOME["id"], "view")
    assert await restore_queue._holding_auto_jobs()
    assert await video_queue_service._process_next_video_job() is False
