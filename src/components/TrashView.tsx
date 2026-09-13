import React, { useState, useEffect } from "react";
import { 
  Trash2, 
  RotateCcw, 
  AlertTriangle, 
  CheckSquare, 
  Loader2,
  Check,
  X,
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

  // Keyboard shortcut to dismiss selection with Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedIds.size > 0) {
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds.size]);

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
        {/* Left Column: Balanced Spacer */}
        <div style={{ flex: 1, minWidth: "120px" }} />

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

        {/* Right Column: Empty Trash Action */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "120px" }}>
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
                cursor: isActionInProgress ? "not-allowed" : "pointer",
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
                {/* Select Checkbox (Top Left - Exactly matching PhotoGrid & Albums) */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleSelect(item.id);
                  }}
                  style={{ 
                    position: "absolute", 
                    top: "6px", 
                    left: "6px", 
                    width: "18px",
                    height: "18px",
                    borderRadius: "var(--radius-xs)",
                    backgroundColor: isSelected ? "var(--accent-primary)" : "rgba(0, 0, 0, 0.45)",
                    border: isSelected ? "none" : "1px solid rgba(255, 255, 255, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    zIndex: 3,
                    opacity: isSelected ? 1 : 0.4,
                    transition: "opacity 0.15s ease, background-color 0.15s ease",
                    cursor: "pointer",
                  }}
                >
                  {isSelected && <Check size={12} strokeWidth={3} />}
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

      {/* ── Jira/Linear-Style Floating Bottom Batch Action Dock (Exact Parity with Photos View) ── */}
      <div
        style={{
          position: "fixed",
          bottom: "24px",
          left: "50%",
          transform: `translateX(-50%) ${selectedIds.size > 0 ? "translateY(0)" : "translateY(80px)"}`,
          opacity: selectedIds.size > 0 ? 1 : 0,
          pointerEvents: selectedIds.size > 0 ? "auto" : "none",
          transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease",
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 16px",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-full)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45), 0 0 1px rgba(255, 255, 255, 0.2)",
          maxWidth: "calc(100% - 48px)",
          overflowX: "auto",
        }}
      >
        {/* Selection Count Capsule */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 12px",
            borderRadius: "var(--radius-full)",
            fontSize: "12px",
            fontWeight: 700,
            backgroundColor: "rgba(59, 130, 246, 0.15)",
            color: "var(--accent-primary)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <CheckSquare size={13} />
          {selectedIds.size} selected
        </span>

        {/* Select All / Deselect All Toggle */}
        <button
          onClick={handleSelectAll}
          className="clickable"
          title={selectedIds.size === trashedItems.length ? "Deselect all items" : "Select all items"}
          style={{
            padding: "5px 12px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--glass-pill-bg)",
            border: "1px solid var(--glass-pill-border)",
            color: "var(--text-secondary)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {selectedIds.size === trashedItems.length ? "Deselect All" : "Select All"}
        </button>

        {/* Subtle Vertical Glass Divider */}
        <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border)", margin: "0 2px", flexShrink: 0 }} />

        {/* Restore Selected */}
        <button
          onClick={handleRestoreSelected}
          disabled={isActionInProgress}
          className="clickable"
          title="Restore selected items back to your library"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            color: "var(--accent-success, #10b981)",
            fontSize: "12px",
            fontWeight: 600,
            whiteSpace: "nowrap",
            flexShrink: 0,
            cursor: isActionInProgress ? "not-allowed" : "pointer",
          }}
        >
          {isActionInProgress ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
          <span>Restore ({selectedIds.size})</span>
        </button>

        {/* Delete Permanently */}
        <button
          onClick={handleDeleteSelectedPermanently}
          disabled={isActionInProgress}
          className="clickable"
          title="Permanently delete selected items from disk"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "var(--accent-danger, #ef4444)",
            fontSize: "12px",
            fontWeight: 600,
            whiteSpace: "nowrap",
            flexShrink: 0,
            cursor: isActionInProgress ? "not-allowed" : "pointer",
          }}
        >
          <Trash2 size={13} />
          <span>Delete Permanently ({selectedIds.size})</span>
        </button>

        {/* Subtle Vertical Glass Divider */}
        <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border)", margin: "0 2px", flexShrink: 0 }} />

        {/* Close / Deselect Button */}
        <button
          onClick={() => setSelectedIds(new Set())}
          className="clickable"
          title="Clear selection (Esc)"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--glass-pill-bg)",
            border: "1px solid var(--glass-pill-border)",
            color: "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.15s ease",
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
