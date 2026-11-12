"""Build script to compile SecurePhotos Python backend engine into a Tauri sidecar binary.

This script uses PyInstaller to freeze `engine/main.py` along with all required
dependencies into a single standalone binary inside `src-tauri/binaries/` named
according to the host target triple (e.g. `securephotos-engine-x86_64-pc-windows-msvc.exe`).
"""

import platform
import shutil
import subprocess
import sys
from pathlib import Path


def get_target_triple() -> str:
    """Returns the target triple expected by Tauri for the current host architecture."""
    # 1. Query active rustc host target if available
    rustc_cmd = shutil.which("rustc")
    if not rustc_cmd:
        cargo_rustc = Path.home() / ".cargo" / "bin" / ("rustc.exe" if sys.platform == "win32" else "rustc")
        if cargo_rustc.exists():
            rustc_cmd = str(cargo_rustc)

    if rustc_cmd:
        try:
            res = subprocess.run([rustc_cmd, "-vV"], capture_output=True, text=True, check=True)
            for line in res.stdout.splitlines():
                if line.startswith("host:"):
                    host = line.split(":", 1)[1].strip()
                    if host:
                        return host
        except Exception:
            pass

    # 2. Fall back to OS/architecture heuristics
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        if "64" in machine or machine in ("amd64", "x86_64"):
            return "x86_64-pc-windows-msvc"
        return "i686-pc-windows-msvc"
    elif system == "darwin":
        if "arm" in machine or "aarch64" in machine:
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"
    elif system == "linux":
        if "arm" in machine or "aarch64" in machine:
            return "aarch64-unknown-linux-gnu"
        return "x86_64-unknown-linux-gnu"
    return f"{machine}-unknown-{system}"


def build_engine():
    root_dir = Path(__file__).resolve().parent.parent
    binaries_dir = root_dir / "src-tauri" / "binaries"
    binaries_dir.mkdir(parents=True, exist_ok=True)

    triple = get_target_triple()
    binary_name = f"securephotos-engine-{triple}"
    ext = ".exe" if platform.system().lower() == "windows" else ""
    target_exe = binaries_dir / f"{binary_name}{ext}"

    print(f"[*] Compiling SecurePhotos Engine Sidecar for target: {triple}")
    print(f"[*] Target destination: {target_exe}")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(root_dir / "run_engine.py"),
        f"--paths={root_dir}",
        "--onefile",
        f"--name={binary_name}",
        f"--distpath={binaries_dir}",
        f"--workpath={root_dir / 'build' / 'pyinstaller_work'}",
        f"--specpath={root_dir / 'build'}",
        "--noconfirm",
        "--clean",
        "--collect-all=engine",
        "--collect-all=onnxruntime",
        "--hidden-import=uvicorn.logging",
        "--hidden-import=uvicorn.loops",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.lifespans",
        "--hidden-import=uvicorn.lifespans.on",
        "--hidden-import=engine",
        "--hidden-import=engine.config",
        "--hidden-import=engine.database",
        "--hidden-import=engine.api.health",
        "--hidden-import=engine.api.system",
        "--hidden-import=engine.api.photos",
        "--hidden-import=engine.api.vault",
        "--hidden-import=engine.api.stories",
        "--hidden-import=engine.api.people",
        "--hidden-import=engine.api.albums",
        "--hidden-import=engine.api.creatives",
        "--hidden-import=engine.api.trash",
        "--hidden-import=engine.api.duplicates",
        "--hidden-import=engine.api.videos",
        "--hidden-import=engine.api.search",
        "--hidden-import=engine.api.documents",
        "--hidden-import=engine.services.crypto_vault",
        "--hidden-import=engine.services.ingestion_service",
        "--hidden-import=engine.services.social_affinity_service",
        "--hidden-import=engine.services.stories_service",
        "--hidden-import=engine.services.super_resolution_service",
        "--hidden-import=engine.services.thumbnail_service",
        "--hidden-import=engine.services.collage_service",
        "--hidden-import=engine.services.deblur_service",
        "--hidden-import=engine.services.document_service",
        "--hidden-import=engine.services.duplicate_service",
        "--hidden-import=engine.services.face_clustering_service",
        "--hidden-import=engine.services.face_recognition_service",
        "--hidden-import=engine.services.face_restore_service",
        "--hidden-import=engine.services.face_scan_worker",
        "--hidden-import=engine.services.music_service",
        "--hidden-import=engine.services.neural_sr_service",
        "--hidden-import=engine.services.video_queue_service",
        "--hidden-import=engine.services.video_runtime",
        "--hidden-import=engine.services.video_service",
        "--hidden-import=aiosqlite",
        "--hidden-import=cryptography",
        "--hidden-import=argon2",
        "--hidden-import=PIL",
        "--hidden-import=piexif",
        "--hidden-import=pyotp",
        "--hidden-import=psutil",
        "--hidden-import=numpy",
        "--hidden-import=onnxruntime",
        "--hidden-import=httpx",
        "--hidden-import=pydantic",
        "--hidden-import=pydantic_settings",
    ]

    result = subprocess.run(cmd, cwd=str(root_dir))
    if result.returncode != 0:
        print(f"[!] PyInstaller build failed with exit code: {result.returncode}")
        sys.exit(result.returncode)

    if not target_exe.exists():
        print(f"[!] Error: Expected binary not found at {target_exe}")
        sys.exit(1)

    size_mb = target_exe.stat().st_size / (1024 * 1024)
    print("[+] Engine Sidecar compiled successfully!")
    print(f"[+] File: {target_exe} ({size_mb:.2f} MB)")

    # On Windows, mirror to both gnu and msvc triples for seamless cross-PC compatibility
    if platform.system().lower() == "windows":
        if "gnu" in triple:
            alt_name = binary_name.replace("gnu", "msvc")
            alt_exe = binaries_dir / f"{alt_name}{ext}"
            try:
                shutil.copy2(target_exe, alt_exe)
                print(f"[+] Mirrored sidecar for MSVC target: {alt_exe.name}")
            except Exception as e:
                print(f"[*] Note: Could not mirror MSVC binary: {e}")
        elif "msvc" in triple:
            alt_name = binary_name.replace("msvc", "gnu")
            alt_exe = binaries_dir / f"{alt_name}{ext}"
            try:
                shutil.copy2(target_exe, alt_exe)
                print(f"[+] Mirrored sidecar for GNU target: {alt_exe.name}")
            except Exception as e:
                print(f"[*] Note: Could not mirror GNU binary: {e}")


if __name__ == "__main__":
    build_engine()
