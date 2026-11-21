"""The computers that do the background work (T3): the start-up question and Settings → Storage."""

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
