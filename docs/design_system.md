# SecurePhotos design system

The look and behaviour of the SecurePhotos app, as built in the 2026 redesign (Mono + acid lime). Use it when changing a screen or adding one. The source of truth is the code: tokens live at the top of [`src/index.css`](../src/index.css), and every screen has its own class prefix there. The reasons behind each decision are recorded in `.agents/history/features_and_functional_decisions.md`.

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
- Radii are `--radius-xs` 4, `-sm` 8, `-md` 12, `-lg` 18 and `-full`. Cards use 14 to 18 px. Buttons, pills and icon buttons are fully round.
- Borders are 1 px `--glass-border`, with hover going to `--glass-border-highlight`. Shadows are rare; separate things with borders and surfaces.

Motion:
- `--transition-fast` 120 ms, `-normal` 200 ms, `-smooth` 320 ms.
- **Reduce motion** in Settings sets `data-reduce-motion="true"` on `<html>`, which turns animations and transitions off app-wide. Check new animations with it on.

---

## 4. App shell

```
┌────┬─────────────────────────────────────────────── 32 px window strip ──┐
│logo│  SecurePhotos   (drag area)                  ☾   _  □  ✕          │
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
- **Window strip** (`WindowStrip.tsx`), 32 px: the app's name on the left (part of the drag area), the theme toggle and the window buttons.
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
| Empty state | `.dash-empty` | Fills its area and sits in the middle. A leading icon gets a soft lime badge, then a heading, one sentence on what goes here and, where it helps, one button |
| Section heading | `.dash-section-title` | |
| Select | `.vid-select` | |
| Dialog | `.alb-dialog-backdrop`, `.alb-dialog`, `.alb-dialog-head` | `role="dialog"`, `aria-modal`, labelled by its heading. Escape and × close it; don't close it while it is saving or uploading |
| Confirmation | `ConfirmDialog` (`src/components/ui/ConfirmDialog.tsx`) | `role="alertdialog"`. The title asks the question ("Delete 3 items forever?"), the message says the consequence, and the confirm label names the action ("Remove song"). Escape or Cancel does nothing |
| Settings rows | `SettingsKit.tsx` (group, row, pill choice) | Always text on the left and the choice on the right, as in Appearance |
| Page search | `InlineSearch` | Header icon that opens a field filtering only this page (names, words in documents) |
| Toasts | `useAppStore().showToast(text, "success" \| "warning")` | One plain sentence; say what happened and what to do next |

Every focusable control shows `outline: 2px solid var(--accent-fill); outline-offset: 2px` on `:focus-visible`.

### 5.1 The photo grid (`PhotoTimeline`)

One component is used by Photos, the Vault, album pages and Favourites (`src/components/photos/PhotoTimeline.tsx`, layout maths in `src/utils/photoTimeline.ts`, `.timeline-*`):
- **Month sections** with a big heading ("May 2026 · 412") and a circle to select the whole month. Undated photos come last under "No date".
- **Justified rows.** Each full row is scaled to fill the width, and a month's last row is not stretched. Only rows near the screen are rendered (the component does its own windowing).
- **Year bar** on the right instead of a scrollbar: a 64 px column listing every year, with the months of the year you are looking at under it (the newest year at first), then "No date". Where you are is a lime pill. Click an entry, or press and drag along the list, to jump. When the list doesn't fit, only the years are listed (`scrubberEntries`). `minScrubberSections` hides it for short timelines (the Vault uses 4).
- **Tiles.** A selection circle (top left, on hover) and a favourite heart (top right). Tags sit bottom left in translucent black with neon text: one icon per fix on an improved photo (palette, sun, face, eraser) and the real size (8K, 4K or 2K). A video has a round play button in the middle, its size (4K, 2K, HD or SD) bottom left and its length bottom right; while it is being prepared, a spinner replaces the play button.
- **Photos still being prepared** show a small progress ring bottom left (it fills as the five steps are done) and the steps' icons taking turns in the middle; their tags appear once they are done. The ring's hover names the step.
- **Selection mode.** Once anything is selected, a click selects instead of opening. Ctrl or Shift + click also selects. Selection lives in `useAppStore` (`selectedPhotoIds`). Screens clear a leftover selection when they open.
- The `vault` prop switches to vault thumbnails and turns selection off.

### 5.2 Selection bar

When items are selected, one floating bar shows: "N selected · Select all · [actions] · ×" (`role="toolbar"`). The most common action comes first (Restore in Trash, Remove from album in an album). Actions that can't be undone come last and ask first. Escape clears the selection.

### 5.3 Cards

| Kind | Where | Shape |
|---|---|---|
| Album cover | Albums | 4:3 cover, then the name and "86 photos · Nov 2026" |
| Made for you | Albums | Big 16:10 fixed, drawn covers (hearts for Favourites, story frames for Saved stories, a mosaic for Collages), a lime badge with the icon, and the name and count underneath |
| Story card | Stories, Albums → Saved stories | Tall 176 × 292 (132 × 212 for Saved), radius 20, a tag for its kind (Trip, This week, Old photos…) and the title on the photo. Save and Hide appear on hover or keyboard focus |
| Collage idea | Stories | 2 × 2 preview, title and contents, one Save (then Open). The first idea is twice the size |
| Document | Documents | The real page on a white "paper" sheet, title, "Receipts & bills · 9 Nov 2026", a pin and a "…" menu. Documents must never look like photo tiles |
| Face | People | Round crop. Close ones get a lime ring |
| Job card | Dashboard | `.dash-job`: icon, title and line, the space it frees in big type, one button |

---

## 6. Screens

| Screen | File(s) | What defines it |
|---|---|---|
| Photos | `App.tsx`, `photos/PhotoTimeline.tsx` | Whole library in one timeline. Header: count, status pill, search (opens the Search page) and "+ Import" |
| Search | `search/SearchPage.tsx`, `search/searchFormat.ts` | Big field; before typing: Try chips, People, Albums; after: matching people and albums, then results in the photo grid. Keywords (videos, favourites, documents, a year or month) filter rather than match text |
| Viewer | `Lightbox.tsx`, `viewer/viewerFormat.ts` | Dark surround. Top bar: Back, the title with an 8K / 4K / HD chip, and date · "41 of 12,480". Actions: Favourite, Download (menu: the file, or a print-ready 300 dpi copy), Details; then, after a divider, Trash and the lime lock (Move to Vault, or Restore for a vault photo). A filmstrip of nine. Details are hidden each time the viewer opens. Zoom with the Zoom out / Fit / Zoom in buttons in the top bar, double-click, Ctrl + wheel or + / − / 0; the screen-sized preview stays until the full photo has loaded. **Old photos:** a "…" button (before Download) offers only what fits: Add colour (grey or sepia photos) or Fix faded colours (colour photos). While it works the date line reads "Adding colour · 45%". The result shows over the photo with a before/after divider ("Before" dark pill, "AI · After" lime pill) and a right panel (`viewer/OldPhotoPanel.tsx`): Natural / Vivid, Strength, "Keep this…" → dialog Keep both / Replace the photo (original to Trash for 30 days) / Discard, with Remember my choice. A photo with an improved copy shows an Original / Improved switch in the top bar; in the grid, improved copies carry their fix icons. **Sharpen faces:** offered in the "…" menu when the photo has faces ("Clearer faces in blurry or old photos"). In the result each face has an outline: lime = sharpened, white dashed = switched off (click to toggle; the preview follows), grey dotted = left as it was by the identity check (not a switch). Panel section "Faces": "2 faces sharpened · 1 switched off · 1 left as it was (no longer looked like the same person)". Fix faded colours sharpens faces too when the face model is there; otherwise its panel says "There are 2 faces that could be sharpened too" with **Also sharpen faces** (download popup, then the fix runs again). **Remove scratches and spots:** offered for scans and black-and-white photos ("Creases, scratches and dust on old prints"). The result shows what was repaired in lime over the before/after ("Show marks" checkbox); panel section "Scratches and spots" with **Touch up**. Touch up is a full-screen dark editor: Back, "Touch up" + "Lime = what was removed · paint a missed scratch, or erase to bring a detail back", Cancel / Apply; tools Brush / Eraser (segment), Size, Hide marks, Undo (also Ctrl+Z), note "Faces under a mark are left alone unless you paint them."; Escape cancels it without closing the viewer. **Missing model:** an action whose model isn't on this computer shows a lock and "Needs a one-time download · 1.0 GB" in the menu; choosing it opens a 460px dialog "Add colour needs a one-time download" (why, size, works offline after; Not now / Download). Downloading shows a progress bar and "1.0 GB of 2.0 GB" with Cancel download / Keep browsing (the download carries on in Activity); when it finishes in the dialog the action starts. A failed download says "Couldn't download it…" with Try again. Not now locks only that action |
| Stories | `StoriesView.tsx`, `stories/*` | Header with a music icon (opens Settings, Music) and Make new stories. The newest story plays as a wide stage (its photos cross-fade with a slow pan; still when motion is reduced) with Play story, Save and Hide. Then More for you, Saved and Collage ideas as a mosaic (6 first, then "Show more ideas"). With no stories: a welcome panel with Make my first stories |
| Albums | `AlbumsView.tsx`, `albums/*` | Made for you, then Your albums as covers. Album page: "← Albums", Slideshow, "+ Add photos", and a "…" menu (Rename, Choose cover photo, Move album to Vault, Delete album) |
| People | `PeopleView.tsx`, `people/PeopleOverview.tsx` | Close ones on top, "Same person?" (one suggestion at a time, a big face and up to three more per side), Everyone, and "Who is this?" naming cards (six first; a new name also asks for the relationship, under the name box). "See this face in its photo" has Not a face. Rename on the person page |
| Person page | `people/PersonPage.tsx` | "← People", big face (lime ring for a close one), name (click to rename) and "214 photos · 2012 – 2026"; relationship pill and Close one toggle; Slideshow; "…" menu (Choose profile photo, Delete … asks). Photos in the month timeline; selected photos can be taken off with "Not {name}" |
| Documents | `DocumentsView.tsx`, `documents/*` | Category chips with counts, Pinned first, paper cards, Find in photos, "+ Add". Vault documents never appear |
| Private Vault | `VaultView.tsx`, `vault/*` | Not set up: "Keep private photos here", three steps, Set up the vault. Locked: one centred card with PIN boxes, "Use master password instead" and the Emergency Card link (`VaultLockCard`). Unlocked: "● Unlocked · locks in 4:58" (amber in the last 30 s), privacy-shield button (P: "Hidden while you look away"), Lock now, and Photos / Albums / Documents tabs. Locked albums use the album page with an "In vault" chip; vault documents use the paper cards; "Move back to library" always asks |
| Dashboard | `DashboardView.tsx`, `dashboard/*` | The library as one sentence in big type over a strip of the newest photos ("12,480 photos, 342 videos…", each number opens its screen); Space: a drive bar and the storage map (`StorageBreakdown`, also in Settings, Storage: a bar and rows that light each other up, rows open their place); Worth doing: Duplicates, What to keep, Big videos; Photo enhancement progress |
| Duplicates | `DuplicatesView.tsx` | Sub-page of the Dashboard. The best pick is ticked and ringed ("Keep · best pick"); other copies say "Goes to Trash". Use "Keep the best in all…" (asks first) |
| Big videos | `VideoOptimizerView.tsx` | Sub-page of the Dashboard. "Make smaller" (asks first; the original is deleted once the copy passes a check). "Enhance" to HD, Full HD or 4K (the original goes to Trash for 30 days) |
| Settings · Old photos | `settings/PhotosAISettings.tsx` | Group "Old photos" in Photos & AI: "Make old photos look better.", then one row per improvement: a tiny CSS before → after picture (`.oldset-chip`), plain title and line, and When I ask / Automatically pills: Add colour to old grey photos; Fix faded or yellowed colours; Sharpen blurry faces; Remove scratches and spots. Then the Keep original switch. Footnote: Automatically works on new scans of prints after import (not phone or camera photos), in the background, waits on battery, progress in Activity |
| Activity | `activity/ActivityView.tsx`, `activity/activityFormat.ts` | Everything running in the background (imports, enhancing, video preparation, old-photo work, the one-time model download). Header: "1 working · 4 waiting" and Pause all / Resume. Sections: Working now (thumbnail, what, which photo, progress bar, Cancel or Stop import), Waiting (tiles, Cancel), Ready to look at (results waiting for Keep both / Replace / Discard, Open), Finished today (what happened, Open). Vault photos are a striped tile with a lock and no name. No rail item: reached from the rail's status ring (turns while work runs, shows what's left, dashed when paused) and the Photos header pill ("Adding colour · 5 items left ›") |
| Trash | `TrashView.tsx`, `trash/*` | "Deleted this month" sections; each tile shows "12 days left", amber for the last 3 days. Restore is lime; "Delete forever…" and "Empty trash…" are red outlines that ask first |
| Settings | `SettingsView.tsx`, `settings/*` | Sections on the left: Appearance (theme, grid size, reduce motion), Photos & AI (photo quality, photo size, video size, battery, faces, old photos, stories), Music, Private Vault (with a Danger zone), Storage, About |
| Import | `ImportModal.tsx`, `import/*` | Before: a drop area, Add files and Add a folder (they add to the selection), a summary with duplicates counted, and "Remove the originals after importing", off by default. While importing: progress with Stop import and Hide (the import keeps going). An empty library shows the welcome screen (`EmptyLibraryState.tsx`) with the app's icon |

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
| ← / → | Move the before/after divider or the Strength slider (when focused; never switches photos) | Viewer, old-photo result |
| ↑ / ↓, M | Volume, mute | Viewer (videos) |
| P | Privacy shield | Private Vault |
| Space, ← / → | Play or pause, previous / next | Story player, slideshow |
| Enter / Space | Open or select the focused photo | Photo grid |

The app-wide keys (T, L, Esc) are ignored while typing in an input or text box. New shortcuts need the same guard. The viewer's own keys are ignored while a dialog is on top of it (Esc closes only that dialog) and while a slider, checkbox or field has focus.

---

## 8. Checking a change

- **Both themes.** Look at every changed screen in dark and light.
- **Contrast scan.** The Playwright check looks for light text on lime fills and lime text in the light theme. Both must come back clean.
- **Throwaway library only.** UI checks run against a library set by `SECUREPHOTOS_DATA_DIR`, never a real one.
- **Tests.** Component tests sit next to each screen (`*.test.tsx`), and helpers have unit tests. A change in behaviour needs a test that fails without it.
- **No new hard-coded colours.** Use the tokens in §2. If something truly needs a new token, add it to both theme blocks in `src/index.css` and to this document.
