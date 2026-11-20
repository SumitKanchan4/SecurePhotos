# Changelog

This file lists the changes in each version of SecurePhotos. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### A new look
- The whole app has been redesigned: a slim side bar, a cleaner photo grid with a year and month bar, and a dark photo viewer with details when you want them.
- New Dashboard: your library in one sentence, how your space is used, and the jobs worth doing, with the space each one frees.
- New Stories page, with the newest story playing at the top.
- Albums made for you (Favourites, Saved stories, Collages) have their own covers.
- A welcome screen when your library is empty, and clearer messages wherever a page has nothing to show yet.

### Old photos
- Add colour to black-and-white prints, bring back faded colours, sharpen blurry faces and remove scratches and spots.
- The original is always kept next to the improved copy. A new "What to keep" page lets you choose between them, one pair at a time or all at once.
- Choose in Settings whether each improvement happens only when you ask or automatically.

### After an import
- Every new photo is now prepared in a set order: its text is read, faces are found, old prints are checked, duplicates are looked for, and then it is enhanced. Photos needing the least work are finished first, and videos come after the photos.
- Heavy work runs one job at a time, so the app stays smooth.
- A small ring on each photo shows how far it has got, and the steps it goes through are shown as icons.
- Stories are suggested after imports and over time, and a story you delete is not suggested again.

### Settings
- Photo quality is now three plain choices: Best, Balanced and Smaller.
- New Photo size (2K, 4K or 8K) and Video size (as recorded, HD, 2K or 4K) settings.
- Pause background work when the battery is low.
- Music for stories has its own page.

### People and faces
- Faces are found straight after an import, on the photo turned the right way up.
- "Same person?" shows several large faces side by side.
- Choose a relationship when you name someone new.
- Remove anything wrongly taken for a face, and it won't be found again.

### Fixes
- Deleting an improved photo now deletes its original too, and restoring from Trash brings both back.
- The vault no longer locks again a moment after you unlock it.
- Thumbnails and previews nobody uses any more are cleaned up.
- Pictures come back by themselves if the photo engine restarts.
- Videos are enlarged by their shorter side, so a portrait video made 4K really is 4K.

## [0.1.0] - 2026-09-06

The first public release.

### Privacy and the vault
- Runs entirely on your own computer, with no tracking.
- A Private Vault that encrypts photos and documents (AES-256-GCM, with the key made from your password using Argon2id).
- Vault photos are decrypted in memory while you view them; no unencrypted copy is written to disk.
- The app and its photo engine talk only on your own computer, protected by a random access token.

### Browsing
- A fast photo grid for very large libraries.
- A full-screen viewer with photo details and keyboard shortcuts.
- Dark and light themes.

### People
- Face recognition on your computer.
- Name a person once and they are found across your library.
- Close ones are kept at the top.

### Search and organising
- Search by words, file names, camera details and the text printed on documents and receipts.
- Albums, and filters by year, month and type.
- A duplicate finder for exact copies and bursts.
- Deleted items stay in Trash for 30 days.

### Stories and collages
- Slideshow stories with gentle pan and zoom, and music.
- High-resolution collages.

### External drives
- Keep your library on an external drive, and use it even when Windows gives the drive a different letter.
