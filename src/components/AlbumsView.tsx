import React, { useState } from "react";
import { 
  FolderHeart, 
  Plus, 
  Lock, 
  Unlock, 
  Heart, 
  Image as ImageIcon 
} from "lucide-react";
import { AlbumItem } from "../types";

interface AlbumsViewProps {
  onOpenAlbum?: (albumId: number) => void;
  onLockAlbumToVault?: (albumId: number) => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({
  onOpenAlbum,
  onLockAlbumToVault,
}) => {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);

  const [isCreatingAlbum, setIsCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");

  const handleCreateAlbum = () => {
    if (!newAlbumName.trim()) return;
    const newAlbum: AlbumItem = {
      id: Date.now(),
      name: newAlbumName.trim(),
      description: "User created album",
      is_vault: false,
      is_favorite: false,
      photo_count: 0,
    };
    setAlbums([newAlbum, ...albums]);
    setNewAlbumName("");
    setIsCreatingAlbum(false);
  };

  const handleToggleFavorite = (id: number) => {
    setAlbums((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_favorite: !a.is_favorite } : a))
    );
  };

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
          <h2 style={{ fontSize: "18px", fontWeight: 700 }}>Albums ({albums.length})</h2>
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
            placeholder="Enter new album title..."
            value={newAlbumName}
            onChange={(e) => setNewAlbumName(e.target.value)}
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
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateAlbum}
            className="clickable"
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-primary)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            Create
          </button>
        </div>
      )}

      {albums.length === 0 ? (
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
          <p style={{ fontSize: "14px", fontWeight: 600 }}>No Albums Yet</p>
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
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "18px",
          }}
        >
          {albums.map((album) => (
            <div
              key={album.id}
              onClick={() => onOpenAlbum?.(album.id)}
              className="clickable glass-panel"
              style={{
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Album Cover Art Placeholder */}
              <div
                style={{
                  height: "160px",
                  backgroundColor: "var(--bg-surface-elevated)",
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                }}
              >
                <ImageIcon size={48} style={{ opacity: 0.4 }} />

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
                        padding: "3px 6px",
                        borderRadius: "var(--radius-xs)",
                      }}
                    >
                      <Heart size={10} fill="#ffffff" />
                    </span>
                  )}
                </div>
              </div>

              {/* Card Meta Content */}
              <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      color: album.is_favorite ? "var(--accent-danger)" : "var(--text-muted)",
                      cursor: "pointer",
                      padding: "2px",
                    }}
                  >
                    <Heart size={14} fill={album.is_favorite ? "currentColor" : "none"} />
                  </button>
                </div>

                <p style={{ fontSize: "11px", color: "var(--text-muted)", lineClamp: 2 }}>
                  {album.description}
                </p>

                <div 
                  style={{ 
                    marginTop: "8px", 
                    paddingTop: "8px", 
                    borderTop: "1px solid var(--border-subtle)", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "space-between" 
                  }}
                >
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                    {album.photo_count} photos
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
                    }}
                  >
                    {album.is_vault ? <Unlock size={12} /> : <Lock size={12} />}
                    {album.is_vault ? "Decrypt & Restore" : "Move Album to Vault (L)"}
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
