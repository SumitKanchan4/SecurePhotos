"""Graphics card or processor for the AI models (T31 part 1, owner-approved 2026-11-24).

SecurePhotos runs from an external drive on any Windows computer, so it can't know the hardware
in advance. Each computer is measured once and its answer is kept with it (in ``computers``):

- The engine ships ``onnxruntime-windowsml``: the processor path plus DirectML, which runs on any
  DirectX 12 graphics card (NVIDIA, AMD, Intel) with nothing installed. It asks Windows for the
  high-performance card, so a separate card is picked over built-in graphics.
- A speed test times each model on the processor and on the graphics card and keeps the card only
  where it is at least ``MIN_SPEEDUP`` faster. Gains differ per model (owner's built-in Radeon:
  faces 5x, the 8K print 6x, colour 1.3x, and scratch repair can't run on it at all), so the
  choice is made per model, not per computer.
- The processor always works and stays the default. A model that can't open on the card, or fails
  while running, goes back to the processor and stays there until the card's driver changes.
- A new computer is tested from the start-up question; a known one before its first old-photo fix.
  A changed card or driver is tested again. The person can turn the card off per computer.

Model keys are those of ``ai_models``; the "jobs" group them the way Settings shows them.
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger("securephotos.ai_device")

GPU = "gpu"
CPU = "cpu"
MIXED = "mixed"  # A job whose models run partly on the card, partly on the processor.
DML = "DmlExecutionProvider"
MIN_SPEEDUP = 1.3
LOW_MEMORY_GB = 8

# What the person sees, and the models behind each. Models of one job are tested on their own.
JOBS: Dict[str, Tuple[str, ...]] = {
    "faces": ("gfpgan",),
    "print": ("realesr",),
    "colour": ("ddcolor_large", "ddcolor_artistic"),
    "scratches": ("scratch_detector", "lama"),
    "finding_faces": ("yunet", "sface"),
}
# Same network as ddcolor_large: tested once, decided together.
SAME_AS = {"ddcolor_artistic": "ddcolor_large"}
# Test picture size per model (the size used in real work, or close to it).
TEST_SIZE = {"gfpgan": 512, "realesr": 128, "ddcolor_large": 512, "scratch_detector": 512, "lama": 512, "yunet": 320, "sface": 112}
# Small models are timed over several runs, so the result isn't noise.
TEST_REPEAT = {"realesr": 3, "yunet": 10, "sface": 10}

_lock = threading.RLock()
_state: Dict[str, Any] = {
    "gpu": None,          # {"name", "driver", "memory_mb"} of the high-performance card, or None
    "detected": False,
    "enabled": True,      # The person's switch for this computer.
    "plan": {},           # model key -> {"device": "gpu"|"cpu", "speedup": float|None, "why": str|None}
    "tested_at": None,
    "tested_for": None,   # "name|driver" the plan was measured on
    "dirty": False,       # plan changed since it was saved
    "used_gpu": set(),    # models that ran on the card in the current job
}
_test: Dict[str, Any] = {"state": "idle", "step": None, "job": None, "progress": 0, "error": None, "cancel": False}


# ── Hardware ────────────────────────────────────────────────────────────────


def _dxgi_high_performance_adapter() -> Optional[Dict[str, Any]]:
    """The adapter Windows calls high-performance (the one DirectML will use), via DXGI."""
    if os.name != "nt":
        return None
    try:
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("a", ctypes.c_uint32), ("b", ctypes.c_uint16), ("c", ctypes.c_uint16), ("d", ctypes.c_ubyte * 8)]

        def guid(text: str) -> GUID:
            p = text.split("-")
            tail = bytes.fromhex(p[3] + p[4])
            return GUID(int(p[0], 16), int(p[1], 16), int(p[2], 16), (ctypes.c_ubyte * 8)(*tail))

        class DESC1(ctypes.Structure):
            _fields_ = [
                ("Description", ctypes.c_wchar * 128), ("VendorId", wintypes.UINT), ("DeviceId", wintypes.UINT),
                ("SubSysId", wintypes.UINT), ("Revision", wintypes.UINT), ("DedicatedVideoMemory", ctypes.c_size_t),
                ("DedicatedSystemMemory", ctypes.c_size_t), ("SharedSystemMemory", ctypes.c_size_t),
                ("AdapterLuid", ctypes.c_int64), ("Flags", wintypes.UINT),
            ]

        dxgi = ctypes.WinDLL("dxgi.dll")
        factory = ctypes.c_void_p()
        iid_factory6 = guid("c1b6694f-ff09-44a9-b03c-77900a0a1d17")
        if dxgi.CreateDXGIFactory1(ctypes.byref(iid_factory6), ctypes.byref(factory)) != 0 or not factory:
            return None

        def method(obj: ctypes.c_void_p, index: int, *argtypes):
            vtable = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
            return ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(vtable[index])

        adapter = ctypes.c_void_p()
        iid_adapter1 = guid("29038f61-3839-4626-91fd-086879011a05")
        # IDXGIFactory6::EnumAdapterByGpuPreference(index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE = 2, iid, out)
        enum = method(factory, 29, wintypes.UINT, ctypes.c_int, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))
        try:
            if enum(factory, 0, 2, ctypes.byref(iid_adapter1), ctypes.byref(adapter)) != 0 or not adapter:
                return None
            desc = DESC1()
            if method(adapter, 10, ctypes.POINTER(DESC1))(adapter, ctypes.byref(desc)) != 0:
                return None
            software = bool(desc.Flags & 2)  # DXGI_ADAPTER_FLAG_SOFTWARE (Microsoft Basic Render Driver)
            return {"name": desc.Description.strip(), "memory_mb": int(desc.DedicatedVideoMemory // (1024 * 1024)), "software": software}
        finally:
            for obj in (adapter, factory):
                if obj:
                    method(obj, 2)(obj)  # Release
    except Exception as err:  # Old Windows, no DXGI 1.6: no card to use.
        logger.info("Could not ask Windows for the graphics card: %s", err)
        return None


def _driver_version(name: str) -> Optional[str]:
    """The installed driver version of the display adapter called ``name`` (from the registry)."""
    if os.name != "nt":
        return None
    try:
        import winreg

        root = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, root) as key:
            for i in range(64):
                try:
                    sub = winreg.EnumKey(key, i)
                except OSError:
                    break
                try:
                    with winreg.OpenKey(key, sub) as adapter:
                        if winreg.QueryValueEx(adapter, "DriverDesc")[0].strip() == name:
                            return str(winreg.QueryValueEx(adapter, "DriverVersion")[0])
                except OSError:
                    continue
    except Exception:
        return None
    return None


def dml_available() -> bool:
    try:
        import onnxruntime as ort

        return DML in ort.get_available_providers()
    except Exception:
        return False


def detect_gpu(refresh: bool = False) -> Optional[Dict[str, Any]]:
    """The graphics card SecurePhotos could use here, or None."""
    with _lock:
        if _state["detected"] and not refresh:
            return _state["gpu"]
        found = _dxgi_high_performance_adapter() if dml_available() else None
        gpu = None
        if found and not found["software"]:
            gpu = {"name": found["name"], "driver": _driver_version(found["name"]), "memory_mb": found["memory_mb"]}
        _state.update(gpu=gpu, detected=True)
        return gpu


def _cpu_name() -> Optional[str]:
    if os.name != "nt":
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
            return " ".join(str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).split())
    except Exception:
        return None


def system_summary() -> Dict[str, Any]:
    """Memory, processor and graphics card, for the new-computer check and Settings."""
    import psutil

    memory_gb = round(psutil.virtual_memory().total / 1024**3)
    gpu = detect_gpu()
    return {
        "memory_gb": memory_gb,
        "memory_low": memory_gb < LOW_MEMORY_GB,
        "cpu": _cpu_name(),
        "cores": psutil.cpu_count(logical=False) or os.cpu_count(),
        "gpu": gpu,
    }


def _gpu_signature() -> Optional[str]:
    gpu = detect_gpu()
    return f"{gpu['name']}|{gpu.get('driver') or ''}" if gpu else None


# ── The plan for this computer ──────────────────────────────────────────────


def load(saved_json: Optional[str], enabled: Optional[int]) -> None:
    """At start-up: this computer's saved plan. A different card or driver means testing again."""
    with _lock:
        _state["enabled"] = enabled is None or bool(enabled)
        try:
            saved = json.loads(saved_json) if saved_json else {}
        except ValueError:
            saved = {}
        signature = _gpu_signature()
        if saved.get("tested_for") and saved.get("tested_for") == signature:
            _state.update(plan=saved.get("plan") or {}, tested_at=saved.get("tested_at"), tested_for=signature)
        else:
            if saved.get("tested_for"):
                logger.info("The graphics card or its driver changed here: it will be tested again.")
            _state.update(plan={}, tested_at=None, tested_for=None)
        _state["dirty"] = False


