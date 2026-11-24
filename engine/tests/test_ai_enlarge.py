"""T31b: small photos enlarged with AI on a computer with a fast graphics card (off by default)."""

import io

import pytest
from PIL import Image

from engine.services import ai_device, enhancement_service, neural_sr_service


def _jpeg(w: int, h: int, mode: str = "RGB") -> bytes:
    img = Image.new(mode, (w, h), (120, 90, 60) if mode == "RGB" else (120, 90, 60, 200))
    out = io.BytesIO()
    img.save(out, "PNG" if mode == "RGBA" else "JPEG", quality=90)
    return out.getvalue()


@pytest.fixture
def ai(monkeypatch):
    """A fast card for the enlarging model, and a stand-in for Real-ESRGAN (4x)."""
    calls = []

    def fake_upscale(img, tile_size=512, tile_pad=32):
        calls.append(img.size)
        # Like the real one: inputs over 1920 px are first reduced to 1920 (sizes truncated).
        w, h = img.size
        if max(w, h) > 1920:
            r = 1920 / max(w, h)
            w, h = int(w * r), int(h * r)
        return img.resize((w * 4, h * 4))

    monkeypatch.setattr(enhancement_service, "ai_enlarge_ready", lambda: True)
    monkeypatch.setattr(neural_sr_service, "neural_upscale", fake_upscale)
    return calls


def test_a_small_photo_is_enlarged_with_ai_when_switched_on(ai):
    _, w, h = enhancement_service.render_enhanced_avif(_jpeg(1600, 1200), 60, 3840, ai_enlarge=True)
    assert (w, h) == (3840, 2880) and ai == [(1600, 1200)]
    # A 2000 px photo going to 4K (Auto) grows only 1.9x and still qualifies, at exactly the
    # size the resize gives (2000x1333 -> 3840x2559, though the model works on 1920x1279).
    _, w, h = enhancement_service.render_enhanced_avif(_jpeg(2000, 1333), 60, 3840, ai_enlarge=True)
    assert ai[-1] == (2000, 1333) and (w, h) == (3840, 2559)


def test_switched_off_or_not_much_bigger_uses_the_resize(ai):
    enhancement_service.render_enhanced_avif(_jpeg(1600, 1200), 60, 3840, ai_enlarge=False)
    enhancement_service.render_enhanced_avif(_jpeg(2400, 1800), 60, 7680, ai_enlarge=True)  # larger than 2048 px: resize keeps more
    enhancement_service.render_enhanced_avif(_jpeg(1600, 1200), 60, 2000, ai_enlarge=True)  # only 1.25x bigger
    enhancement_service.render_enhanced_avif(_jpeg(400, 300, "RGBA"), 60, 3840, ai_enlarge=True)  # transparency
    assert ai == []


def test_no_fast_card_uses_the_resize(ai, monkeypatch):
    monkeypatch.setattr(enhancement_service, "ai_enlarge_ready", lambda: False)
    _, w, _ = enhancement_service.render_enhanced_avif(_jpeg(1600, 1200), 60, 3840, ai_enlarge=True)
    assert w == 3840 and ai == []


def test_if_ai_fails_the_photo_is_still_enhanced_and_the_card_is_not_used_again(monkeypatch):
    marked = []
    monkeypatch.setattr(enhancement_service, "ai_enlarge_ready", lambda: True)
    monkeypatch.setattr(neural_sr_service, "neural_upscale", lambda img, **k: (_ for _ in ()).throw(RuntimeError("Device removed")))
    monkeypatch.setattr(ai_device, "mark_cpu", lambda keys, why: marked.append((list(keys), why)))
    _, w, h = enhancement_service.render_enhanced_avif(_jpeg(1600, 1200), 60, 3840, ai_enlarge=True)
    assert (w, h) == (3840, 2880)
    assert marked == [(["realesr"], "stopped working on the graphics card")]


def test_ready_only_when_the_speed_test_put_the_model_on_the_card(monkeypatch):
    monkeypatch.setattr(ai_device, "device_for", lambda key: "gpu" if key == "realesr" else "cpu")
    assert enhancement_service.ai_enlarge_ready() is True
    monkeypatch.setattr(ai_device, "device_for", lambda key: "cpu")
    assert enhancement_service.ai_enlarge_ready() is False


def test_the_setting_is_off_by_default():
    from engine.api.system import DEFAULT_APP_SETTINGS

    assert DEFAULT_APP_SETTINGS["photo_enlarge_ai"] is False
