# Old-photo models: how they are made (H10)

The app downloads five ONNX files from this repo's Release **`models-v1`** the first time
someone improves an old photo, and refuses any file whose SHA-256 differs
(`engine/services/ai_models.py`, `ON_DEMAND_MODELS`). They are not in git and not in the
installer (about 2.7 GB together).

| File | Purpose | Upstream code (commit) | Official weights (SHA-256) | Licence |
|---|---|---|---|---|
| `ddcolor_modelscope_dyn.onnx` | Add colour (any input size: 512 Natural, 768 Vivid) | [piddnad/DDColor](https://github.com/piddnad/DDColor) `2adb63f2656ac41cbdf7b894cddd94121a3faf13` | [piddnad/ddcolor_modelscope](https://huggingface.co/piddnad/ddcolor_modelscope) `pytorch_model.bin` `d81711971ec59200da26d5e8a1afae8dd3778d495ea8ad7a7dadc769f403f7e7` | Apache-2.0 |
| `ddcolor_artistic_512.onnx` | Second colour opinion, merged per pixel | same | [piddnad/ddcolor_artistic](https://huggingface.co/piddnad/ddcolor_artistic) `pytorch_model.bin` `5a076e84efce59848394f572a105f7b78f7f6e917f615d1ee88537241b96dca3` | Apache-2.0 |
| `scratch_detector.onnx` | Find scratches and spots | [microsoft/Bringing-Old-Photos-Back-to-Life](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life) `33875eccf4ebcd3665cf38cc56f3a0ce563d3a9c` | Release v1.0 `global_checkpoints.zip` → `checkpoints/detection/FT_Epoch_latest.pt` `b2d7ab04e9b3885c6b1991bb7a0b823129dd6e3ac078a9fd059ebd2a7ba59a95` | MIT |
| `lama_512.onnx` | Fill in scratches and spots | [advimman/lama](https://github.com/advimman/lama) `786f5936b27fb3dacd2b1ad799e4de968ea697e7` | [smartywu/big-lama](https://huggingface.co/smartywu/big-lama) at `05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9`: `big-lama.zip` `f1b358ca24093b93a106183b98a3dea6e8ed09f3b43ea7251eb2c81e7b4575f6` (`models/best.ckpt` `fccb7adffd53ec0974ee5503c3731c2c2f1e7e07856fd9228cdcc0b46fd5d423`) | Apache-2.0 |
| `gfpgan_v1.4_512.onnx` | Sharper faces | [TencentARC/GFPGAN](https://github.com/TencentARC/GFPGAN) `7552a7791caad982045a7bbe5634bbf1cd5c8679` | [GFPGANv1.4.pth](https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth) `e2cd4703ab14f4d01fd1383a8a8b266f9a5833dacee8e6a79d3bf21a1b6be5ad` | Apache-2.0 |

Training data: DDColor was trained on ImageNet and GFPGAN on FFHQ; both datasets have their
own terms (see THIRD_PARTY_NOTICES.md). Non-commercial models (e.g. CodeFormer) are not used
(owner decision D1).

## Rebuild

Tools used: Python 3.12, torch 2.15.0 (CPU), onnx 1.23.2, onnxruntime 1.29.0.

1. Clone both repos at the commits above (outside this repo) and download the weights;
   check the weight hashes.
2. In a throwaway virtual environment with torch, onnx, onnxruntime, numpy:

```
python -I export_models.py ddcolor <DDColor checkout> ddcolor_modelscope.bin ddcolor_modelscope_dyn.onnx
python -I export_models.py ddcolor <DDColor checkout> ddcolor_artistic.bin   ddcolor_artistic_512.onnx --fixed 512
python -I export_models.py gfpgan  <GFPGAN checkout>  GFPGANv1.4.pth          gfpgan_v1.4_512.onnx
```

Scratch models (A7, 2026-11-17; also needs `onnxscript` 0.7.2 for LaMa's Fourier layers).
Only the detector file is needed from the 2 GB release zip (it can be read out with HTTP
range requests):

```
python -I export_scratch_models.py lama-weights big-lama/models/best.ckpt lama_generator.pt
python -I export_scratch_models.py detector <BOPBTL checkout> FT_Epoch_latest.pt scratch_detector.onnx
python -I export_scratch_models.py lama     <LaMa checkout>  lama_generator.pt  lama_512.onnx
```

`lama-weights` copies the tensors out of the Lightning checkpoint without running anything
from it (restricted reader). Two runs gave identical files: `scratch_detector.onnx`
`2461c38a92afcda9a6c9b20e0ccd7d470104a2bfc9c6f7470ece05e67d419795` (150,613,765 bytes) and
`lama_512.onnx` `46216567a38eab9a95977f80ccfe0b35906143183608b210487d14e0687e021e`
(209,265,850 bytes); outputs match PyTorch within 5e-7 and 3e-6.

With the tool versions above the files come out **byte-identical** to the released ones
(checked 2026-11-16). With other versions, compare outputs instead:
`python -I export_models.py check <rebuilt.onnx> <released.onnx> 512` (expect ~0).

The script imports only the model-definition files (never the packages' `__init__`), loads
weights with `weights_only=True` and `strict=True`, and is run with `python -I`.

## Publishing a new set

Upload the files as attachments of a new Release tag (e.g. `models-v2`), update the URLs,
sizes and SHA-256s in `ON_DEMAND_MODELS`, and ship an app update. Never replace a file
inside an existing tag. `scripts/create_release.py` refuses to release while any model URL
needs a login (the repo stays private until it is stable).
