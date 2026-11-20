<p align="center">
  <img src="src/assets/brand/app-icon.svg" width="112" height="112" alt="SecurePhotos icon">
</p>

<h1 align="center">SecurePhotos</h1>

SecurePhotos keeps your photos, videos and documents on your own computer or external drive. Nothing is uploaded, there is no account to create and no subscription to pay.

It sorts your photos by date, finds the people in them, picks out documents and receipts, brings old prints back to life, and keeps private files in a locked vault. All of this runs on your computer.

If you want to build or change the app, start with the [developer guide](docs/development.md).

## A look inside

![The photo grid: photos by month, each tagged with its size, and a year bar on the right](docs/images/screenshot-photos.jpg)

| | |
| --- | --- |
| ![Old family photos next to the coloured versions SecurePhotos made](docs/images/screenshot-what-to-keep.jpg) | ![Stories suggested from the photos, with the newest one playing at the top](docs/images/screenshot-stories.jpg) |
| Old prints, brought back in colour. The original is always kept. | Stories made from your photos. |

The screenshots use free sample photos, none of them personal; see [the credits](docs/images/CREDITS.md).

## What it does

### Your library, on your drive
Everything SecurePhotos keeps lives in one library folder: your photos, the vault, thumbnails and the app's own data. You can put that folder on an external drive, plug the drive into another computer and carry on where you left off.

### Bringing photos in
Choose files or a folder, or drop them on the window. SecurePhotos copies them into your library and leaves your originals where they are. If you prefer, it can remove each original once its copy has been checked. Photos you already have are skipped.

After an import, each new photo is prepared in the background. You can use your photos while this happens:

1. The text in it is read, so documents and receipts are found and can be searched.
2. Faces are found, so People fills in.
3. Old prints are checked for missing colour, fading and scratches.
4. Duplicates are looked for.
5. The photo is enhanced to the size you chose (2K, 4K or 8K).

A small ring on each photo shows its progress. Videos are prepared after the photos.

### Old photos
SecurePhotos can add colour to black-and-white prints, bring back faded colours, sharpen blurry faces and remove scratches and spots. It always keeps the original next to the improved copy, so you can compare them and choose which to keep. You decide in Settings whether this happens only when you ask or automatically.

### People
Name a face once and SecurePhotos finds that person across your library. You can mark close family and friends, merge groups that turn out to be the same person, and remove anything that was wrongly taken for a face.

![The People page asking who is in the old family photos](docs/images/screenshot-people.jpg)

### Documents
Receipts, tickets, IDs and other paperwork are separated from your memories, and the words printed on them can be searched.

### Stories and albums
SecurePhotos suggests stories from your trips, the people you love, this week in past years and old photos it has restored. Save the ones you like. Music for stories is in Settings, under Music. You can also make albums of your own and save suggested collages.

### Private Vault
Keep sensitive photos and documents behind a password. Vault files are encrypted, and they are only decrypted in memory while you look at them. A 4-digit PIN reopens the vault quickly while the app stays open. If you forget your password, the Emergency Card you saved during setup is the only way back in.

### Keeping things tidy
The Dashboard shows what's in your library and how much space it uses. It also points you to duplicates you can remove, improved photos still waiting for your choice, and large videos that can be made smaller. Deleted items stay in Trash for 30 days before they are removed for good.

## Getting started

1. Run the installer, `SecurePhotos_<version>_x64-setup.exe`. It needs an internet connection once, to download the old-photo models (about 2.7 GB).
2. Click **Import** and choose your photos, or drop a folder on the window.
3. Browse your photos, name the faces in **People**, and move anything private into the **Private Vault**.

SecurePhotos runs on 64-bit Windows 10 and 11. It works on an ordinary computer; a graphics card is not needed.

## Keyboard shortcuts

| Keys | What it does | Where |
| --- | --- | --- |
| Ctrl + K | Search | Anywhere |
| T | Switch between light and dark | Anywhere |
| Esc | Close the current menu or dialog, then clear the selection | Anywhere |
| ← / → (or K / J) | Previous or next photo | Photo viewer |
| + / − / 0 | Zoom in, zoom out, back to fit | Photo viewer |
| F | Add to or remove from favourites | Photo viewer |
| I | Show or hide the photo's details | Photo viewer |
| Delete | Move to Trash | Photo viewer |
| L | Move to the vault; while the vault is open, lock it | Photo viewer, anywhere |
| P | Hide everything on screen (privacy shield) | Private Vault |

Shortcuts are ignored while you type in a text box.

## Your privacy

- **Your photos stay yours.** They are kept in standard formats in your own library folder, so you are never locked in.
- **It works offline.** Face recognition, text reading and photo enhancement all run on your computer. When you are online, the app only checks GitHub for a newer version, and downloads the old-photo models if the installer couldn't. Nothing about you or your library is sent.
- **Nothing is collected.** There are no analytics, no usage tracking and no error reports sent anywhere.

## Keep a backup

SecurePhotos replaces each imported photo with its enhanced version, and the vault can only be opened with your password or Emergency Card. Please keep your own backup of your original photos and videos on a separate drive.

## More information

- [Changelog](CHANGELOG.md): what changed in each version
- [Security](SECURITY.md): how your data is protected, and how to report a security problem
- [Contributing](CONTRIBUTING.md): how to help
- [Developer guide](docs/development.md), [architecture](docs/architecture.md) and [design system](docs/design_system.md): for developers

## Licence

SecurePhotos is free software under the [MIT License](LICENSE). You keep full ownership of every photo, video and document you add to it.

The app is provided as it is, without any warranty. Its authors are not responsible for lost or damaged photos, videos or files, loss of quality from enhancement or compression, failing drives, or vault contents that can't be opened because a password or Emergency Card was lost. Keep your own backups.