def saved_form() -> str:
    with _lock:
        return json.dumps({"plan": _state["plan"], "tested_at": _state["tested_at"], "tested_for": _state["tested_for"]})


def needs_test() -> bool:
    """A usable card here that hasn't been measured (or changed since)."""
    return detect_gpu() is not None and _state["tested_for"] != _gpu_signature()


def set_enabled(on: bool) -> None:
    with _lock:
        _state["enabled"] = bool(on)


def device_for(key: str) -> str:
    """Where model ``key`` runs on this computer now."""
    with _lock:
        if not _state["enabled"] or detect_gpu() is None:
            return CPU
        entry = _state["plan"].get(SAME_AS.get(key, key))
        return GPU if entry and entry.get("device") == GPU else CPU


def mark_cpu(keys: Iterable[str], why: str) -> None:
    """These models go back to the processor on this computer (until the card or driver changes)."""
    with _lock:
        for key in keys:
            base = SAME_AS.get(key, key)
            _state["plan"][base] = {"device": CPU, "speedup": None, "why": why}
            for other, same in SAME_AS.items():
                if same == base:
                    _state["plan"][other] = dict(_state["plan"][base])
        _state["dirty"] = True


def start_job() -> None:
    """Before an AI job: nothing has used the card yet."""
    with _lock:
        _state["used_gpu"] = set()


