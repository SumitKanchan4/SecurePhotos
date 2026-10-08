# 🎨 SecurePhotos: UI/UX Design System & Performance Specification

> **Enterprise-grade, crisp, and high-performance design system supporting dual Dark & Light themes, fluid lightboxes with 4K AI split-sliders, Stories & Ken-Burns beat-synced player, 4K Collage Maker, Multi-Slot Zero-Trust Vault unlock, Full Album Vault migration, Frosted Privacy Shields, external drive status indicators, and 60fps virtualized scrolling across 100,000+ media assets.**

---

## 1. Design Philosophy & Aesthetic Guidelines

SecurePhotos 2.0 is built around **visual clarity, immediate responsiveness, and zero distraction**:
- **Content-First Imagery**: Backgrounds and UI Chrome recede so photos, videos, and documents take center stage.
- **Crisp Typography**: High-legibility modern sans-serif typography (`Inter` for UI, `JetBrains Mono` for metadata/hashes).
- **Subtle Glassmorphism & Depth**: Multi-tier elevation using subtle semi-transparent surfaces and borders rather than heavy, muddy drop-shadows.
- **Zero Layout Shifts (CLS = 0)**: Pre-calculated aspect ratio skeletons prevent jarring page jumps during thumbnail streaming.
- **Zero-Trust Intimacy & Privacy**: Total isolation of Vault photos with biometrics (Windows Hello), Authenticator 2FA, Full Album Lock/Unlock, and Frosted Privacy Shields.
- **Nostalgia & Delight**: Automatic Stories with vibe-matched audio, 4K Collages, and Ken-Burns cinematic playback.
- **Intelligent People Management**: Representative Medoid face cards that eliminate tagging fatigue ("Name Once, Tag 1,000 Photos").
- **Drive Resilience & Transparency**: Clear, non-intrusive status indicators for external USB drives, hierarchical sharding status, and background 4K optimization queues.
- **Keyboard-First Ergonomics**: Native desktop productivity with full keyboard navigation across all views.

---

## 2. Design Token System (Dark & Light Themes)

The design system uses CSS custom properties (`var(--token)`), ensuring instant, flicker-free theme switching.

### 2.1 Color Palette & Token Definitions

