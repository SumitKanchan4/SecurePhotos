"""T31: graphics card or processor, per model and per computer (no real hardware needed)."""

import json

import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services import ai_device, computers, restore_queue

CARD = {"name": "AMD Radeon 860M", "driver": "32.0.22050.1003", "memory_mb": 512}


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    """A computer with a usable card, nothing measured yet."""
    monkeypatch.setattr(ai_device, "_state", {
        "gpu": dict(CARD), "detected": True, "enabled": True, "plan": {}, "tested_at": None, "tested_for": None,
        "dirty": False, "used_gpu": set(),
    })
    monkeypatch.setattr(ai_device, "_test", {"state": "idle", "step": None, "job": None, "progress": 0, "error": None, "cancel": False})
    monkeypatch.setattr(ai_device, "dml_available", lambda: True)
    # The hardware itself is faked too: a test never sees this PC's real card.
    monkeypatch.setattr(ai_device, "_dxgi_high_performance_adapter", lambda: {"name": CARD["name"], "memory_mb": 512, "software": False})
    monkeypatch.setattr(ai_device, "_driver_version", lambda name: CARD["driver"])
    monkeypatch.setattr(ai_device, "_cpu_name", lambda: "AMD Ryzen AI 5 340")
    yield


def plan(**devices):
    return {k: {"device": v, "speedup": 4.0 if v == "gpu" else 0.8, "why": None if v == "gpu" else "not faster on the graphics card"} for k, v in devices.items()}


def test_the_card_is_used_only_where_the_test_found_it_faster_and_never_when_switched_off():
    ai_device._state["plan"] = plan(gfpgan="gpu", ddcolor_large="cpu")
    assert ai_device.device_for("gfpgan") == "gpu"
    assert ai_device.device_for("ddcolor_large") == "cpu"
    assert ai_device.device_for("ddcolor_artistic") == "cpu"  # Same network as ddcolor_large.
    assert ai_device.device_for("lama") == "cpu"  # Not measured yet: the processor.
    ai_device.set_enabled(False)
    assert ai_device.device_for("gfpgan") == "cpu"


def test_no_usable_card_means_the_processor_and_no_test(monkeypatch):
    monkeypatch.setattr(ai_device, "_dxgi_high_performance_adapter", lambda: None)
    ai_device._state["gpu"] = None
    ai_device._state["plan"] = plan(gfpgan="gpu")
    assert ai_device.device_for("gfpgan") == "cpu"
    assert ai_device.needs_test() is False
    assert ai_device.run_test(lambda k: "x.onnx", lambda: None) == {}
    assert ai_device.test_status()["step"] == "no_gpu"


def test_the_speed_test_decides_per_model_and_reports_progress(monkeypatch):
    seen = []

    def fake_measure(key, path, cpu_options):
        seen.append(key)
        return {"lama": {"device": "cpu", "speedup": None, "why": "can't run on the graphics card"},
                "ddcolor_large": {"device": "cpu", "speedup": 0.8, "why": "not faster on the graphics card"}}.get(
            key, {"device": "gpu", "speedup": 3.5, "why": None})

    monkeypatch.setattr(ai_device, "measure", fake_measure)
    present = {"gfpgan", "realesr", "ddcolor_large", "scratch_detector", "lama"}  # Face models not downloaded.
    result = ai_device.run_test(lambda k: f"{k}.onnx" if k in present else None, lambda: None)
    assert seen == ["gfpgan", "realesr", "ddcolor_large", "scratch_detector", "lama"]  # ddcolor_artistic shares a result.
    assert result["ddcolor_artistic"] == result["ddcolor_large"]
    assert ai_device.test_status() == {"state": "done", "step": "done", "job": None, "progress": 100, "error": None, "cancel": False}
    assert ai_device.needs_test() is False
    jobs = {j["job"]: j for j in ai_device.summary()["jobs"]}
    assert jobs["faces"] == {"job": "faces", "device": "gpu", "speedup": 3.5, "why": None}
    assert jobs["colour"]["device"] == "cpu" and jobs["colour"]["why"] == "not faster on the graphics card"
    assert jobs["scratches"]["device"] == "mixed"  # Finding on the card, repair on the processor.
    assert "finding_faces" not in jobs  # Measured the first time they are needed.


