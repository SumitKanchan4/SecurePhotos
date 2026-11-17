"""Rebuilds the "Remove scratches and spots" ONNX models (H10 / A7) from the official weights.

- ``scratch_detector.onnx``: the scratch-detection U-Net of Microsoft's "Bringing Old Photos
  Back to Life" (MIT). Input: grey ``[1,1,H,W]`` in -1..1 (H, W multiples of 16); output: the
  probability of damage per pixel (sigmoid included).
- ``lama_512.onnx``: Big-LaMa (Apache-2.0), the fill-in. Inputs: ``image [1,3,H,W]`` 0..1 and
  ``mask [1,1,H,W]`` (1 = fill); output: the image with the masked pixels filled. Used on
  512 x 512 tiles; one self-contained file (no external weight file).

Safety (owner approved running the upstream model code for this, 2026-11-17):
- Only the model-definition files are imported (``networks.py`` + ``antialiasing.py`` of
  BOPBTL; ``ffc.py`` and its few small modules of LaMa). Training-only libraries they name
  (``kornia``, ``pytorch_lightning``, BOPBTL's sync-BatchNorm add-on) get empty stand-ins:
  the parts that need them are not used by these models.
- The detector weights load with ``weights_only=True``. The LaMa checkpoint is a PyTorch
  Lightning file that also stores training objects, so ``lama-weights`` first copies out only
  its tensors with a restricted reader that never imports or calls anything named in the file
  (Python's "restricting globals" pattern); the export then loads that tensor file with
  ``weights_only=True``.
- Run with ``python -I`` from outside the checkouts.

Usage:
    python -I export_scratch_models.py lama-weights <big-lama/models/best.ckpt> <lama_generator.pt>
    python -I export_scratch_models.py detector <BOPBTL checkout> <FT_Epoch_latest.pt> <scratch_detector.onnx>
    python -I export_scratch_models.py lama     <LaMa checkout>  <lama_generator.pt>  <lama_512.onnx>
"""

import pickle
import sys
import types
import zipfile
from pathlib import Path

# ── Restricted checkpoint reader ───────────────────────────────────────────

_DTYPES = {
    "FloatStorage": "float32", "DoubleStorage": "float64", "HalfStorage": "float16",
    "LongStorage": "int64", "IntStorage": "int32", "ShortStorage": "int16",
    "CharStorage": "int8", "ByteStorage": "uint8", "BoolStorage": "bool",
}


class _Inert:
    """Stands in for any object in the file: accepts any construction or state, does nothing."""

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _Inert()

    def __setstate__(self, state):
        pass

    def __setitem__(self, key, value):
        pass

    def append(self, value):
        pass

    def extend(self, values):
        pass


class _StateDict(dict):
    """OrderedDict stand-in that can carry the ``_metadata`` attribute."""


class _StorageType:
    def __init__(self, name):
        self.name = name


class _RestrictedUnpickler(pickle.Unpickler):
    def __init__(self, fh, archive, prefix):
        super().__init__(fh)
        self.archive, self.prefix, self.cache = archive, prefix, {}

    def find_class(self, module, name):
        if (module, name) == ("torch._utils", "_rebuild_tensor_v2"):
            return self._rebuild_tensor
        if (module, name) == ("torch._utils", "_rebuild_parameter"):
            return lambda data, requires_grad, hooks: data
        if (module, name) == ("collections", "OrderedDict"):
            return _StateDict
        if module == "torch" and name in _DTYPES:
            return _StorageType(name)
        return _Inert  # Never import or call anything the file names.

    def persistent_load(self, pid):
        import numpy as np

        _kind, storage_type, key, _location, _numel = pid
        dtype = _DTYPES[storage_type.name if isinstance(storage_type, _StorageType) else "FloatStorage"]
        if key not in self.cache:
            self.cache[key] = np.frombuffer(self.archive.read(f"{self.prefix}/data/{key}"), dtype=dtype)
        return self.cache[key]

    @staticmethod
    def _rebuild_tensor(storage, offset, size, stride, *rest):
        import numpy as np
        import torch

        if not isinstance(storage, np.ndarray):
            return _Inert()
        view = np.lib.stride_tricks.as_strided(storage[offset:], shape=tuple(size), strides=tuple(s * storage.itemsize for s in stride))
        return torch.from_numpy(np.array(view))


