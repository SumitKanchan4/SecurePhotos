"""H10 / A3: "Add colour" and "Fix faded colours" (fake DDColor sessions; no model downloads)."""

import io
from contextlib import contextmanager

import numpy as np
import pytest
from PIL import Image

from engine.services import old_photo_processors as op
from engine.services import onnx_sessions

BROWN = (12.0, 35.0)   # Lab a, b: orange/brown (hue ~71 degrees).
BLUE = (-4.0, -30.0)   # Lab a, b: blue.


def _jpeg(rgb) -> bytes:
    out = io.BytesIO()
    Image.fromarray(np.asarray(rgb, dtype=np.uint8)).save(out, "JPEG", quality=95)
    return out.getvalue()


def _grey_photo(w=120, h=90) -> bytes:
    ramp = np.tile(np.linspace(40, 200, w, dtype=np.uint8), (h, 1))
    return _jpeg(np.stack([ramp] * 3, axis=2))


class FakeSession:
    """Answers every pixel with one colour; the colour may depend on the input size."""

    def __init__(self, key, colours, calls):
        self.key, self.colours, self.calls = key, colours, calls

    def run(self, _outputs, feeds):
        size = feeds["input"].shape[2]
        self.calls.append((self.key, size))
        a, b = self.colours.get((self.key, size), self.colours.get(self.key, (0.0, 0.0)))
        ab = np.empty((1, 2, size, size), np.float32)
        ab[0, 0], ab[0, 1] = a, b
        return [ab]


@pytest.fixture
def models(monkeypatch):
    state = {"colours": {}, "calls": [], "loaded": None, "loads": []}

    @contextmanager
    def use_model(key):
        if state["loaded"] != key:
            state["loads"].append(key)
            state["loaded"] = key
        yield FakeSession(key, state["colours"], state["calls"])

    monkeypatch.setattr(onnx_sessions, "use_model", use_model)
    monkeypatch.setattr(onnx_sessions, "loaded_model", lambda: state["loaded"])
    return state


def _mean_ab(jpeg: bytes):
    import cv2

    rgb = np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB")).astype(np.float32) / 255
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)
    return float(lab[..., 1].mean()), float(lab[..., 2].mean())


def _run(fn, data, params=None):
    out = fn(data, params or {}, lambda v: None, lambda: False)
    return getattr(out, "image", out)  # Fix faded colours returns an Outcome (A5: faces).


def test_natural_uses_both_models_at_512_and_keeps_the_size(models):
    models["colours"].update({"ddcolor_large": BLUE, "ddcolor_artistic": BLUE})
    out = _run(op.add_colour, _grey_photo(), {"style": "natural"})
    assert sorted(models["calls"]) == [("ddcolor_artistic", 512), ("ddcolor_large", 512)]
    assert Image.open(io.BytesIO(out)).size == (120, 90)
    a, b = _mean_ab(out)
    assert b < -10  # The colour came through.


def test_vivid_runs_the_large_model_at_768(models):
    models["colours"].update({"ddcolor_large": BLUE, "ddcolor_artistic": BLUE})
    _run(op.add_colour, _grey_photo(), {"style": "vivid"})
    assert ("ddcolor_large", 768) in models["calls"] and ("ddcolor_large", 512) not in models["calls"]


def test_a_brown_result_tries_vivid_and_keeps_it_when_it_removes_the_cast(models):
    models["colours"].update({("ddcolor_large", 512): BROWN, ("ddcolor_large", 768): BLUE, "ddcolor_artistic": (0.0, 0.0)})
    out = _run(op.add_colour, _grey_photo())
    assert ("ddcolor_large", 768) in models["calls"]
    assert _mean_ab(out)[1] < 0  # Blue won, not brown.


def test_vivid_is_not_used_when_it_is_just_as_brown(models):
    models["colours"].update({("ddcolor_large", 512): BROWN, ("ddcolor_large", 768): (32.0, 32.0), "ddcolor_artistic": (0.0, 0.0)})
    out = _run(op.add_colour, _grey_photo())
    a, b = _mean_ab(out)
    assert ("ddcolor_large", 768) in models["calls"]
    assert b > 10 and a < 22  # Still Natural's brown (a~12), not Vivid's redder brown (a~32).


def test_a_normal_result_does_not_pay_for_the_vivid_try(models):
    models["colours"].update({"ddcolor_large": BLUE, "ddcolor_artistic": BLUE})
    _run(op.add_colour, _grey_photo())
    assert all(size == 512 for _, size in models["calls"])


def test_the_model_already_in_memory_runs_first(models):
    models["colours"].update({"ddcolor_large": BLUE, "ddcolor_artistic": BLUE})
    models["loaded"] = "ddcolor_artistic"
    _run(op.add_colour, _grey_photo())
    assert models["loads"] == ["ddcolor_large"]  # Artistic was already loaded: one swap, not two.


def test_cancelling_stops_before_any_model_runs(models):
    assert op.add_colour(_grey_photo(), {}, lambda v: None, lambda: True) == b""
    assert models["calls"] == []


