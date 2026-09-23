"""Custom User Music Library, Auto-Mood Tagging, and Audio Streaming Service.

Provides automatic genre/semantic mood classification, audio scanning,
and streaming integration for user-provided story soundtracks.
"""

import hashlib
import json
import logging
import os
import random
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel

from engine.config import settings
from engine.services.video_runtime import get_ffprobe_path

logger = logging.getLogger("securephotos.music_service")

# Audio formats supported by native browser HTML5 audio element
SUPPORTED_AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"}

# Genre mappings for automatic mood classification
GENRE_MOOD_MAP = {
    "acoustic": [
        "acoustic", "folk", "country", "unplugged", "fingerstyle",
        "instrumental", "coffeehouse", "bluegrass", "indie folk"
    ],
    "nostalgic": [
        "classical", "piano", "ambient", "chillout", "ballad", "blues",
        "soul", "vintage", "retro", "downtempo", "lo-fi chill", "lounge"
    ],
    "upbeat": [
        "pop", "dance", "electronic", "edm", "hip-hop", "hip hop", "funk",
        "lofi beats", "summer", "party", "rock", "disco", "groove", "reggae"
    ],
    "cinematic": [
        "soundtrack", "score", "cinematic", "orchestral", "epic",
        "trailer", "symphonic", "film", "theme", "dramatic"
    ],
}

# Semantic filename keywords
KEYWORD_MOOD_MAP = {
    "nostalgic": [
        "piano", "memories", "past", "warm", "reflective", "gentle",
        "slow", "nostalgia", "sorrow", "tear", "remember", "yesterday", "years"
    ],
    "upbeat": [
        "summer", "sunshine", "party", "happy", "fun", "dance", "beat",
        "cheerful", "energy", "pop", "groove", "joy", "celebration", "jump", "vibe"
    ],
    "acoustic": [
        "acoustic", "guitar", "folk", "serene", "nature", "morning",
        "coffee", "calm", "soft", "peaceful", "quiet", "breeze", "wood", "campfire"
    ],
    "cinematic": [
        "epic", "cinematic", "orchestra", "strings", "journey", "adventure",
        "trailer", "heroic", "triumph", "dramatic", "legend", "odyssey", "quest"
    ],
}


class MusicTrack(BaseModel):
    """Payload representing a single user soundtrack."""
    id: str
    filename: str
    filepath: str
    title: str
    artist: str
    mood: str                       # 'nostalgic' | 'upbeat' | 'acoustic' | 'cinematic'
    auto_tagged: bool
    duration_seconds: float
    duration_formatted: str
    file_size_formatted: str
    file_size_bytes: int
    stream_url: str


