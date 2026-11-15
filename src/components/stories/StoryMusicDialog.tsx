/**
 * Story music (redesign R7e): the songs stories play, one icon away instead of a panel on the
 * page. Add songs, listen, choose the mood each one is used for, or remove one.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music, Pause, Play, Search, Trash2, X } from "lucide-react";
import type { MusicTrackItem } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch, getApiUrl } from "../../services/api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { MOODS, filterTracks, moodLabel, plural } from "./storiesFormat";

const ACCEPT = "audio/mp3,audio/wav,audio/m4a,audio/aac,audio/flac,audio/ogg,.mp3,.m4a,.wav,.aac,.flac,.ogg";

export const StoryMusicDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !removing && !uploading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, removing, uploading]);

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
    <div className="alb-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !uploading && onClose()}>
      <div
        className={dragging ? "alb-dialog sto-music is-dragging" : "alb-dialog sto-music"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sto-music-title"
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
        <div className="alb-dialog-head">
          <div>
            <h2 id="sto-music-title">Story music</h2>
            <p className="dash-muted">Stories play these songs. Each story picks one that fits its mood.</p>
          </div>
          <div style={{ flex: 1 }} />
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
          <button type="button" className="dash-btn dash-btn-primary dash-btn-small" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={13} className="spin" /> : null}
            {uploading ? "Adding…" : "+ Add songs"}
          </button>
          <button type="button" className="dash-icon-btn" aria-label="Close" onClick={onClose} disabled={uploading}>
            <X size={16} />
          </button>
        </div>

        {(tracks?.length ?? 0) > 6 && (
          <div className="sto-music-search">
            <span className="alb-search">
              <Search size={14} aria-hidden="true" />
              <input aria-label="Search songs" placeholder="Song, artist or mood" value={query} onChange={(e) => setQuery(e.target.value)} />
            </span>
          </div>
        )}

        <div className="sto-music-list">
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
              <div key={track.id} className="sto-track">
                <button
                  type="button"
                  className="dash-icon-btn"
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
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.title}?`}
          message="The song is deleted from Story music. This can't be undone; you can add it again later."
          confirmLabel="Remove song"
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
};
