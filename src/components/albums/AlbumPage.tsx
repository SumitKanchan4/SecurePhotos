/**
 * One album, opened from Albums (redesign R7d, approved board). The photos use the Photos grid;
 * rare actions (rename, cover, Vault, delete) live behind one "…" menu. The same page shows
 * Favourites, the automatic Collages album and Saved stories.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FolderPlus, LayoutGrid, Loader2, MoreHorizontal, Play, Trash2, X } from "lucide-react";
import type { AlbumItem, PhotoItem, StoryModel } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch, getApiUrl, getThumbnailUrl } from "../../services/api";
import { fromPhotoItem, sortNewestFirst } from "../../utils/photoTimeline";
import { PhotoTimeline } from "../photos/PhotoTimeline";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AlbumSlideshowModal } from "../AlbumSlideshowModal";
import { AddToAlbumModal } from "../AddToAlbumModal";
import { CollageModal } from "../CollageModal";
import { AddPhotosDialog } from "./AddPhotosDialog";
import { albumPageMeta, isCollagesAlbum, plural } from "./albumsFormat";

export type AlbumPageTarget = { kind: "album"; album: AlbumItem } | { kind: "favourites" } | { kind: "stories" };

interface AlbumPageProps {
  target: AlbumPageTarget;
  savedStories: StoryModel[];
  refreshKey?: number;
  onBack: () => void;
  /** Something changed that the Albums overview shows (counts, covers, names). */
  onChanged: () => void;
  onPhotoClick?: (index: number, photos: PhotoItem[]) => void;
  onToggleFavorite?: (photoId: number) => void;
  onPlayStory?: (storyId: number) => void;
  onLockAlbumToVault?: (albumId: number, isVault?: boolean) => void | Promise<void>;
}

