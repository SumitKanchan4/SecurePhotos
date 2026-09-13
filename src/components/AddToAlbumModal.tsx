import React, { useState, useEffect } from "react";
import { X, FolderPlus, Folder, Plus, Check, Loader2 } from "lucide-react";
import { AlbumItem } from "../types";

interface AddToAlbumModalProps {
  isOpen: boolean;
  selectedPhotoIds: number[];
  onClose: () => void;
  onSuccess: (albumName: string) => void;
}

export const AddToAlbumModal: React.FC<AddToAlbumModalProps> = ({
  isOpen,
  selectedPhotoIds,
  onClose,
  onSuccess,
}) => {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [showCreateInput, setShowCreateInput] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAlbums();
      setShowCreateInput(false);
      setNewAlbumName("");
    }
  }, [isOpen]);

  const loadAlbums = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/albums");
      if (res.ok) {
        const data: AlbumItem[] = await res.json();
        setAlbums(data.filter((a) => a.name.toLowerCase() !== "collages"));
      }
    } catch (err) {
      console.error("Failed to load albums:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToExistingAlbum = async (albumId: number, albumName: string) => {
    if (isSubmitting || selectedPhotoIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: selectedPhotoIds }),
      });
      if (res.ok) {
        onSuccess(albumName);
        onClose();
      }
    } catch (err) {
      console.error("Failed to add photos to album:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAndAdd = async () => {
    const trimmed = newAlbumName.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, photo_ids: selectedPhotoIds }),
      });
      if (res.ok) {
        onSuccess(trimmed);
        onClose();
      }
    } catch (err) {
      console.error("Failed to create and add to album:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "440px",
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg, 12px)",
          overflow: "hidden",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <FolderPlus size={18} style={{ color: "var(--accent-primary)" }} />
            <div>
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0 }}>Add to Album</h3>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, marginTop: "2px" }}>
                {selectedPhotoIds.length} {selectedPhotoIds.length === 1 ? "photo" : "photos"} selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick New Album Action */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
          {!showCreateInput ? (
            <button
              onClick={() => setShowCreateInput(true)}
              className="clickable"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(59, 130, 246, 0.08)",
                border: "1px dashed var(--accent-primary)",
                color: "var(--accent-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                justifyContent: "center",
              }}
            >
              <Plus size={15} />
              Create New Album & Add
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                autoFocus
                placeholder="Album title..."
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateAndAdd();
                  if (e.key === "Escape") setShowCreateInput(false);
                }}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-sidebar)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  outline: "none",
                }}
              />
              <button
                onClick={handleCreateAndAdd}
                disabled={!newAlbumName.trim() || isSubmitting}
                className="clickable"
                style={{
                  padding: "8px 14px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  opacity: !newAlbumName.trim() || isSubmitting ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                {isSubmitting ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                Create & Add
              </button>
              <button
                onClick={() => setShowCreateInput(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "transparent",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Existing Albums List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
          {isLoading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
              <Loader2 size={20} className="spin" style={{ margin: "0 auto 8px" }} />
              Loading albums...
            </div>
          ) : albums.length === 0 ? (
            <div style={{ padding: "30px 20px", textAlign: "center", color: "var(--text-muted)" }}>
              <Folder size={32} style={{ opacity: 0.3, margin: "0 auto 8px" }} />
              <p style={{ fontSize: "13px", fontWeight: 600, margin: 0 }}>No Albums Created Yet</p>
              <p style={{ fontSize: "11px", margin: "4px 0 0" }}>Create a new album above to add these photos.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {albums.map((album) => (
                <div
                  key={album.id}
                  onClick={() => handleAddToExistingAlbum(album.id, album.name)}
                  className="clickable"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "transparent",
                    transition: "background 0.15s ease",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-surface-elevated)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "6px",
                      backgroundColor: "var(--bg-sidebar)",
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {album.cover_photo_id ? (
                      <img
                        src={`http://127.0.0.1:8000/api/photos/${album.cover_photo_id}/thumbnail`}
                        alt={album.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <Folder size={18} style={{ color: "var(--text-muted)" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {album.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {album.photo_count} {album.photo_count === 1 ? "photo" : "photos"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
