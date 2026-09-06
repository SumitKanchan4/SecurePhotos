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
- **Visual Progress Indicators**:
  - Unprocessed thumbnails display a subtle "Queued" badge with a clock icon.
  - Active thumbnail displays a spinning loader and percentage badge.
  - Optimized images receive a high-res badge (`8K` if $\ge 7680\text{px}$, otherwise `HQ`).
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
- **Removed Redundant Selection Actions**: Removed obsolete "Enhance to 8K Ultra" from the multi-select floating bar, and renamed "8K Collage" to "Create Collage".

### Technical Touchpoints
- **Backend**: `engine/api/albums.py`, `GET /api/albums`, `POST /api/albums`, `POST /api/albums/{id}/photos`, `DELETE /api/albums/{id}/photos/{photo_id}`.
- **Frontend**: `src/components/AlbumsView.tsx`, `src/components/AddToAlbumModal.tsx`, `src/App.tsx`.

---

## 5. Album Cover Selection

### Overview
Users can choose which photo represents an album in the gallery view.

### Key Functional Decision Points
- **Contextual One-Click Assignment**: Inside any user album detail view, each photo card features a "Set Cover" button on hover.
- **Visual Feedback**: The active cover photo displays a prominent `Cover` badge with a checkmark.
- **Integrity Validation**: Backend validates that `photo_id` is an active member of the target album before updating `albums.cover_photo_id`.
- **Fallback Resolution**: If no custom cover is set, backend queries dynamically fall back to the newest photo in the album.

### Technical Touchpoints
- **Backend**: `POST /api/albums/{album_id}/cover` in `engine/api/albums.py`.
- **Frontend**: `handleSetAlbumCover` in `src/components/AlbumsView.tsx`.

---

## 6. Interactive Photo Like / Favorites System

### Overview
Users can star/heart photos to mark them as favorites from anywhere in the application.

### Key Functional Decision Points
- **Everywhere Access**:
  - **Photos Grid (`PhotoGrid.tsx`)**: Top-right heart button on every thumbnail. Displays filled red when liked; translucent on hover when unliked.
  - **Lightbox (`Lightbox.tsx`)**: Top toolbar heart button with active state indicator + keyboard shortcut `F`.
  - **Inside Albums (`AlbumsView.tsx`)**: Top-right heart button on every photo in both custom albums and the Favorites album.
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
