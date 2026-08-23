# 🚀 SecurePhotos 2.0 — Enterprise Clean-Slate Blueprint

> **A ground-up, zero-debt architectural blueprint, technology specification, and AI agent framework for building a high-scale, memory-efficient, SLM-powered media library and digital vault.**

---

## 🎯 Executive Summary & Clean-Slate Objectives

Starting from a clean slate eliminates accumulated technical debt, inconsistent state management, and regression loops where fixing one feature inadvertently breaks another.

### Core Targets for SecurePhotos 2.0:
1. **Ultra-Low Memory Footprint (< 80 MB Idle)**: Maximize available RAM/VRAM to host on-device **Small Language Models (SLMs)** (e.g., Moondream2, Phi-3.5, Qwen2.5-VL) on consumer laptops (8GB–16GB RAM).
2. **High Scale & Responsiveness**: 60fps buttery-smooth browsing and sub-10ms search over **100,000+ photos, 4K videos, and scanned documents**.
3. **Instant Hybrid Search**: Combined SQLite FTS5 (full-text/OCR/metadata) + Vector Embeddings (MobileCLIP/SigLIP natural language semantic search).
4. **Zero-Trust Hardened Vault**: Chunked **AES-256-GCM** authenticated streaming encryption with PBKDF2/Argon2id and TOTP 2FA.
5. **Strict Architectural Boundaries**: Type-safe contracts, decoupled modular services, isolated background workers, and zero cross-module coupling.

---

## 🏗️ 1. Modern Technology Stack (Clean Slate)

```mermaid
graph TB
    subgraph UI ["1. Native Presentation Tier (Tauri 2.0 + React 18)"]
        ReactApp["React 18 + Vite SPA<br/>• Pure CSS Tokens & Modern Design System<br/>• TanStack Virtualized Grid (0ms DOM lag)<br/>• Zustand Modular State Stores"]
        TauriShell["Tauri 2.0 Shell (Rust Core)<br/>• Native OS WebView2 (30-40 MB RAM)<br/>• Zero Node.js runtime overhead<br/>• Native File System & Window Controls"]
        
        TauriShell --> ReactApp
    end

    subgraph Service ["2. Application & Data Engine Tier"]
        CoreAPI["FastAPI / Rust Core Engine<br/>• Strictly typed Pydantic V2 / Serde schemas<br/>• Async streaming I/O endpoints<br/>• Strict localhost / custom protocol CORS"]
        SQLiteEngine["SQLite Engine (WAL Mode)<br/>• Composite Covering Indexes<br/>• FTS5 Full-Text & OCR Index<br/>• sqlite-vec / HNSW 512-D Vector Table"]
        
        ReactApp -->|Typed IPC / HTTP| CoreAPI
        CoreAPI --> SQLiteEngine
    end

    subgraph Workers ["3. Isolated Worker Subprocesses (No GIL Contention)"]
        ScanWorker["Ingestion & Indexing Worker<br/>(Transactional Resumable Pipeline)"]
        AIWorker["SLM & Vector Worker (DirectML / GGUF)<br/>• MobileCLIP (Text-to-Image Search)<br/>• Moondream2 / Qwen2.5-VL (Doc OCR & Tagging)<br/>• BlazeFace + MobileFaceNet (Identity Clustering)"]
        VaultWorker["Chunked AES-256-GCM Streaming Worker"]
        
        CoreAPI -->|IPC Job Queue| Workers
        Workers --> SQLiteEngine
    end
```

---

## 👥 2. Enterprise Agent & Skill Framework

```
.agents/
├── skills/
│   ├── modern-web-ui/                # UI tokens, 60fps virtualized grids, accessibility
│   ├── local-slm-engineering/        # GGUF quantization, VLM prompts, memory budget
│   ├── sqlite-vector-search/         # WAL tuning, FTS5, sqlite-vec indexing, zero-N+1
│   ├── zero-trust-crypto/            # AES-256-GCM streaming, Argon2id, TOTP, memory safety
│   ├── enterprise-standards-and-docs/# Coding standards, docstrings, testing, comments
│   └── enterprise-qa-regression/     # Component isolation tests, memory leak profiling
└── rules/
    └── strict-approval-and-standards.md # Rule preventing unapproved auto-implementation
```
