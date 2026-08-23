# 🔒 SecurePhotos

> **Privacy-first, zero-cloud desktop photo library and encrypted digital vault with local on-device AI.**

---

## 🌟 Overview

**SecurePhotos** is an offline, self-hosted desktop photo management system designed for users who demand absolute privacy, high-performance library browsing, and military-grade encryption for sensitive documents and personal media.

Unlike traditional photo managers, **SecurePhotos executes 100% of its workloads locally**:
- **Zero Cloud Reliance**: No remote telemetry, no cloud sync, no tracking.
- **On-Device AI**: Local face detection, recognition, clustering, blur assessment, and document classification using MediaPipe and ONNX runtime.
- **Encrypted Digital Vault**: AES-256-GCM chunked streaming encryption with Argon2id/PBKDF2 key derivation and optional TOTP two-factor authentication.
- **High-Performance Architecture**: SQLite WAL mode, multi-tiered thumbnail sharding, streaming I/O, and asynchronous background workers.

---

## 📑 Table of Contents

- [Key Features](#-key-features)
- [Architecture Overview](#-architecture-overview)
- [Enterprise Clean-Slate Blueprint](#-enterprise-clean-slate-blueprint)
- [Specialized Skills & Rules](#-specialized-skills--rules)
- [License](#-license)

---

## 🚀 Key Features

### 📸 1. High-Scale Photo Management
- **Multi-Source Ingestion**: Watch external hard drives, SSDs, SD cards, or local directories.
- **Managed & Non-Destructive Library Modes**: Choose between referencing original files in place or organizing them into a unified, auto-structured library folder.
- **Resumable Imports**: Transactional import tasks with SHA-256 checksum deduplication and resume capability on crash or restart.
- **EXIF Extraction & Metadata Search**: Fast searching by camera make/model, date ranges, geolocation coordinates, ISO, aperture, and shutter speed.
- **Sharded Thumbnail Cache**: 2-level hash-sharded thumbnail directory (`data/thumbnails/{xx}/{hash}.jpg`) for instantaneous rendering of 100,000+ photo libraries.

### 🧠 2. On-Device AI Engine
- **Face Detection & Recognition**: MediaPipe BlazeFace for sub-millisecond face localization and InsightFace MobileFaceNet (512-dimensional vector embeddings) for facial identity clustering.
- **Smart Albums & Events**: Automatic clustering by event timestamps and people.
- **Quality & Blur Detection**: Laplacian variance and perceptual sharpness scoring to identify blurry or low-quality photos.
- **Perceptual Duplicate Detection**: pHash (Perceptual Hash) + exact byte hash matching with configurable Hamming distance thresholds.
- **Document & Receipt Classifier**: Automatically segregates scans, IDs, receipts, and documents from family photos.

### 🔐 3. Encrypted Vault (Dual Private / Documents)
- **AES-256-GCM Cryptography**: PBKDF2 / Argon2id key derivation with unique per-file salts and chunked authenticated streaming.
- **Dual Vault Partitions**: Segregated spaces for sensitive private media vs. identity/financial documents.
- **In-Memory Decryption**: Zero-disk leakage during playback and browsing; encrypted payloads are streamed directly to memory.
- **Two-Factor Authentication**: Optional TOTP (Google Authenticator, Bitwarden, etc.) layer for vault access.
- **Auto-Lock & Session Invalidation**: Automatic timeout lockouts and short-lived in-memory token expiration.

---

## 🏗️ Architecture Overview

For complete flowcharts, security lifecycles, and database ER diagrams, refer to [ARCHITECTURE.md](file:///c:/Sumit%20Code/SecurePhotos/ARCHITECTURE.md).

For the clean-slate greenfield technical roadmap, refer to [GREENFIELD_ENTERPRISE_BLUEPRINT.md](file:///c:/Sumit%20Code/SecurePhotos/GREENFIELD_ENTERPRISE_BLUEPRINT.md).

---

## 📄 License

Proprietary and Confidential. All rights reserved.
