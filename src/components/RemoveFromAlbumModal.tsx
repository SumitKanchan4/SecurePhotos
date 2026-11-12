import React from "react";
import { X, FolderMinus, Trash2, AlertCircle, Loader2 } from "lucide-react";

interface RemoveFromAlbumModalProps {
  isOpen: boolean;
  photoCount: number;
  onClose: () => void;
  onRemoveFromAlbumOnly: () => void;
  onMoveToTrash: () => void;
  isProcessing?: boolean;
}

export const RemoveFromAlbumModal: React.FC<RemoveFromAlbumModalProps> = ({
  isOpen,
  photoCount,
  onClose,
  onRemoveFromAlbumOnly,
  onMoveToTrash,
  isProcessing = false,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2600,
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: "480px",
          maxWidth: "92vw",
          backgroundColor: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border-highlight)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <AlertCircle size={18} style={{ color: "var(--accent-primary)" }} />
            <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0 }}>
              Remove {photoCount} {photoCount === 1 ? "Photo" : "Photos"}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
            Choose how you would like to handle the selected {photoCount === 1 ? "photo" : "photos"}:
          </p>

          {/* Option 1: Remove from Album Only */}
          <button
            onClick={onRemoveFromAlbumOnly}
            disabled={isProcessing}
            className="clickable glass-panel"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "14px",
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-sidebar)",
              border: "1px solid var(--border-subtle)",
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.15s ease, background-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent-primary)";
              e.currentTarget.style.backgroundColor = "var(--bg-surface-elevated)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
              e.currentTarget.style.backgroundColor = "var(--bg-sidebar)";
            }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)",
                color: "var(--accent-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FolderMinus size={18} />
            </div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                Remove from Album Only
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px", lineHeight: "1.4" }}>
                Removes {photoCount === 1 ? "this photo" : "these photos"} from the album. {photoCount === 1 ? "It remains" : "They remain"} safe in your main Photos library.
              </div>
            </div>
          </button>

          {/* Option 2: Move to Trash */}
          <button
            onClick={onMoveToTrash}
            disabled={isProcessing}
            className="clickable glass-panel"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "14px",
              padding: "14px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(239, 68, 68, 0.06)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.15s ease, background-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent-danger, #ef4444)";
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.25)";
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.06)";
            }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(239, 68, 68, 0.2)",
                color: "var(--accent-danger, #ef4444)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Trash2 size={18} />
            </div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--accent-danger, #ef4444)" }}>
                Move to Trash
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px", lineHeight: "1.4" }}>
                Removes from this album and sends {photoCount === 1 ? "it" : "them"} to Trash. Held for 30 days before permanent deletion (recoverable from Trash).
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            backgroundColor: "var(--bg-sidebar)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              padding: "7px 16px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "transparent",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            {isProcessing ? <Loader2 size={14} className="spin" /> : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
};