def test_skipping_stops_the_test_and_nothing_is_decided(monkeypatch):
    def slow_measure(key, path, cpu_options):
        ai_device.cancel_test()
        return {"device": "gpu", "speedup": 3.0, "why": None}

    monkeypatch.setattr(ai_device, "measure", slow_measure)
    ai_device._test["state"] = "running"
    assert ai_device.run_test(lambda k: f"{k}.onnx", lambda: None) == {}
    assert ai_device.test_status()["state"] == "cancelled"
    assert ai_device.needs_test() is True


def test_a_new_driver_or_card_is_tested_again():
    ai_device._state["plan"] = plan(gfpgan="gpu")
    ai_device._state["tested_for"] = f"{CARD['name']}|{CARD['driver']}"
    saved = ai_device.saved_form()
    ai_device.load(saved, 1)
    assert ai_device.device_for("gfpgan") == "gpu" and not ai_device.needs_test()
    ai_device._state["gpu"]["driver"] = "33.0.0.1"  # Windows updated the driver.
    ai_device.load(saved, 1)
    assert ai_device.device_for("gfpgan") == "cpu" and ai_device.needs_test()
    ai_device.load(saved, 0)
    assert ai_device._state["enabled"] is False


def test_a_model_that_cant_open_on_the_card_goes_to_the_processor(monkeypatch):
    import onnxruntime

    opened = []

    class FakeSession:
        def __init__(self, path, options=None, providers=None):
            opened.append(providers)

    def broken(path):
        raise RuntimeError("The parameter is incorrect.")

    monkeypatch.setattr(onnxruntime, "InferenceSession", FakeSession)
    monkeypatch.setattr(ai_device, "_open_on_gpu", broken)
    ai_device._state["plan"] = plan(lama="gpu")
    ai_device.open_session("lama.onnx", "lama", lambda: None)
    assert opened == [["CPUExecutionProvider"]]
    assert ai_device._state["plan"]["lama"] == {"device": "cpu", "speedup": None, "why": "couldn't run on the graphics card"}
    assert ai_device._state["dirty"] is True


async def test_a_card_failing_mid_job_finishes_the_job_on_the_processor(monkeypatch):
    ai_device._state["plan"] = plan(gfpgan="gpu")
    calls = []

    def run(image, params, progress, cancelled):
        calls.append(ai_device.device_for("gfpgan"))
        if len(calls) == 1:
            ai_device._state["used_gpu"].add("gfpgan")
            raise RuntimeError("Device removed (driver reset)")
        return b"done"

    saved = []

    async def save():
        saved.append(True)

    monkeypatch.setattr(computers, "save_hardware", save)
    processor = restore_queue.Processor(models=(), run=run)
    result = await restore_queue._run_on_best_device(processor, b"img", {}, lambda p: None, lambda: False)
    assert result == b"done" and calls == ["gpu", "cpu"]
    assert ai_device.device_for("gfpgan") == "cpu" and saved == [True]
    assert ai_device._state["plan"]["gfpgan"]["why"] == "stopped working on the graphics card"


async def test_an_error_that_isnt_the_cards_is_not_retried():
    def run(image, params, progress, cancelled):
        raise ValueError("not an image")

    with pytest.raises(ValueError):
        await restore_queue._run_on_best_device(restore_queue.Processor(models=(), run=run), b"", {}, lambda p: None, lambda: False)


async def test_the_result_and_the_switch_are_kept_with_the_computer(monkeypatch):
    await run_migrations()
    me = {"id": "pc-t31-test", "name": "LAPTOP-T31"}
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM computers;")
        await conn.commit()
        await computers.register_this_computer(me)  # The first computer: saved as "always".
        ai_device._state["plan"] = plan(gfpgan="gpu")
        ai_device._state.update(tested_for=f"{CARD['name']}|{CARD['driver']}", dirty=True)
        await computers.save_hardware()
        await computers.set_graphics(False)
        async with conn.execute("SELECT hardware, use_graphics FROM computers WHERE id = ?;", (me["id"],)) as cur:
            hardware, use_graphics = await cur.fetchone()
        assert json.loads(hardware)["plan"]["gfpgan"]["device"] == "gpu" and use_graphics == 0
        listed = await computers.list_computers()
        row = next(c for c in listed["computers"] if c["id"] == me["id"])
        assert row["graphics"] == {"gpu": "AMD Radeon 860M", "jobs_on_gpu": ["faces"], "use_graphics": False}
        # Next start: the same card and driver, so no new test.
        ai_device._state.update(plan={}, tested_for=None)
        await computers.register_this_computer(me)
        assert ai_device._state["plan"]["gfpgan"]["device"] == "gpu" and ai_device._state["enabled"] is False
    finally:
        await conn.execute("DELETE FROM computers WHERE id = ?;", (me["id"],))
        await conn.commit()
        await conn.close()
        computers._this.update(id=None, name=None, choice=None, session=None)


