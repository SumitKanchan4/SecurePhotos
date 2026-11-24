"""The computers that do the background work (T3): the start-up question and Settings → Storage."""

import asyncio
from typing import Any, Dict, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from engine.services import computers

router = APIRouter(prefix="/api/computers", tags=["Computers"])


class Answer(BaseModel):
    answer: Literal["remember", "this_time", "view"]


class Choice(BaseModel):
    choice: Literal["always", "ask", "view"]


@router.get("")
async def list_computers() -> Dict[str, Any]:
    """This computer (and whether to ask the question) and every computer the library knows."""
    return await computers.list_computers()


@router.post("/this/answer")
async def answer_question(body: Answer) -> Dict[str, Any]:
    """The answer to "Do background work on this computer?"."""
    await computers.answer(body.answer)
    return await computers.list_computers()


class Graphics(BaseModel):
    on: bool


@router.get("/this/hardware")
async def this_hardware() -> Dict[str, Any]:
    """T31: memory, processor, graphics card, what runs where, and the test's progress."""
    from engine.services import ai_device

    summary = await asyncio.to_thread(ai_device.summary)
    return {**summary, "test": ai_device.test_status()}


@router.post("/this/hardware/test")
async def test_hardware() -> Dict[str, Any]:
    """T31: starts the graphics card test (the new-computer dialog, or Settings' Test again)."""
    from engine.services import hardware_check

    hardware_check.start()
    return await this_hardware()


@router.post("/this/hardware/test/cancel")
async def cancel_hardware_test() -> Dict[str, Any]:
    """T31: Skip for now. Photos are improved on the processor until it is tested."""
    from engine.services import ai_device

    ai_device.cancel_test()
    return await this_hardware()


@router.put("/this/graphics")
async def set_graphics(body: Graphics) -> Dict[str, Any]:
    """T31: Settings' switch, "Use the graphics card on this computer"."""
    from engine.services import hardware_check

    await computers.set_graphics(body.on)
    hardware_check._forget_open_sessions()
    return await this_hardware()


@router.put("/{computer_id}")
async def change_choice(computer_id: str, body: Choice) -> Dict[str, Any]:
    """Settings: Always does the work / Asks each time / Only views."""
    if not await computers.set_choice(computer_id, body.choice):
        raise HTTPException(status_code=404, detail="That computer isn't on the list any more.")
    return await computers.list_computers()


@router.delete("/{computer_id}")
async def forget_computer(computer_id: str) -> Dict[str, Any]:
    """Settings: Forget. The computer is asked again the next time the drive is plugged in."""
    if not await computers.forget(computer_id):
        raise HTTPException(status_code=404, detail="That computer isn't on the list any more.")
    return await computers.list_computers()