def used_gpu() -> List[str]:
    with _lock:
        return sorted(_state["used_gpu"])


# ── Sessions ────────────────────────────────────────────────────────────────


def _gpu_options():
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.enable_mem_pattern = False  # Required by DirectML.
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 3
    return options


def _open_on_gpu(path: str):
    import onnxruntime as ort

    return ort.InferenceSession(
        path, _gpu_options(), providers=[(DML, {"performance_preference": "high_performance"}), "CPUExecutionProvider"]
    )


def open_session(path, key: str, cpu_options: Callable[[], Any]):
    """The ONNX session for model ``key``: on the graphics card where it is faster here, else on the
    processor. A model that can't open on the card goes to the processor from now on."""
    import onnxruntime as ort

    if device_for(key) == GPU:
        try:
            session = _open_on_gpu(str(path))
            with _lock:
                _state["used_gpu"].add(key)
            logger.info("%s runs on the graphics card", key)
            return session
        except Exception as err:
            logger.warning("%s couldn't open on the graphics card (%s); using the processor.", key, str(err)[:200])
            mark_cpu([key], "couldn't run on the graphics card")
    return ort.InferenceSession(str(path), cpu_options(), providers=["CPUExecutionProvider"])


def note_used(key: str) -> None:
    """A cached session that is on the card is being used again in this job."""
    if device_for(key) == GPU:
        with _lock:
            _state["used_gpu"].add(key)


# ── Speed test ──────────────────────────────────────────────────────────────


def _inputs(session, size: int):
    import numpy as np

    rng = np.random.default_rng(31)
    feed = {}
    for inp in session.get_inputs():
        shape = [d if isinstance(d, int) and d > 0 else (1 if i == 0 else size) for i, d in enumerate(inp.shape)]
        if "mask" in inp.name.lower():
            feed[inp.name] = (rng.random(shape) > 0.9).astype(np.float32)
        else:
            feed[inp.name] = rng.random(shape, dtype=np.float32)
    return feed


def _time(session, feed, repeat: int, warm_up: bool) -> float:
    if warm_up:
        session.run(None, feed)
    started = time.perf_counter()
    for _ in range(repeat):
        session.run(None, feed)
    return (time.perf_counter() - started) / repeat


