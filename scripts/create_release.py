#!/usr/bin/env python3
"""SecurePhotos Release Automation Tool.

Automates the version bumping, validation, git tagging, and GitHub Actions
release triggering across all 9 manifest, engine, UI, and workflow files.

Usage:
    python scripts/create_release.py [options] [NEW_VERSION]

Examples:
    python scripts/create_release.py               # Interactive mode with suggestions
    python scripts/create_release.py 0.0.10        # Directly specify version
    python scripts/create_release.py --dry-run     # Preview file changes without modifying
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Tuple


ROOT_DIR = Path(__file__).resolve().parent.parent


def get_current_branch() -> str:
    """Returns the current active Git branch name."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except Exception as e:
        print(f"[!] Error detecting git branch: {e}")
        return "unknown"


def get_current_version() -> str:
    """Reads the current version from package.json."""
    pkg_path = ROOT_DIR / "package.json"
    with open(pkg_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("version", "0.0.0")


def suggest_next_versions(current_ver: str) -> Tuple[str, str, str]:
    """Calculates next patch, minor, and major SemVer versions."""
    parts = current_ver.split(".")
    try:
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        patch = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        return ("0.0.1", "0.1.0", "1.0.0")

    next_patch = f"{major}.{minor}.{patch + 1}"
    next_minor = f"{major}.{minor + 1}.0"
    next_major = f"{major + 1}.0.0"
    return next_patch, next_minor, next_major


def update_file(path: Path, pattern: str, replacement: str, dry_run: bool = False) -> bool:
    """Replaces a regex pattern within a target file and saves it."""
    if not path.exists():
        print(f"  [!] Warning: File not found: {path.relative_to(ROOT_DIR)}")
        return False

    content = path.read_text(encoding="utf-8")
    new_content, count = re.subn(pattern, replacement, content)

    if count == 0:
        print(f"  [!] Warning: Pattern not matched in {path.relative_to(ROOT_DIR)}")
        return False

    if not dry_run:
        path.write_text(new_content, encoding="utf-8")

    print(f"  [+] Updated {path.relative_to(ROOT_DIR)} ({count} substitution{'s' if count > 1 else ''})")
    return True


def update_all_manifests(current_ver: str, new_ver: str, dry_run: bool = False) -> bool:
    """Updates version strings across all 9 manifest and source files."""
    print(f"\n[*] Updating version references: {current_ver} -> {new_ver}")

    success = True

    # 1. package.json
    success &= update_file(
        ROOT_DIR / "package.json",
        rf'("version":\s*")({re.escape(current_ver)})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 2. src-tauri/tauri.conf.json
    success &= update_file(
        ROOT_DIR / "src-tauri" / "tauri.conf.json",
        rf'("version":\s*")({re.escape(current_ver)})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 3. src-tauri/Cargo.toml
    success &= update_file(
        ROOT_DIR / "src-tauri" / "Cargo.toml",
        rf'(name\s*=\s*"securephotos"\s*\nversion\s*=\s*")({re.escape(current_ver)})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 4. src-tauri/Cargo.lock
    success &= update_file(
        ROOT_DIR / "src-tauri" / "Cargo.lock",
        rf'(name\s*=\s*"securephotos"\s*\nversion\s*=\s*")({re.escape(current_ver)})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 5. src-tauri/src/lib.rs
    success &= update_file(
        ROOT_DIR / "src-tauri" / "src" / "lib.rs",
        rf'("version":\s*")({re.escape(current_ver)})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 6. engine/config.py
    success &= update_file(
        ROOT_DIR / "engine" / "config.py",
        rf'(app_version:\s*str\s*=\s*")({re.escape(current_ver)})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 7. src/components/TitleBar.tsx
    success &= update_file(
        ROOT_DIR / "src" / "components" / "TitleBar.tsx",
        rf'(SecurePhotos\s*<span[^>]*>)({re.escape(current_ver)})(</span>)',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 8. src/components/SettingsView.tsx
    success &= update_file(
        ROOT_DIR / "src" / "components" / "SettingsView.tsx",
        rf'(\(v)({re.escape(current_ver)})(\))',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )
    success &= update_file(
        ROOT_DIR / "src" / "components" / "SettingsView.tsx",
        rf'(Current version:\s*<span[^>]*>v)({re.escape(current_ver)})(</span>)',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 9. .github/workflows/pipeline.yml
    success &= update_file(
        ROOT_DIR / ".github" / "workflows" / "pipeline.yml",
        rf"(\(e\.g\.\s*v)({re.escape(current_ver)})(\))",
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )
    success &= update_file(
        ROOT_DIR / ".github" / "workflows" / "pipeline.yml",
        rf"(default:\s*'v)({re.escape(current_ver)})(')",
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    return success


def get_python_runner() -> str:
    """Finds the project .venv Python or active Python with pytest."""
    venv_python = ROOT_DIR / ".venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        return str(venv_python)
    posix_venv = ROOT_DIR / ".venv" / "bin" / "python"
    if posix_venv.exists():
        return str(posix_venv)
    if "VIRTUAL_ENV" in os.environ:
        cand = Path(os.environ["VIRTUAL_ENV"]) / ("Scripts" if sys.platform == "win32" else "bin") / ("python.exe" if sys.platform == "win32" else "python")
        if cand.exists():
            return str(cand)
    return sys.executable


def get_node_env() -> dict:
    """Enriches PATH with user and system Node.js locations if npm is not readily in PATH."""
    env = os.environ.copy()
    current_path = env.get("PATH", "")
    if shutil.which("npm", path=current_path) is None:
        candidates = [
            Path.home() / ".local" / "nodejs",
            Path("C:/Program Files/nodejs"),
            Path("C:/Program Files (x86)/nodejs"),
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs",
            Path(os.environ.get("NVM_SYMLINK", "")) if os.environ.get("NVM_SYMLINK") else None,
        ]
        for cand in candidates:
            if cand and cand.exists():
                if (cand / "npm.cmd").exists() or (cand / "npm").exists():
                    env["PATH"] = f"{cand};{current_path}"
                    break
    return env


def run_preflight_checks() -> bool:
    """Runs frontend TypeScript build and Python unit tests."""
    print("\n[*] Running pre-flight verification checks...")

    # Frontend build
    print("  -> Testing frontend build (tsc && vite build)...")
    env = get_node_env()
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    build_res = subprocess.run(
        [npm_cmd, "run", "build"],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        env=env,
        shell=(sys.platform == "win32"),
    )
    if build_res.returncode != 0:
        print(f"  [!] Frontend build failed:\n{build_res.stderr or build_res.stdout}")
        return False
    print("  [+] Frontend build passed (0 errors)")

    # Python unit tests
    print("  -> Running Python unit tests (pytest engine/tests)...")
    python_runner = get_python_runner()
    test_res = subprocess.run(
        [python_runner, "-m", "pytest", "engine/tests"],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    if test_res.returncode != 0:
        print(f"  [!] Python tests failed:\n{test_res.stderr or test_res.stdout}")
        return False
    print("  [+] All Python tests passed successfully")

    # H10: users download the old-photo models from this repo's Release; while the repo
    # is private (or a file is missing) those downloads would fail for everyone.
    print("  -> Checking that the old-photo models can be downloaded without a login...")
    unreachable = check_on_demand_models_public()
    if unreachable:
        print("  [!] These model files can't be downloaded anonymously (repo private, or not uploaded to the models-v1 Release):")
        for url in unreachable:
            print(f"      {url}")
        return False
    print("  [+] Old-photo models are downloadable")

    return True


def check_on_demand_models_public(opener=None) -> list:
    """Returns the on-demand model URLs that an anonymous user can't fetch (empty = all fine).

    Sends a HEAD request without any GitHub credentials, as a user's app would.
    """
    import urllib.request

    sys.path.insert(0, str(ROOT_DIR))
    from engine.services.ai_models import ON_DEMAND_MODELS

    opener = opener or urllib.request.build_opener()
    failed = []
    for spec in ON_DEMAND_MODELS.values():
        req = urllib.request.Request(spec["url"], method="HEAD", headers={"User-Agent": "SecurePhotos"})
        try:
            with opener.open(req, timeout=30) as resp:
                if resp.status != 200:
                    failed.append(spec["url"])
        except Exception:
            failed.append(spec["url"])
    return failed


def execute_git_release(new_ver: str, branch: str, dry_run: bool = False) -> bool:
    """Commits with [skip branch-ci], tags the release, and pushes to origin."""
    commit_msg = f"chore(release): bump version to {new_ver} [skip branch-ci]"
    tag_name = f"v{new_ver}"
    tag_msg = f"Release v{new_ver}"

    if dry_run:
        print("\n[DRY RUN] Would execute the following Git commands:")
        print(f'  git commit -am "{commit_msg}"')
        print(f'  git tag -a {tag_name} -m "{tag_msg}"')
        print(f"  git push origin {branch}")
        print(f"  git push origin {tag_name}")
        return True

    print("\n[*] Committing release version bump...")
    subprocess.run(["git", "commit", "-am", commit_msg], cwd=str(ROOT_DIR), check=True)

    print(f"[*] Creating annotated git tag {tag_name}...")
    subprocess.run(["git", "tag", "-a", tag_name, "-m", tag_msg], cwd=str(ROOT_DIR), check=True)

    print(f"[*] Pushing branch '{branch}' and tag '{tag_name}' to GitHub...")
    subprocess.run(["git", "push", "origin", branch], cwd=str(ROOT_DIR), check=True)
    subprocess.run(["git", "push", "origin", tag_name], cwd=str(ROOT_DIR), check=True)

    print("\n=======================================================")
    print(f" [SUCCESS] SecurePhotos {tag_name} released successfully!")
    print("=======================================================")
    print(f"  - Branch: {branch}")
    print(f"  - Tag: {tag_name}")
    print("  - Pipeline: Triggered exactly ONE release run via [skip branch-ci]")
    print("  - GitHub: https://github.com/SumitKanchan4/SecurePhotos/actions")
    return True


def main():
    parser = argparse.ArgumentParser(description="SecurePhotos Release Automation Tool")
    parser.add_argument("version", nargs="?", help="New version to release (e.g. 0.0.10)")
    parser.add_argument("--dry-run", action="store_true", help="Preview updates without touching git or disk")
    parser.add_argument("--skip-tests", action="store_true", help="Skip pre-flight test and build checks")
    parser.add_argument("-y", "--yes", action="store_true", help="Automatically confirm all prompts")
    args = parser.parse_args()

    # Rule 0 Check: Never release from master or main
    branch = get_current_branch()
    if branch in ("master", "main"):
        print("\n[!] ERROR: Enterprise Rule 0 Violation!")
        print(f"    You are currently on branch '{branch}'.")
        print("    Releases and modifications must originate from a topic branch (e.g. feature/* or fix/*).")
        sys.exit(1)

    current_ver = get_current_version()
    next_patch, next_minor, next_major = suggest_next_versions(current_ver)

    print("\n=======================================================")
    print("         SecurePhotos Release Automation Tool          ")
    print("=======================================================")
    print(f"  Current Branch : {branch}")
    print(f"  Current Version: {current_ver}")
    print(f"  Suggestions    : [1] Patch: {next_patch}  [2] Minor: {next_minor}  [3] Major: {next_major}")
    print("=======================================================\n")

    new_ver = args.version
    if not new_ver:
        prompt_text = f"Enter new version [default: {next_patch}]: "
        choice = input(prompt_text).strip()
        if not choice:
            new_ver = next_patch
        elif choice == "1":
            new_ver = next_patch
        elif choice == "2":
            new_ver = next_minor
        elif choice == "3":
            new_ver = next_major
        else:
            new_ver = choice

    # Sanitize version (strip leading 'v')
    if new_ver.startswith("v"):
        new_ver = new_ver[1:]

    # Validate SemVer pattern
    if not re.match(r"^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$", new_ver):
        print(f"[!] Invalid version format '{new_ver}'. Must be SemVer (e.g. 0.0.10 or 0.1.0-beta.1).")
        sys.exit(1)

    print(f"\n[>] Target Release Version: v{new_ver}")

    # Optional Pre-flight checks
    if not args.skip_tests and not args.dry_run:
        if not args.yes:
            run_tests = input("Run pre-flight build and tests before bumping? [Y/n]: ").strip().lower()
            if run_tests not in ("", "y", "yes"):
                print("Skipping tests as requested.")
            else:
                if not run_preflight_checks():
                    print("[!] Pre-flight checks failed. Release aborted.")
                    sys.exit(1)
        else:
            if not run_preflight_checks():
                print("[!] Pre-flight checks failed. Release aborted.")
                sys.exit(1)

    # Update files
    if not update_all_manifests(current_ver, new_ver, dry_run=args.dry_run):
        print("[!] Error: Not all files were updated cleanly. Aborting git operations.")
        sys.exit(1)

    # Git Release Operations
    if not args.yes and not args.dry_run:
        confirm = input(f"\nCommit, tag v{new_ver}, and push to GitHub? [Y/n]: ").strip().lower()
        if confirm not in ("", "y", "yes"):
            print("Release aborted. Changes remain in your working tree.")
            sys.exit(0)

    execute_git_release(new_ver, branch, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

