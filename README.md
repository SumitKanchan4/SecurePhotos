# 📸 SecurePhotos

> **The 100% Private, Zero-Cloud Photo & Video Vault for Your Desktop and External Drives.**

*SecurePhotos is a lightning-fast, beautifully designed personal media library that keeps your family photos, videos, and private documents completely on your own hardware, with zero cloud uploads, zero subscriptions, and zero tracking.*

---

> 👨‍💻 **Are you a developer or contributor?**
> Looking for system architecture, build instructions, or local development setup? Please see the [**Developer Guide**](docs/development.md).

---

## 🌟 Why SecurePhotos?

Most modern photo apps want your photos in their cloud, require ongoing monthly subscriptions, and scan your personal life for ad tracking. **SecurePhotos takes the opposite approach: complete privacy and total ownership.**

| Feature | SecurePhotos | Cloud Services (Google, Apple, OneDrive) |
| :--- | :--- | :--- |
| **Privacy** | 🔒 **100% On-Device & Offline** | ☁️ Uploaded to corporate cloud servers |
| **Storage Location** | 💾 **Your PC or External SSD** | 🏢 Remote third-party data centers |
| **Cost** | 💸 **Free & Lifetime Ownership** | 💳 Recurring monthly storage fees |
| **Speed** | ⚡ **Instant 60fps Native Performance** | ⏳ Buffering, network lag & upload delays |
| **Private Vault** | 🛡️ **Military-Grade Encryption (AES-256)** | 🔓 Plainly readable by cloud admins/AI |
| **AI Processing** | 🧠 **100% On-Device Offline AI** | 🤖 Remote server-side AI training |

---

## ✨ Key Capabilities

### 🛡️ 100% Private & Truly Offline
Every photo, video, face recognition scan, and document search runs strictly on your computer's local hardware. SecurePhotos never connects to any external cloud, has zero telemetry, and never phones home.

### 💾 Portable External Drive Vault
You can install and store your entire library directly on an external hard drive or high-speed portable SSD. When you unplug the drive and connect it to another PC, your entire library, albums, face tags, and encrypted vault are ready to use immediately.

### ⚡ Silky-Smooth Browsing (100,000+ Photos)
Engineered for massive collections. Scroll through decades of memories at a locked 60 frames per second without stuttering, loading spinners, or freezing.

### 👥 Smart People & Family Recognition
Group photos by the people you love without sending your biometric data to the cloud.
- **"Name Once, Tag 1,000 Photos"**: Name a face once, and SecurePhotos automatically identifies that person across your entire collection.
- **VIP "Close Ones"**: Pin your closest family and friends to the top for quick access.
- **Offline & Safe**: All face detection runs 100% locally on your machine.

### 🔒 Encrypted Private Vault
Protect sensitive paperwork, financial records, medical documents, and intimate photos behind a dedicated master password or PIN. Vault photos are stored with bank-grade encryption (AES-256) and are decrypted strictly in memory while you view them, never left exposed on the disk.

### 🧹 Duplicate Cleaner & Disk Space Saver
Free up valuable gigabytes on your computer:
- **Intelligent Duplicate Finder**: Automatically spots exact copies and burst shots, suggesting the best photo to keep while safely moving redundancies to the trash.
- **Video Optimizer**: Compresses oversized phone videos to modern formats with zero perceptible loss in visual quality.
- **30-Day Safety Net**: Trashed items are held safely for 30 days before permanent deletion, so you never have to worry about accidental loss.

### 🎞️ Cinematic Stories & 4K Collages
- **Beat-Matched Stories**: Turn any vacation or album into a cinematic video slideshow with smooth Ken-Burns pan/zoom effects and offline musical soundtracks.
- **Instant Collages**: Generate stunning 2K/4K photo grids with customized spacing and aspect ratios in seconds.

### 📄 Documents & Receipts Hub
Automatically separates receipts, tickets, diplomas, and official documents from your personal memories. Extracts searchable text offline so you can search for a receipt or document by the words printed inside it.