def measure(key: str, path: str, cpu_options: Callable[[], Any]) -> Dict[str, Any]:
    """One model on the processor and on the card; the decision for it."""
    import onnxruntime as ort

    size, repeat = TEST_SIZE.get(key, 256), TEST_REPEAT.get(key, 1)
    cpu = ort.InferenceSession(path, cpu_options(), providers=["CPUExecutionProvider"])
    feed = _inputs(cpu, size)
    cpu_seconds = _time(cpu, feed, repeat, warm_up=repeat > 1)
    del cpu
    try:
        gpu = _open_on_gpu(path)
        gpu_seconds = _time(gpu, feed, repeat, warm_up=True)  # The first run on a card builds its shaders.
        del gpu
    except Exception as err:
        logger.info("%s can't run on the graphics card here: %s", key, str(err)[:200])
        return {"device": CPU, "speedup": None, "why": "can't run on the graphics card"}
    speedup = round(cpu_seconds / gpu_seconds, 1) if gpu_seconds > 0 else None
    if speedup is not None and speedup >= MIN_SPEEDUP:
        return {"device": GPU, "speedup": speedup, "why": None}
    return {"device": CPU, "speedup": speedup, "why": "not faster on the graphics card"}


def test_status() -> Dict[str, Any]:
    with _lock:
        return dict(_test)


def cancel_test() -> None:
    with _lock:
        if _test["state"] == "running":
            _test["cancel"] = True


def run_test(models_present: Callable[[str], Optional[str]], cpu_options: Callable[[], Any]) -> Dict[str, Any]:
    """Measures every downloaded model (blocking; run it on a worker thread). Models not downloaded
    yet are measured the first time they are needed. Returns the new plan."""
    with _lock:
        _test.update(state="running", step="system", job=None, progress=0, error=None, cancel=False)
    try:
        gpu = detect_gpu(refresh=True)
        if gpu is None:
            with _lock:
                _test.update(state="done", step="no_gpu", progress=100)
            return {}
        todo = [(job, key) for job, keys in JOBS.items() for key in keys if key not in SAME_AS and models_present(key)]
        plan: Dict[str, Dict[str, Any]] = {}
        for i, (job, key) in enumerate(todo):
            with _lock:
                if _test["cancel"]:
                    _test.update(state="cancelled")
                    return {}
                _test.update(step="testing", job=job, progress=int(100 * i / max(1, len(todo))))
            plan[key] = measure(key, models_present(key) or "", cpu_options)
        for other, same in SAME_AS.items():
            if same in plan:
                plan[other] = dict(plan[same])
        with _lock:
            _state["plan"].update(plan)
            _state.update(tested_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), tested_for=_gpu_signature(), dirty=True)
            _test.update(state="done", step="done", job=None, progress=100)
        return plan
    except Exception as err:
        logger.warning("The graphics card test stopped: %s", err)
        with _lock:
            _test.update(state="failed", error=str(err)[:200])
        return {}


def summary() -> Dict[str, Any]:
    """This computer's hardware and what runs where, per job, for the dialog and Settings."""
    with _lock:
        plan = dict(_state["plan"])
        enabled = _state["enabled"]
        tested_at = _state["tested_at"]
    jobs = []
    for job, keys in JOBS.items():
        entries = [plan.get(k) for k in keys if plan.get(k)]
        if not entries:
            continue
        devices = {e["device"] for e in entries}
        device = CPU if not enabled else GPU if devices == {GPU} else MIXED if GPU in devices else CPU
        speedups = [e["speedup"] for e in entries if e["device"] == GPU and e.get("speedup")]
        jobs.append({
            "job": job,
            "device": device,
            "speedup": round(min(speedups), 1) if device == GPU and speedups else None,
            "why": None if device == GPU else "turned off" if not enabled else next((e["why"] for e in entries if e["device"] == CPU), None),
        })
    return {**system_summary(), "use_graphics": enabled, "tested_at": tested_at, "needs_test": needs_test(), "jobs": jobs}


def saved_summary(saved_json: Optional[str], enabled: Optional[int]) -> Optional[Dict[str, Any]]:
    """Any computer's saved result, briefly: its card and how many jobs run on it."""
    try:
        saved = json.loads(saved_json) if saved_json else {}
    except ValueError:
        return None
    if not saved.get("tested_for"):
        return None
    name = saved["tested_for"].split("|", 1)[0]
    plan = saved.get("plan") or {}
    on_gpu = [job for job, keys in JOBS.items() if keys and all((plan.get(k) or {}).get("device") == GPU for k in keys)]
    return {"gpu": name, "jobs_on_gpu": on_gpu, "use_graphics": enabled is None or bool(enabled)}
