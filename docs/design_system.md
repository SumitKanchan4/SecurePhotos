# SecurePhotos design system

The look and behaviour of the SecurePhotos app, as built in the 2026 redesign (Mono + acid lime). Use it when changing a screen or adding one. The source of truth is the code: tokens live at the top of [`src/index.css`](../src/index.css), and every screen has its own class prefix there. The reasons behind each decision are in `.agents/history/features_and_functional_decisions.md` (§123–135).

---

## 1. Principles

- **Photos first.** The interface is black, white and grey so the photos carry the colour. The only other colour is one neon accent.
- **One strong action per screen.** It is the lime button ("+ Import", "+ Add photos", "Restore"). Everything else is an outline or an icon.
- **Rare actions behind "…".** Rename, cover, Move to Vault and Delete sit in one menu, so pages stay calm.
- **Ask before anything that can't be undone.** Deleting for good, emptying Trash, erasing the vault, deleting an album, removing a song and compressing videos all open a `ConfirmDialog`. Actions that Trash can undo for 30 days don't ask.
- **No hidden filters.** Whatever narrows a page is visible on that page. Search is its own page and never filters other screens.
- **Plain words.** Say what will happen in the user's terms: "Remove 2 copies", "The original is in Trash for 30 days.", "some of its photos aren't on this computer". Avoid technical terms ("FastAPI sidecar", "Lanczos", "On-Device Vision") and features the app doesn't have.
- **Say only what is true.** No badges or claims for things the app doesn't do (for example, nothing blurs the vault automatically when the window loses focus; the privacy shield is a button and the P key).
- **Private stays private.** Vault items never show a name, path, picture or face outside the unlocked vault. Trash shows them as "Private Vault item" with a lock tile.

---

## 2. Colour tokens

Always use the CSS custom properties, never hex values in components. The theme is set by `data-theme="dark" | "light"` on `<html>`. Dark is the default.

### 2.1 The accent: one neon, three roles

Lime `#C6FF00` is unreadable as text on a light background, and white text on lime fails contrast. So the accent is split into roles:

| Token | Dark | Light | Use |
|---|---|---|---|
| `--accent-fill` | `#c6ff00` | `#c6ff00` | Primary buttons, active pills, progress bars, focus rings, selection rings |
| `--accent-fill-hover` | `#d4ff3d` | `#b8f000` | Hover on a fill |
| `--on-accent` | `#0a0a0a` | `#0a0a0a` | Text and icons **on** the fill (always black) |
| `--accent-ink` | `#c6ff00` | `#0a0a0a` | The accent used **as** text or icon colour |
| `--accent-primary` | → `--accent-ink` | → `--accent-ink` | Old name, kept for existing components |
| `--rail-active-bg` / `-fg` | lime / black | black / white | Current section in the icon rail |

Rules:
- Lime is a fill in both themes. As text, use `--accent-ink`. Never put lime text on a light background.
- Tints are `color-mix(in srgb, var(--accent-ink) N%, transparent)`, not new colours.
- Only one neon. Don't add blue, purple or gradients. The vault accent (`--accent-vault`) is the same ink.

### 2.2 Neutrals

| Token | Dark | Light |
|---|---|---|
| `--bg-app`, `--bg-sidebar` | `#0a0a0a` | `#fafafa` |
| `--bg-surface` | `#171717` | `#ffffff` |
| `--bg-surface-elevated` | `#1c1c1c` | `#ffffff` |
| `--text-primary` | `#f5f5f5` | `#0a0a0a` |
| `--text-secondary` | `#a3a3a3` | `#525252` |
| `--text-muted` | `#8a8a8a` | `#6b6b6b` |
| `--border-subtle` / `--border-highlight` | white 8 % / 16 % | black 8 % / 16 % |
| `--glass-border` / `--glass-border-highlight` | white 10 % / 16 % | black 12 % / 18 % |
| `--glass-pill-bg` / `-hover` / `-active` | white 6 / 11 / 18 % | black 4 / 8 / 12 % |

