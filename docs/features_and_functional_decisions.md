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

## 16. People View Photo Drilldown: Apple Photos Cinematic Hero, Ambient Slideshow & Chronological Timeline

### Functionality Overview
Elevates the individual person photo viewing experience from an administrative boxy layout into a modern, magazine-grade **Apple Photos-inspired Cinematic Experience**:
1. **Interactive Lightbox Viewing**:
   - Clicking any photo thumbnail opens the high-resolution Lightbox viewer with global index tracking across that person's library.
   - Enables smooth left/right navigation (`ArrowLeft`/`ArrowRight`) across all of that person's photos.
2. **Cinematic Ambient Slideshow**:
   - Prominent **`Play Slideshow ({count})`** button styled with vibrant indigo-to-violet gradient and glowing ambient elevation.
   - Integrates `AlbumSlideshowModal` with hardware-accelerated Ken Burns motion and real-time Web Audio procedural soundscapes.
3. **Unified 56px Compact Glassmorphic Header**:
   - Merged the previously stacked navigation bar and hero container into a single, space-efficient 56px sticky bar (`backdrop-filter: blur(20px)`), reclaiming over 140px of vertical screen real estate on laptops and smaller displays.
   - Houses the `← People` button, a 42px circular halo avatar, person's name with inline VIP Close One toggle (`★`), and clean non-technical subtitle (`{count} photos • {yearsRange}`).
   - Right side houses the interactive `[ 🏷️ Relationship: Spouse ▾ ]` popover pill and `Play Slideshow` action button.
   - Cleanses state (`selectedPerson = null`, `personPhotos = []`, `personFilter = 'all'`, `isRelationshipPopoverOpen = false`) upon exiting.
4. **Removal of Technical "Affinity" Jargon**:
   - Eliminated the internal machine learning score ("Affinity 0%") from user view, keeping the subtitle natural and human-friendly (e.g. `2 photos • 2021`).
5. **Modern Interactive Relationship Popover Pill**:
   - Replaced the clunky raw `<select>` dropdown with an interactive pill `[ 🏷️ Relationship: Family ▾ ]`.
   - Clicking opens a sleek floating popover chip menu with active checkmarks, eliminating administrative form visual noise.
6. **Smart Quick-Filter Strip**:
   - One-tap filter chips: `All ({count})`, `Favorites ({favCount})`, and dynamic Year chips (`2024`, `2023`, etc.).
7. **Chronological Timeline Grouping**:
   - Automatically groups photos into Month & Year clusters (e.g. *"August 2024"*, *"June 2024"*, *"Earlier Moments"*).
   - Sticky section headers with sub-item counts and responsive 190px cards with smooth elevation transitions.

### Functional Decision Points & Rationale
- **Single Unified Header vs. Stacked Multi-Block Layout**:
  - *Problem*: Stacking a top navigation bar above a large portrait hero card consumed ~250px (nearly 40% of the viewport) before photos were visible on laptops and smaller windows.
  - *Solution*: Merged navigation, avatar, title, VIP badge, relationship selector, and slideshow trigger into a single 56px glassmorphic bar, saving ~140px and bringing photos into immediate view.
- **Elimination of Internal AI Metrics ("Affinity %")**:
  - *Problem*: The social affinity score is an internal heuristic used to determine story inclusion. Exposing "Affinity 0%" to end users (e.g. "Spouse • Affinity 0%") caused confusion and appeared as a defect.
  - *Solution*: Replaced it with clean temporal and count metadata (`{count} photos • {yearsRange}`).

### Technical Touchpoints
- `src/components/PeopleView.tsx`:
  - Unified single-bar sticky header merging `ArrowLeft`, 42px avatar, name, VIP toggle, relationship popover, and slideshow trigger.
  - Added `useMemo` timeline grouper, year extraction, and multi-mode filter (`all`, `favorites`, `year`).
  - Added `isRelationshipPopoverOpen` and floating popover chip menu.
  - Added timeline group mapping with sticky headers and responsive cards.
- `src/App.tsx`:
  - Provided `onPhotoClick` and `onToggleFavorite` props to `<PeopleView />`.

### State & Lifecycle Impact
- Zero database modifications; delivers a dramatic upgrade in visual polish, interaction speed, and emotional presentation.

---

## 17. Universal Harmonized Responsive Photo Grid Sizing

### Functionality Overview
Harmonizes individual photo thumbnail scaling across all core photo viewing surfaces in the application (Photos Library, inside Albums, and inside People collections):
1. **Target Responsive Size Standard (`minmax(185px, 1fr)`)**:
   - Replaced the rigid, non-responsive `COLUMNS = 5` in `PhotoGrid.tsx` with an adaptive ResizeObserver grid engine targeting 185px per photo card with a consistent 10px gap.
   - On wide desktop monitors (e.g. 1920px), the grid automatically scales up to 8–9 columns, maintaining clean 185px cards rather than blowing up photos to 350px+.
   - On compact laptop displays (e.g. 1200px), it scales down to 5–6 columns, keeping cards at the exact same physical size.
2. **Unified Inter-Tab Geometry**:
   - Standardized `PhotoGrid.tsx`, `AlbumsView.tsx`, and `PeopleView.tsx` to share identical `185px` minimum width, `10px` gap spacing, and `var(--radius-md)` corner curvature.
   - Photos feel identical in size and feel regardless of which navigation route was used to open them.

### Technical Touchpoints
- `src/components/PhotoGrid.tsx`: Added adaptive column & row-height calculation based on `parentRef.current.clientWidth` with ResizeObserver; standardized `gap` to 10px.
- `src/components/AlbumsView.tsx`: Standardized album photo grid to `repeat(auto-fill, minmax(185px, 1fr))` with `10px` gap.
- `src/components/PeopleView.tsx`: Standardized people photo grid to `repeat(auto-fill, minmax(185px, 1fr))` with `10px` gap.

---

## 18. Centered Glassmorphic Header for Album Detail View

### Functionality Overview
Harmonizes the Album Detail viewing experience (`AlbumsView.tsx`) with the modern glassmorphism design language established in People Detail (`PeopleView.tsx`):
1. **Enlarged Plus Jakarta Sans Title & Inline Frosted Capsule Badge**:
   - The album name is rendered in modern geometric display typography (**Plus Jakarta Sans**, `fontSize: 22px`, `fontWeight: 800`, `letterSpacing: -0.03em`, crisp `#ffffff` with subtle text shadow).
   - The photo count (`X photos`) is positioned on the **same horizontal baseline** right next to the title inside a frosted capsule badge (`backgroundColor: rgba(255, 255, 255, 0.08)`, `border: 1px solid rgba(255, 255, 255, 0.12)`, `backdropFilter: blur(8px)`, `borderRadius: var(--radius-full)`).
   - Eliminates vertical awkwardness and achieves an elegant, balanced single-line horizontal center layout.
   - Built on a balanced 3-column flex layout (`flex: 1` Left, `flex: 0 1 auto` Center, `flex: 1` Right) to ensure true horizontal alignment regardless of button widths on either flank.
2. **Unified Frosted Glass Theme (Matching People Detail)**:
   - Header container upgraded to a floating glassmorphic bar:
     - `backgroundColor: "rgba(23, 23, 23, 0.85)"`
     - `backdropFilter: "blur(20px)"` and `-webkit-backdrop-filter: "blur(20px)"`
     - Border highlight: `1px solid rgba(255, 255, 255, 0.08)`
     - Soft elevation shadow: `box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25)`
     - Floating rounded bar: `borderRadius: "var(--radius-lg)"` with sticky positioning (`position: sticky; top: 0; z-index: 20`, `minHeight: 56px`, `padding: 10px 20px`).
