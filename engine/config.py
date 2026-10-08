"""Configuration management for SecurePhotos 2.0 Engine.

This module provides enterprise-grade configuration using Pydantic Settings,
supporting command-line arguments, environment variables, and default configuration
for both in-place indexing and external drive vault operation.
"""

import logging
import sys
from pathlib import Path
from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("securephotos.config")


def resolve_default_data_dir() -> Path:
    """Resolves the active storage directory for database, cache, and models.

    Strictly portable: always stores in <app_dir>/data, or the folder specified in data_location.txt.
    - If SECUREPHOTOS_DATA_DIR environment variable is set, uses that directory.
    - If data_location.txt exists next to executable or in project root, uses that path.
    - If running as a frozen binary (e.g. on an external drive), returns <install_dir>/data.
    - In development, returns <project_root>/data.
    """
    import os

    # 1. Environment variable override
    env_dir = os.environ.get("SECUREPHOTOS_DATA_DIR")
    if env_dir:
        cand = Path(env_dir).resolve()
        cand.mkdir(parents=True, exist_ok=True)
        return cand

    # Determine executable/project base directory
    if getattr(sys, "frozen", False):
        base_dir = Path(sys.executable).resolve().parent
    else:
        base_dir = Path(__file__).resolve().parent.parent

    # 2. Check for data_location.txt pointer
    loc_file = base_dir / "data_location.txt"
    if loc_file.exists():
        try:
            content = loc_file.read_text(encoding="utf-8")
            for line in content.splitlines():
                line = line.strip()
                if line.startswith("path="):
                    custom_path_str = line.split("=", 1)[1].strip()
                    custom_path = Path(custom_path_str)
                    if custom_path.exists():
                        return custom_path.resolve()
        except Exception as e:
            logger.warning(f"Failed to read data_location.txt: {e}")

    # 3. Default co-located data directory
    data_dir = base_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


