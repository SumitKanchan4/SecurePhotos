/**
 * Add photos to an album (redesign R7d): pick from the library, or bring new files in from this
 * computer straight into the album.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Play, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { PhotoItem } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../../services/api";
import { plural } from "./albumsFormat";

interface AddPhotosDialogProps {
  albumId: number;
  albumName: string;
  existingIds: Set<number>;
  onClose: () => void;
  /** Called after photos were added (count may be 0 when everything was already there). */
  onAdded: () => void;
}

export const AddPhotosDialog: React.FC<AddPhotosDialogProps> = ({ albumId, albumName, existingIds, onClose, onAdded }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [library, setLibrary] = useState<PhotoItem[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/api/photos?limit=500")
      .then((res) => (res.ok ? res.json() : []))
      .then((all: PhotoItem[]) => alive && setLibrary(Array.isArray(all) ? all.filter((p) => !existingIds.has(p.id)) : []))
      .catch(() => alive && setLibrary([]));
    return () => {
      alive = false;
    };
  }, [existingIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addPicked = async () => {
    if (picked.size === 0) return;
    setBusy("Adding…");
    try {
      const res = await apiFetch(`/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: Array.from(picked) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Added ${plural(picked.size, "photo")} to ${albumName}.`, "success");
      onAdded();
    } catch {
      showToast(`Those photos couldn't be added to ${albumName}. Try again.`, "warning");
      setBusy(null);
    }
  };

  const importFiles = async () => {
    let paths: string[] | null = null;
    try {
      paths = await invoke<string[] | null>("select_import_files");
    } catch {
      showToast("Choosing files isn't available right now.", "warning");
      return;
    }
    if (!paths || paths.length === 0) return;
    setBusy(`Bringing in ${plural(paths.length, "file")}…`);
    try {
      const res = await apiFetch("/api/photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_paths: paths, album_id: albumId, mode: "managed" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const added = (data.imported || 0) + (data.album_linked_count || 0);
      if (added > 0) showToast(`Added ${plural(added, "item")} to ${albumName}.`, "success");
      else if (data.failed > 0) showToast(`${plural(data.failed, "file")} couldn't be read, so nothing was added.`, "warning");
      else showToast(`Everything you chose is already in ${albumName}.`, "info");
      window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "imported", albumId } }));
      onAdded();
    } catch {
      showToast(`Those files couldn't be added to ${albumName}. Try again.`, "warning");
      setBusy(null);
    }
  };

  const photos = useMemo(() => library ?? [], [library]);

  return (
    <div className="alb-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="alb-dialog" role="dialog" aria-modal="true" aria-labelledby="alb-add-title">
        <div className="alb-dialog-head">
          <div>
            <h2 id="alb-add-title">Add photos to {albumName}</h2>
            <p className="dash-muted">{busy ?? (picked.size ? `${plural(picked.size, "photo")} chosen` : "Choose photos from your library")}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="dash-btn dash-btn-small" onClick={importFiles} disabled={!!busy}>
            From this computer…
          </button>
          <button type="button" className="dash-icon-btn" aria-label="Close" onClick={onClose} disabled={!!busy}>
            <X size={16} />
          </button>
        </div>

        <div className="alb-picker">
          {library === null ? (
            <div className="dash-empty">
              <Loader2 size={22} className="spin" />
            </div>
          ) : photos.length === 0 ? (
            <div className="dash-empty">
              <h2>Nothing else to add</h2>
              <p>Every photo in your library is already in this album. Use "From this computer…" to bring in new ones.</p>
            </div>
          ) : (
            photos.map((p) => {
              const on = picked.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={on ? "alb-pick is-on" : "alb-pick"}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={p.filename}
                  onClick={() => toggle(p.id)}
                  disabled={!!busy}
                >
                  <img src={getThumbnailUrl(p.id)} alt="" loading="lazy" draggable={false} />
                  {p.mime_type?.startsWith("video/") && (
                    <span className="alb-pick-video">
                      <Play size={10} fill="currentColor" />
                    </span>
                  )}
                  <span className="alb-pick-check" aria-hidden="true">
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="alb-dialog-foot">
          <button type="button" className="dash-btn" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button type="button" className="dash-btn dash-btn-primary" onClick={addPicked} disabled={!!busy || picked.size === 0}>
            {busy === "Adding…" && <Loader2 size={13} className="spin" />}
            {picked.size ? `Add ${plural(picked.size, "photo")}` : "Add photos"}
          </button>
        </div>
      </div>
    </div>
  );
};