`--text-muted` is tuned to pass contrast on `--bg-surface` in both themes; don't go lighter (dark) or darker (light).

The `--glass-*` names come from the old design and are kept because many components use them. They are now solid-looking surfaces, not frosted glass.

### 2.3 Status colours

| Token | Dark | Light | Use |
|---|---|---|---|
| `--accent-success` | `#c6ff00` | `#3d7a00` | Done, connected, healthy |
| `--accent-warning` | `#f5a524` | `#b45309` | Last days in Trash, last 30 s before the vault locks, engine starting |
| `--accent-danger` | `#ff6b6b` | `#c42b2b` | Delete forever, Erase, engine or drive problem |

Danger is for outline buttons and text. It is never the strongest button on a screen. "Lock now" is high-contrast (text colour on background colour), not red, because locking is safe.

### 2.4 Viewer surround

The photo viewer is dark in **both** themes so colours look true: `--lightbox-backdrop` is `rgba(10,10,10,.97)` in both, and the toolbar and nav tokens are dark in both. Only the details panel follows the app theme (the viewer root carries `data-theme="dark"`, the panel carries the app theme).

---

## 3. Type, shape and motion

| Token | Value | Use |
|---|---|---|
| `--font-display` | Archivo | Page titles, big numbers, month headings |
| `--font-sans` | Inter | Everything else |
| `--font-mono` | JetBrains Mono | Small counters, key hints, technical values |

All three fonts are bundled through `@fontsource/*` (the app works offline). The emergency-card renderer also draws with Archivo.

Type scale used across screens:
- **Page title** (`.dash-title`): Archivo 30 px, weight 900, letter-spacing −0.035em.
- **Big number** (`.dash-count-value`): Archivo 22 px, 900.
- **Card heading**: Inter 15 px, 800.
- **Body / muted** (`.dash-muted`): 13 px, `--text-secondary`, line-height 1.45.
- **Subtitle / meta** (`.dash-subtitle`): 12 px, 600.

Shape:
- Radii are `--radius-xs` 4, `-sm` 8, `-md` 12, `-lg` 18 and `-full`. Cards use 14–18 px. Buttons, pills and icon buttons are fully round.
- Borders are 1 px `--glass-border`, with hover going to `--glass-border-highlight`. Shadows are rare; separate things with borders and surfaces.

Motion:
- `--transition-fast` 120 ms, `-normal` 200 ms, `-smooth` 320 ms.
- **Reduce motion** in Settings sets `data-reduce-motion="true"` on `<html>`, which turns animations and transitions off app-wide. Check new animations with it on.

---

## 4. App shell

```
┌────┬─────────────────────────────────────────────── 32 px window strip ──┐
│logo│  (drag area)                                 ☾   _  □  ✕          │
│ 🔍 ├───────────────────────────────────────────────────────────────────────┤
│ ▣  │  Photos  1,218 photos  (Importing · 12 of 60)        🔍  [+ Import] │
│ ✦  │                                                                   2026│
│ ▤  │  May 2026 · 412  ○                                                 ·  │
│ 👥 │  ┌──────┐┌────────────┐┌─────┐┌──────────┐                          ·  │
│ ▢  │  │      ││            ││     ││          │   justified rows         ━  │ ← month/year
│ 🔒 │  └──────┘└────────────┘└─────┘└──────────┘                          ·  │   scrubber
│ ── │                                                                   2025│
│ ▦  │  April 2026 · 96  ○                                                 ·  │
│ 🗑 │  …                                                                    │
│ ⚙  │                                                                       │
│ ●  │ ← status dot                                                          │
└────┴───────────────────────────────────────────────────────────────────────┘
 64 px icon rail
```