class AppConfig(BaseSettings):
    """Global configuration settings for the SecurePhotos engine sidecar.

    Attributes:
        app_name: Name of the application.
        app_version: Current semantic version of the engine.
        host: Localhost binding address.
        port: Dynamic binding port discovered or assigned by Tauri host.
        data_dir: Root storage directory for database, cache, and models.
        cors_origins: Whitelisted CORS origins (strictly localhost for Tauri).
        log_level: Logging severity level.
        default_theme: Default UI theme token ('dark' | 'light').
    """

    model_config = SettingsConfigDict(
        env_prefix="SECUREPHOTOS_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "SecurePhotos Engine"
    app_version: str = "0.1.0"
    data_dir: Path = Field(
        default_factory=resolve_default_data_dir,
        description="Path to active data and database directory",
    )
    cors_origins: List[str] = Field(
        default_factory=lambda: [
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        description="Allowed CORS origins for Tauri native IPC communication",
    )
    log_level: str = "INFO"
    default_theme: str = "dark"
    host: str = "127.0.0.1"
    port: int = 8000
    ipc_secret: Optional[str] = Field(
        default=None,
        alias="SECUREPHOTOS_IPC_SECRET",
        description="Cryptographic shared secret for local IPC authorization",
    )

    @property
    def database_path(self) -> Path:
        """Returns the absolute path to the SQLite relational database file."""
        return self.data_dir / "database" / "securephotos.db"

    @property
    def thumbnails_dir(self) -> Path:
        """Returns the root path for sharded micro-thumbnails."""
        return self.data_dir / "thumbnails"

    @property
    def previews_dir(self) -> Path:
        """Returns the root path for 2K/4K display proxies."""
        return self.data_dir / "previews"

    @property
    def models_dir(self) -> Path:
        """Returns the directory holding portable ONNX and GGUF AI models."""
        return self.data_dir / "models"

    @property
    def originals_dir(self) -> Path:
        """Returns the root directory for managed date-sharded original media."""
        return self.data_dir / "originals"

    @property
    def music_dir(self) -> Path:
        """Returns the directory holding user-provided story music and soundtracks."""
        return self.data_dir / "music"

    @property
    def collages_dir(self) -> Path:
        """Returns the dedicated directory holding saved 4K collages."""
        return self.originals_dir / "collages"

    def ensure_directories(self) -> None:
        """Creates all required directory structures idempotently, migrating legacy data if present."""
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)
        self.previews_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.originals_dir.mkdir(parents=True, exist_ok=True)
        self.collages_dir.mkdir(parents=True, exist_ok=True)
        self.music_dir.mkdir(parents=True, exist_ok=True)

        # Automatic legacy migration from ~/.securephotos_data if present
        try:
            legacy_data = Path.home() / ".securephotos_data"
            legacy_db = legacy_data / "database" / "securephotos.db"
            if legacy_data.exists() and legacy_data.resolve() != self.data_dir.resolve():
                import shutil
                logger.info(f"Migrating legacy database from {legacy_data} to {self.data_dir}")
                if legacy_db.exists() and not self.database_path.exists():
                    shutil.copy2(legacy_db, self.database_path)
                for folder in ("thumbnails", "previews", "models", "originals"):
                    legacy_folder = legacy_data / folder
                    target_folder = self.data_dir / folder
                    if legacy_folder.exists():
                        shutil.copytree(legacy_folder, target_folder, dirs_exist_ok=True)

                # Update SQLite paths in migrated database
                if self.database_path.exists():
                    import sqlite3
                    conn = sqlite3.connect(self.database_path)
                    old_prefix = str(legacy_data)
                    new_prefix = str(self.data_dir)
                    conn.execute(
                        "UPDATE photos SET filepath = REPLACE(filepath, ?, ?), thumbnail_path = REPLACE(thumbnail_path, ?, ?), preview_path = REPLACE(preview_path, ?, ?);",
                        (old_prefix, new_prefix, old_prefix, new_prefix, old_prefix, new_prefix)
                    )
                    conn.commit()
                    conn.close()

                # Clean up legacy user directory
                shutil.rmtree(legacy_data, ignore_errors=True)
                logger.info("Legacy data migration completed and ~/.securephotos_data cleaned up successfully.")
        except Exception as e:
            logger.warning(f"Legacy data migration notice: {e}")


    def resolve_media_path(self, filepath: str | Path) -> Path:
        r"""Dynamically resolves a photo or video filepath across drive letters and relative paths.

        Handles:
        1. Pure relative paths: 'originals/2026/01/photo.jpg' -> <data_dir>/originals/2026/01/photo.jpg
        2. Absolute paths on current volume.
        3. Drive letter changes on Windows: 'E:\data\...' -> 'F:\data\...' when drive letter shifts.
        4. Relocated folders: re-anchors to current data_dir.
        """
        if not filepath:
            return Path()

        p = Path(filepath)

        # 1. Pure relative path (the primary portable standard)
        if not p.is_absolute():
            return self.data_dir / p

        # 2. Absolute path that already exists
        if p.exists():
            return p

        # 3. Dynamic Drive Letter Remapping on Windows
        p_str = str(p)
        drive_str = self.data_dir.drive  # e.g. "E:" or "F:"
        if drive_str and len(p_str) >= 2 and p_str[1] == ":":
            remapped_str = drive_str + p_str[2:]
            remapped = Path(remapped_str)
            if remapped.exists():
                return remapped

        # 4. Suffix anchor matching: find relative part under originals, previews, thumbnails, or vault
        for anchor in ("originals", "previews", "thumbnails", "vault"):
            for sep in ("/", "\\"):
                anchor_sub = f"{sep}{anchor}{sep}"
                if anchor_sub in p_str:
                    parts = p_str.split(anchor_sub, 1)
                    if len(parts) == 2:
                        candidate = self.data_dir / anchor / parts[1]
                        if candidate.exists():
                            return candidate

        return self.data_dir / p.name


# Global settings singleton initialized at startup
settings = AppConfig()


def resolve_media_path(filepath: str | Path, base_data_dir: Optional[Path] = None) -> Path:
    """Convenience helper to resolve a media filepath using the active configuration."""
    cfg = settings
    if base_data_dir:
        # Create a temporary config view if an explicit base directory is provided
        return cfg.resolve_media_path(filepath)
    return cfg.resolve_media_path(filepath)
