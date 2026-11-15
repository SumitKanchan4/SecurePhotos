/**
 * One person's page (R10, approved Person page board): big face and name (click to rename),
 * relationship and Close one right under it, their photos in the month timeline with the
 * scrubber, and rare actions behind "…". Wrong photos are taken off by selecting them and
 * choosing "Not {name}".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Download, FolderPlus, Loader2, MoreHorizontal, Play, Star, X } from "lucide-react";
import type { PersonItem, PhotoItem, TimelinePhoto } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch, getApiUrl } from "../../services/api";
import { fromPhotoItem, sortNewestFirst } from "../../utils/photoTimeline";
import { PhotoTimeline } from "../photos/PhotoTimeline";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AddToAlbumModal } from "../AddToAlbumModal";
import { AlbumSlideshowModal } from "../AlbumSlideshowModal";
import { storySpan } from "../stories/storiesFormat";
import { Face } from "./PeopleOverview";

export const RELATIONSHIPS = ["Family", "Friends", "Relatives", "Colleagues", "Acquaintances"];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "214 photos · 2012 – 2026" under the name. */
export function personMeta(photos: Pick<PhotoItem, "taken_at">[]): string {
  const dates = photos.map((p) => p.taken_at).filter((d): d is string => Boolean(d)).sort();
  const span = dates.length ? storySpan(dates[0], dates[dates.length - 1]) : "";
  return [plural(photos.length, "photo"), span].filter(Boolean).join(" · ");
}

interface PersonPageProps {
  person: PersonItem;
  /** Names already in use, to refuse a rename to someone else's name. */
  takenNames: string[];
  onBack: () => void;
  /** The person changed (name, relationship, close one, profile photo or photo count). */
  onChanged: (person: PersonItem) => void;
  onDeleted: (personId: number) => void;
  onOpenPhotos: (photos: TimelinePhoto[], index: number) => void;
  onToggleFavorite?: (photoId: number) => void;
}

