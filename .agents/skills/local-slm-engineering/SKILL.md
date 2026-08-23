---
name: local-slm-engineering
description: >-
  Guidelines for running on-device Small Language Models (SLMs) and Vision-Language Models (VLMs) like Moondream2, Phi-3.5, and MobileCLIP. Covers GGUF/INT4 quantization, VRAM/RAM budgets, DirectML/ONNX hardware acceleration, idle model eviction, and multimodal OCR & captioning.
---

# 🧠 Local SLM & Vision-Language Engineering Skill

This skill guides the implementation and lifecycle management of on-device **Small Language Models (SLMs)** and **Vision-Language Models (VLMs)** in consumer desktop environments.

---

## 1. Model Selection & Quantization Standards

| Workload | Recommended Model | Quantization | RAM Budget | Target Latency |
|---|---|---|---|---|
| **Semantic Search Embeddings** | **MobileCLIP-B(LT)** or **SigLIP** | INT8 / FP16 ONNX | ~40–60 MB | < 5ms / image |
| **Document OCR & Extraction** | **Moondream2 (1.8B)** or **SmolVLM** | Q4_K_M GGUF | ~1.4–1.8 GB | ~300ms / page |
| **Natural Language Photo Q&A** | **Qwen2.5-VL-3B** or **Phi-3.5-mini** | Q4_K_M GGUF | ~2.2–2.8 GB | ~25 tokens/s |

---

## 2. Dynamic Memory & VRAM Budgeting

To ensure the desktop app does not cause Out-Of-Memory (OOM) errors on 8 GB or 16 GB laptops:

### A. Strict RAM Cap & Pre-Flight Checks
- Before loading an SLM into memory, check available physical RAM via `psutil` or native OS APIs.
- Require at least **1.5 GB free system memory** before spawning the model runtime.
- If system memory is tight, gracefully fallback to lightweight CPU-only embeddings (`MobileCLIP-S0`).

### B. Auto-Eviction / Model Parking
- The SLM must **not remain resident in memory indefinitely**.
- Implement an **idle timer (default: 120 seconds)**:
  ```python
  # Unload model weights if no inference request arrives within timeout
  if time.time() - last_inference_time > IDLE_TIMEOUT_SECONDS:
      unload_model_from_vram()
  ```

---

## 3. Hardware Acceleration & Execution Providers

- **Windows**: Use `onnxruntime-directml` or `llama-cpp-python` with `GGML_DIRECTML=on` to support AMD, Intel Arc/Iris, and NVIDIA GPUs uniformly.
- **macOS**: Use Apple Silicon Metal acceleration (`GGML_METAL=on`).
- **Linux**: Vulkan or ROCm/CUDA providers.