def test_contrast_of_a_faded_print_is_restored(models):
    faded = np.tile(np.linspace(60, 175, 120, dtype=np.uint8), (90, 1))  # Faded like the owner's prints (~1.4x).
    out = np.asarray(Image.open(io.BytesIO(_run(op.add_colour, _jpeg(np.stack([faded] * 3, 2))))).convert("L"))
    assert out.max() - out.min() > 200  # Full contrast back.
    washed = np.tile(np.linspace(110, 150, 120, dtype=np.uint8), (90, 1))  # Extremely washed out.
    out = np.asarray(Image.open(io.BytesIO(_run(op.add_colour, _jpeg(np.stack([washed] * 3, 2))))).convert("L"))
    assert 80 < out.max() - out.min() < 120  # Lifted 2.5x at most, not blown out.


def test_fix_faded_colours_removes_a_yellow_cast():
    rng = np.random.default_rng(1)
    base = rng.integers(30, 220, (90, 120, 3)).astype(np.float32)
    yellowed = np.clip(base * [1.0, 0.95, 0.6] + [40, 35, 10], 0, 255)
    before = _mean_ab(_jpeg(yellowed))[1]
    fixed = np.asarray(Image.open(io.BytesIO(_run(op.fade, _jpeg(yellowed)))).convert("RGB")).astype(float)
    after = _mean_ab(_run(op.fade, _jpeg(yellowed)))[1]
    assert before > 15 and abs(after) < before / 3
    assert fixed[..., 2].max() > 240 and fixed[..., 2].min() < 15  # The weak blue channel spans the full range again.


def test_black_and_white_detection_includes_sepia():
    def flat(r, g, b):
        return np.stack([np.full((90, 120), v, np.uint8) for v in (r, g, b)], 2)

    ramp = np.tile(np.linspace(60, 220, 120), (90, 1))
    strong_sepia = np.stack([ramp, ramp * 0.9, ramp * 0.75], 2).astype(np.uint8)  # Warmer than any test print.
    two_colours = np.concatenate([flat(200, 60, 50)[:, :60], flat(40, 90, 200)[:, 60:]], 1)
    assert op.is_black_and_white(op.decode_rgb(_grey_photo()))
    assert op.is_black_and_white(flat(150, 144, 138))       # Lightly toned print.
    assert op.is_black_and_white(strong_sepia)              # One tint, however strong.
    assert not op.is_black_and_white(two_colours)           # Red and blue: a colour photo.
    rng = np.random.default_rng(2)
    assert not op.is_black_and_white(rng.integers(0, 255, (90, 120, 3)).astype(np.uint8))


def test_strength_mixes_result_and_original():
    original, result = _jpeg(np.full((40, 40, 3), 0)), _jpeg(np.full((40, 40, 3), 200))
    assert op.apply_intensity(result, original, 1.0) == result
    half = np.asarray(Image.open(io.BytesIO(op.apply_intensity(result, original, 0.5))))
    assert 95 <= half.mean() <= 105
    none = np.asarray(Image.open(io.BytesIO(op.apply_intensity(result, original, 0.0))))
    assert none.mean() < 5


def test_a_nearly_flat_photo_is_lifted_gently_not_turned_black(models):
    models["colours"].update({"ddcolor_large": BLUE, "ddcolor_artistic": BLUE})
    flat = np.full((90, 120, 3), 120, np.uint8)
    flat[:, :60] = 124  # Almost no detail at all.
    out = np.asarray(Image.open(io.BytesIO(_run(op.add_colour, _jpeg(flat)))).convert("L"))
    assert 80 < out.mean() < 180  # Not black, not white.
    L = np.linspace(40, 60, 1000)
    assert np.ptp(op.stretch_brightness(L)) <= 20 * op.MAX_STRETCH + 1  # Gain capped.
    assert np.ptp(op.stretch_brightness(np.linspace(10, 85, 1000))) > 95  # Normal prints: full range.


def test_automatic_colour_with_faces_sharpens_the_coloured_photo_in_the_same_job(models, monkeypatch):
    """A6: "Add colour" and "Sharpen blurry faces" both Automatic -> one job, one copy."""
    from engine.services import ai_models
    from engine.services.restore_queue import Outcome

    models["colours"].update({"ddcolor_large": BLUE, "ddcolor_artistic": BLUE})
    seen = []

    def faces_outcome(rgb, progress, cancelled, span=(5, 95)):
        seen.append(rgb.copy())
        return Outcome(image=op.encode_jpeg(rgb), info={"faces": [{"strength": 0.8}]})

    monkeypatch.setattr(op, "_faces_outcome", faces_outcome)
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: True)
    out = op.add_colour(_grey_photo(), {"style": "natural", "faces": True}, lambda v: None, lambda: False)
    assert isinstance(out, Outcome) and len(seen) == 1
    assert seen[0][..., 2].mean() > seen[0][..., 0].mean() + 10  # Faces were done on the coloured photo.
    assert op.kinds_kept("colour", out.info, []) == "colour,faces"
    def colour_only(params):
        return op.add_colour(_grey_photo(), params, lambda v: None, lambda: False)

    assert isinstance(colour_only({"style": "natural"}), bytes)  # Asked from the viewer: colour only.
    monkeypatch.setattr(ai_models, "is_model_ready", lambda key, d=None: False)
    assert isinstance(colour_only({"style": "natural", "faces": True}), bytes) and len(seen) == 1  # No face model: colour only.
