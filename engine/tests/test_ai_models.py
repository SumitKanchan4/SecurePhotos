"""H8: AI models are pinned (commit + SHA-256), bundled with the app, and never loaded unverified."""

import hashlib
import importlib.util
import io
import re
from pathlib import Path

import pytest

from engine.services import ai_models


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _spec(data: bytes) -> dict:
    return {"file": "model.onnx", "url": "https://example.invalid/model.onnx",
            "sha256": hashlib.sha256(data).hexdigest(), "license": "MIT"}


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    library, bundled = tmp_path / "library_models", tmp_path / "app" / "data" / "models"
    bundled.mkdir(parents=True)
    monkeypatch.setattr(ai_models, "get_bundled_models_dir", lambda: bundled)
    return library, bundled


def _no_download(monkeypatch):
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: pytest.fail("must not download"))


def test_every_model_is_pinned_to_a_commit_and_checksum():
    assert set(ai_models.MODELS) == {"yunet", "sface", "realesr"}
    for spec in ai_models.MODELS.values():
        assert re.search(r"/resolve/[0-9a-f]{40}/", spec["url"]), spec["url"]  # Not a moving branch like main.
        assert re.fullmatch(r"[0-9a-f]{64}", spec["sha256"])


def test_download_with_wrong_checksum_is_refused(dirs, monkeypatch):
    library, _ = dirs
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(b"tampered model bytes"))
    with pytest.raises(IOError):
        ai_models.ensure_model(_spec(b"the real model"), library)
    assert list(library.iterdir()) == []  # Nothing partial or tampered is left behind.


def test_verified_copy_in_library_is_used_as_is(dirs, monkeypatch):
    library, _ = dirs
    library.mkdir()
    (library / "model.onnx").write_bytes(b"good")
    _no_download(monkeypatch)
    assert ai_models.ensure_model(_spec(b"good"), library) == library / "model.onnx"


def test_bundled_copy_is_used_offline(dirs, monkeypatch):
    """Fresh install or a library moved to another drive: the installer's copy is used, no internet needed."""
    library, bundled = dirs
    (bundled / "model.onnx").write_bytes(b"bundled model")
    _no_download(monkeypatch)
    path = ai_models.ensure_model(_spec(b"bundled model"), library)
    assert path == library / "model.onnx" and path.read_bytes() == b"bundled model"


def test_damaged_bundled_copy_is_not_used(dirs, monkeypatch):
    library, bundled = dirs
    (bundled / "model.onnx").write_bytes(b"damaged")
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(b"real model"))
    path = ai_models.ensure_model(_spec(b"real model"), library)
    assert path.read_bytes() == b"real model"


def test_release_script_fetches_and_verifies_all_models(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[2] / "scripts" / "fetch_models.py"
    spec = importlib.util.spec_from_file_location("fetch_models", script)
    fetch_models = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fetch_models)

    fake = {name: f"model {name}".encode() for name in ai_models.MODELS}
    monkeypatch.setattr(fetch_models, "MODELS", {
        name: {**s, "sha256": hashlib.sha256(fake[name]).hexdigest()} for name, s in ai_models.MODELS.items()
    })
    by_url = {s["url"]: fake[name] for name, s in ai_models.MODELS.items()}
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda req, **k: FakeResponse(by_url[req.full_url]))
    (tmp_path / "placeholder.txt").write_text("placeholder")

    fetch_models.fetch_all(tmp_path)

    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(s["file"] for s in ai_models.MODELS.values())


def test_installer_bundles_the_build_folder_not_the_live_library():
    """The live data/models folder may hold other (e.g. retired, non-redistributable) models."""
    import json

    root = Path(__file__).resolve().parents[2]
    resources = json.loads((root / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["bundle"]["resources"]
    assert resources.get("../build/models/*") == "data/models/"
    assert not any(src.startswith("../data/") for src in resources)
    assert resources.get("../THIRD_PARTY_NOTICES.md") == "THIRD_PARTY_NOTICES.md"  # Licences travel with the models.
    assert ai_models.get_bundled_models_dir() == root / "build" / "models"  # Development runs use the same folder.


# ── H10: old-photo models, downloaded on first use ──────────────────────────


def _on_demand(monkeypatch, data: bytes, key: str = "gfpgan") -> dict:
    spec = {**ai_models.ON_DEMAND_MODELS[key], "sha256": hashlib.sha256(data).hexdigest(), "size": str(len(data))}
    monkeypatch.setitem(ai_models.ON_DEMAND_MODELS, key, spec)
    ai_models._verified_cache.clear()
    return spec


def test_old_photo_models_are_pinned_to_this_repos_release_and_not_bundled():
    assert set(ai_models.ON_DEMAND_MODELS) == {"ddcolor_large", "ddcolor_artistic", "gfpgan"}
    for spec in ai_models.ON_DEMAND_MODELS.values():
        assert spec["url"] == "https://github.com/SumitKanchan4/SecurePhotos/releases/download/models-v1/" + spec["file"]
        assert re.fullmatch(r"[0-9a-f]{64}", spec["sha256"]) and int(spec["size"]) > 100_000_000
        assert spec["license"] == "Apache-2.0"
    assert not set(ai_models.ON_DEMAND_MODELS) & set(ai_models.MODELS)  # The installer stays small.


def test_download_reports_progress_and_keeps_only_a_verified_file(tmp_path, monkeypatch):
    data = b"x" * (3 * 1024 * 1024 + 5)
    spec = _on_demand(monkeypatch, data)
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(data))
    seen = []
    path = ai_models.fetch_on_demand("gfpgan", tmp_path, on_progress=lambda d, t: seen.append((d, t)))
    assert path.read_bytes() == data and seen[-1] == (len(data), len(data)) and len(seen) == 4
    assert ai_models.is_model_ready("gfpgan", tmp_path) and ai_models.model_path("gfpgan", tmp_path) == tmp_path / spec["file"]


def test_cancelled_download_leaves_nothing_behind(tmp_path, monkeypatch):
    import threading

    data = b"y" * (2 * 1024 * 1024)
    _on_demand(monkeypatch, data)
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(data))
    stop = threading.Event()
    stop.set()
    with pytest.raises(ai_models.DownloadCancelled):
        ai_models.fetch_on_demand("gfpgan", tmp_path, cancel=stop)
    assert list(tmp_path.iterdir()) == []


