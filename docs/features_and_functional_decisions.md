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
