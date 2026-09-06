import React, { useState, useEffect } from "react";
import { 
  FolderHeart, 
  Plus, 
  Lock, 
  Unlock, 
  Heart, 
  Image as ImageIcon,
  ArrowLeft,
  Trash2,
  X,
  Check,
  Loader2
} from "lucide-react";
import { AlbumItem, PhotoItem } from "../types";

interface AlbumsViewProps {
  onLockAlbumToVault?: (albumId: number) => void;
  onPhotoClick?: (idx: number, albumPhotos: PhotoItem[]) => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({
  onLockAlbumToVault,
  onPhotoClick,
}) => {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");

  // Album Detail View State
  const [activeAlbumId, setActiveAlbumId] = useState<number | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<PhotoItem[]>([]);
  const [activeAlbumMeta, setActiveAlbumMeta] = useState<AlbumItem | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Photo Picker to Add Photos to Current Album
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false);
  const [libraryPhotos, setLibraryPhotos] = useState<PhotoItem[]>([]);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<Set<number>>(new Set());
  const [isAddingPhotos, setIsAddingPhotos] = useState(false);

  useEffect(() => {
    loadAlbums();
  }, []);

  const loadAlbums = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/albums");
      if (res.ok) {
        const data: AlbumItem[] = await res.json();
        setAlbums(data);
      }
    } catch (err) {
      console.error("Failed to fetch albums:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAlbum = async () => {
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("http://127.0.0.1:8000/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const created: AlbumItem = await res.json();
        setAlbums((prev) => [created, ...prev]);
        setNewAlbumName("");
        setIsCreatingAlbum(false);
        // Automatically open the newly created album detail view
        openAlbumDetail(created.id, created);
      }
    } catch (err) {
      console.error("Failed to create album:", err);
    }
  };

  const openAlbumDetail = async (albumId: number, initialMeta?: AlbumItem) => {
    setActiveAlbumId(albumId);
    if (initialMeta) setActiveAlbumMeta(initialMeta);
    setIsDetailLoading(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveAlbumMeta(data);
        setAlbumPhotos(data.photos || []);
      }
    } catch (err) {
      console.error("Failed to load album details:", err);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleDeleteAlbum = async (albumId: number) => {
    if (!window.confirm("Are you sure you want to delete this album? Photos inside will remain safe in your library.")) {
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}`, { method: "DELETE" });
      if (res.ok) {
        setAlbums((prev) => prev.filter((a) => a.id !== albumId));
        if (activeAlbumId === albumId) {
          setActiveAlbumId(null);
          setActiveAlbumMeta(null);
          setAlbumPhotos([]);
        }
      }
    } catch (err) {
      console.error("Failed to delete album:", err);
    }
  };

  const handleToggleFavorite = async (albumId: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}/toggle-favorite`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAlbums((prev) =>
          prev.map((a) => (a.id === albumId ? { ...a, is_favorite: data.is_favorite } : a))
        );
        if (activeAlbumMeta?.id === albumId) {
          setActiveAlbumMeta((prev) => (prev ? { ...prev, is_favorite: data.is_favorite } : null));
        }
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  const handleRemovePhotoFromAlbum = async (photoId: number) => {
    if (!activeAlbumId) return;
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${activeAlbumId}/photos/${photoId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAlbumPhotos((prev) => prev.filter((p) => p.id !== photoId));
        setActiveAlbumMeta((prev) => (prev ? { ...prev, photo_count: Math.max(0, (prev.photo_count || 1) - 1) } : null));
        setAlbums((prev) =>
          prev.map((a) => (a.id === activeAlbumId ? { ...a, photo_count: Math.max(0, (a.photo_count || 1) - 1) } : a))
        );
      }
    } catch (err) {
      console.error("Failed to remove photo from album:", err);
    }
  };

  const openPhotoPicker = async () => {
    setPickerSelectedIds(new Set());
    setIsPhotoPickerOpen(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos?limit=500");
      if (res.ok) {
        const all: PhotoItem[] = await res.json();
        // Filter out photos that are already in this album
        const existingIds = new Set(albumPhotos.map((p) => p.id));
        setLibraryPhotos(all.filter((p) => !existingIds.has(p.id)));
      }
    } catch (err) {
      console.error("Failed to load library photos for picker:", err);
    }
  };

  const togglePickerSelection = (photoId: number) => {
    setPickerSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleAddSelectedToAlbum = async () => {
    if (!activeAlbumId || pickerSelectedIds.size === 0 || isAddingPhotos) return;
    setIsAddingPhotos(true);
    try {
      const ids = Array.from(pickerSelectedIds);
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${activeAlbumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setIsPhotoPickerOpen(false);
        setPickerSelectedIds(new Set());
        // Refresh detail view
        openAlbumDetail(activeAlbumId, activeAlbumMeta || undefined);
        loadAlbums();
      }
    } catch (err) {
      console.error("Failed to add photos to album:", err);
    } finally {
      setIsAddingPhotos(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // VIEW: Album Detail View (Inside a selected album)
  // ──────────────────────────────────────────────────────────────────────────
  if (activeAlbumId !== null && activeAlbumMeta) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* Header Toolbar */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-sidebar)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <button
              onClick={() => {
                setActiveAlbumId(null);
                setActiveAlbumMeta(null);
                setAlbumPhotos([]);
                loadAlbums();
              }}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ArrowLeft size={14} />
              All Albums
            </button>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "17px", fontWeight: 700, margin: 0 }}>{activeAlbumMeta.name}</h2>
                <button
                  onClick={() => handleToggleFavorite(activeAlbumMeta.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: activeAlbumMeta.is_favorite ? "var(--accent-danger, #ef4444)" : "var(--text-muted)",
                    cursor: "pointer",
                    padding: "2px",
                  }}
                >
                  <Heart size={16} fill={activeAlbumMeta.is_favorite ? "currentColor" : "none"} />
                </button>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 0" }}>
                {albumPhotos.length} {albumPhotos.length === 1 ? "photo" : "photos"}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={openPhotoPicker}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 16px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--accent-primary)",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Plus size={14} />
              Add Photos
            </button>
            <button
              onClick={() => handleDeleteAlbum(activeAlbumMeta.id)}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                color: "var(--accent-danger, #ef4444)",
                fontSize: "12px",
                cursor: "pointer",
              }}
              title="Delete this album"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </div>

        {/* Photos Grid or Empty State */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isDetailLoading ? (
            <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
              <Loader2 size={28} className="spin" style={{ margin: "0 auto 12px" }} />
              Loading album photos...
            </div>
          ) : albumPhotos.length === 0 ? (
            <div
              style={{
                marginTop: "60px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              <ImageIcon size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
              <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>This Album is Empty</p>
              <p style={{ fontSize: "12px", marginTop: "4px", maxWidth: "340px" }}>
                Add photos from your collection to organize them in this album.
              </p>
              <button
                onClick={openPhotoPicker}
                className="clickable"
                style={{
                  marginTop: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "9px 20px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Plus size={15} />
                Add Photos to Album
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "12px",
              }}
            >
              {albumPhotos.map((photo, idx) => (
                <div
                  key={photo.id}
                  className="clickable glass-panel"
                  style={{
                    position: "relative",
                    aspectRatio: "1",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    backgroundColor: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                  }}
                  onClick={() => onPhotoClick?.(idx, albumPhotos)}
                >
                  <img
                    src={`http://127.0.0.1:8000/api/photos/${photo.id}/thumbnail`}
                    alt={photo.filename}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    loading="lazy"
                  />
                  {/* Remove from Album Button (Top Right) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePhotoFromAlbum(photo.id);
                    }}
                    title="Remove from album"
                    style={{
                      position: "absolute",
                      top: "6px",
                      right: "6px",
                      background: "rgba(0, 0, 0, 0.65)",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      borderRadius: "var(--radius-xs, 4px)",
                      color: "#ffffff",
                      width: "24px",
                      height: "24px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <X size={13} />
                  </button>
                  {/* Bottom Filename */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: "6px 8px",
                      background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
                      fontSize: "10px",
                      color: "#ffffff",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {photo.filename}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Photo Picker Modal */}
        {isPhotoPickerOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "24px",
            }}
            onClick={() => setIsPhotoPickerOpen(false)}
          >
            <div
              className="glass-panel"
              style={{
                width: "100%",
                maxWidth: "720px",
                maxHeight: "85vh",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-lg, 12px)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxShadow: "0 24px 48px rgba(0, 0, 0, 0.6)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Add Photos to {activeAlbumMeta.name}</h3>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 0" }}>
                    Select photos from your library ({pickerSelectedIds.size} selected)
                  </p>
                </div>
                <button
                  onClick={() => setIsPhotoPickerOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: "4px",
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Photos Grid */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
                {libraryPhotos.length === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                    All photos in your library are already in this album.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                      gap: "8px",
                    }}
                  >
                    {libraryPhotos.map((p) => {
                      const isSelected = pickerSelectedIds.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => togglePickerSelection(p.id)}
                          style={{
                            position: "relative",
                            aspectRatio: "1",
                            borderRadius: "var(--radius-xs, 6px)",
                            overflow: "hidden",
                            border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                            cursor: "pointer",
                          }}
                        >
                          <img
                            src={`http://127.0.0.1:8000/api/photos/${p.id}/thumbnail`}
                            alt={p.filename}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            loading="lazy"
                          />
                          <div
                            style={{
                              position: "absolute",
                              top: "4px",
                              right: "4px",
                              width: "20px",
                              height: "20px",
                              borderRadius: "50%",
                              backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.5)",
                              border: "1px solid #ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {isSelected && <Check size={12} color="#ffffff" strokeWidth={3} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: "14px 20px",
                  borderTop: "1px solid var(--border-subtle)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "10px",
                  backgroundColor: "var(--bg-sidebar)",
                }}
              >
                <button
                  onClick={() => setIsPhotoPickerOpen(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "transparent",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSelectedToAlbum}
                  disabled={pickerSelectedIds.size === 0 || isAddingPhotos}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 20px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--accent-primary)",
                    border: "none",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    opacity: pickerSelectedIds.size === 0 || isAddingPhotos ? 0.5 : 1,
                    cursor: pickerSelectedIds.size === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {isAddingPhotos ? <Loader2 size={13} className="spin" /> : <Plus size={14} />}
                  Add {pickerSelectedIds.size} {pickerSelectedIds.size === 1 ? "Photo" : "Photos"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIEW: Albums Gallery Grid (Top Level)
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
      {/* Header & Actions */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          marginBottom: "20px" 
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <FolderHeart size={20} style={{ color: "var(--accent-primary)" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Albums ({albums.length})</h2>
        </div>

        <button
          onClick={() => setIsCreatingAlbum(true)}
          className="clickable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 16px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--accent-primary)",
            border: "none",
            color: "#ffffff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={15} />
          New Album
        </button>
      </div>

      {/* New Album Creation Banner */}
      {isCreatingAlbum && (
        <div 
          className="glass-panel"
          style={{
            padding: "16px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--accent-primary)",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder="Enter new album title..."
            value={newAlbumName}
            onChange={(e) => setNewAlbumName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateAlbum();
              if (e.key === "Escape") setIsCreatingAlbum(false);
            }}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-sidebar)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
              fontSize: "13px",
              outline: "none",
            }}
          />
          <button
            onClick={() => setIsCreatingAlbum(false)}
            className="clickable"
            style={{
              padding: "8px 14px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "transparent",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateAlbum}
            disabled={!newAlbumName.trim()}
            className="clickable"
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-primary)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              opacity: !newAlbumName.trim() ? 0.6 : 1,
              cursor: !newAlbumName.trim() ? "not-allowed" : "pointer",
            }}
          >
            Create
          </button>
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
          <Loader2 size={28} className="spin" style={{ margin: "0 auto 12px" }} />
          Loading albums...
        </div>
      ) : albums.length === 0 ? (
        <div 
          style={{
            marginTop: "60px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          <FolderHeart size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>No Albums Yet</p>
          <p style={{ fontSize: "12px", marginTop: "4px", maxWidth: "360px" }}>
            Create an album to organize your favorite moments, trips, or milestones.
          </p>
          <button
            onClick={() => setIsCreatingAlbum(true)}
            className="clickable"
            style={{
              marginTop: "16px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-primary)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={15} />
            Create First Album
          </button>
        </div>
      ) : (
        /* Album Grid Cards */
        <div 
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "18px",
          }}
        >
          {albums.map((album) => (
            <div
              key={album.id}
              onClick={() => openAlbumDetail(album.id, album)}
              className="clickable glass-panel"
              style={{
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
                transition: "transform 0.15s ease, border-color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.borderColor = "var(--accent-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "var(--border-subtle)";
              }}
            >
              {/* Album Cover Art */}
              <div
                style={{
                  height: "160px",
                  backgroundColor: "var(--bg-surface-elevated)",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  overflow: "hidden",
                }}
              >
                {album.cover_photo_id ? (
                  <img
                    src={`http://127.0.0.1:8000/api/photos/${album.cover_photo_id}/thumbnail`}
                    alt={album.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    loading="lazy"
                  />
                ) : (
                  <ImageIcon size={48} style={{ opacity: 0.3 }} />
                )}

                {/* Vault / Favorite Badges */}
                <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", gap: "6px" }}>
                  {album.is_vault && (
                    <span 
                      title="Encrypted Vault Album"
                      style={{
                        backgroundColor: "rgba(139, 92, 246, 0.9)",
                        color: "#ffffff",
                        padding: "3px 6px",
                        borderRadius: "var(--radius-xs)",
                        fontSize: "10px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: "3px",
                      }}
                    >
                      <Lock size={10} /> VAULT
                    </span>
                  )}
                  {album.is_favorite && (
                    <span 
                      style={{
                        backgroundColor: "rgba(239, 68, 68, 0.9)",
                        color: "#ffffff",
                        padding: "4px 6px",
                        borderRadius: "var(--radius-xs)",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Heart size={11} fill="#ffffff" />
                    </span>
                  )}
                </div>
              </div>

              {/* Card Meta Content */}
              <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {album.name}
                  </h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(album.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: album.is_favorite ? "var(--accent-danger, #ef4444)" : "var(--text-muted)",
                      cursor: "pointer",
                      padding: "2px",
                    }}
                  >
                    <Heart size={14} fill={album.is_favorite ? "currentColor" : "none"} />
                  </button>
                </div>

                <div 
                  style={{ 
                    marginTop: "6px", 
                    paddingTop: "8px", 
                    borderTop: "1px solid var(--border-subtle)", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "space-between" 
                  }}
                >
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                    {album.photo_count} {album.photo_count === 1 ? "photo" : "photos"}
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onLockAlbumToVault?.(album.id);
                    }}
                    className="clickable"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: album.is_vault ? "var(--accent-success)" : "var(--accent-vault)",
                      fontSize: "11px",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      cursor: "pointer",
                    }}
                  >
                    {album.is_vault ? <Unlock size={12} /> : <Lock size={12} />}
                    {album.is_vault ? "Decrypt" : "Lock (L)"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
