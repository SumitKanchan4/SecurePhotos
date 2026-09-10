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

---

## 4. Mandatory Unified Header & Drilldown Design Standard

Whenever designing, building, or refactoring drill-down views (e.g. Album Detail, Person Detail, Category Detail, Vault views) or major view headers, **ALWAYS adhere strictly to this design standard**:

### A. Balanced 3-Column Layout
Never use a simple `justify-content: space-between` with asymmetrical items that causes the title to drift off-center. Always use a balanced 3-column flex layout:
1. **Left Column (`flex: 1`, `justifyContent: "flex-start"`, `minWidth: "120px"`)**:
   - Navigation / Back button styled as a frosted pill (`var(--radius-full)`):
     - Background: `rgba(255, 255, 255, 0.06)`, border: `1px solid rgba(255, 255, 255, 0.1)`.
     - Icon + label (e.g. `<ArrowLeft size={14} /> <span>All Albums</span>`).
2. **Center Column (`flex: "0 1 auto"`, `display: "flex"`, `alignItems: "center"`, `justifyContent: "center"`, `gap: "10px"`)**:
   - **Display Title**:
     - Modern geometric font: `var(--font-display)` (**Plus Jakarta Sans**, fallback Inter).
     - Size: `22px`–`24px`, weight: `800` (bold), tracking: `letterSpacing: "-0.03em"`.
     - Color: `#ffffff` with subtle text shadow `0 2px 10px rgba(0, 0, 0, 0.35)`.
   - **Inline Frosted Capsule Count Badge**:
     - Placed on the **same horizontal baseline** right next to the title (never stacked as an awkward subtitle).
     - Style: `padding: "3px 10px"`, `borderRadius: "var(--radius-full)"`, `backgroundColor: "rgba(255, 255, 255, 0.08)"`, `border: "1px solid rgba(255, 255, 255, 0.12)"`, `backdropFilter: "blur(8px)"`, `fontSize: "12px"`, `fontWeight: 600`, `color: "var(--text-secondary)"`.
3. **Right Column (`flex: 1`, `display: "flex"`, `alignItems: "center"`, `justifyContent: "flex-end"`, `gap: "10px"`, `minWidth: "120px"`)**:
   - Primary and secondary actions styled with pill geometry (`var(--radius-full)`).
   - Slideshow trigger: Vibrant gradient `linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)` with ambient glow `0 3px 12px rgba(99, 102, 241, 0.35)`.
   - Secondary actions (Add, Filter, Delete): Frosted glass or primary pills.

### B. Glassmorphic Container Specifications (Dual-Theme macOS Pure Liquid Glass)
- **Background**: `var(--glass-surface)` (Theme-reactive: `rgba(255, 255, 255, 0.78)` in Light mode / `rgba(18, 20, 29, 0.82)` in Dark mode). NEVER hardcode dark `rgba(23, 23, 23, ...)`.
- **Backdrop Blur**: `backdropFilter: "blur(24px)"`, `WebkitBackdropFilter: "blur(24px)"`.
- **Border**: `1px solid var(--glass-border)`.
- **Corner Curvature**: `borderRadius: "var(--radius-lg)"` (18px floating bar).
- **Elevation**: `boxShadow: "var(--glass-shadow)"`.
- **Title Color**: `color: "var(--text-primary)"` (Crisp dark in Light mode / white in Dark mode).
- **Badge**: `backgroundColor: "var(--glass-badge-bg)"`, `border: "1px solid var(--glass-badge-border)"`.
- **Dimensions & Spacing**: `minHeight: "56px"`, `padding: "10px 20px"`.
- **Positioning**: `position: "sticky"`, `top: 0`, `zIndex: 20`, `flexShrink: 0`.