def test_missing_or_damaged_model_is_never_used(tmp_path, monkeypatch):
    spec = _on_demand(monkeypatch, b"the real weights")
    with pytest.raises(FileNotFoundError):
        ai_models.model_path("gfpgan", tmp_path)
    (tmp_path / spec["file"]).write_bytes(b"the real weightz")  # Same size, one byte off.
    assert not ai_models.is_model_ready("gfpgan", tmp_path)
    with pytest.raises(FileNotFoundError):
        ai_models.model_path("gfpgan", tmp_path)


def test_a_replaced_file_is_checked_again(tmp_path, monkeypatch):
    import os

    spec = _on_demand(monkeypatch, b"good weights")
    target = tmp_path / spec["file"]
    target.write_bytes(b"good weights")
    assert ai_models.is_model_ready("gfpgan", tmp_path)
    target.write_bytes(b"evil weights")
    os.utime(target, ns=(1, 1))  # Different timestamp, so the remembered check doesn't apply.
    assert not ai_models.is_model_ready("gfpgan", tmp_path)


def test_import_from_file_recognises_a_renamed_model_and_refuses_anything_else(tmp_path, monkeypatch):
    spec = _on_demand(monkeypatch, b"weights from a usb stick")
    picked = tmp_path / "Downloads" / "renamed (1).onnx"
    picked.parent.mkdir()
    picked.write_bytes(b"weights from a usb stick")
    library = tmp_path / "library"
    assert ai_models.import_model_file(picked, library) == "gfpgan"
    assert (library / spec["file"]).read_bytes() == b"weights from a usb stick" and picked.exists()
    other = tmp_path / "holiday.jpg"
    other.write_bytes(b"not a model at all, same size?!")
    with pytest.raises(ValueError):
        ai_models.import_model_file(other, library)
    with pytest.raises(ValueError):
        ai_models.import_model_file(tmp_path / "missing.onnx", library)
    assert sorted(p.name for p in library.iterdir()) == [spec["file"]]


def test_only_one_big_model_is_in_memory_at_a_time(monkeypatch):
    from engine.services import onnx_sessions

    opened = []
    monkeypatch.setattr(onnx_sessions.ai_models, "model_path", lambda key: Path(f"{key}.onnx"))
    monkeypatch.setattr(onnx_sessions, "_open", lambda path: opened.append(path.name) or object())
    onnx_sessions.release()
    with onnx_sessions.use_model("ddcolor_large") as first:
        pass
    with onnx_sessions.use_model("ddcolor_large") as again:
        assert again is first  # Same model: not loaded twice.
    with onnx_sessions.use_model("gfpgan"):
        assert onnx_sessions.loaded_model() == "gfpgan"
    assert opened == ["ddcolor_large.onnx", "gfpgan.onnx"]
    onnx_sessions.release()
    assert onnx_sessions.loaded_model() is None
    assert 1 <= onnx_sessions.cpu_threads() <= 4


def test_release_refuses_while_old_photo_models_need_a_login():
    script = Path(__file__).resolve().parents[2] / "scripts" / "create_release.py"
    spec = importlib.util.spec_from_file_location("create_release", script)
    create_release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(create_release)

    class Opener:
        def __init__(self, public):
            self.public, self.headers = public, []

        def open(self, req, timeout=None):
            self.headers.append(dict(req.header_items()))
            if not self.public:
                raise OSError("404 (private repo)")
            return FakeResponse(b"")

    FakeResponse.status = 200
    private = Opener(public=False)
    assert create_release.check_on_demand_models_public(private) == [s["url"] for s in ai_models.ON_DEMAND_MODELS.values()]
    assert all("Authorization" not in h for h in private.headers)  # Checked as an anonymous user would.
    assert create_release.check_on_demand_models_public(Opener(public=True)) == []
