import React, { useState, useEffect } from "react";
import { 
  Trash2, 
  RotateCcw, 
  AlertTriangle, 
  CheckSquare, 
  Square, 
  Loader2,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";

interface TrashedItem {
  id: number;
  filename: string;
  filepath: string;
  file_size: number;
  formatted_size: string;
  trashed_at: string;
  days_remaining: number;
}

export const TrashView: React.FC = () => {
  const showToast = useAppStore((state) => state.showToast);
  const [trashedItems, setTrashedItems] = useState<TrashedItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isActionInProgress, setIsActionInProgress] = useState(false);

  useEffect(() => {
    loadTrashedPhotos();
  }, []);

  const loadTrashedPhotos = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/trash");
      if (res.ok) {
        const data: TrashedItem[] = await res.json();
        setTrashedItems(data);
      }
    } catch (err) {
      console.error("Failed to load trashed photos:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === trashedItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(trashedItems.map((item) => item.id)));
    }
  };

  const handleRestoreSelected = async () => {
    if (selectedIds.size === 0 || isActionInProgress) return;
    const ids = Array.from(selectedIds);
    setIsActionInProgress(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/trash/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setTrashedItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
        setSelectedIds(new Set());
        showToast(`Restored ${ids.length} photo(s) to your library`, "success");
      }
    } catch (err) {
      console.error("Failed to restore photos:", err);
      showToast("Failed to restore selected photos", "warning");
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleDeleteSelectedPermanently = async () => {
    if (selectedIds.size === 0 || isActionInProgress) return;
    const ids = Array.from(selectedIds);
    if (!window.confirm(`Permanently delete ${ids.length} photo(s) from disk and database? This action CANNOT be undone.`)) {
      return;
    }
    setIsActionInProgress(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/trash/permanent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: ids }),
      });
      if (res.ok) {
        setTrashedItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
        setSelectedIds(new Set());
        showToast(`Permanently deleted ${ids.length} photo(s) from disk`, "info");
      }
    } catch (err) {
      console.error("Failed to permanently delete selected photos:", err);
      showToast("Failed to permanently delete selected photos", "warning");
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleEmptyTrash = async () => {
    if (trashedItems.length === 0 || isActionInProgress) return;
    if (!window.confirm(`Permanently delete ALL ${trashedItems.length} photos from disk? This action CANNOT be undone.`)) {
      return;
    }
    setIsActionInProgress(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/trash/empty", {
        method: "DELETE",
      });
      if (res.ok) {
        setTrashedItems([]);
        setSelectedIds(new Set());
        showToast("Trash emptied permanently", "info");
      }
    } catch (err) {
      console.error("Failed to empty trash:", err);
      showToast("Failed to empty trash", "warning");
    } finally {
      setIsActionInProgress(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Unified Compact Glassmorphic Header Bar */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          flexWrap: "wrap",
          gap: "12px",
          padding: "10px 20px",
          minHeight: "56px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
          position: "sticky",
          top: 0,
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        {/* Left Column: Select Controls */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "120px" }}>
          {trashedItems.length > 0 && (
            <button
              onClick={handleSelectAll}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-pill-border)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {selectedIds.size === trashedItems.length ? <CheckSquare size={14} /> : <Square size={14} />}
              <span>{selectedIds.size === trashedItems.length ? "Deselect All" : "Select All"}</span>
            </button>
          )}
        </div>

        {/* Center Column: Centered Title & Inline Frosted Capsule Badge */}
        <div style={{ flex: "0 1 auto", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Trash2 size={20} style={{ color: "var(--accent-danger, #ef4444)" }} />
            <h2
              style={{
                fontSize: "22px",
                fontWeight: 800,
                fontFamily: "var(--font-display, var(--font-sans))",
                letterSpacing: "-0.03em",
                color: "var(--text-primary)",
                margin: 0,
                whiteSpace: "nowrap",
              }}
            >
              Trash
            </h2>
          </div>

          {/* Inline Frosted Capsule Badge for Item Count */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-badge-bg)",
              border: "1px solid var(--glass-badge-border)",
              backdropFilter: "blur(8px)",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
              letterSpacing: "0.01em",
            }}
          >
            <span>{trashedItems.length} {trashedItems.length === 1 ? "item" : "items"}</span>
          </div>
        </div>

        {/* Right Column: Action Controls */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "120px" }}>
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={handleRestoreSelected}
                disabled={isActionInProgress}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-action-bg)",
                  border: "1px solid var(--glass-action-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "var(--glass-shadow)",
                  transition: "all 0.15s ease",
                }}
              >
                <RotateCcw size={13} />
                <span>Restore ({selectedIds.size})</span>
              </button>

              <button
                onClick={handleDeleteSelectedPermanently}
                disabled={isActionInProgress}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  color: "var(--accent-danger, #ef4444)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Trash2 size={13} />
                <span>Delete Selected</span>
              </button>
            </>
          )}

          {trashedItems.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              disabled={isActionInProgress}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 16px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(239, 68, 68, 0.14)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "var(--accent-danger, #ef4444)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {isActionInProgress ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              <span>Empty Trash</span>
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>
          <Loader2 size={28} className="spin" style={{ margin: "0 auto 12px" }} />
          Loading trashed media...
        </div>
      ) : trashedItems.length === 0 ? (
        <div 
          style={{
            marginTop: "80px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          <Trash2 size={54} style={{ opacity: 0.25, marginBottom: "16px" }} />
          <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Trash is Empty</p>
          <p style={{ fontSize: "12px", marginTop: "6px", maxWidth: "360px", lineHeight: "1.5" }}>
            Deleted photos and media items will appear here for 30 days before being permanently purged.
          </p>
        </div>
      ) : (
        /* Trashed Grid */
        <div 
          style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", 
            gap: "16px" 
          }}
        >
          {trashedItems.map((item) => {
            const isSelected = selectedIds.has(item.id);

            return (
              <div
                key={item.id}
                onClick={() => handleToggleSelect(item.id)}
                className="clickable glass-panel"
                style={{
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--bg-surface)",
                  border: isSelected ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  cursor: "pointer",
                  transition: "border-color 0.15s ease, transform 0.15s ease",
                }}
              >
                {/* Select Checkbox (Top Left) */}
                <div 
                  style={{ 
                    position: "absolute", 
                    top: "8px", 
                    left: "8px", 
                    color: isSelected ? "var(--accent-primary)" : "#ffffff",
                    zIndex: 3,
                    filter: "drop-shadow(0 1px 3px rgba(0, 0, 0, 0.8))"
                  }}
                >
                  {isSelected ? <CheckSquare size={18} /> : <Square size={18} style={{ opacity: 0.7 }} />}
                </div>

                {/* Expiry Pill (Top Right) */}
                <div 
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    backgroundColor: "rgba(0, 0, 0, 0.75)",
                    color: item.days_remaining <= 5 ? "var(--accent-danger, #ef4444)" : "#fbbf24",
                    padding: "3px 8px",
                    borderRadius: "var(--radius-full, 9999px)",
                    fontSize: "10px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    zIndex: 3,
                    backdropFilter: "blur(6px)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                  }}
                >
                  <AlertTriangle size={10} />
                  {item.days_remaining} {item.days_remaining === 1 ? "day" : "days"} left
                </div>

                {/* Preview Thumbnail */}
                <div 
                  style={{
                    height: "160px",
                    backgroundColor: "var(--bg-surface-elevated)",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  <img 
                    src={`http://127.0.0.1:8000/api/photos/${item.id}/thumbnail?v=3`} 
                    alt={item.filename}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      filter: "grayscale(30%)",
                      imageRendering: "-webkit-optimize-contrast",
                    }}
                    loading="lazy"
                    onError={(e) => {
                      // Fallback if thumbnail file missing
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>

                {/* Meta details */}
                <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  <h4 
                    style={{ 
                      fontSize: "12px", 
                      fontWeight: 600, 
                      margin: 0, 
                      overflow: "hidden", 
                      textOverflow: "ellipsis", 
                      whiteSpace: "nowrap" 
                    }}
                    title={item.filename}
                  >
                    {item.filename}
                  </h4>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {item.formatted_size}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelect(item.id);
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--accent-primary)",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {isSelected ? "Deselect" : "Select"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
