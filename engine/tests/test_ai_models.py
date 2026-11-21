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
    assert set(ai_models.ON_DEMAND_MODELS) == {"ddcolor_large", "ddcolor_artistic", "gfpgan", "scratch_detector", "lama"}
    for spec in ai_models.ON_DEMAND_MODELS.values():
        assert spec["url"] == "https://github.com/SumitKanchan4/SecurePhotos/releases/download/models-v1/" + spec["file"]
        assert re.fullmatch(r"[0-9a-f]{64}", spec["sha256"]) and int(spec["size"]) > 100_000_000
    # Permissive licences only (owner decision D1): the scratch detector is MIT, the rest Apache-2.0.
    assert {k: s["license"] for k, s in ai_models.ON_DEMAND_MODELS.items() if s["license"] != "Apache-2.0"} == {"scratch_detector": "MIT"}
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


class RangeResponse(FakeResponse):
    """A server answer with an HTTP status (206 = the rest of a partial file)."""

    def __init__(self, data: bytes, status: int):
        super().__init__(data)
        self.status = status


def test_an_interrupted_download_continues_where_it_stopped(tmp_path, monkeypatch):
    data = bytes(range(256)) * 20_000
    spec = _on_demand(monkeypatch, data)
    (tmp_path / (spec["file"] + ".download")).write_bytes(data[:1_000_000])
    asked = []

    def server(req, **k):
        asked.append(req.get_header("Range"))
        return RangeResponse(data[1_000_000:], 206)

    monkeypatch.setattr(ai_models.urllib.request, "urlopen", server)
    seen = []
    path = ai_models.fetch_on_demand("gfpgan", tmp_path, on_progress=lambda d, t: seen.append(d))
    assert asked == ["bytes=1000000-"] and path.read_bytes() == data
    assert seen[0] > 1_000_000 and seen[-1] == len(data)  # Progress counts the part already there.


def test_a_server_that_ignores_the_range_starts_again(tmp_path, monkeypatch):
    data = b"z" * 3_000_000
    spec = _on_demand(monkeypatch, data)
    (tmp_path / (spec["file"] + ".download")).write_bytes(b"stale bytes")
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: RangeResponse(data, 200))
    assert ai_models.fetch_on_demand("gfpgan", tmp_path).read_bytes() == data


def test_a_network_drop_keeps_the_part_already_downloaded(tmp_path, monkeypatch):
    data = b"w" * (3 * 1024 * 1024)
    spec = _on_demand(monkeypatch, data)

    class Dropping(FakeResponse):
        def read(self, n=-1):
            if self.tell() >= 2 * 1024 * 1024:
                raise ConnectionResetError("network gone")
            return super().read(n)

    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: Dropping(data))
    with pytest.raises(ConnectionResetError):
        ai_models.fetch_on_demand("gfpgan", tmp_path)
    assert (tmp_path / (spec["file"] + ".download")).stat().st_size == 2 * 1024 * 1024
    assert not ai_models.is_model_ready("gfpgan", tmp_path)


def test_a_damaged_download_is_not_kept(tmp_path, monkeypatch):
    spec = _on_demand(monkeypatch, b"x" * 2_000_000)
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(b"y" * 2_000_000))
    with pytest.raises(IOError):
        ai_models.fetch_on_demand("gfpgan", tmp_path)
    assert not (tmp_path / spec["file"]).exists() and not (tmp_path / (spec["file"] + ".download")).exists()


def test_a_verified_model_is_not_hashed_again_on_the_next_start(tmp_path, monkeypatch):
    spec = _on_demand(monkeypatch, b"verified weights")
    (tmp_path / spec["file"]).write_bytes(b"verified weights")
    assert ai_models.is_model_ready("gfpgan", tmp_path)
    assert (tmp_path / ai_models.VERIFIED_FILE).is_file()
    ai_models._verified_cache.clear()  # A new engine start.
    monkeypatch.setattr(ai_models, "sha256_of", lambda p: pytest.fail("hashed again"))
    assert ai_models.is_model_ready("gfpgan", tmp_path)


def test_a_stamp_for_another_file_does_not_count(tmp_path, monkeypatch):
    import json
    import os

    spec = _on_demand(monkeypatch, b"good weights")
    target = tmp_path / spec["file"]
    target.write_bytes(b"evil weights")
    st = target.stat()
    # A stamp written for different bytes (other checksum) never makes a file trusted.
    (tmp_path / ai_models.VERIFIED_FILE).write_text(json.dumps({spec["file"]: [st.st_size, st.st_mtime_ns, "0" * 64]}))
    assert not ai_models.is_model_ready("gfpgan", tmp_path)
    os.utime(target, ns=(5, 5))
    assert not ai_models.is_model_ready("gfpgan", tmp_path)


