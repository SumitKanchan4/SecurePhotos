# Third-Party Notices

SecurePhotos itself is released under the [MIT License](LICENSE). It uses the following AI models, which are downloaded on first use into the library's `data/models` folder and checked against a pinned SHA-256 fingerprint before they are loaded. Each model remains under its own licence.

Only permissively licensed models are used. Models whose licences restrict commercial use or require copyleft terms were removed in November 2026 (see "Removed models" below).

| Model | Used for | Licence | Source |
|---|---|---|---|
| YuNet (`face_detection_yunet_2023mar.onnx`) | Finding faces for People | MIT | [OpenCV Zoo: face_detection_yunet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| SFace (`face_recognition_sface_2021dec.onnx`) | Recognising people across photos | Apache License 2.0 | [OpenCV Zoo: face_recognition_sface](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
| Real-ESRGAN general x4v3 (`realesr_general_x4v3.onnx`) | AI upscaling | BSD 3-Clause | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) |

The full licence texts and copyright notices for YuNet and SFace are in the `LICENSE` files of the upstream folders linked above; they apply to the downloaded model files.

## Fonts

The app's fonts are bundled with it (no download at runtime) through the Fontsource packages. All three are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/).

| Font | Package | Licence |
|---|---|---|
| Inter | `@fontsource/inter` | OFL-1.1 |
| Plus Jakarta Sans | `@fontsource/plus-jakarta-sans` | OFL-1.1 |
| JetBrains Mono | `@fontsource/jetbrains-mono` | OFL-1.1 |

The full licence text and copyright notices ship with each package (`node_modules/@fontsource/<font>/LICENSE`).

## Real-ESRGAN: BSD 3-Clause License

Copyright (c) 2021, Xintao Wang
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Removed models (no longer used or downloaded)

| Model | Reason |
|---|---|
| InsightFace ArcFace `w600k_r50` | Licensed for non-commercial research only |
| YOLOv8-face `yoloface_8n` | GPL-3.0 (YOLOv8 base: AGPL-3.0); doesn't fit an MIT app |
| CodeFormer | S-Lab License 1.0: non-commercial only |
| `1x-ReFocus-Cleanly` | Licence could not be verified (and the feature was unused) |

When an existing library is upgraded, these files are deleted from `data/models` once every photo has been re-scanned with the new face models.

## A note on training data

Most face-recognition models, including permissively licensed ones, were trained on face datasets released for research. The licences above cover the model files themselves; this note is for transparency, not legal advice.