export const AlbumPage: React.FC<AlbumPageProps> = ({
  target,
  savedStories,
  refreshKey = 0,
  onBack,
  onChanged,
  onPhotoClick,
  onToggleFavorite,
  onPlayStory,
  onLockAlbumToVault,
}) => {
  const showToast = useAppStore((s) => s.showToast);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const selectedPhotoIds = useAppStore((s) => s.selectedPhotoIds);
  const clearSelection = useAppStore((s) => s.clearSelection);

  const album = target.kind === "album" ? target.album : null;
  const isCollages = album ? isCollagesAlbum(album) : false;
  const isUserAlbum = !!album && !isCollages;
  const [name, setName] = useState(album?.name ?? (target.kind === "favourites" ? "Favourites" : "Saved stories"));
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(target.kind !== "stories");
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [choosingCover, setChoosingCover] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "vault" | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [addToAlbum, setAddToAlbum] = useState(false);
  const [collage, setCollage] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (target.kind === "stories") return;
    try {
      const res = await apiFetch(target.kind === "favourites" ? "/api/photos?favorite_only=true" : `/api/albums/${target.album.id}`);
      if (res.ok) {
        const data = await res.json();
        const list = target.kind === "favourites" ? data : data?.photos;
        setPhotos(Array.isArray(list) ? list : []);
        if (target.kind === "album" && data?.name) setName(data.name);
      }
    } catch (err) {
      console.error("Failed to load album:", err);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Selection belongs to this page: start empty and leave nothing selected behind.
  useEffect(() => {
    clearSelection();
    return () => clearSelection();
  }, [clearSelection]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || menuOpen || confirm || adding || slideshow || addToAlbum || collage) return;
      if (choosingCover) setChoosingCover(false);
      else if (useAppStore.getState().selectedPhotoIds.size) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, confirm, adding, slideshow, addToAlbum, collage, choosingCover, clearSelection]);

  const sorted = useMemo(() => sortNewestFirst(photos), [photos]);
  const timeline = useMemo(() => sorted.map(fromPhotoItem), [sorted]);
  const existingIds = useMemo(() => new Set(photos.map((p) => p.id)), [photos]);
  const selected = useMemo(() => sorted.filter((p) => selectedPhotoIds.has(p.id)), [sorted, selectedPhotoIds]);
  const canCollage = selected.length >= 2 && selected.length <= 9 && !selected.some((p) => p.mime_type?.startsWith("video/"));

  const dropFromView = (ids: number[]) => {
    const gone = new Set(ids);
    setPhotos((prev) => prev.filter((p) => !gone.has(p.id)));
    clearSelection();
    onChanged();
  };

  const openPhoto = (index: number) => {
    const photo = sorted[index];
    if (choosingCover && album && photo) {
      setCover(photo.id);
      return;
    }
    onPhotoClick?.(index, sorted);
  };

  const setCover = async (photoId: number) => {
    if (!album) return;
    try {
      const res = await apiFetch(`/api/albums/${album.id}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setChoosingCover(false);
      showToast("Cover photo changed.", "success");
      onChanged();
    } catch {
      showToast("The cover couldn't be changed. Try again.", "warning");
    }
  };

  const toggleFavorite = (photoId: number) => {
    onToggleFavorite?.(photoId);
    if (target.kind === "favourites") {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      onChanged();
    } else {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, is_favorite: !p.is_favorite } : p)));
    }
  };

  const saveRename = async () => {
    if (!album) return;
    const next = renameValue.trim();
    if (!next) {
      showToast("An album needs a name.", "warning");
      return;
    }
    if (next === name) {
      setRenaming(false);
      return;
    }
    try {
      const res = await apiFetch(`/api/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "rename failed");
      setName(data.name ?? next);
      setRenaming(false);
      onChanged();
    } catch (err) {
      showToast(err instanceof Error && err.message !== "rename failed" ? err.message : "The album couldn't be renamed. Try again.", "warning");
    }
  };

  const deleteAlbum = async () => {
    if (!album) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/albums/${album.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`Deleted the album ${name}. Its photos are still in your library.`, "success");
      onChanged();
      onBack();
    } catch {
      showToast("The album couldn't be deleted. Try again.", "warning");
      setBusy(false);
      setConfirm(null);
    }
  };

  const moveToVault = async () => {
    if (!album) return;
    setConfirm(null);
    await onLockAlbumToVault?.(album.id, false);
    onChanged();
    onBack();
  };

  const removeFromAlbum = async () => {
    const ids = selected.map((p) => p.id);
    if (!album || !ids.length) return;
    try {
      const res = await apiFetch(`/api/albums/${album.id}/photos/batch-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dropFromView(ids);
      showToast(`Removed ${plural(ids.length, "photo")} from ${name}. They're still in your library.`, "success");
    } catch {
      showToast("Those photos couldn't be removed from the album. Try again.", "warning");
    }
  };

  const removeFromFavourites = async () => {
    const ids = selected.map((p) => p.id);
    const results = await Promise.all(
      ids.map((id) => apiFetch(`/api/photos/${id}/toggle-favorite`, { method: "POST" }).then((r) => r.ok).catch(() => false)),
    );
    const done = ids.filter((_, i) => results[i]);
    if (done.length) {
      dropFromView(done);
      showToast(`Removed ${plural(done.length, "photo")} from Favourites.`, "success");
    }
    if (done.length < ids.length) showToast("Some photos couldn't be removed from Favourites. Try again.", "warning");
  };

  const moveToTrash = async () => {
    const ids = selected.map((p) => p.id);
    if (!ids.length) return;
    try {
      const res = await apiFetch("/api/photos/batch-trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dropFromView(ids);
      window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "trashed", photoIds: ids } }));
      showToast(`Moved ${plural(ids.length, "photo")} to Trash. You can restore them for 30 days.`, "success");
    } catch {
      showToast("Those photos couldn't be moved to Trash. Try again.", "warning");
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

  const subtitle =
    target.kind === "stories"
      ? plural(savedStories.length, "story", "stories")
      : loading
      ? ""
      : albumPageMeta(photos);

  return (
    <div className="alb-page">
      <div>
        <button type="button" className="dash-back" onClick={onBack}>
          <ArrowLeft size={15} /> Albums
        </button>
      </div>

      <div className="dash-header alb-header">
        {renaming ? (
          <form
            className="alb-rename"
            onSubmit={(e) => {
              e.preventDefault();
              saveRename();
            }}
          >
            <input
              aria-label="Album name"
              value={renameValue}
              autoFocus
              maxLength={120}
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
          <h1 className="dash-title">{name}</h1>
        )}
        <span className="dash-subtitle">{subtitle}</span>
        <div style={{ flex: 1 }} />
        {target.kind !== "stories" && photos.length > 0 && (
          <button type="button" className="dash-btn" onClick={() => setSlideshow(true)}>
            <Play size={13} fill="currentColor" /> Slideshow
          </button>
        )}
        {isUserAlbum && (
          <button type="button" className="dash-btn dash-btn-primary" onClick={() => setAdding(true)}>
            + Add photos
          </button>
        )}
        {album && (
          <div className="alb-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="dash-icon-btn"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="alb-menu" role="menu">
                {isUserAlbum && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setRenameValue(name);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={photos.length === 0}
                  onClick={() => {
                    setMenuOpen(false);
                    clearSelection();
                    setChoosingCover(true);
                  }}
                >
                  Choose cover photo
                </button>
                {isUserAlbum && onLockAlbumToVault && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirm("vault");
                    }}
                  >
                    Move album to Vault
                  </button>
                )}
                {isUserAlbum && (
                  <>
                    <div className="alb-menu-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirm("delete");
                      }}
                    >
                      Delete album (photos stay)
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {choosingCover && (
        <div className="dash-note dash-note-row" role="status">
          <span>Click the photo you want as the cover.</span>
          <button type="button" className="dash-btn dash-btn-small" onClick={() => setChoosingCover(false)}>
            Cancel
          </button>
        </div>
      )}

      {target.kind === "stories" ? (
        savedStories.length === 0 ? (
          <div className="dash-empty">
            <h2>No saved stories yet</h2>
            <p>Save a story you like from Stories and it will stay here.</p>
            <button type="button" className="dash-btn" onClick={() => setActiveTab("stories")}>
              Go to Stories
            </button>
          </div>
        ) : (
          <div className="alb-stories">
            {savedStories.map((story) => (
              <button key={story.id} type="button" className="alb-story" onClick={() => onPlayStory?.(story.id)}>
                <span className="alb-story-cover">
                  {story.cover_photo_id ? <img src={getThumbnailUrl(story.cover_photo_id)} alt="" loading="lazy" draggable={false} /> : null}
                  <span className="alb-story-play" aria-hidden="true">
                    <Play size={14} fill="currentColor" />
                  </span>
                </span>
                <span className="alb-cover-name">{story.title}</span>
                {story.slides_count ? <span className="dash-muted">{plural(story.slides_count, "photo")}</span> : null}
              </button>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="dash-empty">
          <Loader2 size={22} className="spin" />
        </div>
      ) : (
        <div className="alb-grid">
          <PhotoTimeline
            photos={timeline}
            onOpen={openPhoto}
            onToggleFavorite={toggleFavorite}
            minScrubberSections={4}
            empty={
              <div className="dash-empty">
                {target.kind === "favourites" ? (
                  <>
                    <h2>No favourites yet</h2>
                    <p>Tap the heart on any photo and it will show up here.</p>
                  </>
                ) : (
                  <>
                    <h2>This album is empty</h2>
                    <p>{isUserAlbum ? "Add photos from your library or from this computer." : "Collages you save will show up here."}</p>
                    {isUserAlbum && (
                      <button type="button" className="dash-btn dash-btn-primary" onClick={() => setAdding(true)}>
                        + Add photos
                      </button>
                    )}
                  </>
                )}
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
          {album && !isCollages && (
            <button type="button" className="alb-selbar-btn" onClick={removeFromAlbum}>
              <X size={14} /> Remove from album
            </button>
          )}
          {target.kind === "favourites" && (
            <button type="button" className="alb-selbar-btn" onClick={removeFromFavourites}>
              <X size={14} /> Remove from Favourites
            </button>
          )}
          <button type="button" className="alb-selbar-btn" onClick={() => setAddToAlbum(true)}>
            <FolderPlus size={14} /> Add to album
          </button>
          {canCollage && (
            <button type="button" className="alb-selbar-btn" onClick={() => setCollage(true)}>
              <LayoutGrid size={14} /> Make collage
            </button>
          )}
          <button type="button" className="alb-selbar-btn" onClick={download}>
            <Download size={14} /> Download
          </button>
          <button type="button" className="alb-selbar-btn" onClick={moveToTrash}>
            <Trash2 size={14} /> Move to Trash
          </button>
          <button type="button" className="alb-selbar-btn alb-selbar-close" aria-label="Clear selection" onClick={clearSelection}>
            <X size={14} />
          </button>
        </div>
      )}

      {confirm === "delete" && (
        <ConfirmDialog
          title={`Delete the album ${name}?`}
          message="Only the album goes. Its photos stay in your library."
          confirmLabel="Delete album"
          busy={busy}
          onConfirm={deleteAlbum}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "vault" && (
        <ConfirmDialog
          title={`Move ${name} to the Private Vault?`}
          message={`Its ${plural(photos.length, "photo")} will be encrypted and shown only in the Private Vault, not in Photos or Albums.`}
          confirmLabel="Move to Vault"
          onConfirm={moveToVault}
          onCancel={() => setConfirm(null)}
        />
      )}

      {adding && album && (
        <AddPhotosDialog
          albumId={album.id}
          albumName={name}
          existingIds={existingIds}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
            onChanged();
          }}
        />
      )}
      <AlbumSlideshowModal isOpen={slideshow} albumName={name} photos={sorted} onClose={() => setSlideshow(false)} />
      <AddToAlbumModal
        isOpen={addToAlbum}
        selectedPhotoIds={selected.map((p) => p.id)}
        onClose={() => setAddToAlbum(false)}
        onSuccess={(albumName) => {
          setAddToAlbum(false);
          clearSelection();
          showToast(`Added to ${albumName}.`, "success");
          onChanged();
        }}
      />
      <CollageModal
        isOpen={collage}
        selectedPhotoIds={selected.map((p) => p.id)}
        onClose={() => setCollage(false)}
        onSuccess={() => {
          // The dialog shows its own "Saved" state; keep it open like the Photos tab does.
          clearSelection();
          onChanged();
        }}
      />
    </div>
  );
};