```css
/* ═════════════════════════════════════════════════════════════════════════
   🌙 DARK THEME (Default): Deep Obsidian & Electric Blue Accents
   ═════════════════════════════════════════════════════════════════════════ */
[data-theme="dark"], :root {
  /* Backgrounds */
  --bg-app: #090a0f;
  --bg-sidebar: #0e1017;
  --bg-surface: #141722;
  --bg-surface-elevated: #1b2030;
  --bg-surface-glass: rgba(20, 23, 34, 0.75);
  
  /* Borders & Dividers */
  --border-subtle: rgba(255, 255, 255, 0.07);
  --border-highlight: rgba(255, 255, 255, 0.14);
  --border-active: #3b82f6;

  /* Typography Colors */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-inverse: #090a0f;

  /* Accent Colors */
  --accent-primary: #3b82f6;
  --accent-primary-hover: #2563eb;
  --accent-glow: rgba(59, 130, 246, 0.25);
  --accent-success: #10b981;
  --accent-warning: #f59e0b;
  --accent-danger: #ef4444;
  --accent-vault: #8b5cf6;
  --accent-vault-glow: rgba(139, 92, 246, 0.25);

  /* Shadows & Elevation */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.65);
  --shadow-lightbox: 0 24px 64px rgba(0, 0, 0, 0.85);
}

/* ═════════════════════════════════════════════════════════════════════════
   ☀️ LIGHT THEME: Crisp Titanium, Frosted Glass & Saturated Accents
   ═════════════════════════════════════════════════════════════════════════ */
[data-theme="light"] {
  /* Backgrounds */
  --bg-app: #f8fafc;
  --bg-sidebar: #f1f5f9;
  --bg-surface: #ffffff;
  --bg-surface-elevated: #ffffff;
  --bg-surface-glass: rgba(255, 255, 255, 0.82);

  /* Borders & Dividers */
  --border-subtle: rgba(15, 23, 42, 0.08);
  --border-highlight: rgba(15, 23, 42, 0.16);
  --border-active: #2563eb;

  /* Typography Colors */
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --text-inverse: #ffffff;

  /* Accent Colors */
  --accent-primary: #2563eb;
  --accent-primary-hover: #1d4ed8;
  --accent-glow: rgba(37, 99, 235, 0.15);
  --accent-success: #059669;
  --accent-warning: #d97706;
  --accent-danger: #dc2626;
  --accent-vault: #7c3aed;
  --accent-vault-glow: rgba(124, 58, 237, 0.15);

  /* Shadows & Elevation */
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.12);
  --shadow-lightbox: 0 24px 64px rgba(15, 23, 42, 0.25);
}

/* ═════════════════════════════════════════════════════════════════════════
   📏 GEOMETRY & TYPOGRAPHY TOKENS (Universal)
   ═════════════════════════════════════════════════════════════════════════ */
:root {
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-full: 9999px;

  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;

  --transition-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 320ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 3. Screen Structure & Layout Anatomy

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [TitleBar] 🔒 SecurePhotos  |  🔍 Search photos, docs, tags... (Ctrl+K)   |  [_] [□] [✕] │
├──────────────┬─────────────────────────────────────────────────────────────────────────┤
│ [Sidebar]    │ [Page Header] Photos  •  12,482 items  •  💾 External Drive (E:) [Online]│
│              ├─────────────────────────────────────────────────────────────────────────┤
│ 📸 Photos    │ [Stories Carousel Bar] ✨ Alice Through the Years | 🎂 On This Day...   │
│ 📁 Albums    ├─────────────────────────────────────────────────────────────────────────┤
│ 👥 People    │ [Timeline Filter Bar] 2026 | 2025 | 2024 | 2023 | All                    │
│ 📄 Documents ├─────────────────────────────────────────────────────────────────────────┤
│ 🔍 Insights  │ [Virtualized Media Grid (60 FPS)]                                       │
│ 🔐 Vault     │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│ 🗑️ Trash    │  │ Photo 1 │ │ Photo 2 │ │ Photo 3 │ │ Photo 4 │ │ Photo 5 │ │ Photo 6 ││
│ ⚙️ Settings  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
│ ───────────  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│ ⚡ 4K AI Ready│  │ Photo 7 │ │ Photo 8 │ │ Photo 9 │ │Photo 10 │ │Photo 11 │ │Photo 12 ││
│              │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
└──────────────┴─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Virtualization Architecture (60 FPS Performance)

To ensure rendering **100,000+ photos** never degrades frame rates:

1. **Virtual Windowing via `@tanstack/react-virtual`**:
   - The scroll container dynamically calculates the viewport height.
   - Only cards currently in the viewport (+ an overscan buffer of 2 rows above and below) are instantiated in the React virtual DOM.
2. **Progressive Thumbnail Blur-Up**:
   - Step 1: Render an aspect-ratio container with a neutral shimmering skeleton (`--bg-surface-elevated`).
   - Step 2: Request low-resolution 256px WebP thumbnail (~15 KB).
   - Step 3: Fade in smoothly via CSS opacity transition (`opacity: 0 -> 1` over `150ms`).
3. **Decoupled Selection & State**:
   - Multi-selection state (range select with `Shift + Click`, individual toggle with `Ctrl + Click`) is managed via a high-speed `Set<number>` in a localized Zustand store to prevent global grid re-renders.

---

## 5. Multi-Slot Zero-Trust Vault & Privacy Screens

### 5.1 Multi-Option Vault Unlock Modal
```
┌────────────────────────────────────────────────────────────────────────┐
│ 🔐 Unlock Private Vault                                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│       [ 👆 Touch Fingerprint Sensor or use Windows Hello ]             │
│                                                                        │
│                      ─── OR ENTER PIN / PASSWORD ───                   │
│                                                                        │
│ PIN / Password: [ ••••••••••••              ]                          │
│ Authenticator 2FA (TOTP): [ 482 910 ]                                  │
│                                                                        │
│      [ Unlock Vault ]         [ 🔑 Forgot Password? Use Recovery Key ] │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Full Album Vault Migration & Decryption (`Move In / Move Out`)
- **Move Full Album to Vault**: In public album context menu `(...)` ➔ click **"🔒 Move Album to Vault"**. Encrypts all photos, removes album from public view, and places it inside the Vault.
- **Restore Album from Vault**: Inside the Vault ➔ click **"🔓 Decrypt & Restore to Public Library"** to return all photos and album metadata to the public timeline.