- **App icon**: `src/assets/brand/app-icon.svg` (the chosen "C · Frosted glass, photos + lens") at every size; `scripts/render_app_icons.py` renders `src-tauri/icons/*` from it.
- **Icon rail** (`IconRail.tsx`, `.rail-*`), 64 px. From the top: logo, search, then Photos, Stories, Albums, People, Documents, Private Vault, a divider, then Dashboard, Trash and Settings.
  - Buttons are 44 × 44 with a 14 px radius. Hover labels come from `data-label` in pure CSS. The current section uses `--rail-active-*`.
  - The **status dot** at the bottom is lime when ready, amber while the engine starts, and red for a missing drive or an engine problem. Its reason shows on hover, and a click opens Settings.
- **Window strip** (`WindowStrip.tsx`), 32 px: the drag area, the theme toggle and the window buttons.
- **Search page** (`search/SearchPage.tsx`, `.search-*`): the rail's search icon or Ctrl+K opens it as a section (it is marked current in the rail), with a big field on top.
  - People and albums show as one row, never scrolling sideways. As many as fit the width are shown; when there are more, the last tile is "See all" and opens People or Albums. Results keep their real shapes (justified rows).
  - Before typing, it offers quick searches (Videos, Favourites, Documents, this year and last year), people and albums.
  - After typing, it shows matching people and albums, then the photos and videos in the photo grid (no selection there). A person or album opens its page directly (`openPerson` / `openAlbum` in the store).
  - The text is kept while you look elsewhere. Nothing pops up over other screens, and search never filters another page.
- **Search inside a page** (`ui/InlineSearch.tsx`): Albums, People and Documents have a search icon in their header that opens a small field filtering only that page. Escape or × clears it.

---

## 5. Page anatomy and shared pieces

Every top-level screen follows the same frame:

```
[Title]  [meta · counts]  (status pill while work runs)        [icon buttons] [… menu] [+ Primary]
Section title
  content
```

| Piece | Class / component | Notes |
|---|---|---|
| Page container | `.dash-page` | Scrolls; padding `14px 76px 48px 24px` (the right side leaves room for the scrubber) |
| Header row | `.dash-header`, `.dash-title`, `.dash-subtitle` | |
| Button | `.dash-btn` (36 px, round, outline) | `.dash-btn-small` is 32 px |
| Primary button | `.dash-btn .dash-btn-primary` | Lime fill, black text, weight 800. Use one per screen |
| Icon button | `.dash-icon-btn` (36 px circle) | Always give it an `aria-label` |
| Back to parent | `.dash-back` ("← Dashboard", "← Albums") | Used for sub-pages |
| One-time note | `.dash-note`, `.dash-note-row` (with OK) | |
| Empty state | `.dash-empty` | An icon, a heading and one sentence on what goes here and how to add it |
| Section heading | `.dash-section-title` | |
| Select | `.vid-select` | |
| Dialog | `.alb-dialog-backdrop`, `.alb-dialog`, `.alb-dialog-head` | `role="dialog"`, `aria-modal`, labelled by its heading. Escape and × close it; don't close it while it is saving or uploading |
| Confirmation | `ConfirmDialog` (`src/components/ui/ConfirmDialog.tsx`) | `role="alertdialog"`. The title asks the question ("Delete 3 items forever?"), the message says the consequence, and the confirm label names the action ("Remove song"). Escape or Cancel does nothing |
| Settings rows | `SettingsKit.tsx` (group, row, pill choice) | |
| Page search | `InlineSearch` | Header icon that opens a field filtering only this page (names, words in documents) |
| Toasts | `useAppStore().showToast(text, "success" \| "warning")` | One plain sentence; say what happened and what to do next |

Every focusable control shows `outline: 2px solid var(--accent-fill); outline-offset: 2px` on `:focus-visible`.

### 5.1 The photo grid (`PhotoTimeline`)

