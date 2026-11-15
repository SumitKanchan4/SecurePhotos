# Local automatic colorization of black-and-white photos (state as of Nov 2026, CPU-only target)

Scope: on-demand, per-photo colorization inside SecurePhotos (Windows, ONNX Runtime, fully offline). A later hard constraint from the owner is applied throughout: **CPU only, no dedicated GPU**. So diffusion and other large GPU colorizers are marked "not viable on CPU".

Measurement note: the CPU numbers marked "measured locally" come from a benchmark run for this research on the owner's laptop on 2026-11-15. Setup: AMD Ryzen 7 5700U (8 cores / 16 threads, Zen 2, laptop, no dGPU), Windows 11, ONNX Runtime 1.29.0 CPUExecutionProvider, and OpenCV 4.10 for the Zhang Caffe model. Each figure is the median of 3 runs after a warm-up run, on the model's fixed input size, with default thread count unless "4 threads" is stated. Peak RAM is the peak working set of the whole Python process, including about 50–70 MB of interpreter and numpy baseline. The input was random data, because timing does not depend on content. Output quality was **not** judged in this benchmark. Expect ±20% from thermals and background load.

## 1. Candidates: quality and which gives the most natural results on old family photos

### Takeaway
DDColor is the strongest permissively licensed automatic colorizer that can actually be deployed. Its paper reports the best FID and colorfulness realism (ΔCF) against DeOldify, BigColor, CT2 and ColorFormer, and it was preferred in a small user study. Note this is ImageNet-style benchmarking, not old-family-photo benchmarking. DeOldify (archived, MIT) is the most-used legacy option but is measurably less colorful (desaturated or brownish). Zhang ECCV16/SIGGRAPH17 is the light, older baseline. Diffusion and transformer colorizers (CtrlColor, UniColor, CT2, ColorizeNet, text-guided SDXL colorizers) are either non-commercial, GPU-bound, or both.