async def test_api_hardware_and_switch(monkeypatch):
    saved = []

    async def fake_set(on):
        saved.append(on)
        ai_device.set_enabled(on)

    monkeypatch.setattr(computers, "set_graphics", fake_set)
    monkeypatch.setattr(ai_device, "system_summary", lambda: {"memory_gb": 16, "memory_low": False, "cpu": "AMD Ryzen AI 5 340", "cores": 6, "gpu": CARD})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        got = (await client.get("/api/computers/this/hardware")).json()
        assert got["gpu"]["name"] == "AMD Radeon 860M" and got["needs_test"] is True and got["test"]["state"] == "idle"
        got = (await client.put("/api/computers/this/graphics", json={"on": False})).json()
        assert got["use_graphics"] is False and saved == [False]


def test_a_model_added_after_the_test_is_measured_on_first_use(monkeypatch):
    import onnxruntime

    monkeypatch.setattr(onnxruntime, "InferenceSession", lambda *a, **k: "cpu-session")
    monkeypatch.setattr(ai_device, "_open_on_gpu", lambda path: "gpu-session")
    measured = []
    monkeypatch.setattr(ai_device, "measure", lambda key, path, cpu: measured.append(key) or {"device": "gpu", "speedup": 3.0, "why": None})
    ai_device._state.update(plan=plan(gfpgan="gpu"), tested_for=f"{CARD['name']}|{CARD['driver']}")
    assert ai_device.open_session("ddcolor_artistic.onnx", "ddcolor_artistic", lambda: None) == "gpu-session"
    assert measured == ["ddcolor_artistic"]
    assert ai_device._state["plan"]["ddcolor_large"]["device"] == "gpu"  # Same network: decided together.
    ai_device.open_session("ddcolor_large.onnx", "ddcolor_large", lambda: None)
    assert measured == ["ddcolor_artistic"]  # Once.
    # Before the computer's own test, nothing is measured on the side.
    ai_device._state.update(plan={}, tested_for=None)
    assert ai_device.open_session("gfpgan.onnx", "gfpgan", lambda: None) == "cpu-session"
    assert measured == ["ddcolor_artistic"]


def test_the_test_finds_bundled_models_without_downloading(monkeypatch, tmp_path):
    from engine.services import ai_models, hardware_check

    spec = ai_models.MODELS["realesr"]
    (tmp_path / spec["file"]).write_bytes(b"x")
    monkeypatch.setattr(ai_models, "get_models_dir", lambda: tmp_path / "library")
    monkeypatch.setattr(ai_models, "get_bundled_models_dir", lambda: tmp_path)
    monkeypatch.setattr(ai_models, "_is_verified", lambda path, s: path.is_file())
    monkeypatch.setattr(ai_models, "download_verified", lambda *a, **k: pytest.fail("the test must never download"))
    assert hardware_check._model_file("realesr") == str(tmp_path / spec["file"])
    assert hardware_check._model_file("yunet") is None  # Not here: measured when first used.


def test_the_runtimes_usage_events_are_switched_off_before_any_model_opens(monkeypatch):
    import onnxruntime

    switched = []
    monkeypatch.setattr(ai_device, "_quiet", False)
    monkeypatch.setattr(onnxruntime, "disable_telemetry_events", lambda: switched.append(True), raising=False)
    monkeypatch.setattr(onnxruntime, "InferenceSession", lambda *a, **k: "cpu-session")
    ai_device.open_session("lama.onnx", "lama", lambda: None)
    ai_device.open_session("gfpgan.onnx", "gfpgan", lambda: None)
    assert switched == [True]  # Once per process.