One component is used by Photos, the Vault, album pages and Favourites (`src/components/photos/PhotoTimeline.tsx`, layout maths in `src/utils/photoTimeline.ts`, `.timeline-*`):
- **Month sections** with a big heading ("May 2026 · 412") and a circle to select the whole month. Undated photos come last under "No date".
- **Justified rows.** Each full row is scaled to fill the width, and a month's last row is not stretched. Only rows near the screen are rendered (the component does its own windowing).
- **Month/year scrubber** on the right instead of a scrollbar, as on the approved Photos board: a 64 px column with a divider, listing the newest year's months ("Nov", "Oct" …), then one entry per older year ("2025", "2024" …) and "No date", stacked from the top. The entry you are looking at is a lime pill. Click an entry, or press and drag along the list, to jump. When the list doesn't fit, the newest year collapses to one entry (`scrubberEntries`). `minScrubberSections` hides it for short timelines (the Vault uses 4).
- **Tiles** show only a selection circle (on hover), a favourite heart and a "Video" or "Preparing" chip. There are no quality badges; background work shows in the header pill.
- **Selection mode.** Once anything is selected, a click selects instead of opening. Ctrl or Shift + click also selects. Selection lives in `useAppStore` (`selectedPhotoIds`). Screens clear a leftover selection when they open.
- The `vault` prop switches to vault thumbnails and turns selection off.

### 5.2 Selection bar

When items are selected, one floating bar shows: "N selected · Select all · [actions] · ×" (`role="toolbar"`). The most common action comes first (Restore in Trash, Remove from album in an album). Actions that can't be undone come last and ask first. Escape clears the selection.

### 5.3 Cards

| Kind | Where | Shape |
|---|---|---|
| Album cover | Albums | 4:3 cover, then the name and "86 photos · Nov 2026" |
| Made for you | Albums | Big 16:10 covers for Favourites, Saved stories and Collages: a mosaic of up to three photos (one large, two small), a lime badge with the icon, and the name and count underneath |
| Story card | Stories, Albums → Saved stories | Tall 150 × 250, radius 18, title on the photo. Save and Hide appear on hover or keyboard focus |
| Collage idea | Stories | 2 × 2 preview, title and contents, one Save (then Open) |
| Document | Documents | The real page on a white "paper" sheet, title, "Receipts & bills · 9 Nov 2026", a pin and a "…" menu. Documents must never look like photo tiles |
| Face | People | Round crop. Close ones get a lime ring |
| Count tile / job card | Dashboard | `.dash-count`, `.dash-card` |

---

## 6. Screens