### Cited Findings
- **DDColor (ICCV 2023)** has dual decoders (pixel decoder plus query-based color decoder) on a ConvNeXt encoder. It comes in four checkpoints: `ddcolor_paper` (ImageNet, DDColor-L), `ddcolor_modelscope` ("default", ImageNet with the same data cleaning as BigColor, recommended for images outside ImageNet), `ddcolor_artistic` (ImageNet plus private artistic data, trained without colorfulness loss, "may have fewer color artifacts") and `ddcolor_paper_tiny` (DDColor-T). — [DDColor MODEL_ZOO](https://github.com/piddnad/DDColor/blob/master/MODEL_ZOO.md)
- DDColor paper Table 1, ImageNet val5k, FID↓ / Colorfulness CF / ΔCF↓ (deviation from ground-truth colorfulness):
  - CIC (Zhang 2016): 8.72 / 31.60 / 6.61
  - DeOldify: 6.59 / 21.29 / 16.92
  - CT2: 5.51 / 38.48 / 0.27
  - BigColor: 5.36 / 39.74 / 1.53
  - ColorFormer: 4.91 / 38.00 / 0.21
  - DDColor-tiny: 4.38 / 37.66 / 0.55
  - DDColor-large: 3.92 / 38.26 / 0.05

  On COCO-Stuff, DDColor-large FID is 5.18 vs ColorFormer 8.68 and DeOldify 13.86. On ADE20K it is 8.21 vs ColorFormer 8.83 and DeOldify 12.41. — [DDColor paper (ar5iv)](https://ar5iv.labs.arxiv.org/html/2212.11613)
- Parameter counts from the same table: CIC 32.2M, DeOldify 63.6M, InstColor 69.4M, ColorFormer 44.8M, BigColor 105.2M, CT2 463.0M, DDColor-tiny 55.0M, DDColor-large 227.9M. Runtime was measured at 256×256 on a Tesla V100: tiny 25 FPS, large 21 FPS. — [DDColor paper (ar5iv)](https://ar5iv.labs.arxiv.org/html/2212.11613)
- The DDColor user study used 50 ImageNet val images and 20 subjects, comparing against DeOldify, BigColor, CT2 and ColorFormer. DDColor "is preferred by a wider range of users", with percentages shown only as a boxplot. The paper lists its own limitations: failures on transparent or translucent objects, and no user control over colors. It also notes that high colorfulness "does not always mean good visual quality". — [DDColor paper (ar5iv)](https://ar5iv.labs.arxiv.org/html/2212.11613)
- **DeOldify** has three variants:
  - Artistic (resnet34): most vibrant, needs render_factor tuning, worse on nature scenes and portraits.
  - Stable (resnet101): best for landscapes and portraits, fewer "zombie" gray faces or limbs, less colorful.
  - Video: least colorful.

  The repo was archived on 2024-10-19. The "most advanced" DeOldify is exclusive to MyHeritage In Color. — [jantic/DeOldify](https://github.com/jantic/DeOldify)
- **Zhang et al.**: ECCV16 "Colorful Image Colorization" and SIGGRAPH17 (interactive, but can run automatically). The PyTorch port converts to Lab, resizes to 256×256, and merges chroma back at original resolution. — [richzhang/colorization](https://github.com/richzhang/colorization)
- **Diffusion/transformer colorizers:**
  - CtrlColor (arXiv 2402.10855, built on Stable Diffusion) released its checkpoints on 2024-12-16. — [CtrlColor search summary / arXiv](https://arxiv.org/abs/2402.10855v1); [ZhexinLiang/Control-Color](https://github.com/ZhexinLiang/Control-Color)
  - SeAda (IJCAI 2025) is a controlled T2I-diffusion colorizer that claims SOTA. — [IJCAI 2025](https://ijcai.org/proceedings/2025/106)
  - Color-Turbo (Mar 2025) is a distilled-diffusion baseline for language-based colorization with a 14× speed-up over earlier methods. — [arXiv 2503.14974](https://arxiv.org/abs/2503.14974)
- Survey and lists for newer work. 2025 open-code colorization projects are dominated by line art and anime (MangaNinja, AniDoc, DACoN), not photo colorization. — [Awesome-Image-Colorization](https://github.com/MarkMoHR/Awesome-Image-Colorization); [Colorization survey 2024](https://arxiv.org/pdf/2410.02288)
- A 2025 benchmark argues that standard FID tracks human preference poorly for colorization. — [search summary citing arXiv 2503.14974](https://arxiv.org/abs/2503.14974) (treat as secondary; not verified in the PDF)
- DDColor upstream remains maintained. The last commit was 2026-01-17 ("streamline loading and inference pipeline"). ONNX export support was added 2024-10-25. — [piddnad/DDColor commits](https://github.com/piddnad/DDColor/commits/master)

### Inferences
- For old family photos (skin, clothes, skies), the most likely winner is DDColor (modelscope checkpoint for photos, artistic checkpoint as an alternative). DeOldify Stable is a fallback known to be conservative and brownish. Zhang is fast but older and visibly lower quality (worst FID in Table 1).
- I found no 2024–2026 *photo* colorizer that is permissive, CPU-friendly, and clearly better than DDColor. Newer work is diffusion-based, which means GPU and often non-commercial terms.

### Gaps
- There is no published benchmark on *real historical* photos (scanned, grainy, faded) comparing these models. ImageNet benchmarks use synthetic grayscale from modern color photos. An in-house A/B on 20–30 family scans is needed.
- No user-study percentages are available in the text, only a boxplot.

## 2. Licenses (code + weights + training data) and commercial safety

### Takeaway
Permissive code **and** declared-permissive weights exist only for DDColor (Apache-2.0 on the code and on every Hugging Face checkpoint), DeOldify (MIT code and weights per README), Zhang (BSD-2 code) and BigColor/DISCO (MIT code). Every one of these was trained on ImageNet, whose terms of access restrict the *dataset* to non-commercial research and education. Whether that restriction reaches the trained weights is legally unsettled. Non-commercial or restrictive: CtrlColor (S-Lab NC), UniColor (CC BY-NC 4.0), CT2 (CC BY-NC notice in README), ChromaGAN (AGPL-3.0).

### Cited Findings

Repository licenses, verified via the GitHub API on 2026-11-15:

| Model | Code license | Notes |
|---|---|---|
| DDColor | Apache-2.0 | [repo](https://github.com/piddnad/DDColor) |
| DeOldify | MIT | archived; [repo](https://github.com/jantic/DeOldify) |
| Zhang colorization | BSD-2-Clause | [repo](https://github.com/richzhang/colorization) |
| BigColor | MIT | last push 2022; [repo](https://github.com/KIMGEONUNG/BigColor) |
| DISCO | MIT | [repo](https://github.com/MenghanXia/DisentangledColorization) |
| ColorFormer | Tencent BSD-3-style ("THL A29 Limited… redistribution permitted…") | [repo](https://github.com/jixiaozhong/ColorFormer) |
| CtrlColor | **S-Lab License 1.0: "Redistribution and use for non-commercial purpose"** | [repo](https://github.com/ZhexinLiang/Control-Color) |
| UniColor | **CC BY-NC 4.0** in README | [repo](https://github.com/luckyhzt/unicolor) |
| CT2 | no LICENSE file detected; **CC BY-NC notice** in README | [repo](https://github.com/shuchenweng/CT2) |
| ChromaGAN | **AGPL-3.0** | [repo](https://github.com/pvitoria/ChromaGAN) |
| ColorizeNet (SD ControlNet colorizer) | Apache-2.0 | [repo](https://github.com/rensortino/ColorizeNet) |
| text-guided-image-colorization (nick8592) | no license detected by API; a search index says MIT | [repo](https://github.com/nick8592/text-guided-image-colorization) |

- DDColor weights: the Hugging Face model cards for `piddnad/ddcolor_modelscope`, `ddcolor_artistic`, `ddcolor_paper` and `ddcolor_paper_tiny` are all tagged `license: apache-2.0`. — [HF ddcolor_modelscope](https://huggingface.co/piddnad/ddcolor_modelscope); [HF ddcolor_paper_tiny](https://huggingface.co/piddnad/ddcolor_paper_tiny)
- DeOldify README: code under MIT, and the model weights are "released under the MIT license". — [jantic/DeOldify](https://github.com/jantic/DeOldify)
- DDColor training data is ImageNet for all checkpoints, plus private data for `artistic`. — [MODEL_ZOO](https://github.com/piddnad/DDColor/blob/master/MODEL_ZOO.md)
- ImageNet terms of access limit the database to "non-commercial research and educational purposes". Whether weights inherit this is disputed:
  - Some projects treat ImageNet-pretrained weights as commercial-prohibited.
  - PyTorch maintainers note torchvision weights carry no separate license, and torchvision docs say pretrained models "may have their own terms".

  — [DrivenData forum](https://community.drivendata.org/t/clarification-on-imagenet-pre-trained-weights-under-open-source-commercial-rules/11475); [PyTorch forum](https://discuss.pytorch.org/t/license-clarification-for-torchvision-resnet50-weights-and-fine-tuned-checkpoints/225542); [PyTorch forum 2](https://discuss.pytorch.org/t/pre-trained-models-license/38647). (The image-net.org download page refused connection during research, so the exact current wording was not re-verified there.)
- The Qualcomm AI Hub redistributes DDColor and lists the model as Apache-2.0. — [Qualcomm AI Hub DDColor](https://aihub.qualcomm.com/models/ddcolor)

### Inferences
- **Commercial risk ranking** (low to high):
  1. DDColor or DeOldify, both with explicit permissive weights (residual ImageNet-provenance risk shared by virtually every vision model shipped commercially, including those in large vendors' apps).
  2. Zhang, BSD code but weights carry no explicit license.
  3. BigColor, MIT code, but it is built on BigGAN with ImageNet class conditioning, and the weights' license is unstated.
  4. AGPL (ChromaGAN): copyleft would infect a closed-source distributed app.
  5. NC licenses (CtrlColor, UniColor, CT2): not usable.
- A lawyer-free safe-harbour does not exist for ImageNet-trained weights. The pragmatic industry practice is to ship Apache/MIT-declared weights and record provenance in THIRD_PARTY notices. Flag this to the owner as a residual risk, not a blocker.

### Gaps
- No court ruling or ImageNet statement on trained-model weights was found.
- I could not confirm the license of the weights for Zhang, BigColor, ColorFormer or DISCO. Only the code licenses are known.

## 3. ONNX availability, size, CPU speed and RAM (CPU-only constraint)

### Takeaway
DDColor has several ready ONNX exports (Apache-2.0), and all run comfortably on a 2021 laptop CPU. Measured locally:
- DDColor-tiny fp32 at 256 px: about 0.5–0.7 s.
- DDColor-tiny at 512 px: about 1.5–1.9 s.
- DDColor-large fp32 at 512 px: about 3.2 s.
- DeOldify at 256 px: about 1.7 s.
- Zhang at 224 px: about 0.25 s (OpenCV DNN).

**fp16 ONNX exports are a trap on CPU.** DDColor-tiny fp16 ran for more than 8 minutes of wall time without finishing 5 inferences. Ship fp32 or int8 for CPU. The Lab chroma transfer to a 12 MP original costs about 0.7 s. RAM is the main cost at 512 px: about 2.1–2.9 GB peak.

### Cited Findings
- **Official export:** DDColor ships `scripts/export_onnx.py` (onnx 1.16.1, onnxruntime 1.19.2, onnxsim 0.4.36). The README frames it around the tiny model. — [piddnad/DDColor](https://github.com/piddnad/DDColor)
- **edgetools/ddcolor** is DDColor-tiny as fp16 ONNX, 135 MB, fixed 1×3×512×512 input and 1×2×512×512 ab output, Apache-2.0. Weights come from `ddcolor_paper_tiny` (SHA-256 verified), exported at opset 17. Preprocessing: take L of the original, resize to 512, rebuild grey RGB with a=b=0, no ImageNet normalization. Then resize ab to the original size and merge with the original L. — [HF edgetools/ddcolor](https://huggingface.co/edgetools/ddcolor)
- **toolsmonk/ddcolor-tiny** is DDColor-tiny int8 ONNX, 112.7 MB, 512×512, Apache-2.0. MatMul/Gemm weights are dynamically quantized. The fp32 export is 257.7 MiB. Mean absolute difference vs fp32 is about 1.1 ab units. — [HF toolsmonk/ddcolor-tiny](https://huggingface.co/toolsmonk/ddcolor-tiny)
- Other community DDColor ONNX/CoreML ports: `lensmera/lensmera-color-ddcolor` (tiny fp16, 135.8 MB, Apache-2.0) and `Diogo122333/ddcolor-512-fp16` (456.5 MB, which is DDColor-large at 512 judging by size, **no license tag, unknown provenance**). — [HF lensmera](https://huggingface.co/lensmera/lensmera-color-ddcolor); [HF Diogo122333](https://huggingface.co/Diogo122333/ddcolor-512-fp16)
- **Qualcomm AI Hub DDColor** (Apache-2.0) reports 56.3M params, 215 MB float and 54.8 MB w8a8. Its v0.66.0 release includes an ONNX float package (ORT 1.30 tooling) at 256×256 input: `ddcolor.onnx` plus a 225 MB external-data file. — [Qualcomm AI Hub](https://aihub.qualcomm.com/models/ddcolor); [HF qualcomm/DDColor release_assets.json](https://huggingface.co/qualcomm/DDColor)
- Original PyTorch checkpoints: DDColor-L about 912 MB, tiny about 220 MB. — [HF piddnad/ddcolor_modelscope](https://huggingface.co/piddnad/ddcolor_modelscope); [HF ddcolor_paper_tiny](https://huggingface.co/piddnad/ddcolor_paper_tiny)
- **DeOldify ONNX:** `instant-high/deoldify-onnx` releases `deoldify.onnx` (254.8 MB, fixed 1×3×256×256, 0–255 input) and `deoldify_fp16.onnx` (127.4 MB). Newer dynamic-axes "render factor" models (ColorizeArtistic_dyn) are on Google Drive. The repo has no license file. The script blurs the predicted color (Gaussian 13×13), then merges the original L with the predicted a/b. — [instant-high/deoldify-onnx](https://github.com/instant-high/deoldify-onnx)
- A conversion script exists for both Artistic and Stable (opset 12, dynamic axes). A browser port reports 243 MB artistic ONNX and about 61 MB quantized. — [deoldify crate convert_model.py](https://docs.rs/crate/deoldify/0.1.0/source/convert_model.py); [deoldify-on-browser](https://awesome.ecosyste.ms/projects/github.com%2Fakbartus%2Fdeoldify-on-browser)
- **Zhang via OpenCV DNN:** the classic Caffe model (`colorization_release_v2.caffemodel`, 128.9 MB, plus `pts_in_hull.npy`) **no longer loads in OpenCV 5.0**. `readNet` raises "Caffe importer has been removed. Please use ONNX-converted models or use an older OpenCV". It still works in OpenCV 4.10. I found no ready ONNX export of eccv16/siggraph17 on Hugging Face. Export from the PyTorch `colorizers` package would be needed. — measured locally; [richzhang/colorization](https://github.com/richzhang/colorization)

**CPU benchmark, measured locally** (Ryzen 7 5700U, ORT 1.29 CPU EP, median of 3):

| Model / file | Input | File size | Default threads (16) | 4 threads | Peak RAM (process) |
|---|---|---|---|---|---|
| Zhang ECCV16/v2 Caffe (OpenCV 4.10 DNN) | 224 | 129 MB | **0.25 s** | 0.55 s | ~0.68 GB |
| DDColor-tiny fp32 (Qualcomm ONNX) | 256 | 228 MB | **0.70 s** | 0.50 s | ~0.70 GB |
| DeOldify artistic fp32 (instant-high) | 256 | 255 MB | 1.65 s | 2.06 s | ~0.73 GB |
| DDColor-tiny fp32 (upcast from edgetools fp16) | 512 | 270 MB | 1.54 s | 1.88 s | ~2.24 GB |
| DDColor-tiny int8 (toolsmonk) | 512 | 113 MB | 2.82 s | 1.72 s | ~2.13 GB |
| DDColor-large fp32 (upcast from Diogo122333 fp16) | 512 | 911 MB | 3.15 s | not run | ~2.93 GB |
| DDColor-large int8 (dynamic quant, made locally) | 512 | 304 MB | 2.94 s | not run | ~2.36 GB |
| DDColor-tiny **fp16** (edgetools) | 512 | 135 MB | **>8 min, did not finish 5 runs; killed** | not run | not measured |

- Session load took 0.3–3.2 s. Load once per batch, or keep a warm session while a colorize dialog is open.
- The Lab chroma transfer took 0.67 s for 4000×3000: float32 BGR→Lab, bicubic upscale of 512×512 ab, Lab→BGR. — measured locally
- In one hardware-unspecified study at 1024×128, DeOldify ran 0.23 s, DDColor 0.37 s and BigColor 0.54 s per image (GPU). — [arXiv 2409.11532](https://arxiv.org/pdf/2409.11532)

### Inferences
- **Ranking by quality achievable within CPU limits:**
  1. DDColor-large (modelscope or artistic) at 512, fp32 or int8. About 3 s and about 2.4–2.9 GB RAM. Best quality. Needs a self-made fp32/int8 export from the Apache-2.0 HF checkpoint via the official script, not the unlicensed community fp16 file.
  2. DDColor-tiny at 512, int8 or fp32. About 1.5–2.8 s, about 2.1 GB, 113–270 MB file. A good default if RAM matters less than download size.
  3. DDColor-tiny at 256 (Qualcomm fp32). About 0.5–0.7 s and only about 0.7 GB RAM. Best fast or low-RAM option. Chroma at 256 is upsampled anyway, so the loss is mainly in small objects and colour boundaries.
  4. DeOldify artistic or stable at 256. About 1.7 s and 0.7 GB. Lower colorfulness, and the project is archived.
  5. Zhang ECCV16/SIGGRAPH17. About 0.25 s, but the weakest quality, and it needs an ONNX re-export, because OpenCV 5 dropped Caffe.
- Dynamic int8 quantization barely speeds up DDColor (large 3.15 s to 2.94 s), because convolutions dominate. Its main benefit is file size (911 MB to 304 MB) and lower RAM. Static QDQ int8 might do better, but it is untested and quality drop is unknown.
- On a 16-thread CPU, 4 threads was *faster* for the tiny-256 and int8 models. Use about 4–8 intra-op threads to keep the UI responsive with no speed loss.
- Peak RAM of 2+ GB at 512 px comes largely from activation memory in DDColor's attention decoder. Consider 384 px as a middle option (needs a dynamic or second export). Release the session after use. Run inference in the engine process with `enable_cpu_mem_arena` off to return memory.
- DirectML on integrated GPUs (for example Radeon Vega in this CPU) could accelerate fp16/fp32 models, but this was not tested here. Given the CPU-only constraint, treat it as an optional bonus, with CPU fp32/int8 as the baseline.
- **Not viable on CPU:**
  - CtrlColor, SeAda, ColorizeNet, text-guided SDXL colorizers and other Stable-Diffusion-based colorizers (UNet plus VAE plus text encoder, multi-GB, 20+ denoising steps).
  - CT2 (463M params, transformer).
  - UniColor (transformer plus VQGAN, NC licensed anyway).

  Even distilled one-step diffusion (Color-Turbo) is an SD-scale model.

### Gaps
- Quality differences between tiny and large, 256 vs 512, and int8 vs fp32 on real old photos were not evaluated visually.
- DeOldify **Stable** ONNX was not benchmarked. Only the artistic-architecture file from instant-high was available. Stable uses resnet101, so expect it to be slower than artistic.
- There are no CPU timings for BigColor or ColorFormer. No ONNX exports were found, and both need GPU-oriented PyTorch code.
- The exact cause of the fp16 slowdown in ORT CPU was not diagnosed. Likely missing fp16 kernels or fallback paths.

## 4. Failure modes and mitigations

### Takeaway
The classic failure is desaturated sepia, brown or grey output. It comes from mean-seeking losses on multimodal colors. DeOldify is the measurable worst case: lowest colorfulness and the largest ΔCF in the DDColor table. Other failures are "zombie" grey skin or limbs, orange skin and red lips, color bleeding across edges, and errors on transparent objects. Mitigations: pick DDColor, colorize at 512 rather than 256, transfer only chroma onto the original luminance, and expose intensity (chroma scale) and model-variant controls.

### Cited Findings
- A Euclidean loss's optimum is the mean of plausible colors, which "favors grayish, desaturated results". Zhang 2016 fixes this with classification over quantized ab bins, class rebalancing, and an annealed-mean readout. — [Zhang et al. 2016 (arXiv 1603.08511)](https://ar5iv.labs.arxiv.org/html/1603.08511)
- Hobbyist evidence: a regression colorizer "will probably end up averaging them to a sepia tone". — [tinyclouds colorize](https://tinyclouds.org/colorize)
- DeOldify lists its own failures: "zombie hands", grey faces or limbs, orangish skin and overly red lips (post NoGAN inflection), glitches, and weird miscolorations, especially in Artistic. A higher render_factor increases stability. — [jantic/DeOldify](https://github.com/jantic/DeOldify)
- DeOldify colorfulness is 21.29 vs about 38 for DDColor and ColorFormer, with ΔCF 16.92 vs 0.05 for DDColor-L (ImageNet val5k). This quantifies DeOldify's desaturation. — [DDColor paper](https://ar5iv.labs.arxiv.org/html/2212.11613)
- DDColor fails on transparent or translucent objects and has no color guidance. — [DDColor paper](https://ar5iv.labs.arxiv.org/html/2212.11613)
- The instant-high DeOldify pipeline applies a 13×13 Gaussian blur to the predicted color before merging chroma with the original L. This hides blocky or bleeding chroma at the cost of edge precision. — [instant-high/deoldify-onnx](https://github.com/instant-high/deoldify-onnx)
- In Photoshop's Colorize filter, reviewers saw over-saturation in lips and used saturation sliders to fix scene colors. — [CreativePro](https://creativepro.com/colorizing-images-in-photoshop-with-neural-filters); [PetaPixel](https://petapixel.com/2021/11/04/how-adobes-neural-filters-make-colorizing-photos-way-easier/)
- Google Photos Colorize results were described as "muted, less vibrant", with "a tendency to go for an older, vintage look". — [9to5Google](https://9to5google.com/2019/10/07/google-photos-colorize-gallery/)

### Inferences
- **Mitigation checklist for SecurePhotos:**
  1. Convert the input to luminance first. Scanned "B&W" photos often have a sepia or yellow cast, so take Lab L only and feed L-grey so the cast does not bias the model.
  2. Colorize at 512, or 256 in fast mode.
  3. Upscale ab with bicubic or edge-aware (guided or joint-bilateral) filtering, using full-res L as the guide, to reduce bleeding.
  4. Recombine with the original full-res L, so detail and tonality are untouched.
  5. Offer a "color intensity" slider (scale a/b by 0–150%) and an optional model choice ("Natural" = modelscope, "Vivid/Artistic" = artistic).
  6. Optionally auto-detect already-colored or toned images: if the original a/b variance is high, skip the image or warn.
- Pre-cleaning (denoise or descreen, scratch removal) before colorization likely helps, because the model's input then resembles its training distribution. That is covered in the sibling notes.

### Gaps
- No quantitative study was found on how film grain, halftone, or paper damage affects these models.

## 5. How existing apps present colorization (labelling, originals, intensity)

### Takeaway
The norm is: create a *new* colorized copy, keep the original untouched, label the result as artificially colored, and offer basic adjustments. MyHeritage embeds a visible palette symbol. Photoshop outputs to a new layer with saturation, color-balance and focal-point controls. Google Photos exposes it as an edit filter for B&W photos.

### Cited Findings
- **MyHeritage In Color:**
  - Adds an embossed palette symbol in the bottom-left corner "to ensure that people can recognize that a photo has been artificially colorized".
  - The original B&W photo "remains intact" and the colorized copy is stored separately.
  - No symbol is added to *color-restored* (originally color) photos.
  - Enhanced photos get a separate magic-wand symbol.
  - A genealogist criticized the symbol as not very clear.
  - MyHeritage also offers a side-by-side comparison download.

  — [MyHeritage blog launch](https://blog.myheritage.com/2020/02/colorize-your-black-and-white-photos-automatically-with-myheritage-in-color); [MyHeritage help](https://www.myheritage.com/help/en/articles/12851631-how-do-i-access-myheritage-in-color); [Legal Genealogist](https://legalgenealogist.com/?p=19314); [comparison download](https://blog.myheritage.com/2020/03/new-download-a-comparison-of-your-original-and-colorized-photos)
- **Photoshop Neural Filters Colorize:**
  - Global saturation and color-balance sliders.
  - Focal points to set colors in specific areas.
  - Output to the current layer or a new (masked) layer. Adobe recommends "output as a new color layer" to preserve the original.
  - It went from Beta to Featured in Photoshop 2022. UI details may have changed since (possibly outdated).

  — [Adobe helpx](https://helpx.adobe.com/photoshop/discover/colorize-black-and-white-photos-in-photoshop.html); [PetaPixel 2021](https://petapixel.com/2021/11/04/how-adobes-neural-filters-make-colorizing-photos-way-easier/)
- **Google Photos:** "Colorize" appears as an editor filter only for B&W photos. It was announced at I/O 2018 and in beta from October 2019. A later Gemini-based flow is reported by a single, low-reliability source. — [9to5Google](https://9to5google.com/2019/10/07/google-photos-colorize-gallery/); [aivancity (unverified)](https://aivancity.ai/en/blog/coloriser-le-passe-quand-lintelligence-artificielle-de-google-sublime-les-photos-en-noir-et-blanc/)

### Inferences
- **Recommended SecurePhotos UX:**
  - Colorize creates a new version or copy, never overwriting.
  - The result carries metadata such as `ai_colorized=true`, model name and version, and date. Store it in the vault DB and optionally in XMP (for example IPTC DigitalSourceType "compositeWithTrainedAlgorithmicMedia" or similar). That vocabulary is not verified here, so check it in the pipeline/UX notes.
  - Show a small "AI colorized" badge in the viewer.
  - Offer a before/after slider and an intensity slider (re-blends chroma instantly, no re-inference, since ab can be cached).
  - Offer a Natural/Vivid model toggle.
- Because intensity only scales cached ab, the slider is real-time even on CPU. Only the first inference costs about 0.5–3 s.

### Gaps
- Remini's colorization presentation was not researched, due to the tool-call budget.
- I did not verify whether MyHeritage still uses the palette symbol in 2026. The sources are from 2020–2022 (possibly outdated).
- The current Google Photos (2026) colorize UI was not confirmed from Google's own docs.
