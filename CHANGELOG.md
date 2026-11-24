# Changelog

This file lists the changes in each version of SecurePhotos. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Faster on computers with a graphics card
- SecurePhotos can use the computer's graphics card for its AI work: sharpening faces, 8K print copies, finding scratches and more. It works with NVIDIA, AMD and Intel graphics, with nothing to install.
- The first time a computer improves photos, SecurePhotos gets to know it in about half a minute and uses the graphics card only where it is faster. Settings, under Computers, shows what runs where, can turn the card off and can test again.
- Settings, under About, shows the real version number and the graphics card.

### Installing and updating
- The update window shows what's new as headings and lists, with the SecurePhotos logo and the new version number.

## [0.3.1] - 2026-11-24

### Stories
- Three songs now come with SecurePhotos, so every story has real music: Between the Frames, Sunday on the Veranda and Where We Once Stood. They show as Included in Settings, under Music; you can pick their mood, and your own songs are still used first.

### Dashboard
- What you added today is one line under your newest photos, with how many are still being prepared, instead of a card that repeated the same photos.
- The tiles share each row, so the Dashboard has no empty gaps.

### Installing and updating
- Removing SecurePhotos explains on its one screen what stays: your photos, videos, albums and Private Vault stay in the library folder, and vault photos open again with your vault password when SecurePhotos is installed into the same folder. The "Delete the application data" box and the second popup are gone.

## [0.3.0] - 2026-11-22

### A new Dashboard
- The Dashboard is about your library, not settings: **On this day** shows photos from this week in an earlier year and plays them as a story, **Just added** shows your last import, **Brought back** compares an old photo before and after, **People** shows the people you photograph most and the faces still waiting for a name, and **Your year** shows your photos month by month (click a month to open it). Before there is anything to show, Brought back, People and Your year say what they will show and how to start.
- **Worth doing** always shows the same four cards, Duplicates, Big videos, What to keep and Empty Trash, each with the space it frees, or "All good" when there is nothing to do.
- Storage is one line with a link to Settings, and warns when the drive is almost full. What enhancing saved is in a pill beside the title.

### Sharper, lighter photos
- New **Auto** photo size, now the default: full-size photos from your phone or camera are kept at 8K, smaller ones like WhatsApp photos at 4K, so they stay light. Videos get **Auto** too: they stay as recorded, and old, small clips are brought up to HD.
- The Dashboard shows what enhancing did: the space saved (when there is a saving), and how many photos were kept at 8K or enlarged to 4K (press the pill beside the title).
- What to keep, Duplicates and Big videos say how much space they free, in a pill beside the title; What to keep also shows each pair's sizes.
- The print-ready copy is made at 8K with an AI model for crisp edges on large prints, about a minute per photo.

### Photos, videos and people
- **Try again** on an improved old photo: make it again from the original with other settings, such as the other colour style, and compare it with the one you have. Use the new one, or keep the current one; Undo is there if you change your mind. The earlier one waits in Trash for 30 days.
- Faces are found in videos on several moments through each video, not only on its first picture; each person is kept once.
- Make a video Full HD, 2K or 4K from the viewer's menu, even after it was processed.
- When adding colour, switching between Natural and Vivid shows the earlier result straight away instead of colouring again.
- Collages use every cell: two photos make two, five make a row of two and a row of three.
- The Collages album is always there, next to Favourites and Saved stories.
- A video's quality tag (SD, HD, 2K, 4K) is the same on its tile and in the viewer.

### Installing and updating
- **Coming from 0.2.0? Run this installer once.** From this version on, SecurePhotos updates itself: it finds a new version on its own, or from Settings, under About.
- If an update can't be installed, SecurePhotos says why in plain words, with a link to download the installer, and keeps working.
- The installer shows the progress of the old-photo model download, and their results in its own window.
- Choosing to install on the computer itself asks only once.

## [0.2.0] - 2026-11-21

### Your library on an external drive
- Install SecurePhotos on your external drive: the installer suggests a folder on it, and asks before installing on the computer itself.
- On any other Windows computer, open SecurePhotos from the drive. Nothing needs installing first, and SecurePhotos keeps nothing about your photos on that computer.
- The first time a computer is used, choose whether it improves your photos there too, just this time, or only lets you view them. Settings, under Storage, lists every computer your drive has been plugged into, and you can change each one.
- Settings, under Storage, shows your drive (SecurePhotos, other files and free space) next to what SecurePhotos keeps.

### Private Vault
- Add photos straight to the vault with **Add photos**. Each one is locked as it is copied, and by default the original is removed once its locked copy has been checked. You can change that in Settings, and for each import.
- Select photos in the vault to move them back to your library or to Trash.

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
- If the app stops unexpectedly, its photo engine now stops too, so Windows lets you eject the drive.
- Setting up the vault a second time could replace its key and make the photos in it unreadable. It is now refused.
- Closed "Who is this?" cards no longer come back.
- The Dashboard counts a photo and its improved copies once, as Photos shows them.
- A pale, foggy colour photo is no longer taken for a black-and-white print.
- A video you enhance or make smaller yourself now waits its turn instead of slowing everything else down.
- Moving photos out of the vault no longer skips a photo that was just enhanced.

### Licence
- SecurePhotos is free software under the MIT License. The installer shows a short page in plain words instead of a licence agreement.

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