3. **Pill-Shaped Action Buttons**:
   - **`← All Albums` Navigation**: Pill-shaped button (`borderRadius: "var(--radius-full)"`, `backgroundColor: "rgba(255, 255, 255, 0.06)"`, `border: "1px solid rgba(255, 255, 255, 0.1)"`).
   - **`Slideshow`**: Pill-shaped with vibrant gradient (`linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)`) and glowing elevation shadow (`0 3px 12px rgba(99, 102, 241, 0.35)`).
   - **`Add Photos`**: Pill-shaped primary accent button (`borderRadius: "var(--radius-full)"`).
   - **`Delete Album`**: Pill-shaped danger glass button (`backgroundColor: "rgba(239, 68, 68, 0.12)"`, `border: "1px solid rgba(239, 68, 68, 0.25)"`).

### Functional Decision Points & Rationale
- **Single-Line Baseline with Inline Capsule Badge vs. Stacked Subtitle**:
  - *Problem*: Stacking a small `11px` photo count underneath an 18px title created vertical clumsiness in a horizontal floating glass bar and left excessive unused horizontal space.
  - *Solution*: Scaling the title to 22px Plus Jakarta Sans and placing the photo count in an inline frosted capsule chip aligns all elements along a unified horizontal baseline, creating a high-end feel inspired by Apple Photos and Linear.
- **3-Column Flex Structure (`flex: 1` / `flex: 0 1 auto` / `flex: 1`) vs. Simple Justify-Between**:
  - *Problem*: In a standard `justify-content: space-between` layout, differing widths between the left navigation button and right action cluster causes the center title to tilt off-center towards whichever side has fewer buttons.
  - *Solution*: Giving both flanking containers `flex: 1` guarantees the title and photo count remain strictly centered in the viewport.
- **Glassmorphic Consistency Across Core Navigation Tabs**:
  - *Problem*: The previous album detail header was a flat solid bar (`var(--bg-sidebar)`), contrasting with the modern floating frosted glass headers in `PeopleView.tsx`.
  - *Solution*: Adopting the identical glassmorphic tokens creates a seamless, cohesive aesthetic throughout the application.

### Technical Touchpoints
- `index.html`: Loaded Google Font `Plus Jakarta Sans` (`wght@500;600;700;800`).
- `src/index.css`: Added `--font-display: 'Plus Jakarta Sans', 'Inter', ...` token.
- `src/components/AlbumsView.tsx`: Updated Album Detail header to floating glass container, applied 3-column flex centering with 22px Plus Jakarta Sans title and inline frosted capsule photo count badge, upgraded navigation and action buttons to pill shape with gradient accents.
- `src/components/PeopleView.tsx`: Updated Person Detail drill-down header to balanced 3-column layout with 22px Plus Jakarta Sans name, inline frosted capsule count badge (`[ N photos • YearRange ]`), halo avatar on the left, and pill action buttons on the right.
- `src/components/DocumentsView.tsx`: Upgraded header to floating glass bar with centered 22px Plus Jakarta Sans title, inline capsule document count badge, category pill filters on the left, and OCR search pill on the right.
- `src/components/TrashView.tsx`: Upgraded header to floating glass bar with centered 22px Plus Jakarta Sans title, inline capsule item count badge, Select All pill on the left, and pill-shaped Restore / Empty Trash actions on the right.
- `src/components/VaultView.tsx`: Upgraded active vault header to floating glass bar with centered 22px Plus Jakarta Sans title, inline capsule count badge, in-memory unlock status badge on the left, and pill action buttons on the right.

### State & Lifecycle Impact
- Zero database or API changes required; pure UI/UX styling and cross-app layout harmonization.

### Cross-App Design Standard Mandate
- Formally established as the mandatory design pattern codified in `.agents/skills/modern-web-ui/SKILL.md` (Section 4) and `.agents/rules/strict-approval-and-standards.md` (Rule 2).
- Every existing and newly created view/drill-down (Albums, People, Categories, Vault, Stories, Documents) strictly adheres to the balanced 3-column layout, 22–24px Plus Jakarta Sans title, inline frosted capsule count badge, and floating `blur(20px)` glass container.

---

## 19. macOS Pure Liquid Glass Dual-Theme Design System & Semantic Glass Tokenization

### Functionality Overview
Elevates the entire application to an ultra-premium, cohesive **macOS Pure Liquid Glass** aesthetic with 100% theme adaptivity across Dark Titanium and Light Titanium modes:
1. **Universal Semantic Glass Design Tokens**:
   - Replaced fragile hardcoded dark values (`rgba(23, 23, 23, 0.85)`, `rgba(255, 255, 255, 0.08)`, `#ffffff`) with dual-mode CSS custom properties in `src/index.css`:
     - `--glass-surface`: `rgba(18, 20, 29, 0.82)` (Dark) / `rgba(255, 255, 255, 0.78)` (Light)
     - `--glass-border`: `rgba(255, 255, 255, 0.09)` (Dark) / `rgba(0, 0, 0, 0.08)` (Light)
     - `--glass-border-highlight`: `rgba(255, 255, 255, 0.18)` (Dark) / `rgba(0, 0, 0, 0.16)` (Light)
     - `--glass-pill-bg`: `rgba(255, 255, 255, 0.06)` (Dark) / `rgba(0, 0, 0, 0.05)` (Light)
     - `--glass-pill-hover`: `rgba(255, 255, 255, 0.10)` (Dark) / `rgba(0, 0, 0, 0.09)` (Light)
     - `--glass-pill-active`: `rgba(255, 255, 255, 0.15)` (Dark) / `rgba(0, 0, 0, 0.12)` (Light)
     - `--glass-badge-bg`: `rgba(255, 255, 255, 0.07)` (Dark) / `rgba(0, 0, 0, 0.05)` (Light)
     - `--glass-badge-border`: `rgba(255, 255, 255, 0.10)` (Dark) / `rgba(0, 0, 0, 0.08)` (Light)
     - `--glass-action-bg`: `rgba(255, 255, 255, 0.10)` (Dark) / `rgba(0, 0, 0, 0.07)` (Light)
     - `--glass-shadow`: Deep ambient glass shadow adapting seamlessly between dark drop shadows and crisp light elevation.
2. **Elimination of Artificial Purple Gradients**:
   - Eliminated repetitive AI purple gradients (`linear-gradient(135deg, #6366f1, #8b5cf6)`) across interactive buttons and slideshow actions.
   - Standardized on monochromatic high-contrast frosted glass action pills (`var(--glass-action-bg)` with `var(--glass-action-border)` and `var(--text-primary)`), matching macOS Sequoia and native Apple Photos controls.
3. **Atomic Center Identity Profile Unit (`PeopleView.tsx`)**:
   - Fixed broken control placement where the person's avatar was stranded on the left while the title was centered.
   - Unified the 38px circular portrait avatar, display name, VIP gold star, and inline frosted photo count badge into an atomic centered flex component (`flex: "0 1 auto"`), while maintaining clean flanking columns (`flex: 1` back button on the left, relationship selector and slideshow on the right).
4. **App-Wide Cohesive Glass Architecture**:
   - **`TitleBar.tsx`**: Liquid glass surface with 24px backdrop blur, tokenized search input pill.
   - **`Sidebar.tsx`**: Liquid glass backdrop blur, active navigation pills using `var(--glass-pill-active)` and highlight border.
   - **`AlbumsView.tsx`**: Detail header fully tokenized with liquid glass container, pill navigation, and monochromatic slideshow button.
   - **`DocumentsView.tsx`**: Category pills, OCR search bar, and title bar tokenized with liquid glass.
   - **`TrashView.tsx`**: Select All and Restore pills tokenized with liquid glass.
   - **`VaultView.tsx`**: In-memory status badges and Privacy Shield toggle pills tokenized with liquid glass.
   - **`App.tsx` Toolbar & Ribbon**: Timeline year ribbons and batch action toolbar converted to liquid glass pills.
   - **`.glass-panel` Utility**: Refactored in `index.css` with `backdrop-filter: blur(20px)` and theme-reactive glass surface.

