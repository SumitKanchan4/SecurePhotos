# 📋 Next Session Implementation Agenda: Cinema, Albums & Stories Enhancements

**Date Recorded**: 2026-09-23  
**Status**: Completed — All 8 Agenda Items Implemented, Verified (95/95 Pytest, 0 TS Errors), and Documented  
**Git Branch**: `feature/architecture-and-standards`  

---

## Executive Summary
This document records the 8 user observations and architectural solutions mapped out during the review session on 2026-09-23. When resuming work in a fresh chat window, start by executing this agenda end-to-end.

---

## 1. 🎵 Soundtrack Audio Preview Fix (Port Mismatch)
- **Problem**: When clicking preview on the soundtrack upload/management modal, no audio plays.
- **Root Cause**: `[Confidence: High]` In `engine/services/music_service.py`, `stream_url` is returned as relative path `"/api/stories/music/{track_id}/stream"`. In `StoriesView.tsx`, `new Audio(track.stream_url)` resolves against Vite's frontend port `1420` instead of FastAPI's backend port `8000`, causing a 404.
- **Solution**:
  - In `src/components/StoriesView.tsx` (`handleTogglePreview`): Ensure `track.stream_url` is prepended with `API_BASE` (`http://127.0.0.1:8000`).
  - Same check in `src/components/StoryPlayerModal.tsx` for `activeAudioUrl`.

---

## 2. 🎬 Dedicated "Saved Stories" Smart Album & Auto-Archiving from Shelf
- **User Vision**: Like Google Photos and Apple Photos, saved stories should become permanent assets in a dedicated album and rotate off the active suggestions shelf.
- **Technical Flow**:
  1. Add a system Smart Album **🎬 Saved Stories** to `AlbumsView.tsx` / `albums_service.py` (alongside Favorites and Collages).
  2. In `StoriesView.tsx`, update the query/filter so the active shelf displays only ephemeral suggestions (`WHERE is_saved = 0`).
  3. When a user clicks `[ 💾 Save Story ]`, `is_saved` is set to `1`. The story immediately moves into the **Saved Stories** album and disappears from the suggestions shelf.
  4. Inside the **Saved Stories** album, clicking a story card launches the `StoryPlayerModal` to replay the montage anytime.

---

## 3. ✍️ Purge Developer Jargon in Story Subtitles (Rule 7)
- **Problem**: Story hero displays *"10 moments • Dynamic chromatic ambient light • Beat-synchronized Ken-Burns motion"*, which is internal developer engineering jargon.
- **Solution**:
  - Replace with warm, concise, human-centric descriptions in `StoriesView.tsx`:
    - Format: `{slides_count} moments • {year_or_season}` (e.g. `10 moments • Spring 2021` or simply `10 moments`).
  - Zero exposure of internal graphic/motion mechanics to the end user.

---

## 4. 🏷️ Punchy, Dynamic & Attractive Story Title Engine
- **Problem**: Database titles like *"Spring Retrospective (2021)"* or *"Trip: Goa (2024-03-12)"* feel robotic and mechanical.
- **Solution**:
  - Update `engine/services/stories_service.py` with emotional, human-centric semantic templates:
    - **Vacation/Travel**: `"Unforgettable {folder}"`, `"Getaway to {folder}"`, `"Escape to {folder}"` (e.g., *"Unforgettable Goa"* instead of *"Trip: Goa"*).
    - **Milestones/Anniversary**: `"{N} Years Ago Today"`, `"A Day to Remember"`, `"Remember This Day?"`.
    - **Seasonal**: `"Golden Days of {season}"`, `"Sun-Drenched Memories"`, `"Warmth of Summer"`.
    - **Close Loved Ones**: `"Growing Up: {name}"`, `"Smiles with {name}"`, `"The Journey with {name}"`.
  - Future SLM Hook: Parameterized to optionally pass top keywords into local SLM (Phi-3.5) for personalized 3-word titles.

---

## 5. 📌 Pin All System Smart Albums at the Top of Albums View
- **Problem**: Currently, *Favorites* is pinned at the top, but *Collages* is mixed with user-created custom albums.
- **Solution**:
  - Group and pin all **System Smart Collections** in a dedicated top section in `src/components/AlbumsView.tsx`:
    1. `❤️ Favorites` (Liked photos & videos)
    2. `🎨 Collages & Wallpapers` (Creations)
    3. `🎬 Saved Stories` (Saved cinematic montages)
  - Regular user-created albums follow cleanly below in their own labeled grid section: *"My Albums"*.

---

## 6. 🐛 Long Album Name Layout Overflow Bug Fix (Screenshot Verified)
- **Problem**: Entering a very long album name breaks the Album Details header; text spills across the screen, covering the back button and action pills.
- **Root Cause**: `[Confidence: High]` In `src/components/AlbumsView.tsx` (lines 580–595), the `<h2>` has `whiteSpace: "nowrap"` with no `maxWidth`, `overflow: "hidden"`, or `textOverflow: "ellipsis"`.
- **Solution**:
  - Set `maxWidth: "min(400px, 45vw)"` on the title wrapper.
  - Set `overflow: "hidden"`, `textOverflow: "ellipsis"`, `whiteSpace: "nowrap"` on the `<h2>`.
  - Add native `title={activeAlbumMeta.name}` so the full title remains readable on hover via browser tooltip.

---

## 7. 📥 1-Click "Import Direct to Album" Flow
- **Problem**: Adding new photos to an album currently takes 7 manual navigation steps through the Photos view.
- **Solution**:
  - In `src/components/AlbumsView.tsx`, inside the Photo Picker modal (`isPhotoPickerOpen`), add a prominent button: **`[ 📥 Import New Photos ]`**.
  - Clicking this opens the native OS file/directory picker, triggers the import API, and automatically attaches the newly imported photo IDs directly to the active album.

---

## 8. 🎥 Video Support in Stories
- **Current State**: The backend queries `photos` table (which contains videos), but `StoryPlayerModal.tsx` currently renders an `<img>` tag with the video's thumbnail proxy (showing videos as static snapshots).
- **Solution**:
  - In `StoryPlayerModal.tsx`, inspect `slide.mime_type` or extension.
  - If video: Render an HTML5 `<video autoPlay muted playsInline loop />` element with Ken-Burns disabled for the video duration, then advance to the next slide smoothly.

---

## Verification Strategy
1. Automated tests: Run `.venv\Scripts\python.exe -m pytest engine/tests` (95+ tests passing).
2. Frontend build: Run `npm run build` (`tsc && vite build`).
3. Rule 0 compliance: Always commit and push immediately to `origin/feature/architecture-and-standards`.
