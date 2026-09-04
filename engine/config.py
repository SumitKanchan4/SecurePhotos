"""Configuration management for SecurePhotos 2.0 Engine.

This module provides enterprise-grade configuration using Pydantic Settings,
supporting command-line arguments, environment variables, and default configuration
for both in-place indexing and external drive vault operation.
"""

from pathlib import Path
from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    app_version: str = "0.0.7"
    data_dir: Path = Field(
        default_factory=lambda: Path.home() / ".securephotos_data",
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
        """Creates all required directory structures idempotently."""
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)
        self.previews_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.originals_dir.mkdir(parents=True, exist_ok=True)


# Global settings singleton initialized at startup
settings = AppConfig()
