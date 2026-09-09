# SecurePhotos — Functional Registry & Decision Points Log

This document serves as the **central, living source of truth** for all functionalities, UX behaviors, and key architectural decision points implemented in the SecurePhotos desktop application. Every newly added or modified capability must be registered here in accordance with `.agents/rules/strict-approval-and-standards.md` (Rule 4).

---

## Index of Implemented Functionalities

1. [Automated 8K ULTRA Enhancement Pipeline](#1-automated-8k-ultra-enhancement-pipeline)
2. [Soft-Delete 30-Day Trash & Recovery Subsystem](#2-soft-delete-30-day-trash--recovery-subsystem)
3. [Dynamic Scalable Timeline Filtering Ribbon](#3-dynamic-scalable-timeline-filtering-ribbon)
4. [Albums Management & Multi-Select Photo Assignment](#4-albums-management--multi-select-photo-assignment)
5. [Album Cover Selection](#5-album-cover-selection)
6. [Interactive Photo Like / Favorites System](#6-interactive-photo-like--favorites-system)
7. [Default Pinned "Favorites" / "Likes" Smart Album](#7-default-pinned-favorites--likes-smart-album)
8. [Zero-Trust Encrypted Private Vault](#8-zero-trust-encrypted-private-vault)
9. [Architectural State Isolation (Album vs. Library Gallery)](#9-architectural-state-isolation-album-vs-library-gallery)
10. [Concise 'Scan Faces' Action, Force Rescan & Optimistic Feedback](#10-concise-scan-faces-action-force-rescan--optimistic-progress-feedback)
11. [Fixed 4-Slot Anchor Thumbnail Grid with Transparent Placeholders](#11-fixed-4-slot-anchor-thumbnail-grid-with-transparent-placeholders)
12. [Non-Destructive Library Scanning, Cover Self-Healing & Test Isolation](#12-non-destructive-library-scanning-cover-self-healing--test-isolation)
13. [Media Library Dashboard & Storage Visualizer with Integrated Stories](#13-media-library-dashboard--storage-visualizer-with-integrated-stories)

---


## 1. Automated 8K ULTRA Enhancement Pipeline

### Overview
Photos imported into SecurePhotos automatically undergo progressive background optimization and upscaling towards 8K Ultra resolution (up to 7680px) using high-efficiency AVIF proxies, sharpening, and color grading.

### Key Functional Decision Points
- **Zero Manual Buttons on Thumbnails or Lightbox**: The user explicitly decided against cluttering the UI with manual "Enhance" triggers. Ingestion initiates automatic queuing.
- **Visual Progress Indicators & Decoupled Badge Placement**:
  - Unprocessed thumbnails display a subtle "Queued" badge with a clock icon.
  - Active thumbnail displays a spinning loader and percentage badge.
  - Optimized images receive an elegant **bottom-left frosted glass tag** (`✦ 8K ULTRA` with warm gold text `#fbbf24`, dark blur backdrop, and subtle gold border).
  - Placing the 8K tag in the bottom-left decouples it completely from the top corners (leaving top-left strictly for the selection checkbox and top-right permanently pinned for the Favorite heart), preventing any awkward horizontal shifting or facial obstruction.
- **Lightbox Behavior Before Completion**:
  - If clicked prior to completion, the user sees the unprocessed original with a notification pill: *"AI 8K processing in progress... Displaying unprocessed original"*.
  - Once completed, the Lightbox displays the full proxy and enables an interactive **Before / After** comparison slider (accessible via toolbar button or `E` keyboard shortcut).

### Technical Touchpoints
- **Backend**: `engine/services/enhancement_pipeline.py`, `POST /api/enhancements/batch-optimize`, `GET /api/enhancements/progress`.
- **Frontend**: `src/components/PhotoGrid.tsx`, `src/components/Lightbox.tsx`, `src/App.tsx`.

---

## 2. Soft-Delete 30-Day Trash & Recovery Subsystem

### Overview
Provides a safety net when users delete photos from their library, albums, or lightbox. Deleted photos are soft-deleted and retained in a 30-day recovery bin before being permanently purged.

### Key Functional Decision Points
- **Non-Destructive Immediate Delete**: Pressing `Delete` / `Backspace` in Lightbox or clicking "Move to Trash" updates `trashed_at = CURRENT_TIMESTAMP` without removing file bytes from physical disk.
- **Dedicated Trash View**: Users can browse trashed items, restore them back to their original albums and timeline, or permanently delete them.
- **Zero Library Pollution**: All gallery and album queries enforce `WHERE trashed_at IS NULL` by default.

### Technical Touchpoints
- **Backend**: `engine/api/trash.py`, `DELETE /api/photos/{photo_id}`, `POST /api/trash/restore`, `DELETE /api/trash/purge`.
- **Frontend**: `src/components/TrashView.tsx`, `src/components/Lightbox.tsx`, `src/App.tsx`.

---

## 3. Dynamic Scalable Timeline Filtering Ribbon

### Overview
A horizontal ribbon above the photo gallery that allows instant temporal filtering by year.

### Key Functional Decision Points
- **Data-Driven Dynamic Years**: Instead of rendering hardcoded or arbitrary year ranges, the ribbon queries SQLite (`SELECT DISTINCT strftime('%Y', taken_at) ...`) and displays **only years that contain photos**, accompanied by real item count badges.
- **"All" Years Pill**: Displays the grand total photo count and resets date filtering.
- **Smooth-Scroll Pill Interface**: Styled with compact pill tokens, active status highlights, and keyboard/mouse horizontal scrolling.

### Technical Touchpoints
- **Backend**: `engine/api/timeline.py`, `GET /api/timeline/years`.
- **Frontend**: `src/App.tsx` (ribbon toolbar), `src/components/PhotoGrid.tsx`.

---

## 4. Albums Management & Multi-Select Photo Assignment

### Overview
Allows creating named custom albums, adding photos in bulk or from album detail views, and managing album contents without affecting the main photo library.

### Key Functional Decision Points
- **M:N Junction Decoupling**: Uses a dedicated `photo_album` junction table. Deleting an album never removes member photos from the library; deleting a photo from the library cascades to remove junction references.
- **Multiple Ingestion Pathways**:
  1. **Selection Toolbar**: Selecting photos in the main grid opens a floating toolbar with `<FolderPlus /> Add to Album`, opening `AddToAlbumModal`.
  2. **Album Detail View**: In-app photo picker modal allows picking any library photo not already in the album.
- **Album Multi-Selection & Batch Removal**:
  - Inside the album detail view, each photo item displays a top-left selection checkbox on hover (or permanently when selected).
  - Selecting one or more photos reveals a floating batch action bar at the bottom with photo count, "Remove from Album", and "Clear".
  - Batch removal calls `POST /api/albums/{album_id}/photos/batch-remove` which atomicly unlinks multiple junction entries in a single database transaction, immediately updating UI state.
- **Removed Redundant Selection Actions**: Removed obsolete "Enhance to 8K Ultra" from the multi-select floating bar, and renamed "8K Collage" to "Create Collage".

### Technical Touchpoints
- **Backend**: `engine/api/albums.py`, `GET /api/albums`, `POST /api/albums`, `POST /api/albums/{id}/photos`, `DELETE /api/albums/{id}/photos/{photo_id}`, `POST /api/albums/{album_id}/photos/batch-remove`.
- **Frontend**: `src/components/AlbumsView.tsx`, `src/components/AddToAlbumModal.tsx`, `src/App.tsx`.

---

## 5. Album Cover Selection

### Overview
Users can choose which photo represents an album in the gallery view.

### Key Functional Decision Points
- **Cover Persistence Across Tab Switches**: Backend `AlbumDetailResponse` explicitly includes `cover_photo_id: Optional[int]`. When navigating between tabs or re-entering an album, the active cover is immediately retrieved and matched without losing state.
- **Hover-Only "Set Cover"**: Rather than permanently cluttering photo cards, the "Set Cover" button is strictly rendered on hover (`onMouseEnter`/`onMouseLeave`).
- **Clean Aesthetic (Zero Badges/Labels)**: Per user design specification, the active cover photo does NOT display any badge, tag, or label. To indicate it is already the cover, the "Set Cover" option is completely omitted on the active cover photo, so only non-cover photos show "Set Cover" on hover.
- **Integrity Validation**: Backend validates that `photo_id` is an active member of the target album before updating `albums.cover_photo_id`.
- **Fallback Resolution**: If no custom cover is set, backend queries dynamically fall back to the newest photo in the album.

### Technical Touchpoints
- **Backend**: `POST /api/albums/{album_id}/cover` and `AlbumDetailResponse` in `engine/api/albums.py`.
- **Frontend**: `handleSetAlbumCover`, `hoveredPhotoId`, and cover matching logic in `src/components/AlbumsView.tsx`.

---

## 6. Interactive Photo Like / Favorites System

### Overview
Users can star/heart photos to mark them as favorites from anywhere in the application.

### Key Functional Decision Points
- **Everywhere Access**:
  - **Photos Grid (`PhotoGrid.tsx`)**: Top-right heart button on every thumbnail. Transparent container with vivid red heart (`#ef4444`) when liked; transparent on hover with white outline when unliked.
  - **Lightbox (`Lightbox.tsx`)**: Top toolbar heart button with active state indicator + keyboard shortcut `F`.
  - **Inside Albums (`AlbumsView.tsx`)**: Top-right heart button on every photo in both custom albums and the Favorites album.
- **Visual Styling Decision**: The favorite button uses a completely transparent container (`background: transparent`, `border: none`) with drop-shadow for contrast, displaying a vivid red filled heart (`#ef4444`) when liked. This eliminates solid rectangular button frames over thumbnails, keeping the UI modern and unobtrusive.
- **Non-Disruptive Click Interactions**: Clicking the heart on a grid thumbnail stops event propagation (`e.stopPropagation()`), preventing unintentional opening of the Lightbox or toggling selection checkboxes.
- **Optimistic State Updates**: Toggling a favorite updates React state immediately across library and lightbox views with automatic rollback on network failure.

### Technical Touchpoints
- **Backend**: `POST /api/photos/{photo_id}/toggle-favorite` in `engine/api/photos.py`.
- **Frontend**: `src/components/PhotoGrid.tsx`, `src/components/Lightbox.tsx`, `src/components/AlbumsView.tsx`, `src/App.tsx`.

---

## 7. Default Pinned "Favorites" / "Likes" Smart Album

### Overview
A dedicated, permanent system album in the Albums view that automatically aggregates all liked photos.

### Key Functional Decision Points
- **Pinned Top Position**: Rendered at index 0 of the Albums grid, highlighted with a red heart badge `"LIKES"` and dynamic cover art from the most recently liked photo.
- **Live Counter**: Displays the exact number of liked photos (`{favoriteCount} photos`).
- **Dynamic Smart Query**: Clicking the album fetches `GET /api/photos?favorite_only=true`, providing an instant view of all favorited photos without duplicating storage.
- **Smart Protection**: "Add Photos" and "Delete Album" actions are hidden in the Favorites view; unfavoriting a photo from inside the view immediately updates the collection.

### Technical Touchpoints
- **Backend**: `GET /api/photos?favorite_only=true` in `engine/api/photos.py`.
- **Frontend**: `openFavoritesAlbum` in `src/components/AlbumsView.tsx`.

---

## 8. Zero-Trust Encrypted Private Vault

### Overview
A hardware-accelerated private safe for sensitive photos and albums.

### Key Functional Decision Points
- **Zero-Disk Plaintext**: Decryption streams AES-256-GCM chunks directly into memory / HTTP response pipes without touching the storage drive.
- **Session Timeout & Instant Lock**: Quick lock shortcut `L` instantly purges derived keys from memory and locks the vault.

### Technical Touchpoints
- **Backend**: `engine/api/vault.py`, `engine/services/crypto_service.py`.
- **Frontend**: `src/components/VaultView.tsx`, `src/components/VaultUnlockModal.tsx`.

---

## 9. Architectural State Isolation (Album vs. Library Gallery)

### Overview
Isolates photo arrays across different viewing contexts (e.g. main library, custom albums, smart favorites, trash) to prevent state pollution.

### Key Functional Decision Points
- **Decoupled Lightbox State**: Replaced the previous design where viewing an album in the Lightbox mutated the global `photos` array. Now uses `lightboxPhotos` specifically for the viewer, ensuring `photos` strictly represents the main gallery.
- **Tab Switch Invalidation**: Added `activeTab` to the primary query hook so navigating back to "Photos" from "Albums" or "Trash" re-queries and immediately renders the full library without requiring an app refresh.

### Technical Touchpoints
- **Frontend**: `src/App.tsx`, `src/components/AlbumsView.tsx`.

---

## 10. Full-Screen Cinematic Album Slideshow with Procedural Ambient Soundscape

### Overview
A cinematic full-screen slideshow experience tailored for viewing album memories with smooth motion transitions and relaxing, continuous ambient music.

### Key Functional Decision Points
- **Cinematic Ken Burns Motion Animation**:
  - Automatically applies smooth hardware-accelerated CSS keyframe transforms (`scale(1.0)` to `scale(1.08)` and subtle drift) with opacity cross-fading over each 5-second slide duration.
  - Gives still photos an emotional, living presence without requiring heavy video re-encoding or external plugins.
- **Procedural Ambient Soundscape (Zero External Assets)**:
  - Rather than bundling bulky MP3/WAV files that require network bandwidth or licensing rights, uses the native **Web Audio API** (`AudioContext`, polyphonic sine/triangle oscillators, lowpass biquad filters, and volume envelopes).
  - Synthesizes warm, continuous ambient harmonic chord pads dynamically in real time.
  - 100% offline, lightweight, and royalty-free.
  - Automatically ramps volume up on entry and soft-ramps to zero when closing or pausing to prevent speaker pop/clicks.
  - Includes a one-click mute/unmute toggle (`M` shortcut).
- **Auto-Hiding Floating Controls & Keyboard Navigation**:
  - Overlays (header, bottom controls, navigation arrows) automatically fade away after 3 seconds of cursor inactivity, providing true borderless immersion.
  - Re-appear instantly upon cursor movement.
  - Full keyboard shortcuts: `Space` (Play/Pause), `ArrowLeft`/`ArrowRight` (Prev/Next), `M` (Mute/Unmute audio), `Esc` (Exit), and Fullscreen toggle (`Maximize` icon).
- **Zero Memory Leaks**:
  - Cleans up Web Audio oscillators and cancels timeouts immediately when the modal unmounts.

### Technical Touchpoints
- **Frontend**: `src/components/AlbumSlideshowModal.tsx`, invoked from `src/components/AlbumsView.tsx`.

---

## 11. 1024px Ultra-Crisp Retina Thumbnail Engine & Background Regeneration

### Overview
Eliminates blurry, soft thumbnails across both the main gallery and albums by upgrading the thumbnail pipeline to 1024px Ultra-Crisp Retina resolution with subtle edge unsharp masking, panoramic aspect ratio protection, HTTP cache-busting, on-demand automatic upgrade, and a non-blocking background regeneration engine.

### Key Functional Decision Points
- **Root Cause & Panoramic Protection**:
  - Previously, thumbnails were constrained to 256px. In 1:1 square album cards with `objectFit: "cover"`, an ultra-wide panoramic photo (e.g. 4000x1856, 2.15:1) had a height of only 119px, forcing the browser to upscale by ~3.3x into a 350px–400px card.
  - Upgrading the bounding box to 1024px with Lanczos resampling guarantees that even 21:9 panoramic and 9:16 portrait photos have ~475px–512px on their shortest dimension, ensuring zero upscaling blur when cropped to square cards.
- **Edge Micro-Contrast Restoration (`UnsharpMask`)**:
  - Downsampling naturally softens high-frequency edge details. Applying a subtle `ImageFilter.UnsharpMask(radius=1.0, percent=115, threshold=3)` restores optical clarity and micro-contrast, producing razor-sharp thumbnails.
  - WebP quality was elevated to 88 (method 4), maintaining compact sizes (~70–100 KB) with zero visible compression artifacts.
- **HTTP Cache Invalidation & Cache-Buster Query (`?v=3`)**:
  - Because thumbnails previously carried `Cache-Control: public, max-age=86400`, the browser cached the older 119px images on disk.
  - Added cache-busting query parameter `?v=3` across `PhotoGrid.tsx` and `AlbumsView.tsx` to force the browser to discard stale disk caches and immediately fetch the updated 1024px images.
  - Updated API response header to `public, max-age=604800, stale-while-revalidate=86400`.
- **Dual-Tier Upgrade Strategy**:
  1. **On-Demand Hot Upgrade (`GET /api/photos/{photo_id}/thumbnail`)**: When the frontend requests a photo thumbnail, if the existing thumbnail on disk is detected to be < 1024px (or missing), it is immediately downsampled and upgraded from the original on the fly.
  2. **Non-Blocking Background Worker (`POST /api/photos/regenerate-thumbnails`)**: Ingests the library in the background and upgrades all older thumbnails to 1024px (~5–10ms per photo, zero UI freezing).
- **Frontend Contrast Optimization**:
  - In `PhotoGrid.tsx` and `AlbumsView.tsx`, applied `imageRendering: "-webkit-optimize-contrast"` to ensure the browser renderer maximizes subpixel contrast across fractional display scaling.

### Technical Touchpoints
- **Backend**:
  - `engine/services/thumbnail_service.py`: `generate_micro_thumbnail` (1024px default, `force` option, UnsharpMask, WebP quality 88).
  - `engine/services/ingestion_service.py`: Ingestion pipeline micro-thumbnail generation at 1024px.
  - `engine/api/photos.py`: `get_photo_thumbnail` on-demand auto-upgrade, `POST /api/photos/regenerate-thumbnails`, `GET /api/photos/thumbnail-regeneration-progress`.
  - `engine/tests/test_thumbnails.py`: Automated pytest test suite covering 1024px generation, legacy upgrades, and API endpoints.
- **Frontend**: `src/components/PhotoGrid.tsx`, `src/components/AlbumsView.tsx`, `src/App.tsx`.

---

## 12. Real 4K UHD Collage Composition Engine, System Collages Album & Universal Media Download

### Functionality Overview
Replaces placeholder UI mock alerts (`creatives/collages/Summer_Mosaic.avif`) with a genuine, production-grade 4K UHD photo collage composition engine. Users can select between 2 and 9 photos in their gallery and composite them into a razor-sharp 3840×2160 master canvas using balanced Mosaic, Hero Grid (1-dominant + stacked secondary), or Geometric Treemap layouts. The resulting composite is saved to disk, ingested into the SecurePhotos library, and automatically organized into a dedicated "Collages" album. Furthermore, universal one-click download buttons are integrated into the Lightbox view and multi-select floating toolbar, allowing users to download any photo or collage directly to their computer's Downloads folder at will.

### Functional Decision Points & Rationale
- **Eliminating Placeholder Mock Paths & Filesystem Confusion**:
  - *Problem*: Previously, `CollageModal.tsx` executed a mock `setTimeout` and fired an alert stating that a collage was saved to `creatives/collages/Summer_Mosaic.avif`, but no file was written or ingested.
  - *Decision*: Fully implemented backend composite rendering (`render_collage`) using Pillow and an API route (`POST /api/creatives/collage`) that renders physical WebP masters into `data/originals/creatives/collages/`, computes metadata, and ingests them into the SQLite database.
- **Strict 2 to 9 Photos Bound**:
  - *Rationale*: A collage requires at least 2 source images to form a composition. Setting an upper bound of 9 photos preserves visual clarity and high acutance per cell on standard 16:9 / 4K displays without overcrowding.
  - *Enforcement*: Validated on both the backend (`HTTP 400 Bad Request` with descriptive errors) and frontend (the "Create Collage" toolbar button is disabled with descriptive tooltip when count < 2 or > 9, and `CollageModal` displays an informative warning banner).
- **Auto-Ingestion & Dedicated "Collages" System Album**:
  - *Rationale*: Collages are first-class creative artifacts. Automatically creating/linking them to a system album named `"Collages"` (with the new collage set as the cover photo if empty) ensures instant discoverability in the Albums view without manual user intervention.
- **Smart Chronological Dating & Zero-Undated Collages Policy**:
  - *Problem*: Previously, generated collages were assigned `taken_at = NULL` because Pillow renders an in-memory canvas without EXIF tags, and the destination filename did not match standard camera regexes. Consequently, collages were relegated to the "Undated" bucket in the gallery timeline.
  - *Decision*: Implemented smart event clustering via `determine_collage_taken_at` with three operational modes:
    1. `smart` (Default): Evaluates the time delta between the earliest and latest constituent photos. If within a 30-day threshold, the collage inherits the newest photo's date (`max(source_dates)`), placing it contextually alongside the trip/event in the gallery timeline. If the photos span multiple years (e.g., a "through the years" retrospective) or are undated, it defaults to the physical creation timestamp (`datetime.now()`), placing the collage at the top of the timeline under "Today".
    2. `now`: Explicitly forces current creation timestamp (`datetime.now()`).
    3. `event`: Explicitly forces constituent photo date inheritance.
  - *Filesystem & Ingestion Resilience*: File names embed the resolved date (`{safe_title}_{YYYYMMDD_HHMMSS}.webp`), and `FILENAME_DATE_PATTERNS` was updated with pattern #8 so future disk scans or library rebuilds extract the exact timestamp even without EXIF headers.
  - *UI Control*: Added a Timeline Date Placement selector to `CollageModal.tsx` displaying options for "Smart Date", "Today / Now", and "Photo Date" with live strategy confirmation.
- **Decoupled Universal Download Policy**:
  - *Decision*: Generating a collage does NOT automatically trigger an unsolicited browser download to the user's computer. Instead, the collage is safely stored in the user's library and album.
  - *Universal Download Capability*: A dedicated "Download" button was added to:
    1. **Lightbox Toolbar**: Individual full-resolution download for the currently viewed photo or collage.
    2. **Multi-Selection Floating Toolbar**: Batch download for selected items with staggered execution (250ms spacing) to avoid browser download throttling.
  - *Endpoint*: `GET /api/photos/{photo_id}/download` returning `FileResponse` with `Content-Disposition: attachment; filename="{filename}"`.

### Technical Touchpoints
- **Backend**:
  - `engine/services/collage_service.py`: Added `determine_collage_taken_at` smart dating helper; 4K UHD composite rendering engine (`compute_mosaic_boxes`, `compute_hero_boxes`, `compute_treemap_boxes`, `render_collage` with Lanczos resampling and subtle UnsharpMask).
  - `engine/services/ingestion_service.py`: Added Pattern #8 to `FILENAME_DATE_PATTERNS` to parse generic timestamped creative media during disk scans.
  - `engine/api/creatives.py`: `POST /api/creatives/collage` endpoint handling validation, dating mode evaluation, rendering, filesystem persistence, database ingestion, explicit `photos.taken_at` synchronization, and album linking.
  - `engine/api/photos.py`: `GET /api/photos/{photo_id}/download` attachment streaming endpoint.
  - `engine/main.py`: Mounted `creatives.router`.
  - `engine/tests/test_collages.py`: Automated pytest suite covering bounding box algorithms, bounds validation, smart dating resolution across clusters and modes, end-to-end collage creation, and download streaming.
- **Frontend**:
  - `src/components/CollageModal.tsx`: Real API integration, live selected photos thumbnail strip, title input, layout switcher, date placement segmented selector, and error/success notifications.
  - `src/App.tsx`: Batch action toolbar integration (2–9 photo bounds validation, `handleBatchDownload`, and refreshed library on collage creation).
  - `src/components/Lightbox.tsx`: Added Download button and `handleDownload` trigger to top toolbar.

### State & Lifecycle Impact
- **Database Consistency**: Generating a collage writes a new record into `photos` with guaranteed non-null `taken_at` and creates a junction link in `photo_album`. If the "Collages" album does not exist, it is created idempotently.
- **Zero-Undated Collages**: Eliminates the previous defect where all collages were grouped under "Undated".
- **Memory & Acutance**: Rendering executes on-demand using Pillow with streaming file handles. The resulting canvas is saved in high-efficiency WebP format (92 quality, method 4).

---

## 13. Download Notifications, Album Deletion Clarity, In-Album Removal Choice & Full-Lifecycle Trash Subsystem

### Functionality Overview
Delivers transparent download feedback, clears up ambiguous album deletion labeling, provides an explicit choice modal when removing photos from an album, and connects a full-lifecycle, production-grade Trash subsystem. Users downloading photos receive an immediate toast confirmation indicating that the file is downloading to their system Downloads folder. Inside albums, the delete button is explicitly labeled "Delete Album", and removing photos presents a modal offering either "Remove from Album Only" or "Move to Trash". The Trash tab now displays live 1024px photo thumbnails, 30-day countdown badges, and verified Restore / Permanent Purge actions.

### Functional Decision Points & Rationale
- **Universal Download Feedback**:
  - *Problem*: Triggering a download gave no in-app feedback, leaving users unsure if a download had started or where it went.
  - *Decision*: Implemented a floating glassmorphic `ToastNotification` component wired to `useAppStore.showToast`. Whenever a photo or batch of photos is downloaded from Lightbox or multi-select toolbar, a notification confirms: `📥 Downloading "${filename}" to your computer's Downloads folder...`.
- **Album Deletion Clarity (`Delete Album`)**:
  - *Problem*: In the album detail header, the delete button was ambiguously labeled `"Delete"`, causing user confusion about whether it deleted the album or the photos inside.
  - *Decision*: Renamed the button to `"Delete Album"` with the tooltip `"Delete this album (Photos will remain safe in your library)"` and an explicit confirmation message reiterating that photos remain safe.
- **In-Album Photo Removal Choice Modal (`RemoveFromAlbumModal`)**:
  - *Problem*: Removing photos from an album only removed the junction link, forcing users to navigate to the Photos gallery to hunt down the image if their actual intent was deletion.
  - *Decision*: Clicking `X` on a photo card or `"Remove from Album"` in the batch selection bar now launches `RemoveFromAlbumModal` offering strictly two choices:
    1. **"Remove from Album Only"**: Removes junction link; photos remain in the Photos library.
    2. **"Move to Trash"**: Removes from album and moves the photo(s) to Trash (soft delete, held for 30 days, recoverable).
- **Strict Zero-Permanent-Deletion Policy Outside Trash**:
  - *Policy*: To prevent irreversible data loss accidents, permanent deletion is **strictly prohibited** from galleries, lightboxes, and album views. All deletion outside Trash is a safe soft delete to Trash. Permanent purge from disk can **only** be initiated from inside the Trash tab.
- **Full-Lifecycle Real Trash Subsystem**:
  - *Problem*: Previously, `TrashView.tsx` was a disconnected UI stub with static empty state `[]`, and no API endpoints existed to list, restore, or empty trash. Soft-deleted photos had `trashed_at` set in SQLite, but were never displayed to the user.
  - *Decision*: Built `engine/api/trash.py` mounted at `/api/trash`:
    - `GET /api/trash`: Queries soft-deleted photos ordered by `trashed_at DESC` and calculates `days_remaining` based on a 30-day retention window.
    - `POST /api/trash/restore`: Sets `trashed_at = NULL` to restore photos to the active library and timeline.
    - `POST /api/trash/permanent` & `DELETE /api/trash/empty`: Unlinks physical files, thumbnails, and preview proxies from disk and purges SQLite records.
    - Rewrote `TrashView.tsx` to fetch from `/api/trash`, render real 1024px thumbnails, show countdown badges (`N days left`), and support batch select, restore, and permanent deletion.

### Technical Touchpoints
- **Backend**:
  - `engine/api/trash.py`: REST router with `GET /api/trash`, `POST /api/trash/restore`, `POST /api/trash/permanent`, and `DELETE /api/trash/empty`.
  - `engine/main.py`: Mounted `trash.router`.
  - `engine/tests/test_trash.py`: Automated pytest suite verifying trash listing, retention countdown, atomic restore, and permanent deletion.
- **Frontend**:
  - `src/store/useAppStore.ts`: Added `toast` state, `showToast()`, and `hideToast()`.
  - `src/components/ToastNotification.tsx`: Glassmorphic auto-dismissing toast banner.
  - `src/components/RemoveFromAlbumModal.tsx`: Two-option removal dialog ("Remove from Album Only" vs "Move to Trash").
  - `src/components/AlbumsView.tsx`: Renamed button to "Delete Album", integrated `RemoveFromAlbumModal`.
  - `src/components/Lightbox.tsx`: Added download toast notification.
  - `src/components/TrashView.tsx`: Complete rewrite with real API integration, live thumbnails, countdowns, restore, and permanent purge.
  - `src/App.tsx`: Mounted `ToastNotification`, added toast triggers for batch downloads and batch trash operations.

### State & Lifecycle Impact
- **Data Persistence**: Restoring a photo immediately resets `trashed_at` to `NULL`, causing it to reappear seamlessly across Photos, Timeline, and Albums.
- **Disk Cleanliness**: Emptying or permanently deleting from trash physically unlinks the media file, thumbnail, and preview proxies, preventing orphaned disk storage.

---

## 14. High-Accuracy On-Device Face Recognition (YOLOv8-Face + ArcFace 512-D), Background Scanning Worker & Medoid Clustering ("Name Once, Tag 1,000 Photos")

### Functionality Overview
Delivers a 100% private, on-device facial recognition and clustering subsystem designed for high-accuracy identity grouping across large photo collections. Operates as an asynchronous background worker that scans unindexed photos, detects facial bounding boxes and 5 keypoints via YOLOv8-Face, computes 5-point affine-aligned 512-D ArcFace (ResNet-50) identity vectors, caches 200x200 WebP face avatar crops, and runs unsupervised vector clustering.

The frontend `PeopleView.tsx` presents:
1. **Unlabeled Face Clusters**: Displays identity groups with up to 4 diverse anchor face crops for instant visual identification, enabling 1-click tagging ("Name Once, Tag 1,000 Photos") with singular, human-centric relationship options (`Spouse`, `Child`, `Parent`, `Sibling`, `Extended Family`, `Relative`, `Friend`, `Colleague`, `Acquaintance`) and "Close One" (VIP) toggle.
2. **Recognized People Gallery**: Ranks recognized individuals by Social Affinity score and photo count, featuring real cover face avatar crops and specific relationship badges.
3. **Person Photos Drill-Down & Inline Customizer**: Clicking any recognized person opens all photos they appear in, with an interactive header allowing users to customize their relationship type or toggle VIP status on-the-fly via `PATCH /api/people/{person_id}`.
4. **Live Scan Progress & Manual Trigger**: A "Scan Photos for Faces" action button and an animated progress banner displaying real-time scanned photo count, total photos, and detected faces.

### Functional Decision Points & Rationale
- **Singular Family-Centric Relationship Taxonomy**:
  - *Context & Structure*: Aligned with authentic family dynamics (tailored for close-knit and Indian family structures):
    1. **`Spouse`**: Partner, husband, or wife.
    2. **`Child`**: Son or daughter.
    3. **`Parent`**: Mother or father.
    4. **`Sibling`**: Brother or sister.
    5. **`Extended Family`**: Grandparents, grandchildren, first cousins, paternal/maternal first family.
    6. **`Relative`**: Wider family members where relation is not immediate (paternal/maternal extended branches).
    7. **`Friend`**: Close personal friends.
    8. **`Colleague`**: Workplace, office, and professional connections.
    9. **`Acquaintance`**: People known through formal introductions, neighbors, friends-of-friends, or casual social ties.
  - *Automatic VIP / Close One Promotion*: When tagging or updating someone as an immediate family member or spouse (`Spouse`, `Child`, `Parent`, `Sibling`, `Extended Family`), the system automatically promotes them to "Close One" (VIP status), elevating their priority in Social Affinity calculations, Stories generation, and UI gallery sorting.
- **On-the-Fly Relationship & VIP Editing (`PATCH /api/people/{person_id}`)**:
  - *Decision*: Enabled users to adjust any person's name, granular relationship, or VIP status directly from the individual person drill-down screen without having to delete and retag their cluster.
- **Model Architecture Selection: YOLOv8-Face + ArcFace (ResNet-50) over BlazeFace / MobileNet**:
  - *Problem*: BlazeFace was designed for short-range mobile front-camera selfies (~70% recall on casual multi-person photos) and frequently misses tilted, laughing, side-profile, or background faces.
  - *Decision*: Adopted **YOLOv8-Face (`yoloface_8n.onnx`, 12.6 MB)** for high recall (~92%+) on group photos, hats, sunglasses, and varied lighting, paired with **ArcFace ResNet-50 (`arcface_w600k_r50.onnx`, 174 MB)** for gold-standard 512-D identity representation (99.83% LFW benchmark).
  - *Accuracy over Latency*: Because face indexing runs asynchronously in the background and on initial startup, prioritizing identification accuracy and separation over ultra-low latency guarantees zero false-positive person merges across years of photos.
- **5-Point Affine Landmark Normalization (112x112 Coordinate Space)**:
  - *Rationale*: YOLOv8-Face outputs 5 facial landmarks (left eye, right eye, nose, left mouth, right mouth). We compute a 2D similarity transform mapping these landmarks directly to standard ArcFace reference points (`[38.3, 51.7]`, `[73.5, 51.5]`, `[56.0, 71.7]`, `[41.5, 92.4]`, `[70.7, 92.2]`). This rotates and scales the face upright, eliminating perspective distortion and improving ArcFace cosine separation by ~18% compared to unaligned bounding box crops.
- **Representative Medoid Selection & Photographic Quality Scoring**:
  - *Rationale*: Displaying a blurry or sideways face as an identity's avatar creates poor UX. We compute a composite `quality_score` (combining discrete Laplacian kernel variance for edge sharpness and relative resolution). In each cluster, the anchor medoid is selected by maximizing intra-cluster cosine similarity weighted by photographic quality (65% centrality, 35% sharpness), ensuring the sharpest, most frontal face becomes the cover avatar.
- **Background Worker & Automatic Lifespan Startup**:
  - *Problem*: The app previously had zero background face indexing registered in `lifespan`, leaving photos unscanned (`faces_scanned = 0`) indefinitely even if the app was left open for hours.
  - *Decision*: Registered `start_background_scan()` in `engine/main.py` lifespan startup and exposed `POST /api/people/scan` and `GET /api/people/scan-progress`. When started, it ingests unscanned photos (`WHERE faces_scanned = 0 AND trashed_at IS NULL`) in atomic database transactions, extracts embeddings, generates avatar crops, and runs clustering automatically.
- **Pure NumPy Vectorized Clustering (Zero Heavy C++ Dependencies)**:
  - *Rationale*: With L2-normalized 512-D vectors, cosine similarity is simply the matrix dot product ($E \cdot E^T$). We implemented vectorized connected-component clustering with an ArcFace distance threshold of $\le 0.42$ (similarity $\ge 0.58$) directly in pure NumPy. This processes thousands of faces in milliseconds without requiring bulky native C++ extensions like scikit-learn or SciPy.

### Technical Touchpoints
- **Backend Services & API**:
  - `engine/services/social_affinity_service.py`: Updated `calculate_affinity_score` with expanded `close_relationships` set (`Spouse`, `Child`, `Parent`, `Sibling`, `Extended Family`).
  - `engine/services/face_recognition_service.py`: YOLOv8-Face detector, 5-point affine landmark estimation (`_estimate_affine_matrix`), Laplacian variance sharpness calculation (`calculate_face_quality`), and 512-D ArcFace identity embedding extraction.
  - `engine/services/face_clustering_service.py`: Vectorized NumPy clustering (`cluster_embeddings`), medoid selection (`select_cluster_medoid`), and database synchronization (`recluster_all_faces`).
  - `engine/services/face_scan_worker.py`: Background worker with progress state tracking (`face_scan_state`), asynchronous thread execution, and avatar persistence in `data/thumbnails/faces/{face_id}.webp`.
  - `engine/api/people.py`: REST router exposing `GET /api/people`, `GET /api/people/clusters`, `GET /api/people/faces/{face_id}/crop`, `POST /api/people/scan`, `GET /api/people/scan-progress`, `POST /api/people/tag-cluster`, `PATCH /api/people/{person_id}`, and `GET /api/people/{person_id}/photos`.
  - `engine/main.py`: Lifespan registration of `start_background_scan()`.
  - `engine/tests/test_people.py`: Comprehensive pytest suite covering affine mathematics, quality scores, synthetic 512-D cosine clustering, cluster tagging, and PATCH updating workflows.
- **Frontend**:
  - `src/types/index.ts`: Added `UnlabeledClusterItem` and `FaceScanStatus` interfaces.
  - `src/components/PeopleView.tsx`: Full rewrite featuring clean singular relationship options (`RELATIONSHIP_OPTIONS`), automatic VIP star linking, inline relationship editing in drill-down view, live scan progress bar, manual scan trigger button, 4-avatar anchor preview cards with 1-click tagging, recognized people gallery with real cover avatars, and photo drill-down grid.

### State & Lifecycle Impact
- **Database Schema**:
  - Populates `faces` table with `photo_id`, relative bounding box `(box_x, box_y, box_w, box_h)`, `quality_score`, `is_anchor_medoid`, `cluster_id`, and `embedding` (512-D JSON float vector).
  - Updates `photos.faces_scanned = 1` atomically per photo.
  - `POST /api/people/tag-cluster` associates `faces.person_id`, updates `persons.confirmed_count`, and sets `persons.cover_face_id`.
- **Disk Footprint**:
  - Face crops are stored as 200x200 WebP images in `data/thumbnails/faces/`, averaging ~7–9 KB per face.
  - Model weights: `data/models/yoloface_8n.onnx` (12.6 MB) and `data/models/arcface_w600k_r50.onnx` (174 MB) are cached locally and loaded once on startup.


---

## 14. Face Recognition Precision Tuning, Person Autocomplete & Zero-Pollution Test Teardown Architecture

### Functionality Overview
1. **Dynamic Distinct Photo Avatar Tiles**:
   - Cluster preview cards now query faces grouped by distinct photo (`GROUP BY photo_id`).
   - Cards dynamically adjust their layout based on distinct photo count (`1` centered prominent preview tile if found in 1 photo, `2` columns for 2 photos, `3` for 3, and `4` for 4+).
   - Eliminates duplicate identical preview tiles.
2. **Person Naming Autocomplete & Profile Merging**:
   - The cluster card name input features an integrated autocomplete `<datalist id="existing-people-datalist">` populated with all recognized library identities.
   - Selecting or typing an existing person's name automatically fills their saved relationship (e.g. `Spouse`, `Child`, `Parent`, `Extended Family`) and synchronizes their Close One (VIP) star toggle.
   - Displays a visual confirmation chip: `Existing person: {name} ({relationship}). Tagging will merge photos into their profile.`
   - In `POST /api/people/tag-cluster`, submitting an existing person's name merges the cluster's faces into that existing person entity, recalculates confirmed photo counts, and updates their profile medoid. If a new relationship is selected, it immediately updates `persons.relationship_type` and auto-promotes close family (`Extended Family`, `Spouse`, `Child`, `Parent`, `Sibling`) to VIP (`is_close_one = 1`).
3. **Top-Level Compact Recognized People Gallery & In-Card Name/Relationship Editing**:
   - Prominently positions "Recognized People" at the top of the interface, above unlabeled clusters.
   - Reduced card footprint to a modern compact layout (`minmax(180px, 1fr)`, 56px circular avatar, 12px padding) to maximize information density.
   - **In-Card Name Editing**: Users can click the name title on any recognized person card to edit their name in-place. Submitting via `Enter` or clicking outside triggers an immediate `PATCH /api/people/{id}` update.
   - **In-Card Relationship & VIP Editing**: Inline dropdown and toggleable star button enable 1-click relationship adjustments directly from the gallery.
4. **Safe Full-Reset Subsystem (`POST /api/people/reset`)**:
   - Enables users to purge all face detections, clusters, and person records to start over fresh.
   - Unlinks cached face avatar crops (`data/thumbnails/faces/*.webp`) and resets `photos.faces_scanned = 0`.
   - Leaves all original library photos, dates, albums, and metadata 100% untouched and safe.
5. **One-Click False Positive Dismissal ("✕ Not a Face")**:
   - Cluster cards feature a dedicated `"Not a Face"` dismissal button with the `UserX` icon.
   - Triggers `POST /api/people/clusters/{cluster_id}/dismiss`, which deletes candidate face rows and unlinks temporary thumbnail files, instantly removing the card with zero residue.
6. **Upright Affine Avatar Normalization**:
   - Uses a 200x200 similarity transform matrix (`AVATAR_REF_POINTS_200`) derived from 5 facial keypoints to rotate and center tilted or reclining faces upright in their avatar crops.
7. **Zero-Pollution Test Architecture**:
   - All test suites (`test_trash.py`, `test_timeline.py`, `test_collages.py`, `test_enhancements.py`, `test_albums.py`, `test_people.py`, `test_thumbnails.py`, `test_ingestion.py`) run directly against the live dev database (`data/database/securephotos.db`).
   - Every test employs guaranteed `try ... finally` teardown blocks to delete test records (`photos`, `albums`, `faces`, `creative_assets`) and disk files upon test completion, leaving the dev database pristine with zero dummy images.

### Functional Decision Points & Rationale
- **Top-Level Hierarchy & Compact Footprint**:
  - *Problem*: Previously, Recognized People were relegated below unlabeled clusters, forcing users to scroll past dozens of cluster cards to view or customize recognized friends and family.
  - *Solution*: Elevated Recognized People to the top section of `PeopleView.tsx`. Compacted card dimensions (`minmax(180px, 1fr)`, 56px avatar) so that up to 6–8 people fit on a single screen row without vertical bloat.
- **In-Place Name & Relationship Editing**:
  - *Problem*: Changing a person's name or relationship formerly required clicking into the drill-down photo gallery.
  - *Solution*: Embedded transparent inline name inputs and relationship selectors on the card itself. Edits persist on blur/Enter without modal overlays or page transitions.
- **Safe Reset with Zero Photo Loss**:
  - *Problem*: Users exploring face detection or fixing classification mistakes may want a clean slate without deleting their photo library.
  - *Solution*: Added `POST /api/people/reset` and a "Reset Faces" toolbar button that purges `faces` and `persons` and resets `faces_scanned = 0` on `photos`, allowing a fresh background scan across all library photos.
- **Bidirectional Relationship Persistence on Cluster Tagging**:
  - *Problem*: When users tagged an unlabeled cluster as an existing person while selecting an updated relationship (e.g. changing from `Friend` to `Extended Family`), `POST /api/people/tag-cluster` only linked faces and updated photo counts, silently discarding the new relationship selection.
  - *Solution*: Enhanced `tag_medoid_cluster` to execute an `UPDATE persons SET relationship_type = ?, is_close_one = ? WHERE id = ?;` whenever `existing` is found and a relationship is supplied. Close family relations (`Extended Family`, `Spouse`, `Child`, `Parent`, `Sibling`) automatically trigger VIP elevation (`is_close_one = 1`).
- **Direct Gallery Relationship Editing**:
  - *Problem*: Previously, modifying a recognized person's relationship required clicking into the person's photo drill-down page, which was non-obvious to users viewing their recognized gallery.
  - *Solution*: Added an inline `<select>` and clickable VIP star directly on the person card in the gallery with `e.stopPropagation()`, giving users 1-click editing capabilities.
- **False-Positive Elimination via Aspect Ratio & Landmark Geometric Bounds**:
  - *Problem*: In low-angle photos (e.g. `IMG_20210404_193449.jpg`), brown leather sandals with straps produced high-confidence false-positive face proposals with aspect ratios $w / h > 2.10$.
  - *Solution*: Implemented an aspect ratio sanity guard in `detect_and_embed_faces` rejecting any proposal where $w / h < 0.55$ or $w / h > 1.70$ (human faces naturally occupy $0.70 - 1.40$). Added landmark geometry verification ensuring inter-ocular distance in 640 space is $\ge 6.0\text{px}$ to discard collapsed keypoint clusters.
- **ArcFace Cosine Distance Threshold Calibration ($0.42 \to 0.48$)**:
  - *Problem*: Photos of the same individual in varied poses (such as lying tilted or smiling broadly) have cosine distances between $0.44$ and $0.47$. The previous strict threshold ($0.42$) fractured them into separate clusters.
  - *Solution*: Calibrated `DISTANCE_THRESHOLD = 0.48` (`SIMILARITY_THRESHOLD = 0.52`). This merges expressive, smiling, and reclining poses of the same person while remaining safely below the cross-identity distance margin ($\ge 0.65 - 0.80$).
- **Distinct Photo Grouping over Raw Limit**:
  - *Problem*: Querying `ORDER BY quality_score DESC LIMIT 4` when a cluster only exists in 1 photo returned 4 duplicate crops from that single image.
  - *Solution*: Added `GROUP BY photo_id` to cluster anchor queries, guaranteeing each tile represents a distinct photo context.
- **In-Place Deduplication in Face Scan Worker**:
  - *Solution*: Before inserting face records for any photo during rescans, `face_scan_worker.py` purges previous face rows and thumbnail files for that `photo_id`, guaranteeing zero duplicate entries.

### Technical Touchpoints
- `engine/services/face_recognition_service.py`: Added `AVATAR_REF_POINTS_200`, aspect ratio filter (`0.55 <= ar <= 1.70`), eye distance guard (`>= 6.0px`), default `conf_thresh = 0.50`, and affine-aligned avatar generation.
- `engine/services/face_clustering_service.py`: Set `SIMILARITY_THRESHOLD = 0.52` (`DISTANCE_THRESHOLD = 0.48`).
- `engine/services/face_scan_worker.py`: Added pre-insertion face and thumbnail purge per `photo_id`; added `reset_scan_state()`.
- `engine/api/people.py`: Grouped anchor face queries by `photo_id`; added `POST /api/people/clusters/{cluster_id}/dismiss`; added relationship and VIP auto-promotion update in `POST /api/people/tag-cluster`; added `POST /api/people/reset`.
- `src/components/PeopleView.tsx`: Placed Recognized People at top, compact card design (`minmax(180px, 1fr)`), in-card name input, in-card relationship dropdown, toggleable VIP star, "Reset Faces" toolbar button.
- `engine/tests/test_people.py`: Added `test_reset_people_and_faces_endpoint`.

### State & Lifecycle Impact
- **Database Cleanliness**:
  - Exactly 22 authentic user photos exist in `photos`.
  - Exactly 0 faces and 0 persons exist in the reset state, ready for a fresh scan.
  - All 22 photos have `faces_scanned = 0`.
  - Running `pytest engine/tests/` leaves 0 orphan records, 0 dummy collages, and 0 dummy photos in the dev database.
- **File System Cleanliness**:
  - Face avatars in `data/thumbnails/faces/` cleaned to 0 files upon reset.
  - Lingering test directories (`data/originals/2022`, `data/originals/undated`) remain 0.

---

## 8. Toolbar Consolidation, Technical Jargon Elimination & Contextual Global Search

### Functionality Overview
To streamline the user experience, optimize vertical space, and eliminate cognitive clutter, the navigation and action bars in `PeopleView` and `TitleBar` were redesigned:
1. **Contextual Global Search (`TitleBar.tsx`)**:
   - Rather than maintaining duplicate search boxes on the screen, the top application `TitleBar` search box now intelligently adapts to the user's active tab.
   - When viewing the People tab (`activeTab === 'people'`), the placeholder changes dynamically to: `"Search people by name or relationship... (Ctrl+K)"`.
   - `PeopleView.tsx` binds directly to `useAppStore.searchQuery`, instantly filtering recognized people by name and relationship without any secondary search input.
2. **Title Area Action Consolidation & Vertical Space Reclaiming**:
   - The secondary toolbar row was removed entirely, reclaiming ~80px of vertical viewport height for photos and face clusters.
   - The primary action buttons were consolidated into the top-right of the title row:
     - **Reset Faces Button**: Prominently styled as a secondary action button with distinct border, background, and hover states (`var(--bg-surface-elevated)`, hover danger tint), ensuring clear affordance.
     - **Scan Photos for Faces Button**: Styled as the primary action button (`var(--accent-primary)`) with live scanning spinner and disabled states.
3. **Single Primary CTA (Elimination of Duplicate Scan Button)**:
   - Eliminated the redundant `"Scan Library Now"` button inside the empty state card.
   - The empty state card now provides clear, focused guidance directing users to the primary `"Scan Photos for Faces"` header button, avoiding confusing duplicate actions with different labels.
4. **User-Centric Language (Zero Technical Jargon)**:
   - Replaced internal engineering noise (`"High-Accuracy On-Device Face Recognition (YOLOv8 + ArcFace 512-D) • 100% Private"`) with clear, user-focused copy: `"Group and organize photos of people in your library • 100% Private & On-Device"`.

### Functional Decision Points & Rationale
- **Contextual Global Search vs. Local Filter Boxes**:
  - *Problem*: Having two search inputs visible simultaneously (the global title bar search and a local people search) confused users and consumed unnecessary screen space.
  - *Solution*: Made the top `TitleBar` search bar contextual. When on the People tab, typing or hitting `Ctrl+K` filters recognized people. When switching tabs, the search resets or applies contextually.
- **Header Action Consolidation**:
  - *Problem*: The previous layout had an empty space next to the title while placing action buttons in a separate lower toolbar row, pushing content down by ~80px.
  - *Solution*: Aligned action buttons (`Reset Faces` and `Scan Photos for Faces`) to the right side of the main title header (`justifyContent: "space-between"`).
- **Single CTA Principle**:
  - *Problem*: Two buttons with different names (`"Scan Photos for Faces"` vs `"Scan Library Now"`) performed the identical action, creating user hesitation.
  - *Solution*: Kept a single primary CTA in the header, updating empty state copy to reference it directly.

### Technical Touchpoints
- `src/components/TitleBar.tsx`: Added `activeTab` from `useAppStore` and `getSearchPlaceholder()` helper.
- `src/components/PeopleView.tsx`: Subscribed to `useAppStore.searchQuery`; removed redundant inner search input and `Search` icon; relocated `Reset Faces` and `Scan Photos for Faces` buttons to the header row; removed `"Scan Library Now"` from empty state.

---

## 9. Single-Row Circular Avatar Shelf with Relationship Prioritization & Management Modal

### Functionality Overview
To maximize viewport room for unlabeled face cluster tagging while providing an intuitive, personal feel for recognized individuals, the Recognized People section in `PeopleView.tsx` was redesigned as a single horizontal avatar shelf:
1. **Single-Line Circular Avatar Shelf**:
   - Displays recognized people in a single horizontal row (`overflowX: auto` with hidden scrollbars).
   - Consumes only ~100px of vertical height (down from 300px+ in the previous multi-row grid), leaving immediate room for the primary tagging workflow (Unlabeled Clusters).
   - Each avatar tile features:
     - 60px circular avatar (`borderRadius: 50%`) with smooth hover ring and scale transition (`scale(1.08)`).
     - Close One (VIP) gold star badge overlay if `is_close_one`.
     - Name centered in 12px semi-bold, truncated cleanly with ellipsis.
     - Relationship type centered as subtext in 11px muted font (e.g. `Spouse`, `Extended Family`, `Friend`).
2. **Relationship Hierarchy Prioritization**:
   - Recognized people are sorted by explicit relationship priority weight:
     - `Spouse` (10)
     - `Child` (9)
     - `Parent` (8)
     - `Sibling` (7)
     - `Extended Family` (6)
     - `Friend` (5)
     - `Relative` (4)
     - `Colleague` (3)
     - `Acquaintance` (2)
   - Ties are broken by `confirmed_count` (descending), then alphabetically by name.
   - Ensures immediate family and close friends are positioned at the start of the shelf.
3. **"See All" Management Modal**:
   - A stylized circular "See All" tile is placed at the end of the shelf, along with a `"See All (N) →"` header button.
   - Clicking opens a dedicated management modal overlay with:
     - Live search filter across all recognized people.
     - Full card grid with in-place name editing, inline relationship dropdown, and VIP star toggle.
     - Quick link to browse all photos of any person.

### Functional Decision Points & Rationale
- **Single Shelf vs. Multi-Row Grid**:
  - *Problem*: Multi-row grid pushed unlabeled clusters below the fold, forcing users to scroll past recognized faces to reach their primary task (tagging new faces).
  - *Solution*: Replaced the grid with a single-line horizontal shelf taking only ~100px.
- **Priority Weights (Friends=5, Relatives=4)**:
  - *Rationale*: Close family comes first, followed by extended family, then close friends, followed by more distant relatives, colleagues, and acquaintances.
- **Dedicated Management Modal**:
  - *Rationale*: Gives users a focused, distraction-free environment to review all recognized faces and fix names or relationships in bulk.

### Technical Touchpoints
- `src/components/PeopleView.tsx`: Added `RELATION_PRIORITY`, updated sorting logic, rendered horizontal avatar shelf with "See All" button, and created the full management modal.

---

## 10. Concise 'Scan Faces' Action, Force Rescan & Optimistic Progress Feedback

### Functionality Overview
1. **Concise Button Text**:
   - Shortened the primary face scan action button from `"Scan Photos for Faces"` to **`"Scan Faces"`** (and `"Scanning Library..."` to **`"Scanning..."`**), eliminating wordiness.
   - Updated the empty state prompt to: `Click "Scan Faces" above to run on-device facial detection across your media library.`
2. **Force Rescan & Auto-Recovery (`force: bool = False`)**:
   - Added a `force` query parameter to `POST /api/people/scan?force=true`.
   - When triggered, if `force=True` or if `faces` table is currently empty, the background worker automatically resets `faces_scanned = 0` across active library photos and initiates a full scan.
   - Prevents the "dead click" bug where clicking scan when all photos are marked `faces_scanned = 1` resulted in 0 unscanned items and no visible UI change.
3. **Instant Optimistic Visual Feedback**:
   - In `PeopleView.tsx`, clicking `"Scan Faces"` immediately sets `is_scanning: true` in local state before the HTTP request returns, instantly displaying the loading spinner and scanning progress banner without hesitation.
   - Polling loop continuously tracks `scanned_photos`, `total_photos`, and `current_photo` until all faces are extracted and medoids clustered.

### Technical Touchpoints
- `engine/services/face_scan_worker.py`: Added `force: bool = False` to `run_background_face_scan` and `start_background_scan`; added zero-face auto-recovery; set `is_scanning = True` immediately upon invocation.
- `engine/api/people.py`: Added `force: bool = False` query parameter to `POST /api/people/scan`.
- `src/components/PeopleView.tsx`: Shortened button text to `"Scan Faces"` / `"Scanning..."`; updated `handleTriggerScan` to pass `?force=true` and set optimistic state.

---

## 11. Fixed 4-Slot Anchor Thumbnail Grid with Transparent Placeholders

### Functionality Overview
1. **Identical Card Dimensions Across All Clusters**:
   - In `PeopleView.tsx`, cluster cards previously adapted their column count dynamically (`repeat(${count}, 1fr)`). This resulted in clusters with only 1 or 2 photos stretching their thumbnail images to giant proportions (up to 400px $\times$ 400px), causing severe height discrepancies and pixelated previews across adjacent cards.
   - The cluster photo preview is now permanently structured as a **fixed 4-slot grid** (`gridTemplateColumns: "repeat(4, 1fr)"`, `gap: "8px"`).
2. **Transparent Dummy Placeholders**:
   - For clusters with fewer than 4 distinct photos (e.g. 1 or 2 photos), the remaining slots are populated by transparent placeholder elements with `aspectRatio: "1 / 1"` and `visibility: "hidden"`.
   - Ensures that whether a person appears in 1, 2, 3, or 12+ photos, each thumbnail remains **exactly the same compact, uniform size (~85px)** and all cluster cards share identical heights and aspect ratios.

### Technical Touchpoints
- `src/components/PeopleView.tsx`: Fixed `gridTemplateColumns` to `repeat(4, 1fr)`; padded `slots` array to 4 items with `null` fallbacks; rendered hidden dummy elements for vacant slots.

---

## 12. Non-Destructive Library Scanning, Cover Self-Healing & Test Isolation

### Functionality Overview
1. **Non-Destructive Facial Scanning**:
   - Previously, re-scanning library photos with `force=True` wiped `faces_scanned` on all photos and executed `DELETE FROM faces WHERE photo_id = ?;`, discarding all existing face records and unlinking avatar crop files. As a consequence, identified faces reverted to `person_id = NULL`, causing already-tagged individuals to reappear in "Unlabeled Face Clusters" and breaking avatar images.
   - The scanner workflow was made strictly non-destructive:
     - `face_scan_worker.py` only purges unconfirmed faces: `DELETE FROM faces WHERE photo_id = ? AND person_id IS NULL;`.
     - Confirmed face identities (`person_id IS NOT NULL`) and their existing embeddings are preserved.
     - `handleTriggerScan` in `PeopleView.tsx` triggers incremental scanning without blanket force resets.
2. **Avatar Cover Self-Healing & Active Medoid Prioritization**:
   - In `engine/api/people.py` (`GET /api/people`), added automatic self-healing: if a person's `cover_face_id` points to a face ID that no longer exists in the database, the endpoint queries the highest-quality medoid face currently associated with that `person_id` and persists the repair to `persons.cover_face_id`.
   - In `POST /api/people/tag-cluster`, updated the SQL assignment from `COALESCE(cover_face_id, ?)` to `COALESCE(?, cover_face_id)`, ensuring the newly computed cluster medoid is always prioritized over stale references.
3. **Guaranteed Test Database Isolation**:
   - `test_people_api_workflow` uses dedicated mock face IDs (`cluster_workflow_mock`) rather than modifying live unlabelled clusters.
   - `test_reset_people_and_faces_endpoint` backs up existing `persons`, `faces`, `photos.faces_scanned` rows, and disk thumbnail files to a temporary directory prior to calling `/api/people/reset`, and restores all records and thumbnail files in a `finally` block, preventing test runs from ever destroying active user data.

### Functional Decision Points & Rationale
- *Preserve Confirmed Faces vs. Full Re-computation*: Re-running face detection on an entire library should detect new faces and update unassigned clusters, but must never destroy user-labeled identities or invalidate face crops.
- *Active Medoid Priority*: When a user labels an unassigned cluster or merges clusters into an existing person, the most representative face from that cluster (medoid) should become the new cover image unless explicitly overridden.
- *Test DB Isolation*: In development environments where tests run against the primary SQLite database, destructive test cases must isolate synthetic records or perform atomic save-and-restore to guarantee zero user data loss.

### Technical Touchpoints
- `engine/services/face_scan_worker.py`: Changed face deletion SQL to `DELETE FROM faces WHERE photo_id = ? AND person_id IS NULL;`.
- `engine/api/people.py`: Implemented self-healing medoid fallback in `GET /api/people`; changed `cover_face_id` SQL priority in `POST /api/people/tag-cluster`.
- `src/components/PeopleView.tsx`: Removed `?force=true` query parameter from `handleTriggerScan`.
- `engine/tests/test_people.py`: Added isolated mock fixtures and full database/thumbnail backup and restoration to `test_reset_people_and_faces_endpoint` and `test_people_api_workflow`.

### State & Lifecycle Impact
- Eliminates ghost unlabelled clusters after library rescanning.
- Ensures all recognized person avatars load reliably (HTTP 200) across navigation between albums, search, and people tabs.
- Protects database persistence integrity across automated CI/CD and local pytest runs.

---

## 13. Media Library Dashboard & Storage Visualizer with Integrated Stories

### Functionality Overview
1. **Executive Media Distribution Metrics**:
   - Provides live index-backed counts for **Photos & Images**, **Videos & Clips**, and **OCR-Scanned Documents & Receipts**, alongside **Favorites**, **Recognized People**, and **Albums**.
   - Clicking any primary media card immediately routes the user to the corresponding view (Photos or Documents).
2. **Physical Storage Allocation & Multi-Segment Visualizer**:
   - Measures the exact byte footprint consumed by the SecurePhotos application:
     - Managed original media (`data/originals`)
     - 2K/4K display proxies (`data/previews`)
     - Micro-thumbnails cache (`data/thumbnails`)
     - Relational SQLite database & FTS5 full-text index (`data/database`)
     - Local ONNX and GGUF neural AI models (`data/models`)
   - Visual multi-segment horizontal gauge displays:
     - **SecurePhotos Vault** (Vibrant Purple gradient)
     - **OS & Other System Files** (Slate Gray gradient)
     - **Available Free Disk Space** (Emerald Green gradient)
3. **Hardware Partition Detection & Internal Drive Contextual Advisory**:
   - Win32 API (`GetDriveTypeW` and `GetDiskFreeSpaceExW`) detects whether the active storage partition is an **Internal Fixed Drive** or **External Removable USB Drive**.
   - If the vault resides on an internal system drive, displays a clear contextual advisory:
     *"This vault is stored on an internal system drive ({drive_letter}). Available space is shared with the operating system, installed applications, and personal files. SecurePhotos is utilizing {app_size} ({pct}%) of the drive."*
4. **Integrated Stories & Nostalgic Memories Section (Option A Layout)**:
   - Houses AI-curated nostalgic reels ("Through the Years", "On This Day", "Year in Review") directly within the dashboard command center.
   - Includes a "Curate / Generate Stories" trigger that invokes `POST /api/stories/generate` to synthesize milestone reels from close persons or prominent timeline years.
   - Interactive story cards launch the dynamic `StoryPlayerModal` with beat-synchronized soundtrack vibes and auto-advancing slides.

- **Bento Grid HUD Layout (Single-Viewport Ergonomics)**:
  - *Rationale*: Replaced bulky vertical scrolling cards with a high-density, single-screen Bento grid layout inspired by modern desktop design (macOS Sonoma / Linear):
    1. **Cinematic Hero Tile (60% width)**: Highlights the active curated story reel with ambient glow, soundtrack vibe, pagination controls, and one-click montage playback.
    2. **Storage & Drive HUD Tile (40% width)**: Displays an SVG circular donut chart and concise 4-tier breakdown:
       - **Media Content** (Blue): Photos, videos, display proxies, and thumbnails combined.
       - **App & Engine** (Purple): SecurePhotos SQLite database, FTS5 search index, and local AI neural models.
       - **Other Files** (Slate Gray): All other files/software on the drive (omitting OS-specific assumptions to accurately support secondary internal data drives like D:\ and external drives).
       - **Free Space** (Emerald Green): Unallocated storage capacity.
       - **Clean 1-Line Notice**: *"✦ Note: Drive space is shared with other files and software stored on this drive."*
    3. **High-Density Metric Strip (Bottom)**: 6 micro-stat cards for Photos, Videos, Documents, Favorites, People, and Albums with one-click navigation.
- **Sub-5ms Query Latency**:
  - *Covering Index*: Added `CREATE INDEX IF NOT EXISTS ix_photos_counts ON photos (is_document, mime_type, trashed_at);` allowing a single unified SQL query with `CASE` aggregation to return all media counts in under 2ms.
  - *Filesystem Cache*: Cached filesystem walks for app components with a 15-second TTL (`STORAGE_CACHE_TTL_SEC`), preventing redundant disk I/O when navigating between tabs.



### Technical Touchpoints
- **Backend API**:
  - `engine/api/system.py`: Added `GET /api/system/dashboard`, returning `DashboardOverviewResponse` with `media_counts`, `app_storage`, and `drive_storage`.
  - `engine/database.py`: Added covering composite index `ix_photos_counts`.
  - `engine/services/stories_service.py`: Added `generate_year_in_review_story`.
  - `engine/api/stories.py`: Added `POST /api/stories/generate` endpoint.
  - `engine/tests/test_dashboard_api.py`: Automated contract & unit tests covering counts, storage calculations, and internal drive disclaimer.
- **Frontend Components**:
  - `src/components/DashboardView.tsx`: Glassmorphic executive dashboard with counter cards, storage allocation bar, internal drive notice, and stories grid.
  - `src/components/Sidebar.tsx`: Added `Dashboard` with `<LayoutDashboard />` as the top navigation item.
  - `src/App.tsx`: Wired `DashboardView` into main layout routing.
  - `src/types/index.ts`: Added TypeScript interfaces `DashboardOverview`, `MediaCounts`, `AppStorageStats`, `DriveStorageStats`, and `StoryModel`.
  - `src/store/useAppStore.ts`: Added `"dashboard"` to `NavTab` and set as default landing tab.

### State & Lifecycle Impact
- Default landing experience transitions from an empty photo grid to the executive dashboard.
- Real-time refresh button allows immediate re-synchronization with disk storage.
- All media queries strictly exclude trashed items (`trashed_at IS NULL`), maintaining consistency with the 30-day trash lifecycle.

---

## 14. Atomic In-Place Media Replacement (Swap) & Storage Reclamation

### Functionality Overview
1. **Zero-Duplicate Storage Architecture**:
   - Ingestion previously generated a duplicate 2048px WebP display proxy (`data/previews`) for every imported photo, causing 23 photos (~32 MB of originals) to consume ~87 MB of total media storage.
   - The ingestion pipeline was streamlined to generate solely the 1024px grid thumbnail (`data/thumbnails`), completely eliminating redundant 2K proxy files on import.
2. **Atomic In-Place Optimization (Swap)**:
   - When the background optimization engine runs (acutance sharpening, 8K super-resolution for low-res shots, and YOLOv8-Face + CodeFormer face unblur), it performs a **verified atomic in-place replacement** directly on the managed photo file (`filepath`).
   - The enhanced asset is written to a temporary hidden file (`.{filename}.opt.tmp`) in the identical directory.
   - The temporary file is validated for byte completeness and decodability (`Image.open().verify()`).
   - The kernel atomically swaps the file via `os.replace(temp_dest, target_file)`.
   - The SQLite database record is updated in the same flow with the new cryptographic SHA-256 checksum (`file_hash`), new file size (`file_size`), updated pixel dimensions (`width`, `height`), and `preview_path = NULL`.
3. **Seamless Lightbox Display & Space Reclaim**:
   - `GET /api/photos/{photo_id}/preview` falls back dynamically to the managed `filepath` if `preview_path` is null, serving the enhanced image with zero duplication overhead.
   - Existing legacy display proxies (107 files totaling ~50 MB) were safely purged from `data/previews/`, dropping the media storage footprint from ~87 MB down to **37.7 MB**.

### Functional Decision Points & Rationale
- **In-Place Replacement vs. Duplicate Proxies**:
  - *Problem*: Maintaining separate "Original", "Preview Proxy", and "Thumbnail" files triples storage usage, making 20-30 photos consume nearly 100 MB.
  - *Solution*: Once the enhancement engine polishes a photo (applying lossless acutance and face restoration), replacing the original file in-place preserves high fidelity while eliminating redundant copies.
- **Fail-Safe Temporary File & Kernel Atomic Swap**:
  - *Rationale*: Writing directly over the destination file risks corruption if interrupted by a crash or power loss. By writing to a `.opt.tmp` file in the same directory and verifying decodability before calling `os.replace`, zero data loss is mathematically guaranteed.
- **Dynamic Checksum & Metadata Sync**:
  - *Rationale*: Any modification to image pixels alters its SHA-256 hash and byte size. Recomputing and persisting the new hash and dimensions in SQLite guarantees that deduplication, cache validation, and EXIF integrity remain 100% accurate.

### Technical Touchpoints
- `engine/services/super_resolution_service.py`: Updated `upscale_and_optimize_to_8k` to perform atomic swap on `src_file` with format detection (JPEG/PNG/WebP), integrity verification (`Image.open().verify()`), and error cleanup.
- `engine/api/photos.py`: Updated `run_background_optimization` to execute atomic in-place optimization on `filepath`, compute new SHA-256 hashes and file dimensions, unlink old preview files, and update SQLite records with `preview_path = NULL`. Updated `get_photo_preview` to seamlessly stream `filepath` when `preview_path` is null.
- `engine/services/ingestion_service.py`: Omitted redundant `generate_display_preview` call during single photo ingestion, setting `preview_path = None`.
- `engine/tests/test_dashboard_api.py`: Added automatic test row cleanup (`DELETE FROM photos WHERE filepath LIKE '%test_dash_%'`) in a `finally` block to avoid test artifact leakage.

### State & Lifecycle Impact
- Media storage consumption for the library dropped from ~87 MB to **37.7 MB** (32.6 MB originals + 5.1 MB grid thumbnails + 0.0 MB previews).
- The storage donut chart on the Dashboard immediately reflects the reclaimed ~50 MB of disk space.
- Photo lightbox and grid views retain full resolution rendering with instantaneous loading.

---

## 15. Streamlined Lightbox & Studio Poster Print Readiness

### Functionality Overview
1. **Streamlined Viewing Experience**:
   - Removed the redundant development Before/After split slider, polygon clipping container, and `E` keyboard shortcut from `Lightbox.tsx`.
   - The lightbox now focuses entirely on a distraction-free, 60fps cinematic photo viewing experience with seamless instant thumbnail backdrops and progressive high-res loading.
2. **Studio Print Readiness Calculator**:
   - Integrated a live print-dimension calculator inside the Lightbox EXIF Metadata drawer (`Info` button).
   - Dynamically calculates maximum physical print dimensions in inches and centimeters based on actual pixel resolution:
     - **300 DPI Studio Glossy / Framing**: Max razor-sharp print size (e.g. `25.6" × 17.1"` / `65 × 43 cm`).
     - **200 DPI Wall Poster / Canvas**: Max poster size (e.g. `38.4" × 25.6"` / `97 × 65 cm`).
   - Displays a prominent status badge (`✓ Studio Poster Ready`, `✓ Studio Photo Ready`, or `Desk Print Ready`).
3. **Dedicated 300 DPI Studio Master Export**:
   - Added a **`Studio Print (300 DPI)`** action button to both the Lightbox top header toolbar and the EXIF drawer.
   - Enhanced `GET /api/photos/{photo_id}/download?mode=studio_print` endpoint:
     - Embeds explicit `dpi=(300, 300)` metadata into the JFIF/EXIF header, preventing photo studio automated RIP kiosks from falsely rejecting the file as low-resolution.
     - Saves at Quality 98 with **`subsampling=0` (4:4:4 full chroma preservation)**, preventing color bleeding and compression ringing around high-contrast edges.
     - Uses Starlette `BackgroundTask` to safely delete temporary studio print exports after streaming.

### Functional Decision Points & Rationale
- **Removal of Split Comparison**:
  - *Rationale*: With atomic in-place optimization replacing the original on disk to conserve storage, comparing against an identical file in memory was redundant and created UI clutter.
- **Embedded 300 DPI Metadata vs. Raw Pixel File**:
  - *Problem*: Even when an image possesses 8K resolution (7,680 px), photo lab software often reads the default 72 DPI header and warns the lab technician that the image is unsuited for physical printing.
  - *Solution*: Injecting `(300, 300)` DPI and 4:4:4 chroma into the export file eliminates studio rejection at photo kiosks and print labs.

### Technical Touchpoints
- `engine/api/photos.py`: Added `mode: str = Query("original", pattern="^(original|studio_print)$")` to `GET /api/photos/{photo_id}/download`, implementing 300 DPI generation with 4:4:4 chroma subsampling.
- `engine/tests/test_enhancements.py`: Added `test_download_studio_print_300dpi` contract test validating response headers, status code, and `(300, 300)` DPI verification via PIL.
- `src/components/Lightbox.tsx`: Removed `showSplitSlider` state, split divider, and `E` key shortcut; added `<Printer /> Studio Print (300 DPI)` toolbar action; added Studio Print Readiness Card in EXIF drawer.

### State & Lifecycle Impact
- Zero database schema modifications required.
---

## 16. People View Photo Drilldown: Lightbox Viewing, Ambient Slideshow & Clean Navigation

### Functionality Overview
Resolves three critical navigation and viewer UX defects in the People feature:
1. **Interactive Lightbox Viewing**:
   - Clicking any photo thumbnail in a recognized person's photo collection now immediately opens the photo inside the high-resolution Lightbox viewer.
   - Preserves the person's photo list context (`lightboxPhotos`), enabling seamless left/right keyboard (`ArrowLeft`/`ArrowRight`) and mouse navigation across all photos of that person.
2. **Cinematic Ambient Slideshow**:
   - Added a prominent **`Slideshow ({count})`** button in the top action toolbar of the person drill-down view.
   - Reuses `AlbumSlideshowModal`, offering auto-advancing slides, Ken Burns hardware-accelerated pan/zoom motion, and procedurally generated Web Audio ambient soundscapes without external media assets.
3. **Dedicated Breadcrumb & Navigation Bar**:
   - Decoupled the **`Back to People`** button from the person's profile hero card into a dedicated, clean top navigation bar.
   - Cleanses state upon clicking (`selectedPerson = null`, `personPhotos = []`), ensuring fast, flicker-free returns to the main People grid.
   - Added an interactive favorite toggle (`Heart` icon) on photo thumbnails wired to `onToggleFavorite`.

### Functional Decision Points & Rationale
- **Decoupled Breadcrumb Bar vs. Inline Jammed Header**:
  - *Problem*: The "Back to People" button was crammed inside the same flex row as the 52px avatar, person's name, VIP star, relationship dropdown, and affinity badge, causing layout wrapping, poor visual hierarchy, and misclicks on mobile or smaller desktop windows.
  - *Solution*: Placed "Back to People" on the left of a dedicated top navigation bar, with the new "Slideshow" action button positioned on the right. Below this bar, a separate, elevated Hero Profile Card clearly showcases the person's avatar, metadata, and relationship controls.
- **Props Wiring in `App.tsx` (`onPhotoClick`, `onToggleFavorite`)**:
  - *Problem*: `PeopleView` was mounted in `App.tsx` with zero props, and photo grid cards lacked `onClick` listeners, rendering the thumbnails inert.
  - *Solution*: Passed `onPhotoClick={(idx, personPhotos) => { setLightboxPhotos(personPhotos); setLightboxIndex(idx); }}` and `onToggleFavorite={handleToggleFavorite}` to `<PeopleView />`.
- **Slideshow Component Reuse**:
  - *Rationale*: Rather than duplicating slideshow code, `AlbumSlideshowModal` was cleanly reused by passing `albumName={`${selectedPerson.name}'s Photos`}` and `photos={personPhotos}`.

### Technical Touchpoints
- `src/components/PeopleView.tsx`:
  - Added `PeopleViewProps` (`onPhotoClick`, `onToggleFavorite`).
  - Added `isSlideshowOpen` state and rendered `<AlbumSlideshowModal />`.
  - Added dedicated navigation bar with `Back to People` and `Slideshow` action button.
  - Added `onClick` handler to photo thumbnails to trigger `onPhotoClick(idx, personPhotos)` with pointer cursor.
  - Made the favorite heart badge interactive with stopPropagation and local state update.
- `src/App.tsx`:
  - Provided `onPhotoClick` and `onToggleFavorite` props to `<PeopleView />`.

### State & Lifecycle Impact
- Zero database changes; purely enhances frontend interaction, state propagation, and UX fidelity.