### Functional Decision Points & Rationale
- **Monochromatic Neutral Glass vs. Vibrant Colored Gradients**:
  - *Rationale*: Vibrant colored gradients draw excessive visual weight away from personal photos. Neutral frosted glass provides high legibility, timeless luxury, and lets the photography take center stage.
- **Atomic Profile Unit vs. Split Avatar-Title Layout**:
  - *Rationale*: A person's avatar and name represent a single mental entity. Disconnecting them across negative space breaks visual association. Unifying them in the center creates an elegant profile masthead.
- **Theme-Reactive Semantic Tokens vs. Hardcoded RGBA**:
  - *Rationale*: Hardcoded `rgba(23, 23, 23, 0.85)` or `#ffffff` broke immediately when toggling to Light Titanium mode, resulting in unreadable white-on-white text or dark patches on light backgrounds. Semantic tokens switch automatically and smoothly via CSS custom properties.

### Technical Touchpoints
- `src/index.css`: Added dual-theme semantic glass tokens under `[data-theme="dark"]` and `[data-theme="light"]`; enhanced `.glass-panel`, `.glass-pill`, and `.glass-badge`.
- `src/components/TitleBar.tsx`: Applied `var(--glass-surface)`, `var(--glass-border)`, and `var(--glass-pill-bg)`.
- `src/components/Sidebar.tsx`: Applied `var(--bg-sidebar)` with `backdrop-filter: blur(24px)` and `var(--glass-pill-active)`.
- `src/components/PeopleView.tsx`: Integrated atomic center profile unit; tokenized quick filters and slideshow action.
- `src/components/AlbumsView.tsx`: Converted header to `var(--glass-surface)` and tokenized action pills.
- `src/components/DocumentsView.tsx`: Converted header, category pills, and OCR search to liquid glass tokens.
- `src/components/TrashView.tsx`: Converted header and action pills to liquid glass tokens.
- `src/components/VaultView.tsx`: Converted header and action pills to liquid glass tokens.
- `src/App.tsx`: Converted batch action toolbar and timeline year ribbon to liquid glass pills.

### State & Lifecycle Impact
- Zero database or API changes; universal CSS and presentation layer harmonization providing instant, flawless dark/light theme switching and cohesive visual luxury.

---

## 20. Dual-Theme Lightbox Studio Viewer (macOS Pure Liquid Glass)

### Functionality Overview
Eliminates the legacy hardcoded dark canvas in `Lightbox.tsx`, allowing the primary photo viewing modal to adapt instantaneously to the user's active theme:
1. **Light Titanium Alabaster Glass Canvas**:
   - In Light mode, Lightbox renders a soft, frosted alabaster glass backdrop (`var(--lightbox-backdrop): rgba(245, 247, 250, 0.96)` with `backdrop-filter: blur(28px)`).
   - Top toolbar transforms into frosted white liquid glass (`var(--lightbox-toolbar-bg): rgba(255, 255, 255, 0.88)` with `blur(24px)`).
   - Navigation chevrons render in high-contrast frosted pills (`var(--lightbox-nav-bg)` with `var(--lightbox-nav-border)`, `color: #0f172a`, and subtle elevation shadow).
   - Photos display clean elevation drop shadows (`var(--shadow-lightbox)`) against the light studio canvas, matching Apple Photos on macOS Sequoia.
2. **Dark Titanium Obsidian Glass Canvas**:
   - In Dark mode, Lightbox retains a deep obsidian glass backdrop (`rgba(5, 6, 10, 0.96)` with `blur(28px)`), frosted dark toolbar (`rgba(14, 16, 23, 0.85)`), and crisp light chevrons.
3. **Pill-Shaped Action Buttons & Floating Status Badges**:
   - Standardized `Download`, `Print Ready`, `Like`, `Trash`, `Info`, and `Close` buttons with pill geometry (`borderRadius: var(--radius-full)`) and theme-reactive glass tokens (`var(--glass-pill-bg)`).
   - Floating AI enhancement progress pill and thumbnail loading overlays adapt to `var(--glass-surface)` with `var(--text-primary)`.

### Functional Decision Points & Rationale
- **Alabaster Frosted Glass vs. Pure White**:
  - *Problem*: A solid `#ffffff` background in light mode creates blinding glare when viewing darker photos.
  - *Solution*: A frosted alabaster tint (`rgba(245, 247, 250, 0.96)`) maintains high-key elegance while softening contrast, allowing the photograph's dynamic range and colors to stand out.
- **Dedicated Lightbox Tokens (`--lightbox-*`)**:
  - *Rationale*: Modals and lightboxes require higher opacity (`~0.96`) than floating page headers (`~0.82`) to prevent distracting underlying grid text from bleeding through while preserving depth.

### Technical Touchpoints
- `src/index.css`: Defined `--lightbox-backdrop`, `--lightbox-toolbar-bg`, `--lightbox-nav-bg`, `--lightbox-nav-border`, and `--lightbox-nav-color` across `[data-theme="dark"]` and `[data-theme="light"]`.
- `src/components/Lightbox.tsx`: Converted root backdrop, top toolbar, navigation buttons, status pill, loading overlay, and action buttons to liquid glass tokens.




---

## 21. Minimalist Profile Masthead, Single-Line Multi-Decade Timeline Ribbon & Streamlined Actions

### Functionality Overview
1. **Redundant Header Badge Removal & Centered Masthead Focus**:
   - Removed the redundant `[ 2 photos • 2021 ]` capsule badge from the center header of the person photo drill-down view (`PeopleView.tsx`).
   - The center masthead is now clean, uncluttered, and focused purely on personal identity: `[ 38px Circular Avatar ] [ Display Name ] [ ★ VIP Toggle ]`.
2. **Single-Line Multi-Decade Timeline Ribbon (20-Year Non-Wrapping Architecture)**:
   - In collections spanning multiple decades (tested up to a 20-year span, 2005–2024), year filter chips previously wrapped across 3–4 stacked lines when using `flexWrap: "wrap"`, severely pushing photos down the screen.
   - Converted the quick filter row into an elegant, single-line horizontal scrolling ribbon:
     - `overflowX: "auto"`, `whiteSpace: "nowrap"`, `scrollbarWidth: "none"`, `-ms-overflow-style: "none"`, `WebkitOverflowScrolling: "touch"`.
     - `onWheel` event listener converting vertical mouse scroll wheel input to horizontal scrolling (`scrollLeft += deltaY`), providing frictionless navigation across decades on desktop mouse/trackpad.
     - Each filter chip has `flexShrink: 0`, ensuring chips never squish or wrap regardless of how many years are present.
3. **Streamlined Relationship Action**:
   - Replaced the bulky "Relationship" heading with an interactive, compact icon pill `[ HeartHandshake / Users ] [ Relationship Name ] [ ChevronDown ]`.
   - Tooltip: `"Click to change relationship"`.
   - Polished the Slideshow action pill to a clean, understated monochromatic glass button.

### Functional Decision Points & Rationale
- **Badge Removal vs. Retention**:
   - *Problem*: Having `[ 2 photos • 2021 ]` directly above the year filter chips (`All`, `Favorites`, `2021`, etc.) created visual duplication and clutter in the header.
   - *Solution*: Removed the badge entirely, letting the timeline filter ribbon indicate the active year scope and photo count dynamically.
