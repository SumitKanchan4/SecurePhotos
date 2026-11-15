# Local blind face restoration models for old photos (state as of Nov 2026)

Scope: offline face restoration for SecurePhotos (Windows, ONNX Runtime + DirectML). Covers quality, licences (code, weights, training data), ONNX availability, size, speed and identity preservation.

Overall caveat: almost every face restoration model was trained on FFHQ, which is non-commercial (see Q2). No candidate found here has commercially clean training data. Where this note says "weights: not stated", the repo gives no separate licence for the checkpoints. Licence claims come from repo READMEs and LICENSE files fetched in Nov 2026. Check them again before shipping. None of this is legal advice.

## Q1. Candidates and state of the art in quality

### Takeaway
On benchmarks, the best results now come from diffusion methods, and the strongest is one-step diffusion (OSDFace, CVPR 2025). Of the classic feed-forward codebook and GAN models, CodeFormer, DAEFR and VQFR lead. GFPGAN and RestoreFormer++ trail them on fidelity and FID, but they are the practical, fast, ONNX-ready options. Diffusion models (DiffBIR, DifFace, OSDFace) are 1-3 B parameters or need many steps, which makes them impractical for a DirectML desktop app.

### Cited Findings
- One benchmark table from the OSDFace paper covers RestoreFormer++, VQFR, CodeFormer, DAEFR, PGDiff, DifFace, DiffBIR, OSEDiff and OSDFace. On CelebA-Test it reports LPIPS / Deg. (ArcFace angle, lower means better identity) / LMD / FID (vs HQ) — [OSDFace arXiv](https://arxiv.org/html/2411.17163v2):
  - RestoreFormer++: LPIPS 0.4535, Deg 70.51, LMD 8.80, FID 72.79
  - VQFR: 0.3390, 62.26, 5.73, 24.91
  - CodeFormer: 0.3412, 62.20, 5.38, 26.86
  - DAEFR: 0.3580, 62.82, 5.63, 26.05
  - DifFace (250 steps): 0.3469, 63.45, 5.48, 22.24
  - DiffBIR (50 steps): 0.3740, 61.02, 5.10, 32.51
  - OSDFace (1 step): 0.3365, 60.07, 5.29, 17.06 (best FID and identity in the table)
  - GFPGAN and PMRF are not in this table.
- Real-world FID (no ground truth) from the same paper, given as Wider / LFW / WebPhoto — [OSDFace arXiv](https://arxiv.org/html/2411.17163v2):
  - RestoreFormer++: 45.4 / 50.3 / 75.1
  - VQFR: 37.9 / 49.8 / 84.8
  - CodeFormer: 38.8 / 52.3 / 83.2
  - DAEFR: 36.7 / 47.5 / 75.5
  - DiffBIR: 35.3 / 40.3 / 91.8
  - OSDFace: 34.6 / 44.6 / 84.6
  - DAEFR has the best NIQE across these sets (3.57 / 3.48 / 3.93).
- Cost per 512×512 face from the same paper. These are research-GPU PyTorch timings — [OSDFace arXiv](https://arxiv.org/html/2411.17163v2):
  - PGDiff: 1000 steps, 85.8 s, 176 M params
  - DifFace: 250 steps, 7.05 s, 175 M params
  - DiffBIR: 50 steps, 9.03 s, 3,042 M params
  - OSEDiff: 1 step, 0.13 s, 1,302 M params
  - OSDFace: 1 step, 0.10 s, 978 M params
- PMRF reports CelebA-Test results only as an image table. It uses identity metrics (Deg, LMD) and was trained on FFHQ at 512 — [PMRF GitHub](https://github.com/ohayonguy/PMRF).
- Newer work:
  - InterLCM (ICLR 2025) treats the low-quality image as an intermediate latent-consistency-model state. It trades fidelity against quality through the starting step — [InterLCM GitHub](https://github.com/sen-mao/InterLCM).
  - HonestFace (2025) is a one-step diffusion model focused on "honest" (identity-faithful) restoration — [arXiv 2505.18469](https://arxiv.org/html/2505.18469).
  - The NTIRE 2026 Real-World Face Restoration challenge scored entries on a weighted IQA score and used AdaFace as an identity checker. Ten teams made valid submissions — [NTIRE 2026 report](https://arxiv.org/abs/2604.10532). Its participants' code and models are collected at [jkwang28/NTIRE2026_RealWorld_Face_Restoration](https://github.com/jkwang28/NTIRE2026_RealWorld_Face_Restoration) (repo found in search, not verified).
  - BFR_RL / LRPO says its released weights are Apache-2.0, but it bundles base weights under their original licences, and the files are .pth/.ckpt, not ONNX — [HF BFR_RL](https://huggingface.co/wubin1928/BFR_RL). This comes from a search snippet only.

### Inferences
- For a DirectML desktop app, the realistic quality tier is the feed-forward models: GFPGAN, RestoreFormer++, GPEN and CodeFormer (all about 80-100 M params, one forward pass). Diffusion models such as OSDFace lead the benchmarks but are around 1 B params, depend on Stable Diffusion, and have no ONNX release.
- Ranking for old, blurry photos, based on the benchmarks above plus how widely community tools use them:
  - Fidelity and quality: CodeFormer ≈ DAEFR ≈ VQFR > GFPGAN > RestoreFormer++.
  - Among the permissively licensed ONNX-ready models: GFPGAN v1.4 > RestoreFormer++. RestoreFormer++ has the worst identity score (Deg 70.5) and LMD in the table.

### Gaps
- I found no paper table that compares GFPGAN v1.3 and v1.4 against OSDFace, PMRF or DAEFR under one protocol. GFPGAN numbers appear in older papers, which I did not fetch.
- The OSDFace code and weights release, and its licence at https://github.com/jkwang28/OSDFace, are not verified.
- The HonestFace and InterLCM licences were not fetched.
- I did not find out which methods won NTIRE 2026 (the abstract does not say).
- There is no published benchmark specific to scanned old photos (sepia, film grain, halftone). WebPhoto-Test is the closest stand-in.

## Q2. Licensing: code, weights and training data

### Takeaway
The code licence and the weights licence are permissive only for:
- GFPGAN (Apache-2.0)
- RestoreFormer++ (Apache-2.0)
- VQFR (Apache-2.0)
- DiffBIR (Apache-2.0, but the weights depend on Stable Diffusion 2.1)
- PMRF (MIT code)

All of them are trained on FFHQ, which is non-commercial (CC BY-NC-SA 4.0 metadata, with images under mixed Flickr licences). That leaves the dataset-to-weights grey area unresolved for every candidate. The other licences:
- CodeFormer and DifFace: NTU S-Lab 1.0, non-commercial. The CodeFormer rejection is confirmed.
- GPEN: no licence file, and facefusion labels it "Non-Commercial".
- DAEFR: no licence stated.

I found no face restoration model trained on commercially licensed data.

### Cited Findings
FFHQ dataset:
- The dataset metadata, scripts and docs are licensed by NVIDIA under CC BY-NC-SA 4.0: non-commercial use only, share-alike, and citation required — [NVlabs/ffhq-dataset](https://github.com/NVlabs/ffhq-dataset).
- The individual images are under CC BY 2.0, CC BY-NC 2.0, Public Domain Mark 1.0, CC0 1.0 or U.S. Government Works. The page summarises these as permitting use "for non-commercial purposes" — [NVlabs/ffhq-dataset](https://github.com/NVlabs/ffhq-dataset).
- The page says FFHQ "should not be used for development or improvement of facial recognition technologies". It does not say whether trained models count as derivative works — [NVlabs/ffhq-dataset](https://github.com/NVlabs/ffhq-dataset).

GFPGAN:
- Code is Apache-2.0 (© Tencent). The LICENSE file lists third-party carve-outs: StyleGAN2 code modified from rosinality's stylegan2-pytorch (MIT); NVIDIA's official StyleGAN2 under the NVIDIA Source Code License ("only may be used… non-commercially"); and DFDNet (CC BY-NC-SA 4.0) — [GFPGAN LICENSE](https://raw.githubusercontent.com/TencentARC/GFPGAN/master/LICENSE).
- The README gives no separate weights licence. It trains on FFHQ — [GFPGAN GitHub](https://github.com/TencentARC/GFPGAN).
- A third-party HF card says three things:
  - The v1.4 StyleGAN2 decoder prior (`StyleGAN2_512_Cmul1_FFHQ_B12G4_scratch_800k.pth`) was trained from scratch by BasicSR, not taken from NVIDIA's weights, so the NVIDIA carve-out does not apply.
  - The weights are Apache-2.0.
  - FFHQ training remains "the standard unsettled dataset-to-weights question that applies to every face model".

  This is a secondary source — [mlx-community/GFPGANv1.4-fp32](https://huggingface.co/mlx-community/GFPGANv1.4-fp32).
- I found no official TencentARC statement on commercial use of the weights — [search result summary; TencentARC/GFPGANv1 HF](https://huggingface.co/TencentARC/GFPGANv1).

CodeFormer:
- Licensed under NTU S-Lab License 1.0 — [CodeFormer GitHub](https://github.com/sczhou/CodeFormer).
- The licence allows non-commercial use only. For commercial use it says "please contact the contributor(s)". The text covers "source code / binary forms / this software" and does not mention weights explicitly — [CodeFormer LICENSE](https://raw.githubusercontent.com/sczhou/CodeFormer/master/LICENSE).
- facefusion's metadata labels it S-Lab-1.0 — [facefusion face_enhancer core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py).
- Rejection confirmed.

RestoreFormer / RestoreFormer++:
- Code is Apache-2.0 and the weights have no separate licence. The ROHQD codebook and RestoreFormer++ are trained on FFHQ resized to 512 — [RestoreFormerPlusPlus GitHub](https://github.com/wzhouxiff/RestoreFormerPlusPlus).
- facefusion labels it Apache-2.0 — [facefusion core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py).

GPEN:
- The README states no licence. It says the released model is "not our best model due to commercial issues", and that GPEN-BFR-2048 was taken down "due to commercial issues". The 1024 and 2048 versions are on ModelScope. Training uses user-supplied aligned faces, with FFHQ given as the example — [GPEN GitHub](https://github.com/yangxy/GPEN).
- facefusion labels all GPEN models "Non-Commercial" — [facefusion core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py).

VQFR:
- Code is Apache-2.0. The weights (Google Drive) have no stated licence. Trained on FFHQ — [VQFR GitHub](https://github.com/TencentARC/VQFR).

DAEFR:
- No licence in the README or sidebar. Trained on FFHQ at 512 — [DAEFR GitHub](https://github.com/LIAGM/DAEFR).

DifFace:
- NTU S-Lab License 1.0 (non-commercial) — [DifFace GitHub](https://github.com/zsyOAOA/DifFace).

DiffBIR:
- Code is Apache-2.0. The face model `v1_face.pth` is an IRControlNet trained on FFHQ. Stage 2 uses Stable Diffusion 2.1-base, and stage 1 uses SwinIR-Face from DifFace (S-Lab) — [DiffBIR GitHub](https://github.com/XPixelGroup/DiffBIR).
- SD 2.1 is believed to be under CreativeML Open RAIL++-M, but this was not verified here.

PMRF:
- Code is MIT. The weights (HF and Google Drive) have no stated licence. Trained on FFHQ. It reuses a SwinIR checkpoint from DifFace (S-Lab) and helper checkpoints from VQFR — [PMRF GitHub](https://github.com/ohayonguy/PMRF).

### Inferences
- GFPGAN v1.4 is the least-risky choice: Apache code, Apache-labelled weights, and a from-scratch BasicSR StyleGAN2 prior rather than NVIDIA's. It still carries the FFHQ grey area. RestoreFormer++ is second.
- The grey area works like this. Under US/EU law it is unsettled whether model weights are a "derivative" or an "adaptation" of a CC BY-NC-SA dataset. Many commercial apps ship GFPGAN anyway, but nobody can guarantee that is safe. Treat it as residual risk and document it in the app's notices.
- DiffBIR's face path inherits SwinIR-Face from DifFace (S-Lab, non-commercial), so it is not clean even though its own code is Apache. PMRF's quick-start path has the same issue.
- GPEN should be treated as non-commercial.

### Gaps
- No candidate trained on commercially licensed or consented face data was found. Building one would mean training on a licensed or synthetic face dataset, which this note did not research.
- ModelScope's licence for GPEN 1024/2048 was not checked.
- Whether CodeFormer's S-Lab licence formally covers the weights is ambiguous, but this does not matter because CodeFormer is rejected anyway.

## Q3. ONNX availability, DirectML, size and speed

### Takeaway
facefusion hosts ready-made 512-input ONNX exports of the main models on Hugging Face, with licence metadata:
- GFPGAN 1.2/1.3/1.4: about 340 MB each
- CodeFormer: 377 MB
- GPEN 256/512/1024/2048: 76-286 MB
- RestoreFormer++

facefusion runs these through ONNX Runtime with DirectML as one of its providers, so DirectML compatibility is proven in practice. Diffusion models have no ONNX exports. I found no published per-face timings for DirectML.

### Cited Findings
- File sizes on facefusion `models-3.0.0` — [HF facefusion/models-3.0.0](https://huggingface.co/facefusion/models-3.0.0/tree/main):
  - codeformer.onnx: 377 MB
  - gfpgan_1.2 / 1.3 / 1.4.onnx: 340 MB each
  - gpen_bfr_256: 75.8 MB
  - gpen_bfr_1024: 285 MB
  - gpen_bfr_2048: 286 MB
  - The listing was truncated, so the gpen_bfr_512 and restoreformer_plus_plus sizes were not seen.
- facefusion's face-enhancer registry lists these keys: codeformer, gfpgan_1.2/1.3/1.4, gpen_bfr_256/512/1024/2048 and restoreformer_plus_plus — [facefusion core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py).
  - Templates: `ffhq_512` for all of them, except gpen_bfr_256, which uses `arcface_128`.
  - Input sizes are 512, apart from GPEN at 256/1024/2048.
  - Licence metadata: TencentARC Apache-2.0, sczhou S-Lab-1.0, yangxy Non-Commercial, wzhouxiff Apache-2.0.
- GFPGAN v1.4 has 87.1 M params, fp32, about 349 MB (MLX conversion) — [mlx-community/GFPGANv1.4-fp32](https://huggingface.co/mlx-community/GFPGANv1.4-fp32).
- Other community ONNX repos exist: harisreedhar/Face-Upscalers-ONNX (CodeFormer, GFPGAN, GPEN, RestoreFormer folders; details not readable) — [GitHub](https://github.com/harisreedhar/Face-Upscalers-ONNX). There is also a GFPGAN ONNX inference API in GuijiAI/ReHiFace-S — [HF](https://huggingface.co/GuijiAI/ReHiFace-S/raw/main/face_restore/gfpgan_onnx_api.py).
- AMD hosts a PSFRGAN ONNX for Ryzen AI — [amd/ryzenai-psfrgan](https://hf-2025.pages.dev/amd/ryzenai-psfrgan). Licence not checked.
- DirectML performance:
  - It can be slower than CPU on weak iGPUs such as the Intel UHD 630, and loading the first session is slow — [microsoft/DirectML issue 175 (mirror)](https://summer-heart-0930.chufeiyun1688.workers.dev/https/github.com/microsoft/DirectML/issues/175).
  - Pre- and post-processing stay on the CPU — [ORT DirectML EP docs](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html).
- Speed reference: the diffusion models run 0.1 s (OSDFace, 1 step, about 1 B params) to 9 s (DiffBIR) per face on a research GPU in PyTorch — [OSDFace arXiv](https://arxiv.org/html/2411.17163v2).

### Inferences
- The CodeFormer ONNX in facefusion takes a `weight` (w) input. facefusion passes `face_enhancer_weight` to any model that declares one — [facefusion core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py).
- Rough expectation, inferred from about 87 M params and roughly 100+ GFLOPs at 512² (not measured):
  - GFPGAN or RestoreFormer++ at 512 should take tens of milliseconds per face on a mid-range discrete GPU with DirectML, and roughly 0.5-2 s per face on a modern CPU.
  - These figures must be benchmarked in the app.
- Download size: about 340 MB per GFPGAN model in fp32. fp16 conversion could roughly halve it. Ship it as an on-demand download.
- Licence hygiene: SecurePhotos should not redistribute facefusion's packaged files without checking the facefusion-assets repository terms. It is cleaner to export GFPGAN v1.4 to ONNX from TencentARC's .pth itself.

### CPU-only constraint (owner update, Nov 2026)

The target is CPU only: no dedicated GPU, at most integrated graphics.

Cited findings:
- I found no reliable published CPU per-face timing for GFPGAN.
  - The GFPGAN repo offers a "clean" architecture that runs on CPU or Windows without CUDA extensions — [GFPGAN GitHub](https://github.com/TencentARC/GFPGAN).
  - One guide gives about 0.5-2 s per image for Real-ESRGAN face enhancement, but the hardware is unspecified and it is GPU-oriented — [Real-ESRGAN face-enhancement guide](https://mintlify.com/xinntao/Real-ESRGAN/guides/face-enhancement).
- On weak iGPUs, DirectML can be slower than CPU — [DirectML issue 175 (mirror)](https://summer-heart-0930.chufeiyun1688.workers.dev/https/github.com/microsoft/DirectML/issues/175). Benchmark CPU EP against DirectML-on-iGPU per machine and pick the faster.
- Diffusion models need 0.1-9 s per face on a research GPU, with 1-3 B params (OSDFace 978 M, DiffBIR 3,042 M), or hundreds of steps (DifFace 250, PGDiff 1000) — [OSDFace arXiv](https://arxiv.org/html/2411.17163v2).
- Lightweight research models exist:
  - CFRNet (arXiv 2606.06850, 2026) has about 2.0 M params, works on 256×256 crops, and runs about 23 ms INT8 on an embedded NPU. It claims the best LPIPS against retrained 256² baselines, but its code is "will be released" and has no licence — [arXiv 2606.06850](https://arxiv.org/abs/2606.06850).
  - The same paper cites a GPEN-Lite-style 256² model at about 15 M params and about 19 GMACs (search snippet only) — [arXiv PDF](https://arxiv.org/pdf/2606.06850).
- Existing variants:
  - A GFPGAN v1.4 LiteRT (TFLite) conversion exists, which shows that mobile-sized deployment is feasible — [litert-community/GFPGAN-v1.4-LiteRT](https://huggingface.co/litert-community/GFPGAN-v1.4-LiteRT). Its quantisation level was not checked.
  - Model sizes: GFPGAN is 87.1 M params, 340-349 MB fp32 — [mlx-community](https://huggingface.co/mlx-community/GFPGANv1.4-fp32), [facefusion HF](https://huggingface.co/facefusion/models-3.0.0/tree/main). gpen_bfr_256.onnx is 75.8 MB, the smallest standard option — [facefusion HF](https://huggingface.co/facefusion/models-3.0.0/tree/main).
  - I found no official int8 ONNX of GFPGAN, RestoreFormer++, CodeFormer or GPEN.

Viability per candidate. Times are rough estimates, not measurements. They assume a 4-8-core mid-range laptop CPU (e.g. Core i5/Ryzen 5, 2022-2025) running ORT CPU EP fp32, and come from the model sizes plus the general behaviour of 512² conv nets on CPU. They must be benchmarked.

| Model | Viable on CPU? | Est. per face | Est. per photo (1-5 faces) | Est. RAM working set | Size | Lighter variant |
|---|---|---|---|---|---|---|
| GFPGAN v1.4 (512) | Yes | ~1-3 s | ~1-15 s | ~0.7-1.5 GB | 340 MB fp32 | none official; self-quantise (fp16 storage / int8 dynamic) to test |
| RestoreFormer++ (512) | Yes | ~1-3 s | ~1-15 s | ~0.7-1.5 GB | not seen (similar class) | none found |
| GPEN-BFR-256 | Yes (fastest) | ~0.2-0.6 s | ~0.2-3 s | ~0.3-0.6 GB | 75.8 MB | none found. Licence: Non-Commercial (rejected) |
| GPEN-BFR-512/1024/2048 | 512 yes; 1024/2048 slow | 512: ~1-3 s; 1024+: several s+ | — | 1+ GB | 285-286 MB (1024/2048) | — (Non-Commercial) |
| CodeFormer (512) | Yes | ~1-4 s | — | ~1-1.5 GB | 377 MB | — (S-Lab, rejected) |
| VQFR / DAEFR | Marginal; no ONNX | likely several s | — | — | — | — |
| DiffBIR, DifFace, PGDiff, OSDFace, OSEDiff, PMRF, SUPIR-like | **Not viable on CPU** (diffusion or flow, 1-3 B params or many steps) | minutes | — | multiple GB | GBs | — |
| CFRNet (2 M) | Would be ideal | likely tens of ms | — | small | ~8 MB est. | no code or weights yet |

Inferences:
- Rank by quality achievable within CPU limits and licence:
  1. GFPGAN v1.4 (Apache, ONNX-ready, best-known real-world results among permissive options).
  2. RestoreFormer++ (Apache, ONNX-ready, but weaker identity: Deg 70.5).
  3. Watch-list: CFRNet or other tiny 2026 models, once released with a licence.
- CodeFormer and GPEN would rank as high as or higher than these technically, but are excluded on licence.
- Mitigations for CPU:
  - Run only on demand (a user-triggered "Restore faces" action), never as a background batch over the library.
  - Run at 512 and only on faces whose detected size is below about 300 px. Larger faces gain little.
  - Load the session lazily and free it afterwards, because it is a 340 MB model.
  - Try ORT dynamic int8 quantisation, which usually gives 1.5-3× speed on CPU. Validate identity similarity against fp32 with SFace, because GAN decoders can degrade under int8.
  - fp16 mainly halves file size on CPU EP. It does not reliably speed it up.

### Gaps
- No published per-face latency for GFPGAN, CodeFormer or RestoreFormer++ ONNX on DirectML or CPU. All CPU timings and RAM figures above are estimates and must be measured locally.
- int8 quality and speed for GFPGAN / RestoreFormer++ are unverified.
- Sizes of gpen_bfr_512.onnx and restoreformer_plus_plus.onnx were not seen.
- The licence of facefusion-assets as a redistribution channel was not checked.
- Whether all ops (for example GFPGAN's modulated conv / StyleGAN2 layers) run fully on the DirectML EP without CPU fallback is not documented. facefusion's working DirectML support is indirect evidence that they do.

## Q4. Identity preservation, hallucination risk and fidelity/quality controls

### Takeaway
All generative-prior and codebook models invent detail on severely degraded faces. They can change identity, and a known artefact is overly smooth, "plasticky" skin. Each model has a different control for this:
- CodeFormer: w (0 favours quality, 1 favours fidelity)
- VQFR v2: fidelity ratio `-f`
- InterLCM: starting step
- Any model: blending the output with the original at paste-back (facefusion's blend percentage)

RestoreFormer++ scored worst on identity in the benchmark table, and OSDFace and DiffBIR scored best.

### Cited Findings
- CodeFormer's w runs from 0 to 1. A smaller w gives higher quality and a larger w higher fidelity. Suggested values: 0.5 for aligned faces, 0.7 for whole images, 1.0 for video — [CodeFormer GitHub](https://github.com/sczhou/CodeFormer).
- VQFR v2's `-f` fidelity ratio runs from 0 (best quality) to 1 (best fidelity), default 0 — [VQFR GitHub](https://github.com/TencentARC/VQFR).
- InterLCM balances fidelity and quality by choosing which LCM step to start from — [InterLCM GitHub](https://github.com/sen-mao/InterLCM).
- Identity angle (Deg., lower is better) on CelebA-Test — [OSDFace arXiv](https://arxiv.org/html/2411.17163v2):
  - OSDFace 60.07, DiffBIR 61.02, CodeFormer 62.20, VQFR 62.26, DAEFR 62.82, DifFace 63.45, RestoreFormer++ 70.51, PGDiff 71.60
- NTIRE 2026 treats identity as a hard gate, using AdaFace as the identity checker — [NTIRE 2026 report](https://arxiv.org/abs/2604.10532).
- Reference-based methods use other photos of the same person to anchor identity. Examples are FaceMe (AAAI 2025) and RefSTAR (2026) — [Awesome-Face-Restoration](https://github.com/24wenjie-li/Awesome-Face-Restoration). These are relevant to a photo library that already has face clusters.
- facefusion's `face_enhancer_blend` (default 80) mixes the enhanced face with the original, at about 80% enhanced. Lower values keep more of the original — [facefusion core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py).

### Inferences
- For SecurePhotos, run an identity check after restoring a face. Compare the SFace embedding of the restored face with that of the original. If similarity drops below a threshold, lower the blend or warn the user. This mirrors NTIRE's AdaFace gate and uses models the app already ships.
- Show the result as a before/after comparison with a strength slider (output blending). Never overwrite the original. For old family photos, invented features ("this isn't grandma") are the main user-trust risk.
- GFPGAN has no built-in fidelity knob, so output blending is its only control.

### Gaps
- I found no source comparing GFPGAN v1.3 against v1.4 on identity or naturalness. My recollection is that the GFPGAN README describes v1.3 as more natural and v1.4 as having slightly more detail, but this is unverified.
- There is no quantitative study of skin texture on scanned old photos specifically.
- PMRF's identity numbers exist only as an image and were not extracted.

## Q5. How these models are used for old photos, and which face detectors

### Takeaway
The standard pipeline is:
1. Detect faces and get 5-point landmarks.
2. Warp each face by similarity transform to the model's template (FFHQ-512 alignment).
3. Restore the 512² crop.
4. Warp it back with the inverse affine matrix.
5. Composite it with a feathered (blurred box) mask, optionally intersected with an occlusion or face-parsing mask, and an overall blend factor.
6. Upscale the background separately, if wanted (e.g. Real-ESRGAN).

YuNet gives the five landmarks the FFHQ template needs, so it can drive alignment directly.

### Cited Findings
- facefusion's steps are as follows — [facefusion core.py](https://raw.githubusercontent.com/facefusion/facefusion/master/facefusion/processors/modules/face_enhancer/core.py):
  - Warp the face to the model template (`ffhq_512`) from the 5-point landmarks.
  - Run the model.
  - Paste back through the inverse affine matrix.
  - Build the mask: a box mask with `face_mask_blur`, combined by per-pixel minimum with an optional occlusion mask.
  - Blend with the frame using `face_enhancer_blend`.
- GFPGAN's reference pipeline uses facexlib (MIT) for detection, alignment and parsing, BasicSR (Apache-2.0), and Real-ESRGAN for background upsampling — [GFPGAN LICENSE](https://raw.githubusercontent.com/TencentARC/GFPGAN/master/LICENSE); [GFPGAN GitHub](https://github.com/TencentARC/GFPGAN).
- InterLCM also supports a whole-image mode with Real-ESRGAN for background and face upsampling — [InterLCM GitHub](https://github.com/sen-mao/InterLCM).
- RestoreFormer++, VQFR, DAEFR and PMRF all expect 512×512 FFHQ-aligned inputs — [RestoreFormer++](https://github.com/wzhouxiff/RestoreFormerPlusPlus), [DAEFR](https://github.com/LIAGM/DAEFR), [PMRF](https://github.com/ohayonguy/PMRF).

### Inferences
- YuNet outputs 5 landmarks (eyes, nose tip, mouth corners), which is the same landmark set used for the FFHQ-512 template. So no extra detector is needed, and its MIT licence keeps the chain clean.
- facexlib's default detectors (RetinaFace weights) and parsing networks carry their own licences. Avoid them, and use YuNet plus a feathered elliptical mask. A face-parsing model is only worth adding if its licence is checked first.
- For old photos, use this order: optional scratch/damage repair, then face restoration, then colourisation. Restore on greyscale or sepia input, because these models are trained on colour FFHQ and may add colour casts. Convert the output to luminance before colourising, or blend only luminance into the original.

### Gaps
- No source was found on how restoration models behave on monochrome or sepia input, or whether converting to luminance only is standard practice. This is untested.
- No source was found comparing YuNet against RetinaFace alignment accuracy for restoration quality.
