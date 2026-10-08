# 🔒 Security Policy

Security and privacy are the foundation of SecurePhotos. We built this application so you can keep your personal memories completely private, offline, and in your full control.

---

## 🛡️ Supported Versions

We provide security updates for the following versions of SecurePhotos:

| Version | Supported |
| :--- | :---: |
| 0.2.x | ✅ |
| 0.1.x | ✅ |
| < 0.1.0 | ❌ |

---

## 🏰 Our Security Model

SecurePhotos is designed with a zero-trust, zero-cloud architecture:

- 🌐 **100% Offline by Design**: SecurePhotos never connects to the internet. There are no tracking scripts, telemetry collectors, or remote servers.
- 🔑 **Bank-Grade Encryption**: Photos in your Private Vault are protected with AES-256-GCM encryption. Keys are derived locally using Argon2id with unique cryptographic salts.
- 🧠 **Memory-Only Decryption**: When you view a photo from your Private Vault, it is decrypted directly in RAM. Unencrypted files are never written to temporary disk folders.
- 🛡️ **Protected Local Communication**: The desktop app (Tauri) and local engine (FastAPI) talk only over a local loopback connection (127.0.0.1) using dynamic ports and cryptographically generated tokens (BCryptGenRandom). External devices on your network cannot access this channel.
- 🔒 **Biometric and Two-Factor Options**: Support for Windows Hello authentication and RFC 6238 time-based one-time passwords (TOTP) for extra protection.

---

## 🚨 Reporting a Security Issue

We welcome security reports from developers, researchers, and users. If you discover a potential vulnerability, please help us protect everyone by following responsible disclosure.

### How to Report

1. **Do not open a public issue.** Please report security issues privately to protect all users until a fix is released.
2. Send an email to **security@securephotos.local** (or submit a private security advisory on GitHub under the **Security** tab).
3. Include clear details:
   - A short description of the issue.
   - Steps to reproduce or a proof of concept.
   - The version of SecurePhotos and operating system you tested on.
   - Any potential impact you identified.

### Response Timeline

- **Initial acknowledgment**: Within 48 hours.
- **Triage and fix plan**: Within 5 business days.
- **Release and disclosure**: We will publish a fix release promptly and credit you in our release notes (unless you prefer to remain anonymous).

---

## 💡 Best Practices for Users

While SecurePhotos keeps your media private and encrypted, here are steps you can take to keep your computer and vault safe:

- 🗝️ **Choose a Strong Master Password**: Use a password or passphrase that is hard to guess. Since there is no cloud recovery, nobody (including us) can reset your password if you forget it.
- 📝 **Save Your Recovery Key**: Store your recovery phrase in a safe, physical location (like a notebook or safe).
- 💾 **Maintain Regular Backups**: Keep copies of your photos and external drives in multiple locations. Hardware failure can happen to any drive.
- 🛑 **Lock When Leaving**: Lock your Private Vault or close the application when stepping away from your computer in public or shared spaces.