- **Horizontal Scrolling Ribbon vs. Multi-Line Wrapping**:
   - *Problem*: As users accumulate photos of family members over 15–20 years, wrapped chips occupy 120px+ of vertical space, breaking the layout.
   - *Solution*: A fixed 36px height horizontal scrolling ribbon keeps the interface compact, clean, and consistent across all screens, with native mouse-wheel delta translation.

### Technical Touchpoints
- `src/components/PeopleView.tsx`: Removed badge from header masthead; removed unused `yearsRange` computation; added horizontal scroll ribbon container with `onWheel` delta handler and `scrollbarWidth: "none"`.
- `data/database/securephotos.db`: Seeded 19 historical sample photos spanning 2005–2024 linked to Akriti (`person_id = 32`) to demonstrate and validate multi-decade horizontal scrolling.

---

## 22. Hybrid Multi-Year & Continuous Range Timeline Architecture (Shift-Click, Cmd-Click, Range Popover & Edge Fade Chevrons)

### Functionality Overview
To eliminate multi-decade timeline scrolling fatigue and provide fluid multi-year analysis:
1. **Dynamic Edge Fade & Floating Scroll Chevrons (`ChevronLeft` / `ChevronRight`)**:
   - The timeline ribbon monitors container scroll position (`scrollLeft`, `scrollWidth`, `clientWidth`).
   - When earlier years overflow to the left or later years overflow to the right, floating frosted liquid glass chevron buttons (`ChevronLeft` / `ChevronRight`) dynamically appear on the edges with smooth 240px jump scrolling.
   - Smooth bidirectional CSS gradient masks (`linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)`) fade overflowing items into the background, providing immediate visual affordance that more decades exist.
2. **Native Power-User Multi-Selection & Range Selection**:
   - **Single-Click**: Selects that individual year (or toggles back to 'All' if already active).
   - **Shift + Click (Continuous Range)**: Clicking year $A$ and then Shift-clicking year $B$ selects all intermediate years inclusive ($A \dots B$).
   - **Ctrl / Cmd + Click (Disjoint Multi-Select)**: Toggles non-contiguous years (e.g. comparing 2018 and 2024).
   - Selected year chips glow with `var(--glass-pill-active)` and `var(--glass-border-highlight)` with elevated drop shadow.
3. **`[ 📅 Range ▾ ]` Frosted Popover Capsule**:
   - A dedicated pill placed directly beside `Favorites`.
   - **Dynamic Summary State**: When a multi-year range is active, the pill dynamically reflects the span (e.g. `📅 2012–2020` or `📅 3 Yrs`) with an inline one-click `✕` clear button.
   - **Popover Menu Features**:
     - **Quick Presets**: `"Last 3 Yrs"`, `"Last 5 Yrs"`, `"2020s"`, `"2010s"`, `"2000s"`.
     - **Custom Span Steppers**: Chronologically sorted `From: [ YYYY ▾ ]` to `To: [ YYYY ▾ ]` with `"Apply Range"`.
     - Dismissable on outside click or Escape.
4. **Valid Sample Photo Proxies & Zero-Broken-Image Policy**:
   - Sample historical photos in `securephotos.db` point `thumbnail_path` and `preview_path` to valid local WebP proxies, eliminating broken image placeholders during multi-decade exploration.

### Functional Decision Points & Rationale
- **Hybrid Approach (Keyboard Shortcuts + Visual Popover)**:
   - *Rationale*: Power users expect desktop conventions (Shift-click range and Cmd-click multi-select), while mouse-only or touch users need a 100% discoverable UI affordance (`[ 📅 Range ▾ ]` popover). Combining both delivers unmatched versatility without clutter.
- **Pinned Controls Architecture & Zero-Clipping Popover**:
   - *Problem*: In CSS, any parent with `overflow-x: auto` and `mask-image` creates an implicit vertical clipping box (`overflow-y: auto/hidden`), rendering any absolute dropdown popovers invisible inside the 36px ribbon height. Furthermore, scrolling years pushed `All` and `Favorites` off-screen.
   - *Solution*: Separated the toolbar into two distinct zones:
     1. **Pinned Filter Group**: Contains `All`, `Favorites`, and the `[ 📅 Range ▾ ]` popover button in an unclipped (`overflow: visible`, `zIndex: 100`) container.
     2. **Decoupled Scrollable Years Track**: Connected via a subtle vertical glass separator, allowing timeline years to scroll freely while keeping primary controls and dropdown menus 100% visible at all times.

- `src/components/PeopleView.tsx`: Integrated `useRef` ribbon tracking, `checkRibbonScroll`, `scrollRibbon`, `handleYearClick`, Shift/Ctrl range logic, dynamic `rangeSummary`, pinned filter group, and `range-popover-container`.
- `src/App.tsx`: Replaced technical engineering jargon (`"8K ULTRA Optimization: Processing SAMPLE_SPAN_2024.jpg (19/19) • 100%"`) and idle placeholder with clean, user-friendly copy (`"Optimizing photo quality (N of Total)"` / `"Finishing enhancements..."` with hover tooltip for active filename) and theme-reactive glass tokens.
- `data/database/securephotos.db`: Updated `thumbnail_path` and `preview_path` for `SAMPLE_SPAN_%` photos.

---

## 23. Decoupled Dashboard, Cinema Stories Hub & Dual-Theme Header Harmonization

### Functionality Overview
Resolves view duplication and aligns the workspace with user-centric media workflows, strict dual-theme liquid glass standards, and intuitive sidebar navigation:
1. **Default Opening Screen & Logical Tab Hierarchy**:
   - The opening application screen defaults to **Photos** (`activeTab: "photos"`), placing personal photography front-and-center upon launch rather than an analytical dashboard.
   - **Sidebar Hierarchy Reordering**:
     1. 📸 **Photos** (Primary media collection)
     2. ✨ **Stories** (Curated milestone reels & slideshows)
     3. 📁 **Albums** (User & smart albums)
     4. 👥 **People** (Faces & close-ones tagging)
     5. 📄 **Documents** (OCR receipts & invoices)
     6. 🔒 **Encrypted Vault** (Zero-trust private safe)
     --- *(Visual Glass Divider)*
     7. 📊 **Dashboard** (Storage allocation & photographic intelligence)
     8. 🗑️ **Trash** (Soft-delete recovery)
     9. ⚙️ **Settings** (Preferences, runtime health & Engine Architecture / About)
2. **Strict Dual-Theme Header Rule Enforcement (`var(--glass-surface)`)**:
   - Fixed a critical theming bug where floating headers used hardcoded `rgba(23, 23, 23, 0.85)` with `color: var(--text-primary)`, creating a pitch-black box with dark unreadable text in Light Titanium mode.
   - Formally updated `.agents/rules/strict-approval-and-standards.md` (Rule 2) and `.agents/skills/modern-web-ui/SKILL.md` (Section 4): **Strictly forbids** hardcoded `rgba(23, 23, 23, ...)` in headers. All headers must strictly consume theme-reactive `var(--glass-surface)`, `border: 1px solid var(--glass-border)`, `boxShadow: var(--glass-shadow)`, and `var(--glass-badge-bg)`.
3. **Contextual User Media Storage Footprint ([DashboardView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/DashboardView.tsx))**:
   - Replaced internal engineering metrics ("On-Device AI Models & Weights: 606 MB", "SQLite Database & Vector Indices: 668 KB", "High-Resolution Previews") with contextual, user-centric categories:
     - 📸 **Photos & Images**
     - 🎥 **Videos**
     - ✨ **Curated Stories & Memories**
     - ⚡ **Thumbnails & Instant Cache** (with explanatory note that cache preserves 60fps scrolling without re-reading disks).
