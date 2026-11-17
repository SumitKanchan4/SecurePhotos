# Local whole-photo restoration for old photos: damage removal, denoise/deblur/de-JPEG, upscaling (state as of Nov 2026)

**Scope:** SecurePhotos runs locally on ONNX Runtime. **Hard constraint from the owner (mid-task): CPU only, no dedicated GPU.** Every candidate below is judged on realistic CPU time for a typical old-photo scan (about 1500x1000 px input, tiled). Face restoration and colorization belong to other researchers and are mentioned only where they touch this pipeline.

**Measured benchmark (done for this note, not from a source):** ONNX Runtime 1.29.0, CPUExecutionProvider, default threads, on an **AMD Ryzen 7 5700U laptop CPU (8 cores / 16 threads, 15 GB RAM)**, which is a typical mid-range laptop with no GPU. The inputs were random tensors, and the timings do not depend on image content. Scripts were in the session scratchpad. Each figure is the inference time only, with no pre- or post-processing. "Peak MB" is the peak working set of the Python process, which includes the loaded model.

| Model (ONNX file) | File size | Input | CPU time | Peak RAM | Est. for a 1500x1000 scan |
|---|---|---|---|---|---|
| Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact), the app's current `data/models/realesr_general_x4v3.onnx` | 4.9 MB | dynamic, 256 px tiles with 16 px padding | **23.3 s** for all 24 tiles (output 6000x4000) | ~220 MB, not counting the assembled output (a 6000x4000 float32 RGB image is another ~288 MB) | **~23 s** |
| 1x_refocus_cleanly (RRDB / ESRGAN-class body, 1x), the repo's `src-tauri/target/debug/data/models/1x_refocus_cleanly.onnx` | 66.9 MB | dynamic, 256 px tiles | **339 s** for 24 tiles | ~670 MB | **~5.6 min**. Real-ESRGAN x4plus uses the same 23-block RRDB body, so it should cost at least this much (inference) |
| BOPBTL scratch detector (`rasgunos_old_photos.onnx`, artiva-ai) | 150.6 MB | dynamic, grayscale 1-channel; timed at 512x512 | **2.5 s** per 512x512 | ~1.1 GB | about 14 s if run on the full 1.5 MP image (linear scaling, inference). Upstream runs it on a downscaled copy, so it is usually cheaper |
| Big-LaMa inpainting (`lama_512.onnx`, artiva-ai) | 207.6 MB | fixed 512x512 image + mask | **3.7 s** per 512 crop | ~1.3 GB | 4–45 s: only crops that contain damage are processed (1–12 crops) |
| SCUNet color real-PSNR denoiser (`scunet_color_real_psnr_512.onnx`) | 74.4 MB | fixed 512x512 | **8.5 s** per tile | **~5.7 GB (!)** | ~100 s for about 12 overlapping tiles. The RAM peak is a real risk on 8 GB machines |
| FBCNN color JPEG-artifact remover (`fbcnn_color_512.onnx`) | 287.7 MB | fixed 512x512 + quality factor | **6.0 s** per tile | ~1.2 GB | ~72 s for about 12 tiles |

---

## 1. Scratch / crease / damage removal: Microsoft "Bringing Old Photos Back to Life" (BOPBTL) and newer alternatives; can detect + inpaint run locally on ONNX?

### Takeaway
Yes, and on CPU. The BOPBTL **scratch detector** (code MIT, weights released by Microsoft) followed by **Big-LaMa** inpainting (code Apache-2.0) is the practical, permissively licensed path. Both already exist as community ONNX exports, and the benchmark puts them at about 2.5 s per 512 tile (detector) and 3.7 s per 512 crop (LaMa) on a laptop CPU. A full damage-removal pass on a 1500x1000 scan should take roughly 10–60 s, depending on how much of the photo is damaged. The full BOPBTL restoration network (the global VAE-translation model) is 256-px-trained and dated. MAT is CC BY-NC (non-commercial). Newer 2025 old-photo papers are face-only or film-only, or need a diffusion model.