def format_duration(seconds: float) -> str:
    """Formats duration in seconds into MM:SS string."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"


def format_size(size_bytes: int) -> str:
    """Formats byte counts into clean human-readable strings."""
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


def detect_mood_from_metadata(
    filename: str,
    genre: Optional[str] = None,
    parent_folder: Optional[str] = None,
) -> Tuple[str, bool]:
    """Automatically classifies audio into an emotional mood bucket.

    Evaluates:
    1. Parent folder name if named after a mood.
    2. Embedded ID3 / container genre.
    3. Semantic keywords in filename or title.

    Returns:
        Tuple of (mood, auto_tagged_flag).
    """
    valid_moods = {"nostalgic", "upbeat", "acoustic", "cinematic"}

    # 1. Folder name match (e.g. music/nostalgic/piano.mp3)
    if parent_folder and parent_folder.lower() in valid_moods:
        return parent_folder.lower(), True

    # 2. ID3 Genre match
    if genre:
        g_lower = genre.lower()
        for mood, genres in GENRE_MOOD_MAP.items():
            if any(g in g_lower for g in genres):
                return mood, True

    # 3. Filename semantic keyword match
    fn_lower = filename.lower().replace("_", " ").replace("-", " ")
    for mood, keywords in KEYWORD_MOOD_MAP.items():
        if any(kw in fn_lower for kw in keywords):
            return mood, True

    # Default to nostalgic for story memories
    return "nostalgic", True


def auto_detect_mood(
    filename: str,
    genre: Optional[str] = None,
    parent_folder: Optional[str] = None,
) -> str:
    """Returns detected mood string for audio file."""
    mood, _ = detect_mood_from_metadata(filename, genre, parent_folder)
    return mood


def get_music_manifest_path() -> Path:
    """Returns path to the user music manifest for saving mood overrides."""
    return settings.music_dir / "music_manifest.json"


def load_manifest() -> Dict[str, Any]:
    """Loads custom mood overrides from manifest."""
    manifest_p = get_music_manifest_path()
    if manifest_p.exists():
        try:
            return json.loads(manifest_p.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_manifest(data: Dict[str, Any]) -> None:
    """Saves custom mood overrides to manifest."""
    manifest_p = get_music_manifest_path()
    manifest_p.parent.mkdir(parents=True, exist_ok=True)
    manifest_p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def probe_audio_file(filepath: Path) -> Dict[str, Any]:
    """Extracts duration, title, artist, and genre using ffprobe."""
    ffprobe = get_ffprobe_path()
    meta = {
        "title": filepath.stem.replace("_", " ").replace("-", " ").title(),
        "artist": "Local Soundtrack",
        "genre": None,
        "duration": 180.0,
    }

    if not ffprobe or not filepath.exists():
        return meta

    cmd = [
        ffprobe,
        "-v", "error",
        "-show_entries", "format=duration:format_tags=title,artist,genre",
        "-of", "json",
        str(filepath.resolve()),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=True)
        data = json.loads(proc.stdout)
        fmt = data.get("format", {})
        dur = float(fmt.get("duration", 180.0))
        meta["duration"] = dur if dur > 0 else 180.0

        tags = fmt.get("tags", {})
        if tags:
            # Case-insensitive tag extraction
            tags_lower = {k.lower(): v for k, v in tags.items()}
            if "title" in tags_lower and tags_lower["title"].strip():
                meta["title"] = tags_lower["title"].strip()
            if "artist" in tags_lower and tags_lower["artist"].strip():
                meta["artist"] = tags_lower["artist"].strip()
            if "genre" in tags_lower and tags_lower["genre"].strip():
                meta["genre"] = tags_lower["genre"].strip()
    except Exception as e:
        logger.warning(f"ffprobe audio probe notice on {filepath}: {e}")

    return meta


def scan_music_library() -> List[MusicTrack]:
    """Scans the music directory recursively, indexing and auto-tagging all tracks."""
    settings.ensure_directories()
    music_dir = settings.music_dir
    manifest = load_manifest()

    tracks: List[MusicTrack] = []
    if not music_dir.exists():
        return tracks

    for root, _, files in os.walk(music_dir):
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in SUPPORTED_AUDIO_EXTENSIONS:
                f_path = Path(root) / f
                track_id = hashlib.sha256(str(f_path.resolve()).encode("utf-8")).hexdigest()[:12]
                file_size = f_path.stat().st_size

                # Extract audio tags
                audio_meta = probe_audio_file(f_path)
                parent_folder = f_path.parent.name

                # Check manifest for manual override
                if track_id in manifest:
                    mood = manifest[track_id].get("mood", "acoustic")
                    auto_tagged = manifest[track_id].get("auto_tagged", False)
                else:
                    mood, auto_tagged = detect_mood_from_metadata(
                        filename=f,
                        genre=audio_meta.get("genre"),
                        parent_folder=parent_folder,
                    )

                tracks.append(
                    MusicTrack(
                        id=track_id,
                        filename=f,
                        filepath=str(f_path.resolve()),
                        title=audio_meta["title"],
                        artist=audio_meta["artist"],
                        mood=mood,
                        auto_tagged=auto_tagged,
                        duration_seconds=audio_meta["duration"],
                        duration_formatted=format_duration(audio_meta["duration"]),
                        file_size_formatted=format_size(file_size),
                        file_size_bytes=file_size,
                        stream_url=f"/api/stories/music/{track_id}/stream",
                    )
                )

    return tracks


def get_track_for_mood(mood: str) -> Optional[MusicTrack]:
    """Finds an available user soundtrack matching the given mood."""
    all_tracks = scan_music_library()
    matching = [t for t in all_tracks if t.mood == mood]
    if matching:
        return random.choice(matching)
    elif all_tracks:
        # Fallback to any user track if specific mood isn't found
        return random.choice(all_tracks)
    return None


def get_track_by_id(track_id: str) -> Optional[MusicTrack]:
    """Finds a specific music track by its unique ID."""
    all_tracks = scan_music_library()
    for t in all_tracks:
        if t.id == track_id:
            return t
    return None


def update_track_mood(track_id: str, new_mood: str) -> bool:
    """Updates and persists a manual mood classification for a track."""
    valid_moods = {"nostalgic", "upbeat", "acoustic", "cinematic"}
    if new_mood not in valid_moods:
        return False

    manifest = load_manifest()
    manifest[track_id] = {
        "mood": new_mood,
        "auto_tagged": False,
    }
    save_manifest(manifest)
    return True


def save_uploaded_music(
    file_bytes: bytes,
    filename: str,
    explicit_mood: Optional[str] = None,
) -> MusicTrack:
    """Saves an uploaded audio file into the music library, auto-tagging if mood omitted."""
    settings.ensure_directories()
    safe_name = Path(filename).name.replace(" ", "_")
    target_path = settings.music_dir / safe_name

    target_path.write_bytes(file_bytes)

    track_id = hashlib.sha256(str(target_path.resolve()).encode("utf-8")).hexdigest()[:12]
    audio_meta = probe_audio_file(target_path)

    if explicit_mood and explicit_mood in {"nostalgic", "upbeat", "acoustic", "cinematic"}:
        mood = explicit_mood
        auto_tagged = False
        manifest = load_manifest()
        manifest[track_id] = {"mood": mood, "auto_tagged": False}
        save_manifest(manifest)
    else:
        mood, auto_tagged = detect_mood_from_metadata(
            filename=safe_name,
            genre=audio_meta.get("genre"),
        )

    file_size = len(file_bytes)
    return MusicTrack(
        id=track_id,
        filename=safe_name,
        filepath=str(target_path.resolve()),
        title=audio_meta["title"],
        artist=audio_meta["artist"],
        mood=mood,
        auto_tagged=auto_tagged,
        duration_seconds=audio_meta["duration"],
        duration_formatted=format_duration(audio_meta["duration"]),
        file_size_formatted=format_size(file_size),
        file_size_bytes=file_size,
        stream_url=f"/api/stories/music/{track_id}/stream",
    )