### 5.3 Batch Vault Optimizer & Frosted Privacy Shield
- During active batch vault 4K enhancement, the lock timer is extended until completion.
- If the user switches windows or steps away, the app displays a **Frosted Glass Privacy Shield**:
```
┌────────────────────────────────────────────────────────────────────────┐
│ 🔒 Vault Active: Optimizing to 4K in RAM...                            │
│ [████████████████░░░░░░░░░░░░] 240 / 500 items (48%)                   │
│                                                                        │
│ [ 🛑 Stop & Lock Now ]         (Auto-locks immediately on completion)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Automatic Stories, Beat-Matched Player & 4K Collage Maker

### 6.1 Stories Hub Carousel (Home / Insights)
- Displays top curated stories filtered to **Close Ones (Affinity Score > 65)**:
  * *🌟 Alice: Through the Years (2012 - 2026)*
  * *🎂 On This Day: 5 Years Ago*
  * *✈️ Paris Summer Trip with Alice & Bob*

### 6.2 Cinematic Beat-Matched Story Player Modal
- **Vibe-Matched Music**: Plays loopable ambient tracks matching the emotional mood of the scene, with cuts synchronized to music downbeats.
- **1-Click Video Export**: Renders a lightweight, visually lossless 4K 60fps MP4 file in seconds.

### 6.3 Smart 4K Mosaic Collage Generator
- Selected photos in the grid can trigger **"🎨 Create 4K Collage"**.
- Offers Treemap layout options (2x2, Hero-Grid, Polaroid Mosaic) with face-aware cropping to avoid cutting heads.
- Exports to high-res printable 4K AVIF/PNG.

---

## 7. People & Face Management (Representative Medoid System)

### 7.1 "Name Once, Tag 1,000 Photos" Representative Medoid Card
In the **👥 People** view, unsupervised clusters are surfaced using 3-4 diverse anchor medoids (portrait, side-profile, outdoor, sunglasses):

```
┌────────────────────────────────────────────────────────────────────────┐
│ 👥 Who is this person?                                                 │
├────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ [Face 1] │  │ [Face 2] │  │ [Face 3] │  │ [Face 4] │  (+996 others) │
│  │ Portrait │  │ Profile  │  │ Outdoor  │  │ Glasses  │                │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                │
│                                                                        │
│ Name: [ Alice                   ]   [✓ Confirm & Tag 1,000 Photos]     │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Social Affinity Badge & Relationship Customizer
- On Alice's profile: `⭐ Close One (Affinity: 94/100)` | `Relationship: [ Daughter ▼ ]`.
- Toggle: `[x] Generate Automatic Stories & Milestones for Alice`.

---

## 8. Ingestion Modals, External Drive & Settings UI

### 8.1 Interactive Import Confirmation Modal (Mode A: Managed Import)
```
┌────────────────────────────────────────────────────────────────────────┐
│ 📥 Import Media to External Vault                                      │
├────────────────────────────────────────────────────────────────────────┤
│ Found 1,420 files (42.6 GB) • Estimated 4K Space: ~14.8 GB (-65%)     │
│ Target Path: E:\.securephotos_library\originals\YYYY\MM\DD\           │
│                                                                        │
│ 🧹 Source File Cleanup Option:                                         │
│ ( ) Keep Source Files (Copy only: originals remain untouched)         │
│ (●) Move & Free Source (Deletes from SD Card/Phone after SHA-256 verify)│
│                                                                        │
│ ⚙️ Optimization & Deduplication:                                       │
│ [x] Skip duplicate files already present in library                    │
│ [x] Convert to visually lossless 4K AVIF/AV1 in background             │
│                                                                        │
│                    [ Cancel ]        [ Start Import ]                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Disconnection / Reconnection Banners
- **Active / Online**: Clean subtle pill in header: `💾 Samsung T7 (E:) • 420 GB free`.
- **Sudden Disconnection**: Non-blocking toast + floating frosted glass banner:
  > `⚠️ External Storage Disconnected (Volume: MediaVault-2026). Processing queues paused safely without data loss. Reconnect drive to resume.`
- **Auto-Reconnection**: Banner clears automatically and resumes pending import/optimization tasks within 500ms of drive detection.

---

## 9. Comprehensive Keyboard Shortcuts

| Shortcut | Action | Scope |
|---|---|---|
| `Ctrl + K` / `Cmd + K` | Focus Global Hybrid Search Box | Global |
| `J` / `ArrowRight` | Next Photo / Next Story Slide | Grid / Lightbox / Stories |
| `K` / `ArrowLeft` | Previous Photo / Previous Story Slide | Grid / Lightbox / Stories |
| `Space` | Toggle Quick Look / Play & Pause Story | Grid / Stories |
| `E` | Trigger 4K AI Enhancement / Split-Slider | Lightbox |
| `F` | Toggle Favorite | Grid / Lightbox |
| `L` | Move Selected Photo/Album to Vault | Grid / Lightbox / Albums |
| `U` | Move Selected Photo/Album Out of Vault | Vault |
| `Delete` / `Backspace` | Move to Trash (Soft Delete) | Grid / Lightbox |
| `Ctrl + A` | Select All Visible Photos in Section | Grid |
| `Ctrl + I` | Toggle EXIF Info Drawer | Lightbox |
| `T` | Toggle Theme (Light / Dark) | Global |
| `Esc` | Close Lightbox / Clear Selection / Close Modal | Global |
