import React, { useState } from "react";
import { 
  X, 
  Sparkles, 
  LayoutGrid, 
  Maximize,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Calendar
} from "lucide-react";
import { apiFetch, getApiUrl } from "../services/api";

interface CollageModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPhotoIds: number[];
  onSuccess?: () => void;
}

export const CollageModal: React.FC<CollageModalProps> = ({
  isOpen,
  onClose,
  selectedPhotoIds,
  onSuccess,
}) => {
  const [layout, setLayout] = useState<"mosaic" | "hero_grid" | "treemap">("mosaic");
  const [title, setTitle] = useState("");
  const [dateMode, setDateMode] = useState<"smart" | "now" | "event">("smart");
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const count = selectedPhotoIds.length;
  const isValidCount = count >= 2 && count <= 9;

  const handleRenderCollage = async () => {
    if (!isValidCount || isExporting) return;
    setIsExporting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await apiFetch("/api/creatives/collage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_ids: selectedPhotoIds,
          layout,
          title: title.trim() || undefined,
          date_mode: dateMode,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "Failed to render collage" }));
        throw new Error(errorData.detail || "Collage rendering failed");
      }

      await res.json();
      setSuccessMessage("4K UHD Collage saved to your library and added to the 'Collages' album!");
      setTimeout(() => {
        setIsExporting(false);
        onSuccess?.();
        onClose();
      }, 1400);
    } catch (err: any) {
      setIsExporting(false);
      setErrorMessage(err.message || "An unexpected error occurred during collage generation.");
    }
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2500,
      }}
    >
      <div 
        className="glass-panel"
        style={{
          width: "560px",
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
            <Sparkles size={18} style={{ color: "var(--accent-primary)" }} />
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0 }}>Create 4K Photo Collage</h2>
          </div>
          <button 
            onClick={onClose} 
            disabled={isExporting}
            className="clickable" 
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "70vh", overflowY: "auto" }}>
          {/* Item count status */}
          {!isValidCount ? (
            <div 
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "var(--accent-danger)",
                fontSize: "12px",
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>
                Collages require between <strong>2 and 9</strong> selected photos. You currently have <strong>{count}</strong> selected. Please adjust your selection.
              </span>
            </div>
          ) : (
            <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5", margin: 0 }}>
              Combining <strong>{count}</strong> selected photos into a high-acutance 4K UHD composite canvas (3840×2160).
            </p>
          )}

          {/* Selected Photos Thumbnails Strip */}
          <div>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
              Selected Photos ({count})
            </span>
            <div 
              style={{ 
                display: "flex", 
                gap: "8px", 
                overflowX: "auto", 
                paddingBottom: "6px",
              }}
            >
              {selectedPhotoIds.map((id) => (
                <div 
                  key={id}
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                    border: "1px solid var(--border-subtle)",
                    flexShrink: 0,
                    backgroundColor: "var(--bg-sidebar)",
                  }}
                >
                  <img 
                    src={getApiUrl(`/api/photos/${id}/thumbnail`)} 
                    alt={`Photo ${id}`} 
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Collage Title Input */}
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
              Collage Title (Optional)
            </label>
            <input 
              type="text" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Summer Memories 2026"
              disabled={isExporting}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-sidebar)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

          {/* Layout Options */}
          <div>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
              Composition Layout
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
              {[
                { id: "mosaic", label: "Balanced Mosaic", icon: <LayoutGrid size={20} /> },
                { id: "hero_grid", label: "Hero Grid (1+Dominant)", icon: <Maximize size={20} /> },
                { id: "treemap", label: "Geometric Treemap", icon: <Layers size={20} /> },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isExporting}
                  onClick={() => setLayout(opt.id as any)}
                  className="clickable"
                  style={{
                    padding: "14px 10px",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: layout === opt.id ? "var(--bg-surface-elevated)" : "var(--bg-sidebar)",
                    border: `2px solid ${layout === opt.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    color: layout === opt.id ? "var(--accent-primary)" : "var(--text-secondary)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Timeline Date Mode */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Calendar size={13} style={{ color: "var(--accent-primary)" }} />
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", margin: 0 }}>
                Timeline Date Placement
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
              {[
                { id: "smart", label: "Smart Date", desc: "Auto-sync with event or today" },
                { id: "now", label: "Today / Now", desc: "Show at top of timeline" },
                { id: "event", label: "Photo Date", desc: "Group with source photos" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isExporting}
                  onClick={() => setDateMode(opt.id as any)}
                  className="clickable"
                  style={{
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: dateMode === opt.id ? "var(--bg-surface-elevated)" : "var(--bg-sidebar)",
                    border: `1.5px solid ${dateMode === opt.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    color: dateMode === opt.id ? "var(--accent-primary)" : "var(--text-secondary)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "2px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "11px", fontWeight: 600 }}>{opt.label}</span>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.2 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Canvas Specs */}
          <div 
            style={{
              padding: "12px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-sidebar)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              fontSize: "11px",
              color: "var(--text-muted)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Output Resolution:</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>3840 × 2160 (4K UHD Master)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Dating Strategy:</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {dateMode === "smart" ? "Smart Event Clustering" : dateMode === "now" ? "Creation Timestamp (Today)" : "Source Event Date"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Placement:</span>
              <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>Saved to Library & "Collages" Album</span>
            </div>
          </div>

          {/* Status Messages */}
          {errorMessage && (
            <div 
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "var(--accent-danger)",
                fontSize: "12px",
              }}
            >
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div 
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(16, 185, 129, 0.12)",
                color: "var(--accent-success)",
                fontSize: "12px",
              }}
            >
              <CheckCircle2 size={16} />
              <span>{successMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div 
          style={{
            padding: "14px 20px",
            backgroundColor: "var(--bg-sidebar)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            onClick={onClose}
            disabled={isExporting}
            className="clickable"
            style={{
              padding: "7px 14px",
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
            onClick={handleRenderCollage}
            disabled={!isValidCount || isExporting}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 18px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: isValidCount ? "var(--accent-primary)" : "var(--text-muted)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isValidCount ? "pointer" : "not-allowed",
              opacity: isValidCount ? 1 : 0.6,
            }}
          >
            {isExporting ? (
              <>
                <Loader2 size={14} className="spin" />
                Rendering 4K Canvas...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate Collage
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
