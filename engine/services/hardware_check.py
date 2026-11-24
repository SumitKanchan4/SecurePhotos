"""Runs the graphics card test (T31) and keeps its result with this computer.

Started by the new-computer dialog ("Getting to know this computer"), by Settings ("Test
again"), and before the first old-photo fix on a known computer that hasn't been tested (the
queue already holds the heavy-work slot then, so ``hold_slot`` is False).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from engine.services import ai_device, ai_models, computers, cpu_budget, onnx_sessions

logger = logging.getLogger("securephotos.hardware_check")

_task: Optional[asyncio.Task] = None


def _model_file(key: str) -> Optional[str]:
    """The model's file if it is on this computer (models not downloaded are tested later)."""
    try:
        if key in ("yunet", "sface"):
            from engine.services.face_recognition_service import ensure_face_models

            yunet, sface = ensure_face_models()
            return str(yunet if key == "yunet" else sface)
        return str(ai_models.model_path(key))
    except Exception:
        return None


def _forget_open_sessions() -> None:
    """Sessions opened before the test reopen with the new choice (graphics card or processor)."""
    onnx_sessions.release()
    from engine.services import face_recognition_service, neural_sr_service

    face_recognition_service._yunet_session = None
    face_recognition_service._sface_session = None
    neural_sr_service._session = None


async def run(hold_slot: bool = True) -> None:
    """The whole test, then the result saved for this computer."""
    _forget_open_sessions()  # Frees memory for the test.
    if hold_slot:
        async with cpu_budget.heavy(cpu_budget.USER, "graphics-test"):
            await asyncio.to_thread(ai_device.run_test, _model_file, onnx_sessions.cpu_options)
    else:
        await asyncio.to_thread(ai_device.run_test, _model_file, onnx_sessions.cpu_options)
    _forget_open_sessions()
    await computers.save_hardware()


def start() -> None:
    """Starts the test in the background (once; a running test is left to finish)."""
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.get_event_loop().create_task(run())