### Cited Findings
- **BOPBTL repo license: MIT** (GitHub license API; repo last pushed 2023-10-26, so effectively unmaintained). — [microsoft/Bringing-Old-Photos-Back-to-Life](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life)
- Pretrained checkpoints are published as GitHub release assets (`global_checkpoints.zip`, `face_checkpoints.zip`), and the scratch pipeline is turned on with `--with_scratch`. The README does not state a separate weights license, so the repo's MIT license is the only stated term. — [BOPBTL README](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life)
- Microsoft does **not** release its labelled scratch dataset: "Currently we don't plan to release the scratched old photos dataset with labels directly." The training data is therefore unavailable and its provenance unverifiable. — [BOPBTL README](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life)
- The README itself warns: "Since the model is pretrained with 256*256 images, the model may not work ideally for arbitrary resolution." — [BOPBTL README](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life)
- The BOPBTL face stage needs a separate landmark-detection model download (dlib-based). — [BOPBTL README](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life)
- **A community ONNX of the BOPBTL scratch detector exists:** `rasgunos_old_photos.onnx` in **artiva-ai/modelos**, listed as "Bringing Old Photos Back to Life, scratch detection … Microsoft … MIT". The card says all files were "exported from the original PyTorch weights to ONNX, checked against PyTorch on the same inputs". The same repo also ships `lama_512.onnx`/`lama_1024.onnx` (Apache-2.0), `scunet_color_real_psnr_512.onnx` and `fbcnn_color_512.onnx` (Apache-2.0), with per-file license files. — [artiva-ai/modelos](https://huggingface.co/artiva-ai/modelos)
- Measured: the artiva scratch detector has a dynamic grayscale `[1,1,h,w]` input and outputs a `[1,1,h,w]` mask. It took 2.5 s per 512x512 on a Ryzen 7 5700U CPU and peaked at about 1.1 GB RAM (own benchmark, see the table above).
- The artiva LaMa export rewrites LaMa's FFT (Fourier units) with MatMul/Cos/Sin, following Carve-Photos/lama FourierUnitJIT, "so it runs on WebGPU". It has a fixed 512 or 1024 input. — [artiva-ai/modelos](https://huggingface.co/artiva-ai/modelos)
- `zeroscratches` is a pip-installable "lightweight implementation of Microsoft Bringing Old Photos Back to Life", MIT, last pushed 2025-05. It is PyTorch, not ONNX. — [awesome.ecosyste.ms: zeroscratches](https://awesome.ecosyste.ms/projects/github.com%2Fleonelhs%2Fzeroscratches), [HF leonelhs/zeroscratches](https://huggingface.co/leonelhs/zeroscratches)
- **LaMa code: Apache-2.0** (GitHub license API). The recommended Big-LaMa weights were trained on Places2 / Places Challenge and are now downloaded from a Hugging Face mirror (`smartywu/big-lama`). — [advimman/lama](https://github.com/advimman/lama)
- **Carve/LaMa-ONNX** is an ONNX port of the original big-lama, tagged Apache-2.0. The card recommends the fp32 file (`lama_fp32.onnx`). OpenCV's model zoo uses it as its source, and an int4/int8 quantised build (~37 MB) for onnxruntime-web also exists. — [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX), [opencv/inpainting_lama](https://huggingface.co/opencv/inpainting_lama/raw/main/README.md), [othytenk/lama-int4-int8](https://huggingface.co/othytenk/lama-int4-int8)
- **Places dataset terms (training data for LaMa):** the official Places365 repo says "The pretrained places-CNN models can be used under the Creative Common License (Attribution CC BY)… The copyright of all the images belongs to the image owners." I could not reach the Places download page (places2.csail.mit.edu refused the connection) to read the dataset's own terms of use. — [CSAILVision/places365](https://github.com/CSAILVision/places365)
- **MAT (CVPR 2022 inpainting): CC BY-NC 4.0 (Attribution-NonCommercial)**. The license file is the CC BY-NC 4.0 text, so it is **not usable commercially**. — [fenglinglwb/MAT](https://github.com/fenglinglwb/MAT)
- **IOPaint** (formerly lama-cleaner), the common local inpainting front-end: Apache-2.0, last pushed 2025-04. — [Sanster/IOPaint](https://github.com/Sanster/IOPaint)
- Newer research: **SSDiff** (NeurIPS 2025) is a training-free diffusion method for **old face photos** that uses scratch masks and face parsing, with a 300-image VintageFace benchmark. It is face-only and diffusion-based. — [arXiv 2510.12114](https://arxiv.org/pdf/2510.12114), [NeurIPS 2025](https://proceedings.neurips.cc/paper_files/paper/2025/hash/d4fe4d3d284e4566a53eaef5f63bd6de-Abstract-Conference.html)
- **HaineiFRDM** (Dec 2025) handles scratches and dust in **film** with a video diffusion model. The paper says code "will be released". — [arXiv 2512.24946](https://arxiv.org/html/2512.24946v1)
- Commercial reference point: Topaz Photo "Dust & Scratch v2" runs locally but needs 8 GB VRAM on Windows. — [Topaz docs](https://docs.topazlabs.com/topaz-photo/dust-and-scratch)

### Inferences
- **The recommended damage stage on CPU:** run the scratch detector on a downscaled copy (about 512–1024 px long side), upsample and dilate the mask, then run LaMa only on 512x512 crops around connected mask regions and blend them back. Expected cost on the benchmark CPU is about 3–15 s for detection plus 4–45 s for inpainting, and RAM stays around 1.3 GB. This fits a "Repair damage" action with a progress bar.
- LaMa works at a fixed 512 size, so large creases on a high-resolution scan should be inpainted on a downscaled crop and then upscaled. Thin scratches can be handled at native resolution. LaMa reconstructs texture, not faces. A crease through a face needs the face-restoration stage (other researchers), or the user should be warned.
- The detector is the weak link. It was trained on Microsoft's private dataset, misses or over-detects on textured paper and fine detail, and so **needs a user-editable mask** (brush and eraser) before LaMa runs. This UX recommendation is my inference.
- BOPBTL's global restoration network (VAE latent translation) is not worth adopting in 2026. It is 256-px-trained and unmaintained, and it is superseded by the stages below. Only its scratch detector is worth keeping.
- License position: BOPBTL detector code and weights are MIT, and LaMa code is Apache-2.0. The LaMa **weights** have no license statement separate from the repo, and the Places images remain copyrighted by their owners. That is the usual "trained-on-scraped-data" grey zone, but it is far safer than MAT (NC).
- The artiva exports carry per-file license notices and were PyTorch-parity checked, but they are a third-party conversion. For shipping, re-export from the official checkpoints or at least diff the outputs against PyTorch.

### Gaps
- No published accuracy numbers for the BOPBTL scratch detector on real scans. I found no 2024–2026 open, permissively licensed, general (non-face) old-photo damage detector to replace it.
- I could not reach the official Places dataset terms page, so the training-data license for LaMa weights is unverified.
- I did not benchmark the Carve int8 LaMa on CPU, so the quality and speed impact of quantisation is unknown.
- The detector was timed at 512x512 only. Time at full scan resolution and the downscale factor upstream uses are not verified.

---

## 2. Denoise / deblur / JPEG-artifact removal: NAFNet, Restormer, SCUNet, SwinIR, FBCNN, DiffBIR, SUPIR

### Takeaway
On CPU, the realistic options are: **(a)** let Real-ESRGAN general-x4v3 do denoising as part of upscaling (its `-dn` denoise-strength knob), which is the cheapest; **(b)** **SCUNet real-PSNR** (Apache-2.0) for blind real-world noise, which is high quality but ~100 s and ~5.7 GB RAM per 1.5 MP scan; **(c)** **FBCNN** (Apache-2.0) for JPEG artifacts at ~72 s; **(d)** compact **OpenModelDB 1x** models (CC-BY-4.0, credit required). NAFNet (MIT) and Restormer (MIT) are trained on narrow benchmark data (SIDD smartphone noise, GoPro motion blur) that does not match old prints. SwinIR is Apache-2.0 but heavy. DiffBIR and SUPIR are **not viable on CPU**, and SUPIR is also non-commercial.

### Cited Findings
- **Licenses (GitHub license files):** NAFNet **MIT** (plus the Apache-2.0 BasicSR notice); Restormer **MIT**; SCUNet **Apache-2.0**; SwinIR **Apache-2.0**; Uformer **MIT**; DiffBIR **Apache-2.0** (code). — [NAFNet](https://github.com/megvii-research/NAFNet), [Restormer](https://github.com/swz30/Restormer), [SCUNet](https://github.com/cszn/SCUNet), [SwinIR](https://github.com/JingyunLiang/SwinIR), [Uformer](https://github.com/ZhendongWang6/Uformer), [DiffBIR](https://github.com/XPixelGroup/DiffBIR)
- **SCUNet ONNX:** Heliosoph/scunet-onnx bundles all 8 upstream checkpoints (color/gray 15/25/50, real_psnr, real_gan) at opset 17, Apache-2.0. artiva-ai has a fixed-512 `scunet_color_real_psnr_512.onnx` that "the app processes … in tiles". — [Heliosoph/scunet-onnx](https://huggingface.co/Heliosoph/scunet-onnx), [artiva-ai/modelos](https://huggingface.co/artiva-ai/modelos)
- Measured: SCUNet real-PSNR fixed 512 took **8.5 s per tile** on the Ryzen 7 5700U, with **peak RSS ~5.7 GB**. FBCNN color 512 took **6.0 s per tile** at ~1.2 GB (own benchmark).
- **FBCNN** (blind JPEG artifact removal with an adjustable quality factor): Apache-2.0 per the artiva card, which also ships a mixed-precision variant (`fbcnn_color_512_mixto.onnx`, float16 convolutions). — [artiva-ai/modelos](https://huggingface.co/artiva-ai/modelos)
- **NAFNet ONNX:** Qualcomm publishes NAFNet-DeNoise and NAFNet-DeBlur (float and w8a16) for Snapdragon devices. OpenCV hosts a NAFNet **deblurring** ONNX. darktable-ai converts a SIDD-trained NAFNet denoiser to ONNX at opset 17. — [qualcomm/NAFNet-DeNoise](https://huggingface.co/qualcomm/NAFNet-DeNoise), [opencv/deblurring_nafnet](https://huggingface.co/opencv/deblurring_nafnet), [darktable-ai](https://github.kakarurec.workers.dev/darktable-org/darktable-ai)
- A Restormer ONNX for **document** image denoising exists on HF. — [efwfe/restomer](https://huggingface.co/efwfe/restomer)
- **SwinIR ONNX:** Heliosoph/swinir-onnx fixes the spatial dims at export because the shifted-window attention is fragile with dynamic H/W in ONNX Runtime. — [Heliosoph/swinir-onnx](https://huggingface.co/Heliosoph/swinir-onnx)
- **OpenModelDB 1x restoration models:** *1x DeNoise realplksr otf* (Phips) is tagged Restoration/Denoise/Photography and "also handles a bit of jpg compression". Its license is listed as "CC-BY-0.4" on OpenModelDB (a typo) and **cc-by-4.0** on HF. *1x DeJPG OmniSR* is CC-BY-4.0. *1x JPEGDestroyer* is **GPL-3.0** (copyleft, avoid). *1x Kim2091 DeJpeg v0* is "incomplete … temporary release". *1x Archiver Soft* is gentle denoise that preserves film grain, with its license not shown. — [1x-DeNoise-realplksr-otf](https://openmodeldb.info/models/1x-DeNoise-realplksr-otf), [HF Phips](https://huggingface.co/Phips/1xDeNoise_realplksr_otf/blob/main/README.md), [1x-DeJPG-OmniSR](https://openmodeldb.info/models/1x-DeJPG-OmniSR), [1x-JPEGDestroyer](https://openmodeldb.info/models/1x-JPEGDestroyer), [1x-Kim2091-DeJpeg-v0](https://openmodeldb.info/models/1x-Kim2091-DeJpeg-v0), [1x-Archiver-Soft](https://openmodeldb.info/models/1x-Archiver-Soft)
- **DiffBIR:** stage 1 uses SCUNet-PSNR for denoising and BSRNet for SR. Stage 2 is an IRControlNet on **Stable Diffusion 2.1**. v2.1 weights were trained on filtered Unsplash with LLaVA captions. The README gives no VRAM or time figures, and offers tiled sampling for low VRAM. It lists CUDA/MPS/CPU devices, but "speed up inference" is still a TODO. The weights' license is not stated. — [XPixelGroup/DiffBIR](https://github.com/XPixelGroup/DiffBIR)
- **SUPIR license:** "SUPIR Software License Agreement" from SupPixel Pty Ltd. The proprietary weights "may only be used for non-commercial purposes". Commercial use, defined to include "process[ing] images that are intended for sale", "requires a separate commercial license agreement". — [SUPIR LICENSE](https://raw.githubusercontent.com/Fanghua-Yu/SUPIR/master/LICENSE)

### Inferences
- **Ranking for CPU-only old-photo cleanup (quality within CPU limits):**
  1. **Real-ESRGAN general-x4v3 with tunable denoise (`wdn` blend)**. It is already shipped, takes ~23 s, and denoising comes free with the upscale. The limitation is that the official notes call its "deblur and denoise capacity … not too strong".
  2. **SCUNet real-PSNR** as an optional "Strong denoise". It handles mixed real-world noise and is the denoiser DiffBIR itself uses. It costs ~100 s, and its ~5.7 GB peak RAM must be tamed with smaller tiles or lower ORT arena settings, or it will fail on 8 GB laptops.
  3. **FBCNN** only when the source is a JPEG (phone photo of a print, web download). It is pointless for clean TIFF scans.
  4. **Compact OpenModelDB 1x RealPLKSR / SPAN denoisers (CC-BY-4.0)**. These are likely faster than SCUNet and trained on photo degradations, but they need a .pth to ONNX conversion and attribution in the app's credits.
- NAFNet and Restormer are permissive, but their checkpoints are SIDD (phone sensor noise), GoPro (motion blur) and similar. Old prints have film grain, paper texture, halftone and fading. They are low-value for this app unless retrained.
- The deblur that is useful for old photos is mild defocus, and the best CPU route is a GAN upscaler (general-x4v3) or the repo's existing 1x_refocus model. The refocus model is too slow on CPU (5.6 min per 1.5 MP measured) to be a default.
- **Diffusion restorers are not viable on CPU** (see section 4). DiffBIR's stage 1 (SCUNet) is the piece that transfers.

### Gaps
- No CPU benchmarks for NAFNet, Restormer or SwinIR at photo sizes were run or found.
- No ready ONNX for the OpenModelDB 1x RealPLKSR or SPAN denoisers was found, and their CPU speed is unmeasured.
- No independent quality comparison on real old-photo scans (as opposed to synthetic benchmarks) was found for any of these.

---

## 3. Upscalers beyond Real-ESRGAN general-x4v3: x4plus, SwinIR, HAT, DAT, SPAN, OpenModelDB compact; licenses and DirectML notes

### Takeaway
On CPU, **stay with SRVGGNetCompact-class (general-x4v3) or SPAN/compact-class models**. RRDB models (Real-ESRGAN x4plus) cost about 15x more. The measured RRDB-body model took 339 s against 23 s for general-x4v3, and transformer models (SwinIR, HAT, DAT) are heavier still. Permissive options: Real-ESRGAN (BSD-3), SwinIR/HAT/DAT/SPAN code (Apache-2.0), CC0 RealPLKSR pretrains. The good OpenModelDB photo models (Nomos8k SPAN, NomosWebPhoto RealPLKSR) are **CC-BY-4.0** (commercial use OK with credit). DirectML matters less now that the target is CPU, and **DirectML is in maintenance mode**.

### Cited Findings
- Real-ESRGAN: **BSD-3-Clause**, last pushed 2024-08 (stable or dormant). — [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)
- realesr-general-x4v3 is "a tiny small model (consume much fewer GPU memory and time); not too strong deblur and denoise capacity". The `-dn` denoise-strength option (0 = keep noise, 1 = strong, default 0.5) works only for x4v3 and needs the companion `realesr-general-wdn-x4v3.pth`. — [Real-ESRGAN model zoo](https://www.Github.com/xinntao/Real-ESRGAN/blob/master/docs/model_zoo.md), [Releases](https://www.Github.com/xinntao/Real-ESRGAN/releases)
- RealESRGAN_x4plus is RRDBNet with 23 blocks, and x4v3 is SRVGGNetCompact (32 conv layers, 64 features). Third-party docs give conflicting parameter counts and file sizes. The measured ONNX of general-x4v3 is 4.9 MB. — [mintlify mirror of Real-ESRGAN docs](https://mintlify.com/xinntao/Real-ESRGAN/models/general-models) (third-party)
- The Real-ESRGAN docs mirror says CPU inference "is extremely slow" and recommends ncnn on CPU, with fp32 needed on CPU. — [mintlify quickstart/FAQ](https://mintlify.com/xinntao/Real-ESRGAN/quickstart) (third-party)
- Measured (own): general-x4v3 took **23.3 s** for 1500x1000 to 6000x4000 on the Ryzen 7 5700U. An RRDB-body 1x model of the same size took **339 s**.
- Code licenses: **HAT Apache-2.0**, **DAT Apache-2.0**, **SPAN Apache-2.0** (pushed 2026-02), SwinIR Apache-2.0. — [HAT](https://github.com/XPixelGroup/HAT), [DAT](https://github.com/zhengchen1999/DAT), [SPAN](https://github.com/hongyuanyu/SPAN), [SwinIR](https://github.com/JingyunLiang/SwinIR)
- SPAN (CVPRW 2024, NTIRE efficient-SR winner lineage) is a parameter-free-attention, efficiency-oriented SR network. — [arXiv 2311.12770](https://arxiv.org/abs/2311.12770v3)
- **OpenModelDB photo upscalers and licenses:** *4x Nomos8k span otf medium*, CC-BY-4.0 ("Commercial use … Credit required"); *4xNomos8kDAT*, CC-BY-4.0 (otf jpg, blur, resize degradations); *4xNomos8k_atd_jpg*, CC-BY-4.0; *4xNomosWebPhoto RealPLKSR* (realistic noise, lens blur, jpg/webp re-compression), listed "CC-BY-0.4" (typo) and cc-by-4.0 on HF; *4x RealPLKSR mssim pretrain*, *4x RealPLKSR Pretrain V4* and *4x realplksr gan pretrain*, **CC0** but pretrains, not finished photo models. — [4x-Nomos8k-span-otf-medium](https://openmodeldb.info/models/4x-Nomos8k-span-otf-medium), [4x-Nomos8kDAT](https://openmodeldb.info/models/4x-Nomos8kDAT), [4x-Nomos8k-atd-jpg](https://openmodeldb.info/models/4x-Nomos8k-atd-jpg), [4x-NomosWebPhoto-RealPLKSR](https://openmodeldb.info/models/4x-NomosWebPhoto-RealPLKSR), [4x-realplksr-mssim-pretrain](https://openmodeldb.info/models/4x-realplksr-mssim-pretrain), [4x-RealPLKSR-Pretrain-V4](https://openmodeldb.info/models/4x-RealPLKSR-Pretrain-V4), [4x-realplksr-gan-pretrain](https://openmodeldb.info/models/4x-realplksr-gan-pretrain)
- chaiNNer, the common converter and runner for OpenModelDB models, is **GPL-3.0**. Use it as a tool only, and do not embed its code. — [chaiNNer](https://github.com/chaiNNer-org/chaiNNer)
- **DirectML status:** the README says "DirectML is in maintenance mode … no new functionality or feature updates are planned" and recommends Windows ML on Windows 11 24H2+. — [microsoft/DirectML](https://github.com/microsoft/DirectML)
- DirectML issues seen in the wild: Magpie reported a black screen running Real-ESRGAN ONNX on an AMD iGPU (DirectML, unresolved). Magpie requires matched fp16/fp32 I/O in NCHW. SwinIR-type exports are usually fixed-shape for robustness. — [Magpie #772](https://www.github.com/Blinue/Magpie/issues/772), [Magpie onnx-preview1](https://newreleases.io/project/github/Blinue/Magpie/release/onnx-preview1), [Heliosoph/swinir-onnx](https://huggingface.co/Heliosoph/swinir-onnx)

### Inferences
- **Upscaler ranking within CPU limits:**
  1. **general-x4v3** (keep it as the default). It is BSD-3 and 4.9 MB, takes ~23 s per 1.5 MP to 4x, and has tunable denoise.
  2. **A SPAN or compact RealPLKSR photo model (e.g., 4x Nomos8k SPAN otf medium, CC-BY-4.0)** is the most promising "better quality, similar cost" candidate. SPAN is built for speed, and these are trained on photo degradations. Before adopting, convert to ONNX (fp32) and benchmark. My unverified estimate is the same order of magnitude as general-x4v3.
  3. **Real-ESRGAN x4plus** only as an opt-in "max quality, slow" mode (estimated ≥6 min per 1.5 MP on a laptop CPU).
  4. **SwinIR, HAT, DAT, ATD** are **not viable as defaults on CPU**. They are transformer models costing several times more than RRDB, and their ONNX exports are fragile with dynamic shapes.
- Old prints rarely need 4x. A 1500x1000 scan at 2x (3000x2000) is enough for viewing and printing. Running x4 and downscaling, or using a 2x model, halves memory and output size. 2x compact models exist on OpenModelDB, but their licenses need checking per model.
- With the CPU-only constraint, keep the CPU execution provider as the baseline, and treat DirectML or Windows ML as optional acceleration for users with iGPUs, because DirectML gets no new features.

### Gaps
- No direct CPU measurement for SPAN, RealPLKSR or x4plus. The x4plus figure is inferred from the RRDB-body model.
- I did not verify OpenModelDB licenses for 2x compact models or for every Nomos model, so check each page before shipping.
- No authoritative list of DirectML operator failures for SR models was found.

---

## 4. Diffusion-based restorers (SUPIR, DiffBIR, StableSR, plus one-step OSEDiff, InvSR, HYPIR): realistic locally? VRAM, time, licenses, hallucination

### Takeaway
**Not viable on CPU, so rule them out for SecurePhotos.** Even on GPUs they need about 8–24 GB VRAM and minutes per image. Most also carry non-commercial or base-model licenses: SUPIR and HYPIR use a SupPixel license (NC); StableSR and InvSR use S-Lab 1.0 (NC); DiffBIR and OSEDiff code is Apache-2.0 but built on SD 2.1 (CreativeML Open RAIL++-M). All of them hallucinate detail by design, which is a problem for family archives.

### Cited Findings
- SUPIR low-VRAM mode: "12G for Diffusion, 16G for LLaVA". — [SUPIR README](https://fr.github.com/Fanghua-Yu/SUPIR)
- SUPIR user reports: 15–20 min per image on a 12 GB RTX 3060 (ComfyUI), and 26 min on a 12 GB RTX 3080 for a 1024px 2x upscale. Another guide claims 30–60 s, which conflicts with those reports. — [Reddit r/StableDiffusion](https://redlib.hackliberty.org/r/StableDiffusion/comments/1b11486/new_sota_image_upscale_open_source_model_supir/kse0vkr), [insiderllm guide](https://insiderllm.com/guides/local-ai-upscaling-guide/)
- SUPIR license: weights are non-commercial, and processing images for sale needs a commercial license. — [SUPIR LICENSE](https://raw.githubusercontent.com/Fanghua-Yu/SUPIR/master/LICENSE)
- **HYPIR** (XPixelGroup, 2025) uses the same "SupPixel Pty Ltd" license template, so it is non-commercial. — [XPixelGroup/HYPIR](https://github.com/XPixelGroup/HYPIR)
- **StableSR:** S-Lab License 1.0, "Redistribution and use for non-commercial purpose". **InvSR** (2025): S-Lab License 1.0, also NC. — [IceClear/StableSR](https://github.com/IceClear/StableSR), [zsyOAOA/InvSR](https://github.com/zsyOAOA/InvSR)
- **DiffBIR:** Apache-2.0 code on SD 2.1. No VRAM or time figures are published, and tiled sampling is the low-VRAM path. — [DiffBIR](https://github.com/XPixelGroup/DiffBIR)
- **OSEDiff** (one-step diffusion SR): Apache-2.0 code. It needs SD 2.1-base and re-trains SD2.1's VAE. The README's timing script reports about **0.10 s per iteration** (GPU). — [cswry/OSEDiff](https://github.com/cswry/OSEDiff)

### Inferences
- Even one-step diffusion (OSEDiff) runs an SD2.1 UNet (~865M parameters) plus a VAE at 512 tiles. On a laptop CPU that is likely tens of seconds per tile, so several minutes or more per scan, with several GB of RAM (inference, not measured). Also, SD-family licenses (OpenRAIL++-M) add use-based restrictions that must be passed on to users.
- Hallucination risk: generative restorers invent textures, text and facial features, which is unsuitable for archival "restore my grandparents' photo" without strong warnings. Deterministic CNN pipelines (sections 1–3) are safer, if less dramatic.

### Gaps
- No CPU timings for any diffusion restorer were found or measured.
- DiffBIR weights license and real VRAM numbers are not stated in the repo.

---

## 5. Practical CPU-only chain for an old scanned print; which steps are worth it

### Takeaway
Recommended default chain, measured or estimated on a Ryzen 7 5700U for a 1500x1000 scan:
1. **(Optional, user-triggered) Damage repair:** scratch detect (~3–15 s), then user mask touch-up, then LaMa crops (~4–45 s).
2. **(Optional) Strong denoise / de-JPEG:** SCUNet (~100 s, high RAM) or FBCNN for JPEG sources (~72 s).
3. **Upscale + mild denoise:** general-x4v3 (~23 s), or a 2x target.
4. **Face restore:** other researchers' stage, run last on detected faces.

A one-click "Enhance" should be just step 3 (plus faces), finishing in under ~30 s. Damage repair and strong denoise should be explicit opt-ins.

### Cited Findings
- DiffBIR's own design separates degradation removal (stage 1: SCUNet for denoise, BSRNet for SR) from generative detail (stage 2). This supports "clean first, then upscale or generate". — [DiffBIR](https://github.com/XPixelGroup/DiffBIR)
- BOPBTL orders its pipeline as global restoration with scratch handling, then face enhancement. — [BOPBTL README](https://github.com/microsoft/Bringing-Old-Photos-Back-to-Life)
- Stage timings are from the measured benchmark table at the top of this note (own measurements).

### Inferences
- **Order rationale:** inpaint before upscaling, because LaMa works at 512 and scratches get magnified and smeared by SR. Denoise before or within upscaling, since SR models amplify grain. Face restoration last, on the final-resolution crop, so it is not overwritten by later stages. Colorization (other researcher), if offered, usually runs on the cleaned image before or after upscaling at low resolution. Running it at low resolution and transferring chroma to the high-resolution luma is cheaper on CPU.
- **Worth it:**
  - Upscale with denoise: high value, low cost.
  - Damage repair: high value for creased or scratched prints, but it needs a mask editor.
  - Faces: high perceived value.
- **Situational:**
  - SCUNet: very grainy scans only, and watch RAM.
  - FBCNN: JPEG sources only.
- **Not worth it on CPU:**
  - Real-ESRGAN x4plus, 1x_refocus, SwinIR/HAT/DAT as defaults: minutes per scan.
  - Any diffusion restorer.
- **Model download budget (ONNX fp32):** general-x4v3 4.9 MB, scratch detector 151 MB, LaMa 208 MB (int8 builds ~37 MB exist), SCUNet 74 MB, FBCNN 288 MB (a mixed-fp16 variant exists). Ship general-x4v3 by default and download the others on demand.
- **CPU engineering:** cap ORT intra-op threads to leave the UI responsive, process tiles sequentially to bound RAM (SCUNet's 5.7 GB peak needs attention), and consider ORT dynamic int8 quantisation for LaMa and the detector after quality checks.
- **Licensing summary:**
  - Permissive: Real-ESRGAN BSD-3; BOPBTL MIT; LaMa, SCUNet, SwinIR, HAT, DAT, SPAN, FBCNN, DiffBIR (code) Apache-2.0; NAFNet, Restormer MIT; CC0 RealPLKSR pretrains.
  - Credit required: OpenModelDB Nomos models (CC-BY-4.0).
  - **Avoid (NC):** MAT (CC BY-NC 4.0), SUPIR and HYPIR (SupPixel NC), StableSR and InvSR (S-Lab NC).
  - **Avoid (copyleft):** 1x JPEGDestroyer (GPL-3.0); chaiNNer (GPL-3.0) as a library.

### Gaps
- End-to-end quality of this chain on real old prints was not evaluated. Only speed was measured.
- The benchmark is one CPU (Ryzen 7 5700U). Older 4-core CPUs could be 2–3x slower (inference, not measured).
