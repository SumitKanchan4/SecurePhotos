import React, { useState } from "react";
import { 
  Trash2, 
  RotateCcw, 
  AlertTriangle, 
  CheckSquare, 
  Square, 
  Image as ImageIcon 
} from "lucide-react";

interface TrashedItem {
  id: number;
  filename: string;
  deletedAt: string;
  daysRemaining: number;
  fileSize: string;
}

export const TrashView: React.FC = () => {
  const [trashedItems, setTrashedItems] = useState<TrashedItem[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const handleToggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleRestoreSelected = () => {
    setTrashedItems(trashedItems.filter((item) => !selectedIds.has(item.id)));
    setSelectedIds(new Set());
  };

  const handleEmptyTrash = () => {
    if (confirm("Permanently delete all items from disk? This cannot be undone.")) {
      setTrashedItems([]);
      setSelectedIds(new Set());
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
      {/* Header */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          marginBottom: "16px" 
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Trash2 size={20} style={{ color: "var(--accent-danger)" }} />
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 700 }}>Trash ({trashedItems.length})</h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Items are permanently purged from disk after 30 days
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", gap: "8px" }}>
          {selectedIds.size > 0 && (
            <button
              onClick={handleRestoreSelected}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--accent-primary)",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <RotateCcw size={14} />
              Restore Selected ({selectedIds.size})
            </button>
          )}

          {trashedItems.length > 0 && (
            <button
              onClick={handleEmptyTrash}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--accent-danger)",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <Trash2 size={14} />
              Empty Trash Permanently
            </button>
          )}
        </div>
      </div>

      {trashedItems.length === 0 ? (
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
          <Trash2 size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 600 }}>Trash is Empty</p>
          <p style={{ fontSize: "12px", marginTop: "4px" }}>Deleted photos and documents will appear here for 30 days.</p>
        </div>
      ) : (
        /* Trashed Grid */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
          {trashedItems.map((item) => (
            <div
              key={item.id}
              onClick={() => handleToggleSelect(item.id)}
              className="clickable glass-panel"
              style={{
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--bg-surface)",
                border: `1px solid ${selectedIds.has(item.id) ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                position: "relative",
              }}
            >
              {/* Select Checkbox */}
              <div style={{ position: "absolute", top: "10px", left: "10px", color: "var(--accent-primary)" }}>
                {selectedIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} style={{ opacity: 0.5 }} />}
              </div>

              {/* Expiry Pill */}
              <div 
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  backgroundColor: "rgba(239, 68, 68, 0.15)",
                  color: "var(--accent-danger)",
                  padding: "2px 8px",
                  borderRadius: "var(--radius-full)",
                  fontSize: "10px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                }}
              >
                <AlertTriangle size={10} />
                {item.daysRemaining} days left
              </div>

              {/* Preview Thumbnail */}
              <div 
                style={{
                  height: "120px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  marginTop: "20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                }}
              >
                <ImageIcon size={36} style={{ opacity: 0.3 }} />
              </div>

              <div>
                <h4 style={{ fontSize: "12px", fontWeight: 600, wordBreak: "break-all" }}>{item.filename}</h4>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Deleted {item.deletedAt} • {item.fileSize}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
