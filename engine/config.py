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
    """Resolves the default storage directory for database, cache, and models.

    Strictly portable: always stores in <app_dir>/data, never in the user's home folder.
    - If running as a frozen PyInstaller binary (e.g. on an external drive), returns <install_dir>/data.
    - In development, returns <project_root>/data.
    """
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        data_dir = exe_dir / "data"
    else:
        dev_data = Path(__file__).resolve().parent.parent / "data"
        data_dir = dev_data

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

    def ensure_directories(self) -> None:
        """Creates all required directory structures idempotently, migrating legacy data if present."""
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)
        self.previews_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.originals_dir.mkdir(parents=True, exist_ok=True)

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


# Global settings singleton initialized at startup
settings = AppConfig()
