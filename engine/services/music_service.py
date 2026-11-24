"""Custom User Music Library, Genuine Acoustic DSP Mood Detection, and Audio Streaming Service.

Provides genuine on-device audio waveform acoustic analysis (BPM, RMS energy, spectral centroid),
library management, mood categorization, and streaming integration for user-provided story soundtracks.
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

import numpy as np

from engine.config import settings
from engine.services.video_runtime import get_ffmpeg_path, get_ffprobe_path

logger = logging.getLogger("securephotos.music_service")

# Audio formats supported by native browser HTML5 audio element
SUPPORTED_AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"}

# Songs that come with SecurePhotos (owner, 2026-11-24), so a story always has real music
# instead of the player's made-up chords. Made by the owner, shipped under the app's licence.
# They live in the engine package (the engine build collects its files), are never deleted,
# and are used when none of the person's own songs fits a story. Their ids are fixed, so a
# mood chosen for one survives the install moving to another drive letter.
INCLUDED_MUSIC_DIR = Path(__file__).resolve().parents[1] / "assets" / "music"
INCLUDED_ARTIST = "Sumit Kanchan"
INCLUDED_TRACKS = {
    # file stem: (title, mood the app's detection hears, beats per minute)
    "between_the_frames": ("Between the Frames", "acoustic", 136.0),
    "sunday_on_the_veranda": ("Sunday on the Veranda", "acoustic", 123.0),
    "where_we_once_stood": ("Where We Once Stood", "acoustic", 161.5),
}

# Genuine Genre mappings for embedded ID3 container classification
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


class MusicTrack(BaseModel):
    """Payload representing a single user soundtrack."""
    id: str
    filename: str
    filepath: str
    title: str
    artist: str
    mood: str                       # 'auto' | 'nostalgic' | 'upbeat' | 'acoustic' | 'cinematic'
    detected_mood: Optional[str] = None
    bpm: Optional[float] = None
    auto_tagged: bool               # True when mood == 'auto'
    duration_seconds: float
    duration_formatted: str
    file_size_formatted: str
    file_size_bytes: int
    stream_url: str
    included: bool = False          # Comes with SecurePhotos: can't be removed.


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


def analyze_audio_acoustics(filepath: Path) -> Dict[str, Any]:
    """Extracts genuine physical acoustic features directly from the raw audio waveform.

    Extracts a representative 20-second PCM slice and analyzes:
    1. RMS Energy & signal amplitude (quiet vs driving loudness)
    2. Rhythm & Tempo (BPM) via energy envelope onset autocorrelation
    3. Spectral Centroid (frequency brightness) via Real FFT
    4. Zero-Crossing Rate (ZCR) for percussive texture vs flowing harmony

    Returns:
        Dict with bpm, rms, spectral_centroid, zcr, detected_mood.
    """
    ffmpeg = get_ffmpeg_path()
    default_res = {
        "bpm": 120.0,
        "rms": 0.20,
        "spectral_centroid": 2000.0,
        "zcr": 0.10,
        "detected_mood": None,
    }
    if not ffmpeg or not filepath.exists():
        return default_res

    try:
        # Extract a 20-second mono PCM slice at 22,050 Hz
        cmd = [
            ffmpeg,
            "-v", "error",
            "-i", str(filepath.resolve()),
            "-t", "20",
            "-f", "s16le",
            "-ac", "1",
            "-ar", "22050",
            "-",
        ]
        proc = subprocess.run(cmd, capture_output=True, check=True, timeout=10)
        raw = proc.stdout
        if not raw or len(raw) < 22050 * 2:  # Less than 1 second of audio
            return default_res

        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

        # 1. RMS Energy
        rms = float(np.sqrt(np.mean(audio**2)))

        # 2. Envelope & Onset Detection for Tempo (BPM)
        hop = 512
        frames = [float(np.sum(audio[i:i+hop]**2)) for i in range(0, len(audio)-hop, hop)]
        env = np.array(frames, dtype=np.float32)
        diff = np.maximum(0, np.diff(env))

        acorr = np.correlate(diff, diff, mode="full")
        acorr = acorr[len(acorr)//2:]

        sr_env = 22050 / hop
        min_lag = int(sr_env * 60 / 180)  # 180 BPM
        max_lag = int(sr_env * 60 / 60)   # 60 BPM

        if len(acorr) > max_lag:
            peak_lag = min_lag + int(np.argmax(acorr[min_lag:max_lag]))
            bpm = round(float((sr_env * 60) / max(1, peak_lag)), 1)
        else:
            bpm = 120.0

        # 3. Spectral Centroid (Brightness in Hz)
        slice_len = min(len(audio), 22050 * 10)
        fft = np.abs(np.fft.rfft(audio[:slice_len]))
        freqs = np.fft.rfftfreq(slice_len, 1.0 / 22050)
        centroid = float(np.sum(freqs * fft) / (np.sum(fft) + 1e-6))

        # 4. Zero-Crossing Rate
        zcr = float(np.mean(np.abs(np.diff(np.sign(audio)))))

        # Genuine Acoustic Classification
        # - Upbeat: energetic tempo with high sound pressure and bright frequencies
        # - Acoustic: warm mid/low frequency balance with mellow volume
        # - Cinematic: high dynamic range or expansive orchestral sound
        # - Nostalgic: slow/contemplative tempo with smooth warmth
        if (bpm >= 115 and rms >= 0.20) or (bpm >= 120 and centroid >= 2200):
            detected_mood = "upbeat"
        elif centroid <= 1700 and rms < 0.20 and zcr <= 0.12:
            detected_mood = "acoustic"
        elif zcr >= 0.18 or (bpm < 110 and rms >= 0.22):
            detected_mood = "cinematic"
        elif bpm < 95 and rms < 0.22:
            detected_mood = "nostalgic"
        else:
            detected_mood = "acoustic"

        return {
            "bpm": bpm,
            "rms": round(rms, 4),
            "spectral_centroid": round(centroid, 1),
            "zcr": round(zcr, 4),
            "detected_mood": detected_mood,
        }
    except Exception as e:
        logger.warning(f"Genuine acoustic analysis notice for {filepath}: {e}")
        return default_res


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
    """Persists custom mood overrides to manifest."""
    manifest_p = get_music_manifest_path()
    manifest_p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def probe_audio_file(filepath: Path) -> Dict[str, Any]:
    """Inspects an audio file via ffprobe extracting container metadata and duration."""
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


def detect_mood_from_audio(
    filepath: Path,
    genre: Optional[str] = None,
) -> Tuple[str, bool, Optional[str], Optional[float]]:
    """Classifies audio mood genuinely using embedded ID3 tags and physical acoustic DSP analysis.

    Returns:
        Tuple of (mood_setting, auto_tagged_flag, detected_mood, bpm).
    """
    # 1. Check embedded ID3 genre if present
    if genre:
        g_lower = genre.lower()
        for mood, genres in GENRE_MOOD_MAP.items():
            if any(g in g_lower for g in genres):
                return "auto", True, mood, None

    # 2. Genuine Physical Acoustic Waveform Analysis (DSP)
    acoustics = analyze_audio_acoustics(filepath)
    detected_mood = acoustics.get("detected_mood")
    bpm = acoustics.get("bpm")

    return "auto", True, detected_mood, bpm


# Global in-memory cache for ultra-fast story loading
_MUSIC_CACHE: Optional[List[MusicTrack]] = None


def invalidate_music_cache() -> None:
    """Invalidates the in-memory music library cache."""
    global _MUSIC_CACHE
    _MUSIC_CACHE = None


def scan_music_library() -> List[MusicTrack]:
    """Scans the music directory, utilizing manifest metadata caching and in-memory cache for sub-millisecond lookups."""
    global _MUSIC_CACHE
    if _MUSIC_CACHE is not None:
        return _MUSIC_CACHE

    settings.ensure_directories()
    music_dir = settings.music_dir
    manifest = load_manifest()
    manifest_dirty = False

    tracks: List[MusicTrack] = []
    if not music_dir.exists():
        _MUSIC_CACHE = tracks
        return tracks

    for root, _, files in os.walk(music_dir):
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in SUPPORTED_AUDIO_EXTENSIONS:
                f_path = Path(root) / f
                track_id = hashlib.sha256(str(f_path.resolve()).encode("utf-8")).hexdigest()[:12]
                f_stat = f_path.stat()
                file_size = f_stat.st_size
                mtime = f_stat.st_mtime

                entry = manifest.get(track_id, {})
                # Check if we have valid cached metadata for this exact file modification
                if entry and entry.get("mtime") == mtime and "title" in entry and "duration" in entry:
                    title = entry["title"]
                    artist = entry.get("artist", "Local Soundtrack")
                    duration = float(entry["duration"])
                    mood = entry.get("mood", "auto")
                    auto_tagged = entry.get("auto_tagged", mood == "auto")
                    detected_mood = entry.get("detected_mood")
                    bpm = entry.get("bpm")
                else:
                    # New or modified file: probe once and analyze
                    audio_meta = probe_audio_file(f_path)
                    title = audio_meta["title"]
                    artist = audio_meta["artist"]
                    duration = audio_meta["duration"]

                    if track_id in manifest and "mood" in manifest[track_id]:
                        mood = manifest[track_id]["mood"]
                        auto_tagged = manifest[track_id].get("auto_tagged", mood == "auto")
                        detected_mood = manifest[track_id].get("detected_mood")
                        bpm = manifest[track_id].get("bpm")
                    else:
                        mood, auto_tagged, detected_mood, bpm = detect_mood_from_audio(
                            filepath=f_path,
                            genre=audio_meta.get("genre"),
                        )

                    manifest[track_id] = {
                        "title": title,
                        "artist": artist,
                        "duration": duration,
                        "mtime": mtime,
                        "file_size": file_size,
                        "mood": mood,
                        "auto_tagged": auto_tagged,
                        "detected_mood": detected_mood,
                        "bpm": bpm,
                    }
                    manifest_dirty = True

                tracks.append(
                    MusicTrack(
                        id=track_id,
                        filename=f,
                        filepath=str(f_path.resolve()),
                        title=title,
                        artist=artist,
                        mood=mood,
                        detected_mood=detected_mood,
                        bpm=bpm,
                        auto_tagged=auto_tagged,
                        duration_seconds=duration,
                        duration_formatted=format_duration(duration),
                        file_size_formatted=format_size(file_size),
                        file_size_bytes=file_size,
                        stream_url=f"/api/stories/music/{track_id}/stream",
                    )
                )

    included, included_dirty = _included_tracks(manifest)
    tracks.extend(included)
    if manifest_dirty or included_dirty:
        save_manifest(manifest)

    _MUSIC_CACHE = tracks
    return tracks


def _included_tracks(manifest: Dict[str, Any]) -> Tuple[List[MusicTrack], bool]:
    """The songs that come with SecurePhotos; the length is measured once and kept in the manifest."""
    found: List[MusicTrack] = []
    dirty = False
    for stem, (title, heard, bpm) in INCLUDED_TRACKS.items():
        f_path = INCLUDED_MUSIC_DIR / f"{stem}.mp3"
        if not f_path.is_file():
            continue
        track_id = f"included-{stem.replace('_', '-')}"
        size = f_path.stat().st_size
        entry = manifest.get(track_id, {})
        duration = entry.get("duration") if entry.get("file_size") == size else None
        if duration is None:
            duration = float(probe_audio_file(f_path).get("duration") or 0.0)
            manifest[track_id] = {**entry, "duration": duration, "file_size": size}
            dirty = True
        mood = manifest[track_id].get("mood", "auto")
        found.append(
            MusicTrack(
                id=track_id,
                filename=f_path.name,
                filepath=str(f_path),
                title=title,
                artist=INCLUDED_ARTIST,
                mood=mood,
                detected_mood=heard,
                bpm=bpm,
                auto_tagged=mood == "auto",
                duration_seconds=duration,
                duration_formatted=format_duration(duration),
                file_size_formatted=format_size(size),
                file_size_bytes=size,
                stream_url=f"/api/stories/music/{track_id}/stream",
                included=True,
            )
        )
    return found, dirty


def get_track_for_mood(mood: str) -> Optional[MusicTrack]:
    """A song for a story's mood: the person's own songs first, then the included ones."""
    all_tracks = scan_music_library()
    own = [t for t in all_tracks if not t.included]
    return _pick_for_mood(own, mood) or _pick_for_mood([t for t in all_tracks if t.included], mood)


def _pick_for_mood(all_tracks: List[MusicTrack], mood: str) -> Optional[MusicTrack]:
    """The mood's songs, else ones on Auto, else any."""
    # 1. Exact match on explicit mood or on auto with matching detected_mood
    matching = [
        t for t in all_tracks
        if t.mood == mood or (t.mood == "auto" and t.detected_mood == mood)
    ]
    if matching:
        return random.choice(matching)
    # 2. General auto tracks
    auto_tracks = [t for t in all_tracks if t.mood == "auto"]
    if auto_tracks:
        return random.choice(auto_tracks)
    # 3. Any available track
    if all_tracks:
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
    """Updates and persists a mood classification or restores Auto detection."""
    valid_moods = {"auto", "nostalgic", "upbeat", "acoustic", "cinematic"}
    if new_mood not in valid_moods:
        return False

    manifest = load_manifest()
    entry = manifest.get(track_id, {})
    entry["mood"] = new_mood
    entry["auto_tagged"] = (new_mood == "auto")
    manifest[track_id] = entry
    save_manifest(manifest)
    invalidate_music_cache()
    return True


