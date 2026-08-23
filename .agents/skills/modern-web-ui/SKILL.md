---
name: modern-web-ui
description: >-
  Enterprise UI/UX design standards for high-scale media applications. Enforces 60fps virtualized scrolling (@tanstack/react-virtual), pure CSS design tokens, fluid lightboxes, zero layout shifts (CLS=0), keyboard navigation (J/K/Space), and sleek dark-mode aesthetics.
---

# 🎨 Modern Web UI & Virtualization Skill

This skill enforces enterprise-grade UI/UX design, aesthetic excellence, and high-performance virtualization standards for high-scale photo/media desktop applications.

---

## 1. Core Performance & Virtualization Rules

### A. Mandatory Virtual Windowing for Media Grids
- When rendering collections of photos, albums, or documents, **never render unbounded DOM elements**.
- Always use `@tanstack/react-virtual` (or `react-window`) to ensure only the **~30 visible items** are mounted in the DOM.
- Keep DOM node count flat, even when browsing 100,000+ items.

```jsx
// Example: High-Performance Virtualized Grid
import { useVirtualizer } from '@tanstack/react-virtual';

const rowVirtualizer = useVirtualizer({
  count: rowCount,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 220, // Row height in px
  overscan: 5,
});
```

### B. Zero Layout Shift (CLS = 0)
- Always render an aspect-ratio placeholder skeleton (`background: var(--surface-secondary)`) while thumbnails load.
- Thumbnails must load progressively with an instantaneous blur-up / CSS transition.

---

## 2. Design System & CSS Tokens

Avoid arbitrary Tailwind classes or inline styles. All styles must map to the CSS design token system:

```css
:root {
  --bg-app: #090a0f;
  --bg-surface: #12141c;
  --bg-surface-elevated: #1a1d29;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-highlight: rgba(255, 255, 255, 0.16);
  --accent-primary: #3b82f6;
  --accent-glow: rgba(59, 130, 246, 0.25);
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 18px;
}
```

---

## 3. Micro-Interactions & Keyboard Ergonomics

- **Keyboard First**:
  - `J` / `ArrowRight`: Next photo.
  - `K` / `ArrowLeft`: Previous photo.
  - `Space`: Quick Look / Preview overlay.
  - `F`: Toggle favorite.
  - `L`: Move to vault / lock.
  - `Esc`: Close lightbox or modal.
- **Micro-Animations**:
  - Lightbox zoom in/out with CSS transform `scale(0.95) -> scale(1)` over `180ms ease-out`.
  - Smooth card hover lift (`transform: translateY(-2px)`).