def extract_lama_weights(ckpt: Path, out: Path) -> int:
    """Copies the generator tensors out of the Lightning checkpoint without running it."""
    import torch

    with zipfile.ZipFile(ckpt) as archive:
        pkl = next(n for n in archive.namelist() if n.endswith("/data.pkl"))
        with archive.open(pkl) as fh:
            data = _RestrictedUnpickler(fh, archive, pkl[: -len("/data.pkl")]).load()
    state = {k[len("generator."):]: v for k, v in data["state_dict"].items() if k.startswith("generator.") and isinstance(v, torch.Tensor)}
    torch.save(state, out)
    return len(state)


# ── Models ─────────────────────────────────────────────────────────────────


def _stub(name: str, **attrs) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module
    return module


def _load_file(name: str, path: Path) -> types.ModuleType:
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def export_detector(checkout: Path, weights: Path, out: Path) -> None:
    import torch

    folder = checkout / "Global" / "detection_models"
    _stub("detection_models").__path__ = [str(folder)]
    _stub("detection_models.sync_batchnorm", DataParallelWithCallback=object)  # Multi-GPU only.
    _load_file("detection_models.antialiasing", folder / "antialiasing.py")
    networks = _load_file("detection_models.networks", folder / "networks.py")
    net = networks.UNet(in_channels=1, out_channels=1, depth=4, conv_num=2, wf=6, padding=True, batch_norm=True,
                        up_mode="upsample", with_tanh=False, sync_bn=False, antialiasing=True)
    net.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True)["model_state"], strict=True)
    net.eval()

    class Detector(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, grey):
            return torch.sigmoid(self.inner(grey))

    torch.onnx.export(Detector(net).eval(), (torch.zeros(1, 1, 256, 384),), str(out), input_names=["grey"],
                      output_names=["probability"], dynamic_axes={"grey": {2: "h", 3: "w"}, "probability": {2: "h", 3: "w"}},
                      opset_version=17, dynamo=False)


def export_lama(checkout: Path, weights: Path, out: Path) -> None:
    import torch

    modules = checkout / "saicinpainting" / "training" / "modules"
    for name, path in (("saicinpainting", checkout / "saicinpainting"), ("saicinpainting.training", checkout / "saicinpainting" / "training"),
                       ("saicinpainting.training.modules", modules)):
        _stub(name).__path__ = [str(path)]
    _stub("saicinpainting.utils", get_shape=lambda t: tuple(t.shape))
    _stub("kornia")
    _stub("kornia.geometry")
    _stub("kornia.geometry.transform", rotate=None)  # Only the unused spatial-transform layer needs it.
    for name in ("depthwise_sep_conv", "multidilated_conv", "base", "squeeze_excitation", "spatial_transform"):
        _load_file(f"saicinpainting.training.modules.{name}", modules / f"{name}.py")
    ffc = _load_file("saicinpainting.training.modules.ffc", modules / "ffc.py")
    gen = ffc.FFCResNetGenerator(
        input_nc=4, output_nc=3, ngf=64, n_downsampling=3, n_blocks=18, add_out_act="sigmoid",
        init_conv_kwargs={"ratio_gin": 0, "ratio_gout": 0, "enable_lfu": False},
        downsample_conv_kwargs={"ratio_gin": 0, "ratio_gout": 0, "enable_lfu": False},
        resnet_conv_kwargs={"ratio_gin": 0.75, "ratio_gout": 0.75, "enable_lfu": False},
    )  # big-lama/config.yaml, "generator".
    gen.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True), strict=True)
    gen.eval()

    class Lama(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, image, mask):
            pred = self.inner(torch.cat([image * (1 - mask), mask], dim=1))
            return mask * pred + (1 - mask) * image

    torch.onnx.export(Lama(gen).eval(), (torch.zeros(1, 3, 512, 512), torch.zeros(1, 1, 512, 512)), str(out),
                      input_names=["image", "mask"], output_names=["output"], opset_version=20, dynamo=True,
                      external_data=False)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == "lama-weights":
        print("tensors:", extract_lama_weights(Path(args[1]), Path(args[2])))
    elif len(args) == 4 and args[0] == "detector":
        export_detector(Path(args[1]), Path(args[2]), Path(args[3]))
    elif len(args) == 4 and args[0] == "lama":
        export_lama(Path(args[1]), Path(args[2]), Path(args[3]))
    else:
        sys.exit(__doc__)
    print("done")