def test_models_the_installer_put_in_the_app_folder_are_found(dirs, monkeypatch):
    library, bundled = dirs
    monkeypatch.setattr(ai_models, "get_models_dir", lambda: library)
    spec = _on_demand(monkeypatch, b"installed by the setup")
    assert ai_models.missing_models(["gfpgan"]) == ["gfpgan"]
    (bundled / spec["file"]).write_bytes(b"installed by the setup")
    assert ai_models.model_path("gfpgan") == bundled / spec["file"]  # Used in place, not copied.
    assert ai_models.missing_models(["gfpgan"]) == [] and not library.exists()
    assert ai_models.download_size(["gfpgan", "gfpgan"]) == 2 * len(b"installed by the setup")


def test_there_is_no_way_to_use_another_model_file():
    assert not hasattr(ai_models, "import_model_file")


# ── A2c: the installer's model download ────────────────────────────────────


def _all_small(monkeypatch, payloads: dict) -> None:
    for key, data in payloads.items():
        _on_demand(monkeypatch, data, key)


def test_installer_skips_verified_models_downloads_the_rest_and_never_fails(tmp_path, monkeypatch):
    from engine.services import model_installer

    payloads = {"ddcolor_large": b"L" * 2_000_000, "ddcolor_artistic": b"A" * 1_000, "gfpgan": b"G" * 1_000,
                "scratch_detector": b"S" * 1_000, "lama": b"M" * 1_000}
    _all_small(monkeypatch, payloads)
    dest = tmp_path / "app" / "data" / "models"
    dest.mkdir(parents=True)
    (dest / ai_models.ON_DEMAND_MODELS["ddcolor_artistic"]["file"]).write_bytes(payloads["ddcolor_artistic"])

    def server(req, **k):
        if "gfpgan" in req.full_url:
            raise OSError("404 not public yet")
        return FakeResponse(payloads["ddcolor_large"])

    monkeypatch.setattr(ai_models.urllib.request, "urlopen", server)
    monkeypatch.setattr(ai_models, "get_models_dir", lambda: tmp_path / "library" / "models")
    lines = []
    monkeypatch.setattr("builtins.print", lambda line, **k: lines.append(line))
    assert model_installer.main(["--fetch-models", str(dest)]) == 0
    status = (dest / model_installer.STATUS_FILE).read_bytes().decode("utf-8")
    assert "Add colour: ready\r\n" in status
    assert "Add colour (second pass): already up to date\r\n" in status
    assert "Sharpen faces: couldn't download (the app will ask later)" in status
    assert "The app will offer the download" in status
    assert any(line.startswith("  Add colour: ") and line.endswith("%") for line in lines)  # Progress lines.
    assert ai_models.is_model_ready("ddcolor_large", dest) and not ai_models.is_model_ready("gfpgan", dest)


def test_installer_counts_models_already_in_a_library_kept_elsewhere(tmp_path, monkeypatch):
    from engine.services import model_installer

    payloads = {"ddcolor_large": b"L" * 10, "ddcolor_artistic": b"A" * 10, "gfpgan": b"G" * 10, "scratch_detector": b"S" * 10, "lama": b"M" * 10}
    _all_small(monkeypatch, payloads)
    library = tmp_path / "external" / "models"
    library.mkdir(parents=True)
    for key, data in payloads.items():
        (library / ai_models.ON_DEMAND_MODELS[key]["file"]).write_bytes(data)
    monkeypatch.setattr(ai_models, "get_models_dir", lambda: library)
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: pytest.fail("downloaded again"))
    monkeypatch.setattr("builtins.print", lambda *a, **k: None)
    dest = tmp_path / "app" / "data" / "models"
    assert model_installer.main(["--fetch-models", str(dest)]) == 0
    status = (dest / model_installer.STATUS_FILE).read_text(encoding="utf-8")
    assert status.count("already up to date") == 5 and "offer the download" not in status


def test_installer_survives_anything(tmp_path, monkeypatch):
    from engine.services import model_installer

    monkeypatch.setattr(model_installer, "fetch_models", lambda *a, **k: 1 / 0)
    monkeypatch.setattr("builtins.print", lambda *a, **k: None)
    assert model_installer.main(["--fetch-models", str(tmp_path)]) == 0
    assert "couldn't download" in (tmp_path / model_installer.STATUS_FILE).read_text(encoding="utf-8")


def test_the_engine_launcher_runs_the_model_download_without_starting_the_server():
    from pathlib import Path as _P

    launcher = (_P(__file__).resolve().parents[2] / "run_engine.py").read_text(encoding="utf-8")
    assert launcher.index("--fetch-models") < launcher.index("from engine.main import")
    hooks = (_P(__file__).resolve().parents[2] / "src-tauri" / "nsis-hooks.nsh").read_text(encoding="utf-8")
    assert '"$INSTDIR\\engine\\securephotos-engine.exe" --fetch-models "$INSTDIR\\data\\models"' in hooks
    assert "$PassiveMode <> 1" in hooks  # No message box during silent updates.


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