export const PersonPage: React.FC<PersonPageProps> = ({ person, takenNames, onBack, onChanged, onDeleted, onOpenPhotos, onToggleFavorite }) => {
  const showToast = useAppStore((s) => s.showToast);
  const selectedPhotoIds = useAppStore((s) => s.selectedPhotoIds);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(person.name);
  const [relationOpen, setRelationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addToAlbum, setAddToAlbum] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const relationRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/people/${person.id}/photos`);
      const data = res.ok ? await res.json() : [];
      setPhotos(Array.isArray(data) ? data : []);
    } catch {
      setPhotos([]);
    }
  }, [person.id]);

  useEffect(() => {
    setPhotos(null);
    load();
  }, [load]);

  // A photo trashed or moved to the vault elsewhere (e.g. from the viewer) leaves this page too.
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener("photos-changed", onChanged);
    return () => window.removeEventListener("photos-changed", onChanged);
  }, [load]);

  // A selection left over from another screen must not act here.
  useEffect(() => {
    clearSelection();
    return () => clearSelection();
  }, [clearSelection, person.id]);

  // Menus close on a click outside them.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (relationRef.current && !relationRef.current.contains(e.target as Node)) setRelationOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Escape: close a menu, then leave "choose profile photo", then clear the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmDelete || addToAlbum || slideshow || renaming) return;
      if (menuOpen || relationOpen) {
        setMenuOpen(false);
        setRelationOpen(false);
      } else if (choosingCover) setChoosingCover(false);
      else if (useAppStore.getState().selectedPhotoIds.size) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, relationOpen, choosingCover, confirmDelete, addToAlbum, slideshow, renaming, clearSelection]);

  const sorted = useMemo(() => sortNewestFirst(photos ?? []), [photos]);
  const timeline = useMemo(() => sorted.map(fromPhotoItem), [sorted]);
  const selected = sorted.filter((p) => selectedPhotoIds.has(p.id));

  const update = async (changes: { name?: string; relationship_type?: string; is_close_one?: boolean }) => {
    try {
      const res = await apiFetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onChanged(await res.json());
    } catch {
      showToast("That change couldn't be saved. Try again.", "warning");
    }
  };

  const saveRename = async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (!name || name === person.name) return;
    const taken = takenNames.find((n) => n.trim().toLowerCase() === name.toLowerCase() && n !== person.name);
    if (taken) {
      showToast(`Someone else is already called ${taken}. Pick a different name.`, "warning");
      return;
    }
    await update({ name });
  };

  const openPhoto = (index: number) => {
    const photo = timeline[index];
    if (!choosingCover) {
      onOpenPhotos(timeline, index);
      return;
    }
    setChoosingCover(false);
    apiFetch(`/api/people/${person.id}/cover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_id: photo.id }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        onChanged({ ...person, cover_face_id: data.cover_face_id });
        showToast("Profile photo changed.", "success");
      })
      .catch(() => showToast("That photo couldn't be used. Try another one.", "warning"));
  };

  const notThisPerson = async () => {
    const ids = selected.map((p) => p.id);
    setBusy(true);
    let removed = 0;
    for (const id of ids) {
      try {
        const res = await apiFetch(`/api/people/${person.id}/unlink-photo/${id}`, { method: "POST" });
        if (res.ok) removed++;
      } catch {
        /* counted below */
      }
    }
    setBusy(false);
    clearSelection();
    setPhotos((prev) => (prev ?? []).filter((p) => !ids.includes(p.id)));
    onChanged({ ...person, confirmed_count: Math.max(0, (person.confirmed_count ?? 0) - removed) });
    if (removed === ids.length) showToast(`Took ${plural(removed, "photo")} off ${person.name}. They stay in your library.`, "success");
    else showToast(`${plural(ids.length - removed, "photo")} couldn't be changed. Try again.`, "warning");
  };

  const deletePerson = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/people/${person.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Deleted ${person.name}. Their photos stay in your library.`, "success");
      onDeleted(person.id);
    } catch {
      showToast(`${person.name} couldn't be deleted. Try again.`, "warning");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const download = () => {
    selected.forEach((p, i) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = getApiUrl(`/api/photos/${p.id}/download`);
        link.setAttribute("download", p.filename || `photo_${p.id}.jpg`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, i * 150);
    });
    showToast(`Downloading ${plural(selected.length, "photo")} to your Downloads folder.`, "info");
  };

  const relationship = person.relationship_type || "Friends";

  return (
    <div className="alb-page person-page">
      <div>
        <button type="button" className="dash-back" onClick={onBack}>
          <ArrowLeft size={15} /> People
        </button>
      </div>

      <div className="person-head">
        <Face faceId={person.cover_face_id} name={person.name} size={92} className={person.is_close_one ? "person-face is-close" : "person-face"} />
        <div className="person-head-text">
          <div className="person-name-row">
            {renaming ? (
              <form
                className="alb-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveRename();
                }}
              >
                <input
                  aria-label="Name"
                  value={renameValue}
                  autoFocus
                  maxLength={80}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setRenaming(false);
                    }
                  }}
                />
                <button type="submit" className="dash-btn dash-btn-primary dash-btn-small">
                  Save
                </button>
                <button type="button" className="dash-btn dash-btn-small" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <h1 className="dash-title">
                <button
                  type="button"
                  className="person-name"
                  title="Click to rename"
                  onClick={() => {
                    setRenameValue(person.name);
                    setRenaming(true);
                  }}
                >
                  {person.name}
                </button>
              </h1>
            )}
            {photos !== null && <span className="dash-subtitle">{personMeta(photos)}</span>}
          </div>
          <div className="person-controls">
            <div className="alb-menu-wrap" ref={relationRef}>
              <button
                type="button"
                className="dash-btn dash-btn-small"
                aria-label={`Relationship: ${relationship}`}
                aria-haspopup="menu"
                aria-expanded={relationOpen}
                onClick={() => setRelationOpen((v) => !v)}
              >
                {relationship} <ChevronDown size={13} />
              </button>
              {relationOpen && (
                <div className="alb-menu person-relation-menu" role="menu">
                  {RELATIONSHIPS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="menuitemradio"
                      aria-checked={r === relationship}
                      onClick={() => {
                        setRelationOpen(false);
                        if (r !== relationship) update({ relationship_type: r });
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={person.is_close_one ? "dash-btn dash-btn-small dash-btn-primary" : "dash-btn dash-btn-small"}
              aria-pressed={person.is_close_one}
              onClick={() => update({ is_close_one: !person.is_close_one })}
            >
              <Star size={13} fill={person.is_close_one ? "currentColor" : "none"} /> Close one
            </button>
          </div>
        </div>
        {sorted.length > 0 && (
          <button type="button" className="dash-btn" onClick={() => setSlideshow(true)}>
            <Play size={13} fill="currentColor" /> Slideshow
          </button>
        )}
        <div className="alb-menu-wrap" ref={menuRef}>
          <button type="button" className="dash-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="alb-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={sorted.length === 0}
                onClick={() => {
                  setMenuOpen(false);
                  clearSelection();
                  setChoosingCover(true);
                }}
              >
                Choose profile photo
              </button>
              <div className="alb-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                Delete {person.name}…
              </button>
            </div>
          )}
        </div>
      </div>

      {choosingCover && (
        <div className="dash-note dash-note-row" role="status">
          <span>Click the photo you want as {person.name}'s profile photo.</span>
          <button type="button" className="dash-btn dash-btn-small" onClick={() => setChoosingCover(false)}>
            Cancel
          </button>
        </div>
      )}

      {photos === null ? (
        <div className="dash-empty">
          <Loader2 size={22} className="spin" />
        </div>
      ) : (
        <div className="alb-grid">
          <PhotoTimeline
            photos={timeline}
            onOpen={openPhoto}
            onToggleFavorite={onToggleFavorite}
            minScrubberSections={4}
            empty={
              <div className="dash-empty">
                <h2>No photos of {person.name} yet</h2>
                <p>Photos where {person.name} is recognised show up here. Name more faces in People to add them.</p>
              </div>
            }
          />
        </div>
      )}

      {selected.length > 0 && (
        <div className="alb-selbar" role="toolbar" aria-label="Selected photos">
          <span className="alb-selbar-count">{selected.length} selected</span>
          <button
            type="button"
            className="alb-selbar-btn"
            onClick={() =>
              selected.length === sorted.length ? clearSelection() : useAppStore.setState({ selectedPhotoIds: new Set(sorted.map((p) => p.id)) })
            }
          >
            {selected.length === sorted.length ? "Select none" : "Select all"}
          </button>
          <span className="alb-selbar-divider" />
          <button type="button" className="alb-selbar-btn is-strong" onClick={notThisPerson} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <X size={14} />} Not {person.name}
          </button>
          <button type="button" className="alb-selbar-btn" onClick={() => setAddToAlbum(true)}>
            <FolderPlus size={14} /> Add to album
          </button>
          <button type="button" className="alb-selbar-btn" onClick={download}>
            <Download size={14} /> Download
          </button>
          <button type="button" className="alb-selbar-btn alb-selbar-close" aria-label="Clear selection" onClick={clearSelection}>
            <X size={14} />
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${person.name}?`}
          message={`Only the name goes: ${person.name}'s faces become unnamed again and every photo stays in your library.`}
          confirmLabel={`Delete ${person.name}`}
          busy={busy}
          onConfirm={deletePerson}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      <AddToAlbumModal
        isOpen={addToAlbum}
        selectedPhotoIds={selected.map((p) => p.id)}
        onClose={() => setAddToAlbum(false)}
        onSuccess={(albumName) => {
          setAddToAlbum(false);
          clearSelection();
          showToast(`Added to ${albumName}.`, "success");
        }}
      />
      <AlbumSlideshowModal isOpen={slideshow} albumName={person.name} photos={sorted} onClose={() => setSlideshow(false)} />
    </div>
  );
};