---

## 🚀 Getting Started in 3 Simple Steps

1. **Install SecurePhotos**:
   Run the desktop installer (`SecurePhotos_0.1.0_x64-setup.exe`). You can choose your main computer drive or select an external SSD.
2. **Import Your Photos**:
   Click **Import Photos** on the top toolbar. Select any folder, memory card, or drive. SecurePhotos will automatically organize them by date.
3. **Enjoy & Organize**:
   Explore your timeline, create custom albums, name faces in the **People** tab, or lock sensitive items into your **Private Vault**.

---

## ⌨️ Effortless Keyboard Shortcuts

Navigate your entire collection without taking your hands off the keyboard:

| Shortcut | Action | Where It Works |
| :---: | :--- | :--- |
| `J` / `→` | **Next Photo** | Photo Grid & Fullscreen Lightbox |
| `K` / `←` | **Previous Photo** | Photo Grid & Fullscreen Lightbox |
| `Space` | **Quick Preview / Play Video** | Anywhere |
| `F` | **Toggle Favorite Star** | Anywhere |
| `L` | **Lock to Private Vault** | Fullscreen Lightbox & Photo Grid |
| `Delete` | **Move to 30-Day Trash** | Anywhere |
| `T` | **Switch Dark 🌙 / Light ☀️ Theme** | Anywhere |
| `Ctrl + K` | **Open Instant Search** | Anywhere |
| `Ctrl + I` | **View Camera & EXIF Details** | Fullscreen Lightbox |
| `Escape` | **Close View / Clear Selection** | Anywhere |

---

## 🛡️ The SecurePhotos Privacy Promise

1. **Your Photos Are Yours**: Your pictures are stored in standard formats on your own drive. You are never locked in.
2. **Zero Internet Dependency**: The application functions 100% identically whether you are connected to the internet or in airplane mode in the middle of nowhere.
3. **Zero Data Harvesting**: We do not collect analytics, email addresses, error logs, or usage metrics.

---

## 📚 Documentation & Guides

- 🛠️ [**Developer Guide**](docs/development.md): Environment setup, running locally, and build commands.
- 📐 [**System Architecture**](docs/architecture.md): High-level system design, FastAPI sidecar, and offline AI inference.
- 🗄️ [**Database Schema**](docs/database_schema.md): SQLite WAL setup, indexes, and search architecture.
- 🎨 [**Design System**](docs/design_system.md): Visual design tokens, dark/light themes, and 60fps virtualization.
- 🚀 [**Product Roadmap**](docs/roadmap.md): Planned features, multi-vault capabilities, and future companion apps.
- 🔒 [**Security Policy**](SECURITY.md): Cryptography design, threat model, and vulnerability reporting.
- 🤝 [**Contributing Guide**](CONTRIBUTING.md): How to contribute, report issues, and propose improvements.
- 📜 [**Changelog**](CHANGELOG.md): Version history and release notes.

---

## 📄 License, User Ownership & Liability Disclaimer

### 1. 100% User Media Ownership
**You own your photos and videos.** SecurePhotos, its developers, and contributors claim **zero** ownership, title, copyright, license, or control over any photos, videos, or documents imported into or managed by the app. Your personal content belongs entirely to you.

### 2. Software License (MIT)
SecurePhotos is released as free software under the **[MIT License](LICENSE)**.

### 3. Limitation of Liability & Zero Liability for Data or Quality Loss
The software is provided **"AS IS"**, without warranty of any kind. 
- Under no circumstances shall the authors, developers, or contributors be liable for any direct, indirect, incidental, or consequential damages resulting from the use of this software.
- This includes, but is not limited to: **any loss of original photos/videos, alteration or loss of visual quality, compression artifacts, accidental deletions, external drive corruption, hardware failures, or unrecoverable media due to forgotten vault passwords or lost recovery phrases.**
- **User Backup Obligation**: Users are solely responsible for maintaining independent, regular backups of all original media files on separate storage devices before using this application.

