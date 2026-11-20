/**
 * Settings → Music (owner feedback, round 2 #6): the songs stories play, on their own page in
 * Settings instead of a dialog on the Stories page. Add songs (or drop them here), listen,
 * choose the mood each one is used for, or remove one; and turn story music on or off.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music, Pause, Play, Search, Trash2 } from "lucide-react";
import type { MusicTrackItem } from "../../types";
import type { AppSettings } from "../../hooks/useAppSettings";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch, getApiUrl } from "../../services/api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { MOODS, filterTracks, moodLabel, plural } from "../stories/storiesFormat";
import { SettingRow, SettingsGroup } from "./SettingsKit";

const ACCEPT = "audio/mp3,audio/wav,audio/m4a,audio/aac,audio/flac,audio/ogg,.mp3,.m4a,.wav,.aac,.flac,.ogg";

/** The song list: add, play, mood, remove. */
export const MusicLibrary: React.FC = () => {
  const showToast = useAppStore((s) => s.showToast);
  const [tracks, setTracks] = useState<MusicTrackItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MusicTrackItem | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch("/api/stories/music")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTracks(Array.isArray(data) ? data : []))
      .catch(() => setTracks([]));
    return () => {
      audio.current?.pause();
      audio.current = null;
    };
  }, []);

  const shown = useMemo(() => filterTracks(tracks ?? [], query), [tracks, query]);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };

  const togglePlay = (track: MusicTrackItem) => {
    if (playing === track.id) {
      stop();
      return;
    }
    audio.current?.pause();
    const el = new Audio(track.stream_url.startsWith("http") ? track.stream_url : getApiUrl(track.stream_url));
    el.volume = 0.6;
    el.onended = () => setPlaying(null);
    el.play().catch(() => setPlaying(null));
    audio.current = el;
    setPlaying(track.id);
  };

  const upload = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    setUploading(true);
    let added = 0;
    for (const file of list) {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await apiFetch("/api/stories/music/upload", { method: "POST", body: form });
        if (res.ok) {
          const track: MusicTrackItem = await res.json();
          setTracks((prev) => [track, ...(prev ?? []).filter((t) => t.id !== track.id)]);
          added++;
        }
      } catch {
        /* counted below */
      }
    }
    setUploading(false);
    if (added === list.length) showToast(`Added ${plural(added, "song")}. Stories will pick the right mood for ${added === 1 ? "it" : "them"}.`, "success");
    else showToast(`${plural(list.length - added, "song")} couldn't be added. Use MP3, M4A, WAV, AAC, FLAC or OGG files.`, "warning");
  };

  const setMood = async (track: MusicTrackItem, mood: string) => {
    try {
      const res = await apiFetch(`/api/stories/music/${track.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: MusicTrackItem = await res.json();
      setTracks((prev) => (prev ?? []).map((t) => (t.id === track.id ? updated : t)));
    } catch {
      showToast("The mood couldn't be changed. Try again.", "warning");
    }
  };

  const remove = async () => {
    const track = removing;
    if (!track) return;
    setRemoving(null);
    try {
      const res = await apiFetch(`/api/stories/music/${track.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (playing === track.id) stop();
      setTracks((prev) => (prev ?? []).filter((t) => t.id !== track.id));
      showToast(`Removed ${track.title}.`, "success");
    } catch {
      showToast("That song couldn't be removed. Try again.", "warning");
    }
  };

  return (
    <section
      className={`music-lib${dragging ? " is-dragging" : ""}`}
      aria-label="Songs"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="music-lib-head">
        <div>
          <h3 className="music-lib-title">Songs{tracks?.length ? ` · ${tracks.length}` : ""}</h3>
          <p className="dash-muted">Each story picks a song that fits its mood. Drop music files here, or add them.</p>
        </div>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
        <button type="button" className="dash-btn dash-btn-primary dash-btn-small" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={13} className="spin" /> : null}
          {uploading ? "Adding…" : "+ Add songs"}
        </button>
      </div>

      {(tracks?.length ?? 0) > 6 && (
        <span className="alb-search music-lib-search">
          <Search size={14} aria-hidden="true" />
          <input aria-label="Search songs" placeholder="Song, artist or mood" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
      )}

      <div className="music-lib-list">
        {tracks === null ? (
          <div className="dash-empty">
            <Loader2 size={22} className="spin" />
          </div>
        ) : tracks.length === 0 ? (
          <div className="dash-empty">
            <Music size={26} aria-hidden="true" />
            <h2>No songs yet</h2>
            <p>Add songs from this computer, or drop them here. Stories play quietly without music until you do.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="dash-muted">No song matches "{query.trim()}".</p>
        ) : (
          shown.map((track) => (
            <div key={track.id} className={`sto-track${playing === track.id ? " is-playing" : ""}`}>
              <button
                type="button"
                className="dash-icon-btn music-play"
                aria-label={playing === track.id ? `Stop ${track.title}` : `Play ${track.title}`}
                onClick={() => togglePlay(track)}
              >
                {playing === track.id ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <span className="sto-track-text">
                <span className="alb-cover-name">{track.title}</span>
                <span className="dash-muted">{[track.artist, track.duration_formatted, moodLabel(track)].filter(Boolean).join(" · ")}</span>
              </span>
              <select className="vid-select" aria-label={`Mood for ${track.title}`} value={track.mood} onChange={(e) => setMood(track, e.target.value)}>
                {MOODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button type="button" className="dash-icon-btn" aria-label={`Remove ${track.title}`} onClick={() => setRemoving(track)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.title}?`}
          message="The song is deleted from your music. This can't be undone; you can add it again later."
          confirmLabel="Remove song"
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
};

export const MusicSettings: React.FC<{
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}> = ({ settings, updateSetting }) => (
  <>
    <SettingsGroup>
      <SettingRow title="Play music in stories" description="Stories and slideshows play a song from your music, quietly in the background.">
        <ToggleSwitch checked={settings.ambient_music} onChange={(checked) => updateSetting("ambient_music", checked)} ariaLabel="Play music in stories" />
      </SettingRow>
    </SettingsGroup>
    <MusicLibrary />
  </>
);
