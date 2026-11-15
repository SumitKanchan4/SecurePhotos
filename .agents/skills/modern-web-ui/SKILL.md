---
name: modern-web-ui
description: >-
  UI standards for SecurePhotos screens (Mono + acid lime redesign): CSS tokens only (lime as a fill with black text, --accent-ink as text), Archivo titles over Inter, the icon-rail shell, the shared page header and buttons, the PhotoTimeline grid for photos, ConfirmDialog for anything that can't be undone, plain wording, both themes and the contrast check. Use when building or changing any frontend screen.
---

# Modern web UI (SecurePhotos)

The full specification is [`docs/design_system.md`](../../../docs/design_system.md). Read it before changing a screen. This skill holds the rules that are easiest to get wrong.

## 1. Colour
- Use the tokens in `src/index.css`; no hex values, gradients or new accent colours in components.
- One neon: `--accent-fill` (lime) is a **fill** with `--on-accent` (black) text on it, in both themes. For the accent as text or an icon, use `--accent-ink` (lime in dark, near-black in light). Never put lime text on a light background, and never put white text on lime.
- Tints are `color-mix(in srgb, var(--accent-ink) N%, transparent)`.
- Red (`--accent-danger`) is for outline buttons and text on irreversible actions, never the main button. The viewer surround is dark in both themes.

## 2. Layout and pieces
- Every screen sits in the icon-rail shell (`src/components/shell/*`). Pages use `.dash-page` with a header row: Archivo title (`.dash-title`, 30 px / 900), a meta line, a status pill only while work runs, icon buttons, a "…" menu for rare actions, and **one** lime primary button (`.dash-btn .dash-btn-primary`).
- Sub-pages get a `.dash-back` pill ("← Albums").
- Photos are always shown with `PhotoTimeline` (month sections, justified rows, scrubber, own windowing). Don't add another photo grid or a virtual-list library.
- Dialogs use `.alb-dialog*` with `role="dialog"`, `aria-modal` and a labelled heading. Irreversible actions use `ConfirmDialog` (`role="alertdialog"`; the title asks, the message says the consequence, and the button names the action). Actions that Trash can undo for 30 days don't ask.
- Icon-only buttons need an `aria-label`. Every control shows the lime `:focus-visible` outline.

## 3. Wording
- Plain words that say what will happen ("Remove 2 copies", "The original is in Trash for 30 days."). No technical terms, and no claims about features the app doesn't have.
- Each screen keeps its wording, date and count helpers in a tested `*Format.ts` next to it.

## 4. Keyboard
- App-wide: Ctrl+K search, T theme, L lock the vault, Esc closes the top menu or dialog, then clears the selection. Viewer: arrows or J/K, F, I, L, Delete, + / − / 0. Guard new shortcuts so they don't fire while typing in an input.

## 5. Checking
- Look at every changed screen in dark **and** light on a throwaway library (`SECUREPHOTOS_DATA_DIR`), and run the contrast scan (no light text on lime, no lime text in light). Component tests sit next to the screen and must fail without the change.
- Respect Reduce motion (`data-reduce-motion="true"` turns animation off).