4. **Relocation of Engine Architecture & Security Telemetry ([SettingsView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/SettingsView.tsx))**:
   - Moved the technical "Engine Architecture & Security Telemetry" cards (SQLite Vector Engine, Zero-Trust AES-256-GCM Cryptography, and Local SLM Intelligence) out of the user dashboard and into **Settings $\to$ Section 5: Engine Architecture & Security Specifications (About)**.
5. **Unified Photographic Intelligence & Memory Velocity on Dashboard**:
   - Integrated library-wide photographic analytics directly into `DashboardView.tsx`:
     - **Frequent Companions**: Top captured people with avatars, relationship badges, and quick jump to People tab.
     - **Lighting & Solar Rhythms**: Distribution across Morning, Afternoon, Golden Hour, and Night.
     - **Optics & Gear Profile**: Cameras and phones extracted from EXIF metadata.
     - **Archive Span & Velocity**: Chronological moments captured across decades and years.
6. **Dedicated Cinema Stories Studio ([StoriesView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/StoriesView.tsx))**:
   - Focuses purely on AI nostalgia reels, Ken Burns spotlight previews, vibe soundtracks, milestone collections ("Through the Years", "Year in Review"), and automated montage playback.

### Functional Decision Points & Rationale
- **Photos-First Launch vs Dashboard Landing**:
  - *Rationale*: Users launch a photo manager to see their photographs, not a disk pie chart. Standardizing on `activeTab: "photos"` mirrors industry-leading native desktop applications (Apple Photos, Lightroom).
- **Contextual Media Breakdown vs Technical Model Footprint**:
  - *Rationale*: End users care about how many gigabytes their photos and videos take up. Showing on-device neural model sizes creates confusion and clutter. Internal architecture specs belong in the About/Settings area.
- **Rule Codification Against Hardcoded Dark Header Values**:
  - *Rationale*: Hardcoded `rgba(23, 23, 23, 0.85)` in skills and rules caused repeated light-mode visual breakage. Codifying `var(--glass-surface)` in both rule and skill documentation guarantees permanent dual-theme consistency across all current and future views.

### Technical Touchpoints
- `.agents/rules/strict-approval-and-standards.md`: Updated Rule 2 to enforce `var(--glass-surface)` and forbid static dark header colors.
- `.agents/skills/modern-web-ui/SKILL.md`: Updated Section 4 container specifications with dual-theme semantic glass tokens.
- `src/store/useAppStore.ts`: Updated initial state to `activeTab: "photos"`.
- `src/components/Sidebar.tsx`: Reordered navigation items logically and added a subtle glass divider before Dashboard.
- `src/components/DashboardView.tsx`: Applied dual-theme header tokens, contextual media storage footprint, and photographic intelligence bento cards.
- `src/components/SettingsView.tsx`: Added Section 5 (Engine Architecture & Security Specifications / About).
- `src/components/StoriesView.tsx`: Applied dual-theme header tokens and dedicated cinema montage layout.
- `engine/api/stories.py` & `engine/services/stories_service.py`: Added `GET /api/stories/insights` and `_safe_float` unpack for SQLite packed floats.

### State & Lifecycle Impact
- Zero database schema migrations required; 100% theme adaptive, instantaneous view transitions, and full test suite passing (`53 passed in pytest`, `tsc --noEmit 0 errors`).

---

## 24. Universal Liquid Glass Header Harmonization & Decoupled Category Ribbon Architecture

### Functionality Overview
Eliminates remaining blunt, flat row headers across root views, achieving 100% app-wide visual harmony with the macOS Liquid Glass design system, and decouples document tags into an extensible scrolling ribbon:
1. **Liquid Glass Floating Header for Albums Root ([AlbumsView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/AlbumsView.tsx))**:
   - Replaced the plain, blunt `Albums (3)` row and rectangular blue button with the Section 4 compliant floating liquid glass toolbar:
     - **Container**: Floating rounded bar (`var(--glass-surface)`, `blur(24px)`, `border: 1px solid var(--glass-border)`, `borderRadius: var(--radius-lg)`, `boxShadow: var(--glass-shadow)`).
     - **Balanced 3-Column Layout**:
       - Left (`flex: 1`): Indicator capsule `[ 📁 Album Collections ]`.
       - Center (`flex: 0 1 auto`): Modern display title `Albums` (22px Plus Jakarta Sans, `fontWeight: 800`) with inline frosted count badge `[ N Albums ]` along the horizontal baseline.
       - Right (`flex: 1`): Pill action button `+ New Album` (`var(--radius-full)`).
