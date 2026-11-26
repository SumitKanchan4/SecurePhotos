# Security

SecurePhotos is built so that your photos stay private and under your control. This page explains how your data is protected, how to report a security problem, and what you can do to keep your library safe.

## Supported versions

Security fixes are made for the latest version. Please update to it before reporting a problem.

| Version | Supported |
| --- | --- |
| 0.3.x | Yes |
| Older | No |

## How your data is protected

- **It stays on your computer.** There is no tracking, no analytics and no remote server. The app goes online only to check for a newer version and, if the installer couldn't, to download the old-photo models. Nothing about you or your library is sent.
- **The AI parts send nothing either.** SecurePhotos switches off the usage events of ONNX Runtime, the Microsoft component that runs its AI models. DirectML, the Microsoft component that lets those models use a graphics card, has no such switch: like Windows itself, it follows your Windows diagnostic data settings (Settings › Privacy & security › Diagnostics & feedback). It never sees your photos.
- **The vault is encrypted.** Photos and documents in your Private Vault are encrypted with AES-256-GCM, each file with its own key, in a format that detects any tampering or a cut-off file. The key is made from your password with Argon2id and a random salt.
- **Vault photos are opened in memory.** When you view a vault photo it is decrypted in memory. No unencrypted copy is written to disk. The vault key is never saved to disk either; [the architecture notes](docs/architecture.md) explain what is and isn't protected while the app is running.
- **Updates are signed.** The app installs an update only if its signature matches the key built into the app, so a changed or fake installer is refused.
- **The app and its engine talk only on your computer.** They use a local connection (127.0.0.1) on a port chosen at start-up, protected by a random access token. Other devices on your network can't reach it.
- **There is no back door.** If you forget your password, the Emergency Card you saved during setup (the card image, or the 16 numbers on it) can reset it. There is no other way in. A 4-digit PIN reopens the vault quickly, but only while the app stays open.

## Reporting a security problem

Thank you for helping keep SecurePhotos users safe. Please report problems privately so they can be fixed before they are made public.

1. Don't open a public issue.
2. On GitHub, open the repository's **Security** tab and choose **Report a vulnerability**.
3. Include:
   - what the problem is,
   - the steps to reproduce it,
   - the SecurePhotos version and Windows version you used,
   - what an attacker could do with it.

You can expect a reply within 48 hours and a plan for a fix within 5 working days. When the fix is released, you'll be credited in the release notes unless you prefer not to be.

## Keeping your library safe

- **Choose a strong master password.** Nobody, including us, can reset it for you.
- **Keep your Emergency Card somewhere safe.** Print it or save it away from this computer. It is the only way back in if you forget your password.
- **Keep backups.** Copy your original photos and videos to a separate drive. Any drive can fail.
- **Lock the vault when you step away.** Press L or use **Lock now**, especially on a shared computer.
- **Encrypt your disk.** Turn on BitLocker (or similar), so the files Windows writes from memory, such as the page file, are protected too.