| Screen | File(s) | What defines it |
|---|---|---|
| Photos | `App.tsx`, `photos/PhotoTimeline.tsx` | Whole library in one timeline. Header: count, status pill, search (opens the Search page) and "+ Import" |
| Search | `search/SearchPage.tsx`, `search/searchFormat.ts` | Big field; before typing: Try chips, People, Albums; after: matching people and albums, then results in the photo grid. Keywords (videos, favourites, documents, a year or month) filter rather than match text |
| Viewer | `Lightbox.tsx`, `viewer/viewerFormat.ts` | Dark surround. Top bar: Back, the title with an 8K / 4K / HD chip, and date · "41 of 12,480". Actions: Favourite, Download (menu: the file, or a print-ready 300 dpi copy), Details; then, after a divider, Trash and the lime lock (Move to Vault, or Restore for a vault photo). A filmstrip of nine. Details are hidden each time the viewer opens. Zoom with double-click, Ctrl + wheel or + / − / 0 |
| Stories | `StoriesView.tsx`, `stories/*` | Header with Story music (icon) and Make new stories. Rows: For you, Saved, Collage ideas (6 first, then "Show more ideas") |
| Albums | `AlbumsView.tsx`, `albums/*` | Made for you, then Your albums as covers. Album page: "← Albums", Slideshow, "+ Add photos", and a "…" menu (Rename, Choose cover photo, Move album to Vault, Delete album) |
| People | `PeopleView.tsx`, `people/PeopleOverview.tsx` | Close ones on top, "Same person?" (one suggestion at a time), Everyone, and "Who is this?" naming cards (six first). Rename on the person page |
| Documents | `DocumentsView.tsx`, `documents/*` | Category chips with counts, Pinned first, paper cards, Find in photos, "+ Add". Vault documents never appear |
| Private Vault | `VaultView.tsx`, `vault/*` | Locked: one centred card with PIN boxes, "Use master password instead" and the Emergency Card link. Unlocked: "● Unlocked · locks in 4:58" (amber in the last 30 s), a privacy-shield button (P), Lock now, and Photos / Albums / Documents tabs |
| Dashboard | `DashboardView.tsx`, `dashboard/*` | Five count tiles; Storage: a drive bar (SecurePhotos, other files, free) and "What SecurePhotos uses" rows by kind (`StorageBreakdown`, also in Settings → Storage); job cards (Duplicates, Big videos); Photo enhancement progress |
| Duplicates | `DuplicatesView.tsx` | Sub-page of the Dashboard. The best pick is ticked and ringed ("Keep · best pick"); other copies say "Goes to Trash". Use "Keep the best in all…" (asks first) |
| Big videos | `VideoOptimizerView.tsx` | Sub-page of the Dashboard. "Make smaller" (asks first; the original is deleted once the copy passes a check). "Enhance" to HD, Full HD or 4K (the original goes to Trash for 30 days) |
| Trash | `TrashView.tsx`, `trash/*` | "Deleted this month" sections; each tile shows "12 days left", amber for the last 3 days. Restore is lime; "Delete forever…" and "Empty trash…" are red outlines that ask first |
| Settings | `SettingsView.tsx`, `settings/*` | Sections on the left: Appearance, Photos & AI, Private Vault (with a Danger zone), Storage, About |
| Import | `ImportModal.tsx`, `import/*` | Before: a drop area, a summary of the selection with duplicates counted, and a Move switch that is off by default. While importing: progress with Stop import and Hide (the import keeps going) |

Each screen's pure helpers (wording, dates, counts) live next to it in a `*Format.ts` file with unit tests. Date spans read "12 Nov 2025", "Nov 2026", "Oct – Dec 2025" or "2019 – 2026".

---

## 7. Keyboard

| Keys | Action | Where |
|---|---|---|
| Ctrl + K | Open the Search page and focus its field | Everywhere, even while typing |
| T | Switch light / dark | Everywhere (not while typing) |
| L | Lock the vault | Everywhere while it is open |
| Esc | Close the top menu or dialog, then clear the selection (in a search field: clear it) | Everywhere |
| ← / → or K / J | Previous / next photo | Viewer |
| F | Favourite (P pins a document) | Viewer |
| I or Ctrl + I | Show or hide details | Viewer |
| L | Move to Vault (or restore) | Viewer |
| Delete / Backspace | Move to Trash | Viewer |
| + / − / 0 | Zoom in / out / reset | Viewer (photos) |
| ↑ / ↓, M | Volume, mute | Viewer (videos) |
| P | Privacy shield | Private Vault |
| Space, ← / → | Play or pause, previous / next | Story player, slideshow |
| Enter / Space | Open or select the focused photo | Photo grid |

The app-wide keys (T, L, Esc) are ignored while typing in an input or text box. New shortcuts need the same guard.

---

## 8. Checking a change

- **Both themes.** Look at every changed screen in dark and light.
- **Contrast scan.** The Playwright check looks for light text on lime fills and lime text in the light theme. Both must come back clean.
- **Throwaway library only.** UI checks run against a library set by `SECUREPHOTOS_DATA_DIR`, never a real one.
- **Tests.** Component tests sit next to each screen (`*.test.tsx`), and helpers have unit tests. A change in behaviour needs a test that fails without it.
- **No new hard-coded colours.** Use the tokens in §2. If something truly needs a new token, add it to both theme blocks in `src/index.css` and to this document.
