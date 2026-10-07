#!/usr/bin/env python3
"""SecurePhotos Semantic Versioning & Release Utility.

Provides robust, deterministic SemVer detection, bumping, and manifest
synchronization across desktop and sidecar configuration files.

Usage:
    python scripts/release_version.py detect [--bump {patch,minor,major}]
    python scripts/release_version.py sync --version <X.Y.Z>
    python scripts/release_version.py auto-bump [--bump {patch,minor,major}]
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple


ROOT_DIR = Path(__file__).resolve().parent.parent


def parse_semver(version_str: str) -> Tuple[int, int, int]:
    """Parses a SemVer string into a (major, minor, patch) integer tuple.

    Args:
        version_str: The version string, optionally starting with 'v'.

    Returns:
        Tuple of (major, minor, patch) integers.

    Raises:
        ValueError: If version_str is not valid SemVer format.
    """
    clean_ver = version_str.lstrip("v").strip()
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)", clean_ver)
    if not match:
        raise ValueError(f"Invalid SemVer string: '{version_str}'")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def format_semver(major: int, minor: int, patch: int) -> str:
    """Formats an integer tuple as a SemVer string."""
    return f"{major}.{minor}.{patch}"


def get_git_tags(repo_dir: Path = ROOT_DIR) -> List[str]:
    """Retrieves all git tags from the repository."""
    try:
        res = subprocess.run(
            ["git", "tag", "-l", "v*"],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            check=True,
        )
        return [t.strip() for t in res.stdout.splitlines() if t.strip()]
    except Exception:
        return []


def get_package_json_version(repo_dir: Path = ROOT_DIR) -> Optional[str]:
    """Reads the current version from package.json."""
    pkg_file = repo_dir / "package.json"
    if not pkg_file.exists():
        return None
    try:
        with open(pkg_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("version")
    except Exception:
        return None


def get_latest_version(repo_dir: Path = ROOT_DIR) -> str:
    """Determines the highest known release version from git tags and package.json.

    Returns:
        Highest SemVer string without 'v' prefix (e.g. '0.1.0').
    """
    candidates: List[Tuple[int, int, int]] = []

    # 1. Inspect Git tags
    for tag in get_git_tags(repo_dir):
        try:
            candidates.append(parse_semver(tag))
        except ValueError:
            continue

    # 2. Inspect package.json
    pkg_ver = get_package_json_version(repo_dir)
    if pkg_ver:
        try:
            candidates.append(parse_semver(pkg_ver))
        except ValueError:
            pass

    if not candidates:
        return "0.1.0"

    candidates.sort()
    highest = candidates[-1]
    return format_semver(*highest)


def calculate_next_version(current_ver: str, bump_type: str) -> str:
    """Calculates the next version based on the bump type.

    Args:
        current_ver: Current base SemVer (e.g. '0.1.0').
        bump_type: One of 'patch', 'minor', or 'major'.

    Returns:
        Next SemVer string.
    """
    major, minor, patch = parse_semver(current_ver)

    if bump_type == "patch":
        return format_semver(major, minor, patch + 1)
    elif bump_type == "minor":
        return format_semver(major, minor + 1, 0)
    elif bump_type == "major":
        return format_semver(major + 1, 0, 0)
    else:
        raise ValueError(f"Unsupported bump type: '{bump_type}'. Must be patch, minor, or major.")


def update_file_pattern(path: Path, pattern: str, replacement: str, dry_run: bool = False) -> bool:
    """Replaces occurrences of a regex pattern in a file."""
    if not path.exists():
        return False
    content = path.read_text(encoding="utf-8")
    new_content, count = re.subn(pattern, replacement, content)
    if count == 0:
        return False
    if not dry_run:
        path.write_text(new_content, encoding="utf-8")
    return True


def sync_all_manifests(
    current_ver: str,
    new_ver: str,
    repo_dir: Path = ROOT_DIR,
    dry_run: bool = False,
) -> bool:
    """Synchronizes version numbers across all manifest and configuration files.

    Args:
        current_ver: Current version to replace.
        new_ver: Target version to set.
        repo_dir: Root repository path.
        dry_run: If True, previews changes without writing to disk.

    Returns:
        True if all critical files were successfully synchronized.
    """
    esc_curr = re.escape(current_ver)
    success = True

    # 1. package.json
    success &= update_file_pattern(
        repo_dir / "package.json",
        rf'("version":\s*")({esc_curr})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 2. src-tauri/tauri.conf.json
    success &= update_file_pattern(
        repo_dir / "src-tauri" / "tauri.conf.json",
        rf'("version":\s*")({esc_curr})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 3. src-tauri/Cargo.toml
    success &= update_file_pattern(
        repo_dir / "src-tauri" / "Cargo.toml",
        rf'(name\s*=\s*"securephotos"\s*\nversion\s*=\s*")({esc_curr})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 4. src-tauri/Cargo.lock (if present)
    cargo_lock = repo_dir / "src-tauri" / "Cargo.lock"
    if cargo_lock.exists():
        update_file_pattern(
            cargo_lock,
            rf'(name\s*=\s*"securephotos"\s*\nversion\s*=\s*")({esc_curr})(")',
            rf"\g<1>{new_ver}\g<3>",
            dry_run,
        )

    # 5. src-tauri/src/lib.rs
    update_file_pattern(
        repo_dir / "src-tauri" / "src" / "lib.rs",
        rf'("version":\s*")({esc_curr})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 6. engine/config.py
    success &= update_file_pattern(
        repo_dir / "engine" / "config.py",
        rf'(app_version:\s*str\s*=\s*")({esc_curr})(")',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    # 7. src/components/TitleBar.tsx
    update_file_pattern(
        repo_dir / "src" / "components" / "TitleBar.tsx",
        rf'(v)({esc_curr})',
        rf"\g<1>{new_ver}",
        dry_run,
    )

    # 8. src/components/SettingsView.tsx
    update_file_pattern(
        repo_dir / "src" / "components" / "SettingsView.tsx",
        rf'(\(v)({esc_curr})(\))',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )
    update_file_pattern(
        repo_dir / "src" / "components" / "SettingsView.tsx",
        rf'(v)({esc_curr})(\s*•)',
        rf"\g<1>{new_ver}\g<3>",
        dry_run,
    )

    return success


def write_github_actions_output(output_vars: dict) -> None:
    """Writes key-value pairs to the $GITHUB_OUTPUT file if available."""
    gh_output_path = os.environ.get("GITHUB_OUTPUT")
    if gh_output_path:
        with open(gh_output_path, "a", encoding="utf-8") as f:
            for k, v in output_vars.items():
                f.write(f"{k}={v}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="SecurePhotos Semantic Versioning Utility")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # detect command
    detect_parser = subparsers.add_parser("detect", help="Detect current version and calculate next version")
    detect_parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch", help="Bump type")
    detect_parser.add_argument("--repo-dir", type=Path, default=ROOT_DIR, help="Repository root path")

    # sync command
    sync_parser = subparsers.add_parser("sync", help="Synchronize version across all manifests")
    sync_parser.add_argument("--version", required=True, help="New version to set across manifests")
    sync_parser.add_argument("--current-version", default=None, help="Current version (auto-detected if omitted)")
    sync_parser.add_argument("--dry-run", action="store_true", help="Preview modifications")
    sync_parser.add_argument("--repo-dir", type=Path, default=ROOT_DIR, help="Repository root path")

    # auto-bump command
    auto_parser = subparsers.add_parser("auto-bump", help="Detect, calculate, and synchronize in one step")
    auto_parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch", help="Bump type")
    auto_parser.add_argument("--dry-run", action="store_true", help="Preview modifications")
    auto_parser.add_argument("--repo-dir", type=Path, default=ROOT_DIR, help="Repository root path")

    args = parser.parse_args()

    if args.command == "detect":
        curr = get_latest_version(args.repo_dir)
        next_ver = calculate_next_version(curr, args.bump)
        tag_name = f"v{next_ver}"

        data = {
            "previous_version": curr,
            "next_version": next_ver,
            "tag_name": tag_name,
            "bump_type": args.bump,
        }
        print(json.dumps(data, indent=2))
        write_github_actions_output(data)

    elif args.command == "sync":
        curr = args.current_version or get_latest_version(args.repo_dir)
        new_ver = args.version.lstrip("v")
        print(f"[*] Synchronizing manifests: {curr} -> {new_ver} (dry_run={args.dry_run})")
        ok = sync_all_manifests(curr, new_ver, repo_dir=args.repo_dir, dry_run=args.dry_run)
        if not ok:
            print("[!] Warning: Some files were not updated.", file=sys.stderr)
            sys.exit(1)
        print("[+] Manifests synchronized successfully.")

    elif args.command == "auto-bump":
        curr = get_latest_version(args.repo_dir)
        next_ver = calculate_next_version(curr, args.bump)
        tag_name = f"v{next_ver}"
        print(f"[*] Auto-bumping: {curr} -> {next_ver} (type: {args.bump}, dry_run={args.dry_run})")
        ok = sync_all_manifests(curr, next_ver, repo_dir=args.repo_dir, dry_run=args.dry_run)
        if not ok:
            print("[!] Warning: Some files were not updated.", file=sys.stderr)
            sys.exit(1)

        data = {
            "previous_version": curr,
            "next_version": next_ver,
            "tag_name": tag_name,
            "bump_type": args.bump,
        }
        print(json.dumps(data, indent=2))
        write_github_actions_output(data)
        print(f"[+] Version updated to {next_ver} ({tag_name})")


if __name__ == "__main__":
    main()