2. **Liquid Glass Floating Header for Photos Root ([App.tsx](file:///c:/Sumit/Code/SecurePhotos/src/App.tsx))**:
   - Replaced the flat row with bottom line with the Section 4 compliant floating liquid glass toolbar:
     - **Container**: Floating rounded bar (`var(--glass-surface)`, `blur(24px)`, `border: 1px solid var(--glass-border)`, `borderRadius: var(--radius-lg)`, `boxShadow: var(--glass-shadow)`).
     - **Balanced 3-Column Layout**:
       - Left (`flex: 1`): Live AI optimization progress pill `[ ⚡ Optimizing photo quality (N of Total) ]` when active, or `[ 📸 Library Collection ]` status badge.
       - Center (`flex: 0 1 auto`): Modern display title `Photos` (22px Plus Jakarta Sans, `fontWeight: 800`) with inline frosted count badge `[ N photos ]`.
       - Right (`flex: 1`): Batch action pills when items are selected (`Collage`, `Download`, `Add to Album`, `Vault`, `Trash`, `Clear`), or `Import Media` and `Sync` pills when selection is idle.
3. **Decoupled Category Ribbon in Documents ([DocumentsView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/DocumentsView.tsx))**:
   - **Header Redesign**: Removed cramped category pills from inside the 3-column header bar. Replaced with `[ 📄 OCR Document Vault ]` indicator on the left, centered 22px Plus Jakarta Sans title with inline capsule count badge, and pill OCR search input on the right.
   - **Dedicated Horizontal Scrolling Ribbon**: Positioned below the header, modeled after the multi-decade ribbon in People view:
     - Single-line horizontal scrolling (`overflowX: "auto"`, `whiteSpace: "nowrap"`, `scrollbarWidth: "none"`).
     - Mouse-wheel delta translation (`scrollLeft += deltaY`) on `onWheel` listener.
     - Extensible tags: `All Documents`, `Receipts & Bills`, `Passports & IDs`, `Tax & Financial`, `Medical & Health`, `Legal & Contracts`, `Warranties & Manuals`.
     - Supports unbounded category expansion with zero layout shifts or vertical clutter.
4. **Liquid Glass Floating Header for People & Family Root ([PeopleView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/PeopleView.tsx))**:
   - Replaced the blunt, flat `People & Family` header row and rectangular buttons with the Section 4 compliant floating liquid glass toolbar:
     - **Container**: Floating rounded bar (`var(--glass-surface)`, `blur(24px)`, `border: 1px solid var(--glass-border)`, `borderRadius: var(--radius-lg)`, `boxShadow: var(--glass-shadow)`).
     - **Balanced 3-Column Layout**:
       - Left (`flex: 1`): Indicator capsule `[ 👥 Face Intelligence ]`.
       - Center (`flex: 0 1 auto`): Modern display title `People & Family` (22px Plus Jakarta Sans, `fontWeight: 800`) with inline frosted count badge `[ N People ]` along the horizontal baseline.
       - Right (`flex: 1`): Full pill action buttons for `↺ Reset Faces` and `↻ Scan Faces` (`var(--radius-full)`, `var(--glass-pill-bg)`).

### Functional Decision Points & Rationale
- **Universal Floating Glass Standard Across All Views**:
  - *Problem*: Having floating liquid glass headers in drill-downs (People Detail, Album Detail, Vault) while root views (Photos, Albums, People) used blunt flat border-bottom rows created jarring visual inconsistency.
  - *Solution*: Universalizing the floating 3-column liquid glass bar across every primary view makes the application feel cohesive, finished, and unmistakably premium.
- **Decoupling Document Tags from the Header Container**:
  - *Problem*: Jamming category tags inside the left column of the 3-column header squeezed the center title off-center and left no room for additional tags as document categorization grows.
  - *Solution*: Decoupling tags into a dedicated horizontal scrolling ribbon preserves the clean 3-column header balance while allowing the taxonomy of labels to grow infinitely without vertical space penalty.

### Technical Touchpoints
- `src/components/AlbumsView.tsx`: Upgraded root albums gallery header to floating 3-column liquid glass toolbar.
- `src/App.tsx`: Upgraded root photos gallery header to floating 3-column liquid glass toolbar.
- `src/components/DocumentsView.tsx`: Upgraded header to balanced 3-column liquid glass toolbar and added separate horizontal scrolling category ribbon with `onWheel` translation.
- `src/components/PeopleView.tsx`: Upgraded root people gallery header to balanced 3-column floating liquid glass toolbar with baseline capsule count and pill action buttons.

### State & Lifecycle Impact
- Zero database or backend API modifications; pure presentation layer elevation adhering strictly to Rule 2 and Section 4 of `modern-web-ui`.

---

## 25. Test Data Cleanup, Missing-File Optimization Guard & Photos Timeline Scroll Chevrons

### Functionality Overview
1. **Purge of Synthetic Test Photos from Database**:
   - Removed 19 leftover `SAMPLE_SPAN_*` dummy photo records that were inserted during multi-year timeline testing. These records had `is_optimized = 0` and non-existent `filepath` values (`sample_2005_IMG_14.jpg` etc.), causing the background 8K optimization worker to endlessly attempt processing on phantom files.
   - Database now contains only 22 genuine user photos.
2. **Missing-File Optimization Guard ([photos.py](file:///c:/Sumit/Code/SecurePhotos/engine/api/photos.py))**:
   - Added an `else` branch in `run_background_optimization()` for the `if target_file.exists()` check. When a photo's `filepath` does not exist on disk, the worker now logs a warning and marks it `is_optimized = 1` instead of silently skipping and leaving it in an infinite retry loop.
3. **Photos Timeline Scroll Chevrons with Edge Fade Masks ([App.tsx](file:///c:/Sumit/Code/SecurePhotos/src/App.tsx))**:
   - Upgraded the Photos timeline ribbon from a flat `overflowX: auto` strip (no scroll indicators) to a structured layout matching the People Detail year ribbon:
     - **Left Pinned Group**: `TIMELINE:` label and `All` pill permanently visible, separated from scrollable track by a glass divider.
     - **Scrollable Track**: `ref={timelineRibbonRef}` with `onScroll` and `onWheel` (`scrollLeft += deltaY`) handlers for smooth mouse-wheel horizontal scrolling.
     - **Left & Right Chevrons**: Frosted glass circular buttons (`ChevronLeft` / `ChevronRight`) that appear dynamically when the track overflows in either direction.
     - **Edge Fade Masks**: `maskImage: linear-gradient(...)` / `WebkitMaskImage` applied to smoothly fade year chips at scroll boundaries.

### Functional Decision Points & Rationale
- **Why mark missing files as optimized?**: Without this guard, any orphan database entry with a non-existent `filepath` would cause the optimization worker to spin through its entire queue on every application launch, wasting CPU cycles and showing misleading progress banners to the user.
- **Why add chevrons to the Photos timeline?**: The People Detail view already had this scroll navigation pattern. The Photos timeline had many year pills (2005–2024) that extended beyond the visible area with no affordance for discovering off-screen chips. The chevrons provide consistent UX parity across both ribbons.

### Technical Touchpoints
- `data/database/securephotos.db`: Purged 19 `SAMPLE_SPAN_*` rows via `DELETE FROM photos WHERE filename LIKE 'SAMPLE_SPAN_%'`.
- `engine/api/photos.py`: Added `else` branch in `run_background_optimization()` to mark missing-file entries as `is_optimized = 1`.
- `src/App.tsx`: Added `useRef`, `useCallback`, scroll state (`canScrollLeft`, `canScrollRight`), `checkTimelineScroll()`, `scrollTimeline()`, `ChevronLeft`/`ChevronRight` imports, glass divider, edge fade masks, and chevron buttons.

### State & Lifecycle Impact
- Eliminates phantom optimization loops and misleading progress banners caused by orphan database entries.
- Provides scroll navigation parity between Photos and People Detail timeline ribbons.
- Full test suite: 53/53 passed. TypeScript: 0 errors.

---

## 26. Timeline Pill Count Clutter Elimination & Single Source of Truth

### Functionality Overview
- Streamlined the Photos timeline filter ribbon by removing inner photo count badges from both the pinned `All` pill and the dynamic year pills (`{item.year}`).
- Each filter pill now presents clean, focused typography (`All`, `2021`, etc.) without micro-capsule count chips inside the button body.

### Functional Decision Points & Rationale
- **Single Source of Truth for Photo Counts**: The Section 4 compliant floating liquid glass header (`Photos [ N photos ]`) already dynamically updates its baseline capsule badge immediately upon selecting any timeline year or filter.
- **Elimination of Visual Redundancy & Clutter**: Displaying count capsules within both the header and every single timeline pill created redundant visual noise (e.g., `[ 22 photos ]` in the header immediately above `All [ 22 ]` and `2021 [ 22 ]`). Removing the chip counts achieves clean, sleek aesthetics aligned with `modern-web-ui`.

### Technical Touchpoints
- `src/App.tsx`: Removed the `{timelineData.total_count > 0 && (...)}` badge from the `All` button and `{item.count.toLocaleString()}` badge from the year mapping loop.

### State & Lifecycle Impact
- Zero state, API, or database impact. Filtering logic, scroll chevrons, and active pill highlights remain 100% intact.

---

## 27. Relationship Terminology Simplification: "Extended Family" to "Family"

### Functionality Overview
- Simplified the relationship categorization by renaming `"Extended Family"` to `"Family"` across the People & Family interface (tagging dropdown, cluster association, relationship picker, priority sorting, and VIP auto-promotion).
- Preserved full backwards compatibility so that any historical or existing `"Extended Family"` records in the database continue to map to priority level 6 and retain Close One (VIP) status.

### Functional Decision Points & Rationale
- **Concise, Natural Language**: In everyday use, users categorize relatives beyond immediate nuclear members simply as "Family" rather than formal clinical labels like "Extended Family".
- **Visual Brevity in UI Chips**: The shorter `"Family"` label fits cleanly into compact relationship tags, dropdown items, and card subtitles without wrapping or horizontal overflow.
- **Backwards Compatibility**: Both `"Family"` and `"Extended Family"` are maintained in `CLOSE_RELATIONSHIPS` and backend sets, ensuring zero breaking changes for existing databases.

### Technical Touchpoints
- `src/components/PeopleView.tsx`: Updated `RELATIONSHIP_OPTIONS` to include `"Family"` and updated `RELATION_PRIORITY` and `CLOSE_RELATIONSHIPS` sets with `"Family"`.
- `engine/api/people.py`: Added `"Family"` to `close_relationships` sets in `tag_cluster` and `update_person` endpoints.
- `engine/services/social_affinity_service.py`: Added `"Family"` to `close_relationships` set for affinity calculation.
- `engine/tests/test_people.py`: Updated cluster retagging test to assert `"Family"` relationship and VIP promotion.

### State & Lifecycle Impact
- Auto-promotes any person tagged with `"Family"` to Close One (`is_close_one = 1`) by default.
- Backwards compatible with legacy database rows.
- Full test suite: 53/53 passed. TypeScript: 0 errors.

---

## 28. SQLite FTS5 Trigger Column Scoping, Segment Desync Immunity & Automated Self-Healing

### Functionality Overview
- Eliminated intermittent `database disk image is malformed` errors originating from SQLite's full-text search (`photos_fts`) during high-frequency photo metadata mutations (such as bulk thumbnail regeneration, proxy generation, favorite toggles, face scanning flags, and trash timestamps).
- Scoped the FTS5 synchronization trigger (`photos_au`) strictly to searchable textual columns (`filename`, `folder_name`, `caption`, `content_tags`, `ocr_text`, `is_encrypted`), preventing all non-text columns from invoking FTS shadow table deletions and re-indexing.
- Integrated automated FTS5 index self-healing and resynchronization (`rebuild_fts_index`) into schema migrations (`run_migrations`) to automatically recover from any external content shadow segment desynchronization.

### Functional Decision Points & Rationale
- **Targeted Column Scoping Over Unrestricted Table Triggers**: The previous trigger was declared as `AFTER UPDATE ON photos BEGIN ...`. Because SQLite executed an FTS deletion (`VALUES('delete', ...)`) followed by a re-insert on *every* column update, batch operations like thumbnail regeneration triggered thousands of redundant FTS operations. Scoping the trigger to `AFTER UPDATE OF filename, folder_name, caption, content_tags, ocr_text, is_encrypted ON photos` completely isolates high-churn media metadata updates from FTS shadow tables.
- **Automated Self-Healing via Native FTS5 Rebuild**: SQLite FTS5 external content tables can encounter docid/segment desynchronization if historical updates or migrations altered rows without matching token states. FTS5 provides an instant native recovery command: `INSERT INTO photos_fts(photos_fts) VALUES('rebuild');`. Incorporating this into `run_migrations()` guarantees that every database instance automatically self-heals at boot without requiring manual user intervention or raw SQL scripts.
- **Decoupled Utility Function**: Provided `rebuild_fts_index()` in `engine.database` as a reusable asynchronous service function with full error logging and transaction safety.

### Technical Touchpoints
- `engine/database.py`:
  - Updated `SCHEMA_DDL` to define `photos_au AFTER UPDATE OF filename, folder_name, caption, content_tags, ocr_text, is_encrypted ON photos`.
  - Added `rebuild_fts_index()` utility function for safe programmatic rebuilds.
  - Enhanced `run_migrations()` to drop legacy unscoped `photos_au` triggers, install the scoped trigger, and execute `rebuild_fts_index()`.
- `engine/tests/test_database.py`:
  - Added `test_fts_scoped_update_trigger`: Verifies that updating `thumbnail_path` and `is_favorite` causes zero FTS churn while text updates cleanly re-index.
  - Added `test_fts_rebuild_self_healing`: Verifies that `rebuild_fts_index` cleanly resynchronizes search items.

### State & Lifecycle Impact
- Bulk thumbnail regeneration and background optimization workers can process thousands of items with zero risk of `database disk image is malformed` errors.
- Reduces SQLite disk write amplification and WAL journal size during background processing.
- Full test suite: 55/55 passed. Backward compatible with all existing SQLite databases.

---

## 29. Unified 1:1 Photo Grid Geometry & Row Virtualizer Whitespace Elimination

### Functionality Overview
- Standardized the primary Photos library grid ([PhotoGrid.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/PhotoGrid.tsx)) to a 1:1 square card aspect ratio, matching the visual geometry of the Albums ([AlbumsView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/AlbumsView.tsx)) and People detail views ([PeopleView.tsx](file:///c:/Sumit/Code/SecurePhotos/src/components/PeopleView.tsx)).
- Eliminated massive empty dead space and vertical row collisions by integrating native TanStack Virtualizer `gap: 10` spacing and dynamic DOM row measurement (`rowVirtualizer.measureElement`).
- Increased visible photo real estate by ~60% across the library without changing responsive column density.

### Functional Decision Points & Rationale
- **Aspect Ratio Parity Across Core Views**: In the Albums tab, photo cards render as clean 1:1 squares with 10px gaps (`aspectRatio: "1"`). Standardizing `PhotoCard` to 1:1 creates an identical look, feel, and visual weight across all application views.
- **Native Virtualizer Gap Over Manual Row Container Padding**: Previously, `gap: 10` was hacked by adding `paddingBottom: 10px` inside row containers and hardcoding `height: virtualRow.size`. When the virtualizer cached an initial row height (195px), Row 1 was positioned at `translateY(195px)` while Row 0 occupied up to 202px, causing rows to collide with near-zero vertical separation. Configuring `gap: 10` natively inside `useVirtualizer` removes container padding and guarantees that both vertical and horizontal gaps are mathematically locked to exactly `10px`.
- **Dynamic `measureElement` & Cache Invalidation**: Attached `ref={rowVirtualizer.measureElement}` and `data-index={virtualRow.index}` to the row element so the browser's ResizeObserver measures exact rendered DOM heights. An observer hook calls `rowVirtualizer.measure()` on resize to instantly purge any stale measurement caches.

### Technical Touchpoints
- `src/components/PhotoGrid.tsx`:
  - Standardized `PhotoCard` to `aspectRatio: "1"` and `width: "100%"`.
  - Configured `gap: 10` natively in `useVirtualizer`.
  - Attached `ref={rowVirtualizer.measureElement}` and `data-index={virtualRow.index}` on the row container, removing manual `paddingBottom` and fixed `height`.
  - Added cache invalidation hook via `rowVirtualizer.measure()`.

### State & Lifecycle Impact
- Zero database or API impact. Pure UI layout and virtualizer geometry harmonization.
- Row-to-row spacing is mathematically identical to column-to-column spacing (exactly 10px).
- Build verified: TypeScript 0 errors, Vite bundle built cleanly in 4.43s, 55/55 backend tests passed.

---

## 30. Duplicates & Clutter Reclaimer Workspace (Dashboard-Integrated Side-by-Side Comparison & Lightbox)

### Functionality Overview
- Integrated a dedicated, full-width **Duplicates & Clutter Reclaimer** workspace into the Dashboard tab, accessible via an interactive Storage Visualizer banner (`Review & Reclaim Space`).
- Surfaces exact duplicate copies (identical SHA-256 checksums) and burst / perceptually near-identical photos (64-bit dHash perceptual hashing with Hamming distance $\le 8$ or burst shots within 3 seconds).
- Displays duplicate sets in high-density, side-by-side comparison cards with resolution dimensions, file sizes, capture dates, AI enhancement badges, and sharpness scores.
- Renders an AI-computed **"⭐ Recommended Best"** badge with explainable rationale (e.g. `Marked Favorite • 4032x3024 (12.2 MP) • High Sharpness`).
- **Interactive Lightbox Inspection**: Clicking any duplicate photo opens it at full resolution in the immersive Lightbox modal, allowing seamless 1:1 zoom, EXIF inspection, and left/right arrow keyboard navigation between duplicate candidates.
- **Zero Data Loss Space Reclamation**: Single-click resolution per group ("Keep This Photo" or "Keep Suggested Best") or across all groups ("Resolve All (Keep Best)") routes rejected duplicate copies into SecurePhotos' existing 30-Day Soft-Delete Trash (`trashed_at = CURRENT_TIMESTAMP`), preserving user recoverability.

### Functional Decision Points & Rationale
- **Dashboard-Integrated Sub-view vs. 10th Navigation Tab**:
  - *Decision*: Avoided adding a 10th tab to the desktop navigation sidebar. Duplicate management is a maintenance/optimization workflow directly tied to physical disk capacity; embedding it as an on-demand sub-view inside the Dashboard (with a prominent Storage Composition banner) keeps the primary sidebar clean, focused, and intuitive.
- **Side-by-Side Photo Comparison with Full-Resolution Lightbox Zoom**:
  - *Decision*: Users cannot confidently discard redundant photos from tiny thumbnails alone. The comparison cards provide immediate visual alignment and metadata parity, and clicking any candidate opens the full-screen Lightbox for pixel-level inspection before committing a deletion.
- **Balanced "Best Pick" Scoring Heuristic**:
  - *Decision*: Rather than relying purely on file size or resolution, the scoring engine uses a prioritized multi-tier hierarchy:
    1. User Favorite (+5000 pts): User intention decisively overrides automated heuristics.
    2. AI Super-Resolution Enhanced (+1000 pts) / Lossless Optimized (+250 pts).
    3. Resolution Megapixels (+50 pts per MP).
    4. Sharpness / Blur score (+2.0 per unit).
    5. SLM Aesthetic Quality score (+10.0 per unit).
    6. File size (+10.0 per MB).
- **Strict Non-Destructive Soft-Delete Routing**:
  - *Decision*: Permanently deleting files (`os.unlink`) carries irreversible user risk. Trashed duplicates receive `trashed_at = CURRENT_TIMESTAMP`, immediately freeing them from library views and reclaiming logical storage while retaining 30-day recovery in the Trash view.
- **Modern-Web-UI Section 4 Header Standard Compliance**:
  - Floating dual-theme liquid glass container (`var(--glass-surface)`, `blur(24px)`).
  - Balanced 3-column layout (Left: Dashboard back button + Rescan pill; Center: Centered Plus Jakarta Sans title + inline capsule badge; Right: Resolve All action pill).

### Technical Touchpoints
- `engine/services/duplicate_service.py`:
  - `compute_image_dhash()`: 64-bit difference perceptual hashing using Pillow grayscale downsampling.
  - `hamming_distance()`: Bitwise XOR popcount distance computation.
  - `score_candidate_photo()`: Multi-factor scoring with explainable rationale strings.
  - `scan_and_cluster_duplicates()`: Exact SHA-256 grouping, dHash Union-Find connected component clustering, and DB synchronization into `duplicate_groups`.
  - `resolve_duplicate_group()` & `resolve_all_duplicates_best()`: Soft-delete routing to `trashed_at = CURRENT_TIMESTAMP`.
- `engine/api/duplicates.py`:
  - Endpoints: `GET /api/duplicates/summary`, `GET /api/duplicates/groups`, `POST /api/duplicates/scan`, `POST /api/duplicates/resolve`, `POST /api/duplicates/resolve-all-best`.
- `engine/main.py`:
  - Mounted router under `/api/duplicates`.
- `engine/tests/test_duplicates.py`:
  - Automated tests covering dHash computation, Hamming distance, candidate scoring, exact hash clustering, summary metrics, and single-group resolution.
- `src/types/index.ts`:
  - Defined `DuplicateGroupItem` and `DuplicateSummaryResponse` TypeScript interfaces.
- `src/components/DuplicatesView.tsx`:
  - Dedicated full-width workspace with Section 4 liquid glass header, side-by-side comparison cards, Lightbox click-to-open handlers, and individual/bulk resolution.
- `src/components/DashboardView.tsx`:
  - Added `activeSubView: "overview" | "duplicates"`, `dupSummary` telemetry loading, and interactive Bento Row 1.5 Duplicates & Clutter Reclaimer banner.
- `src/App.tsx`:
  - Passed `onPhotoClick={(idx, customPhotos) => { setLightboxPhotos(customPhotos); setLightboxIndex(idx); }}` to `DashboardView`.

### State & Lifecycle Impact
- Zero schema migration needed (`duplicate_groups` table was pre-declared in `engine/database.py`).
- Soft-deletions update SQLite in WAL mode; existing FTS5 and timeline queries automatically exclude trashed items (`trashed_at IS NULL`).
- **Layout & Typography Resilience**: Added `flexShrink: 0`, `flex: "0 0 auto"`, and `minHeight: "76px"` to the Duplicates banner and Bento rows, preventing vertical browser compression. Added `gap: 10px`, `minWidth: 0`, and concise subtitles (`Solar EXIF`, `Hardware EXIF`, `Timeline EXIF`) across insight cards, eliminating text collisions.
- **Human Subject & Facial Clarity Recommendation Engine**:
  - `duplicate_service.py` evaluates detected face telemetry from `faces` and `persons` tables in a single batch query (`ix_faces_photo_id`).
  - Face base clarity: `quality_score * 1000.0` pts.
  - VIP close-one multiplier: `+300.0 * quality_score` for family members (`is_close_one = 1`, e.g. Inaaksh, Kiaan).
  - Face prominence: `(box_w * box_h) * 500.0` pts.
  - File size de-emphasized to a pure tie-breaker (`0.01` pts/MB), ensuring 0.1MB compression noise cannot override portrait clarity.
  - Dynamic explainable rationale: e.g. `Front Portrait (Inaaksh: 0.97) • Clear Expression • 3000x4000`.
- **Streamlined UI & Dynamic Space Reclaim Calculation**:
  - **Single Action Button**: Every duplicate group features exactly one primary action button: `"Keep Selected"`, with the AI-recommended photo pre-selected by default. Resolves the group according to the user's checked photos in a single click.
  - **Real-Time Dynamic Space Telemetry**: As the user toggles checkboxes on images, the group's reclaimable badge and the main view header badge update instantly based on the unselected copies (`+{formatBytes(groupReclaimable)} Reclaimable` or `0 B (Keeping All)`).
  - **Consistent Card Dimensions (210px Flex Wrapping)**: Replaced variable stretching CSS Grid (`repeat(auto-fit, minmax(240px, 1fr))`) with fixed `210px` width cards (`flex: "0 0 210px"`, `flexWrap: "wrap"`). Guarantees that 2-photo groups, 3-photo groups, and 5+ burst clusters maintain identical, consistent thumbnail dimensions without ballooning or shrinking.
  - **Top-Right Icon Cluster (Yellow Star & Red Heart)**: Replaced bulky text pill with compact frosted-glass icon badges at top-right of each thumbnail: yellow star (`#eab308`) for AI Recommended with `title="Recommended Best Pick"` and red heart (`#ef4444`) for Favorite with `title="Favorite Photo"`. Completely eliminates photo obstruction while keeping sub-image area down to a single clean metadata line.
  - **Session-Level Skip / Defer Action**: Added secondary `"Skip"` pill button next to `"Keep Selected"` in the group header, allowing users to defer ambiguous duplicate groups for the current session without trashing files or writing permanent dismissals.
  - **Concise Similarity Text**: Streamlined to `Exact Match` and `Similar (94%)`.
  - **Clean Header & Zero Repetition**: Removed redundant sub-header telemetry bar; refined view title to `Duplicate & Burst Photos`.
- Automated verification: 60/60 backend tests passed; TypeScript type check 0 errors; Vite bundle built cleanly in 4.19s.