def delete_track(track_id: str) -> bool:
    """Deletes an audio track from disk and removes its manifest entry (never an included song)."""
    track = get_track_by_id(track_id)
    if not track or track.included:
        return False

    try:
        p = Path(track.filepath)
        if p.exists():
            p.unlink()
    except Exception as e:
        logger.warning(f"Could not unlink audio file {track.filepath}: {e}")

    manifest = load_manifest()
    if track_id in manifest:
        del manifest[track_id]
        save_manifest(manifest)
    invalidate_music_cache()
    return True


def save_uploaded_music(
    file_bytes: bytes,
    filename: str,
    explicit_mood: Optional[str] = None,
) -> MusicTrack:
    """Saves an uploaded audio file and performs genuine acoustic analysis."""
    settings.ensure_directories()
    safe_name = Path(filename).name.replace(" ", "_")
    target_path = settings.music_dir / safe_name

    target_path.write_bytes(file_bytes)

    track_id = hashlib.sha256(str(target_path.resolve()).encode("utf-8")).hexdigest()[:12]
    audio_meta = probe_audio_file(target_path)

    manifest = load_manifest()
    if explicit_mood and explicit_mood in {"nostalgic", "upbeat", "acoustic", "cinematic"}:
        mood = explicit_mood
        auto_tagged = False
        detected_mood = None
        bpm = None
    else:
        mood, auto_tagged, detected_mood, bpm = detect_mood_from_audio(
            filepath=target_path,
            genre=audio_meta.get("genre"),
        )

    f_stat = target_path.stat()
    manifest[track_id] = {
        "title": audio_meta["title"],
        "artist": audio_meta["artist"],
        "duration": audio_meta["duration"],
        "mtime": f_stat.st_mtime,
        "file_size": len(file_bytes),
        "mood": mood,
        "auto_tagged": auto_tagged,
        "detected_mood": detected_mood,
        "bpm": bpm,
    }
    save_manifest(manifest)
    invalidate_music_cache()

    file_size = len(file_bytes)
    return MusicTrack(
        id=track_id,
        filename=safe_name,
        filepath=str(target_path.resolve()),
        title=audio_meta["title"],
        artist=audio_meta["artist"],
        mood=mood,
        detected_mood=detected_mood,
        bpm=bpm,
        auto_tagged=auto_tagged,
        duration_seconds=audio_meta["duration"],
        duration_formatted=format_duration(audio_meta["duration"]),
        file_size_formatted=format_size(file_size),
        file_size_bytes=file_size,
        stream_url=f"/api/stories/music/{track_id}/stream",
    )
