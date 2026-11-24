"""CPU ONNX sessions for the old-photo models, one large model in memory at a time (H10 / A2a).

The colour and face models are 0.3–1 GB each; with all of them loaded at once the A0
benchmark peaked at 7.3 GB on the owner's laptop. So :func:`use_model` keeps exactly one
of them loaded: asking for another one first releases the current one. The job queue
groups work by model, so a model is loaded once per batch, and :func:`release` frees it
when the queue goes idle.

CPU settings come from the A0 benchmark on a Ryzen 7 5700U: 4 threads were as fast as 16,
and turning off spin-waiting stops idle threads from burning a core between photos.
The small face-finding models (YuNet, SFace) are separate (face_recognition_service).
"""

from __future__ import annotations

import gc
import logging
import os
import threading
from contextlib import contextmanager
from typing import Iterator, Optional

from engine.services import ai_models

logger = logging.getLogger("securephotos.onnx_sessions")

_lock = threading.RLock()
_current_key: Optional[str] = None
_current_session = None


def cpu_threads() -> int:
    """Threads for one inference: 4 on most laptops, fewer on small CPUs."""
    return max(1, min(4, (os.cpu_count() or 2) // 2))


def cpu_options() -> "object":
    """Processor settings from the A0 benchmark (also used by the graphics card test)."""
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.intra_op_num_threads = cpu_threads()
    options.inter_op_num_threads = 1
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    return options


def _open(path, key: str) -> "object":
    """T31: on the graphics card where it is faster on this computer, else on the processor."""
    from engine.services import ai_device

    return ai_device.open_session(path, key, cpu_options)


@contextmanager
def use_model(key: str) -> Iterator["object"]:
    """Yields the ONNX session for on-demand model ``key``, loading it if needed.

    Holds a lock while in use, so two jobs never swap models under each other.

    Raises:
        FileNotFoundError: The model isn't downloaded (see ``ai_models.model_path``).
    """
    global _current_key, _current_session
    with _lock:
        if _current_key != key:
            _drop()
            path = ai_models.model_path(key)
            logger.info("Loading %s", path.name)
            _current_session = _open(path, key)
            _current_key = key
        else:
            from engine.services import ai_device

            ai_device.note_used(key)
        yield _current_session


def loaded_model() -> Optional[str]:
    """Key of the model in memory, if any."""
    return _current_key


def _drop() -> None:
    global _current_key, _current_session
    if _current_session is not None:
        logger.info("Releasing %s", _current_key)
    _current_key, _current_session = None, None
    gc.collect()


def release() -> None:
    """Frees the loaded model (called when the queue has nothing left to do)."""
    with _lock:
        _drop()
