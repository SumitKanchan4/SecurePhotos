"""Rebuilds the old-photo ONNX models (H10) from the official weights.

The app downloads these files from the ``models-v1`` Release and checks them by SHA-256
(``engine/services/ai_models.py``). This script shows exactly how they were made, so anyone
can rebuild them from the upstream code and weights and compare. ``torch.onnx.export`` is
not byte-for-byte reproducible across versions, so compare the outputs (``--check``) rather
than the file hashes. Sources, commits and weight hashes: see README.md here.

Safety: only the model-definition files of each upstream repo are imported (their package
``__init__`` files, which import much more, are never run); weights are loaded with
``weights_only=True`` (no pickled code runs) and ``strict=True`` (no layer silently skipped).
Run it with ``python -I`` from outside the upstream checkouts.

Usage:
    python -I export_models.py ddcolor <DDColor checkout> <pytorch_model.bin> <out.onnx> [--fixed 512]
    python -I export_models.py gfpgan  <GFPGAN checkout>  <GFPGANv1.4.pth>    <out.onnx>
    python -I export_models.py check   <new.onnx> <released.onnx> <size>
"""

import logging
import sys
import types
from pathlib import Path


class _Registry:
    def register(self, obj=None):
        return obj if obj is not None else (lambda o: o)


def _stub_package(name: str, path: Path = None) -> types.ModuleType:
    """A stand-in package: lets submodules import without running the real ``__init__``."""
    module = types.ModuleType(name)
    if path is not None:
        module.__path__ = [str(path)]
    sys.modules[name] = module
    return module


def _stub_basicsr(archs_path: Path = None) -> None:
    basicsr = _stub_package("basicsr")
    utils = _stub_package("basicsr.utils")
    registry = _stub_package("basicsr.utils.registry")
    registry.ARCH_REGISTRY = _Registry()
    utils.registry = registry
    utils.get_root_logger = lambda: logging.getLogger("export")
    basicsr.utils = utils
    archs = _stub_package("basicsr.archs", archs_path)
    arch_util = _stub_package("basicsr.archs.arch_util")
    arch_util.default_init_weights = lambda *a, **k: None  # Real weights are loaded afterwards.
    archs.arch_util = arch_util


def export_ddcolor(checkout: Path, weights: Path, out: Path, fixed: int = 0) -> None:
    """DDColor ConvNeXt-L. Default: any input size (one file serves 512 Natural and 768 Vivid)."""
    _stub_basicsr(checkout / "basicsr" / "archs")
    import torch
    from basicsr.archs.ddcolor_arch import DDColor

    size = fixed or 512
    model = DDColor(
        encoder_name="convnext-l", decoder_name="MultiScaleColorDecoder", input_size=[size, size],
        num_output_channels=2, last_norm="Spectral", do_normalize=False,
        num_queries=100, num_scales=3, dec_layers=9,
    )
    state = torch.load(weights, map_location="cpu", weights_only=True)
    model.load_state_dict(state.get("params", state), strict=True)
    model.eval()
    dynamic = None if fixed else {"input": {2: "h", 3: "w"}, "output": {2: "h", 3: "w"}}
    with torch.no_grad():
        torch.onnx.export(model, torch.rand(1, 3, size, size), str(out), opset_version=17,
                          input_names=["input"], output_names=["output"], dynamic_axes=dynamic, dynamo=False)


def export_gfpgan(checkout: Path, weights: Path, out: Path) -> None:
    """GFPGAN v1.4 (clean architecture, no custom CUDA ops), 512 x 512 face crops."""
    _stub_basicsr()
    _stub_package("gfpgan", checkout / "gfpgan")
    _stub_package("gfpgan.archs", checkout / "gfpgan" / "archs")
    import torch
    from gfpgan.archs.gfpganv1_clean_arch import GFPGANv1Clean

    net = GFPGANv1Clean(
        out_size=512, num_style_feat=512, channel_multiplier=2, decoder_load_path=None, fix_decoder=False,
        num_mlp=8, input_is_latent=True, different_w=True, narrow=1, sft_half=True,
    )
    net.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True)["params_ema"], strict=True)
    net.eval()

    class Wrapper(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, x):
            return self.inner(x, return_rgb=False, randomize_noise=False)[0]

    with torch.no_grad():
        torch.onnx.export(Wrapper(net), torch.rand(1, 3, 512, 512), str(out), opset_version=17,
                          input_names=["input"], output_names=["output"], dynamo=False)


def check(new: Path, released: Path, size: int) -> float:
    """Largest output difference between a rebuilt file and the released one on random input."""
    import numpy as np
    import onnxruntime as ort

    x = np.random.default_rng(0).random((1, 3, size, size), dtype=np.float32)
    a = ort.InferenceSession(str(new), providers=["CPUExecutionProvider"]).run(None, {"input": x})[0]
    b = ort.InferenceSession(str(released), providers=["CPUExecutionProvider"]).run(None, {"input": x})[0]
    return float(np.abs(a - b).max())


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 4 and args[0] == "ddcolor":
        fixed = int(args[args.index("--fixed") + 1]) if "--fixed" in args else 0
        export_ddcolor(Path(args[1]), Path(args[2]), Path(args[3]), fixed)
    elif len(args) == 4 and args[0] == "gfpgan":
        export_gfpgan(Path(args[1]), Path(args[2]), Path(args[3]))
    elif len(args) == 4 and args[0] == "check":
        print(f"max difference: {check(Path(args[1]), Path(args[2]), int(args[3])):.6f}")
    else:
        sys.exit(__doc__)
    print("done")
