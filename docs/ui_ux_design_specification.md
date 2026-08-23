# 🎨 SecurePhotos 2.0 — UI/UX Design System & Performance Specification

> **Enterprise-grade, crisp, and high-performance design system supporting dual Dark & Light themes, fluid lightboxes, and 60fps virtualized scrolling across 100,000+ media assets.**

---

## 1. Design Philosophy & Aesthetic Guidelines

SecurePhotos 2.0 is built around **visual clarity, immediate responsiveness, and zero distraction**:
- **Content-First Imagery**: Backgrounds and UI Chrome recede so photos, videos, and documents take center stage.
- **Crisp Typography**: High-legibility modern sans-serif typography (`Inter` for UI, `JetBrains Mono` for metadata/hashes).
- **Subtle Glassmorphism & Depth**: Multi-tier elevation using subtle semi-transparent surfaces and borders rather than heavy, muddy drop-shadows.
- **Zero Layout Shifts (CLS = 0)**: Pre-calculated aspect ratio skeletons prevent jarring page jumps during thumbnail streaming.
- **Keyboard-First Ergonomics**: Native desktop productivity with full keyboard navigation across all views.

---

## 2. Design Token System (Dark & Light Themes)

The design system uses CSS custom properties (`var(--token)`), ensuring instant, flicker-free theme switching.

### 2.1 Color Palette & Token Definitions

```css
/* ═════════════════════════════════════════════════════════════════════════
   🌙 DARK THEME (Default) — Deep Obsidian & Electric Blue Accents
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
   ☀️ LIGHT THEME — Crisp Titanium, Frosted Glass & Saturated Accents
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
│ [TitleBar] 🔒 SecurePhotos  |  🔍 Search photos, docs, tags... (Ctrl+K)   |  [—] [□] [✕] │
├──────────────┬─────────────────────────────────────────────────────────────────────────┤
│ [Sidebar]    │ [Page Header] Photos  •  12,482 items  •  Sort: Date Taken (Desc)       │
│              ├─────────────────────────────────────────────────────────────────────────┤
│ 📸 Photos    │ [Timeline Filter Bar] 2026 | 2025 | 2024 | 2023 | All                    │
│ 📁 Albums    ├─────────────────────────────────────────────────────────────────────────┤
│ 👥 People    │ [Virtualized Media Grid (60 FPS)]                                       │
│ 📄 Documents │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│ 🔍 Insights  │  │ Photo 1 │ │ Photo 2 │ │ Photo 3 │ │ Photo 4 │ │ Photo 5 │ │ Photo 6 ││
│ 🔐 Vault     │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
│ 🗑️ Trash    │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│ ⚙️ Settings  │  │ Photo 7 │ │ Photo 8 │ │ Photo 9 │ │Photo 10 │ │Photo 11 │ │Photo 12 ││
│              │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
│ ───────────  │  ... (Only ~30 active DOM nodes mounted at any time via virtualizer)     │
│ ⚡ AI Ready │                                                                         │
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
   - Step 2: Request low-resolution 256px thumbnail.
   - Step 3: Fade in smoothly via CSS opacity transition (`opacity: 0 -> 1` over `150ms`).
3. **Decoupled Selection & State**:
   - Multi-selection state (range select with `Shift + Click`, individual toggle with `Ctrl + Click`) is managed via a high-speed `Set<number>` in a localized Zustand store to prevent global grid re-renders.

---

## 5. Fluid Lightbox & Visual Inspection

- **Transitions**: Lightbox opens with a spring scale animation (`scale(0.92) -> scale(1.0)` with `backdrop-filter: blur(16px)`).
- **Deep Zoom & Pan**: Smooth mouse-wheel zooming up to 400% with CSS `transform: translate3d(...)` and double-click to reset.
- **EXIF Inspector Sidebar**: Collapsible slide-over drawer (`Ctrl + I`) showing:
  - Histogram & color profile
  - Camera make, model, lens, focal length, aperture ($f$), ISO, shutter speed
  - Geolocation mini-map (if GPS coordinates are present)
  - Face tags & detected AI objects/text
  - Cryptographic file hash & storage location

---

## 6. Comprehensive Keyboard Shortcuts

| Shortcut | Action | Scope |
|---|---|---|
| `Ctrl + K` / `Cmd + K` | Focus Global Hybrid Search Box | Global |
| `J` / `ArrowRight` | Next Photo | Grid / Lightbox |
| `K` / `ArrowLeft` | Previous Photo | Grid / Lightbox |
| `Space` | Toggle Quick Look / Lightbox | Grid |
| `F` | Toggle Favorite | Grid / Lightbox |
| `L` | Move Selected to Encrypted Vault | Grid / Lightbox |
| `Delete` / `Backspace` | Move to Trash (Soft Delete) | Grid / Lightbox |
| `Ctrl + A` | Select All Visible Photos in Section | Grid |
| `Ctrl + I` | Toggle EXIF Info Drawer | Lightbox |
| `T` | Toggle Theme (Light / Dark) | Global |
| `Esc` | Close Lightbox / Clear Selection / Close Modal | Global |
