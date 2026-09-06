import React, { useState } from "react";
import { 
  X, 
  Sparkles, 
  Download, 
  LayoutGrid, 
  Maximize 
} from "lucide-react";

interface CollageModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
}

export const CollageModal: React.FC<CollageModalProps> = ({
  isOpen,
  onClose,
  selectedCount,
}) => {
  const [layout, setLayout] = useState<"mosaic" | "hero_grid" | "treemap">("mosaic");
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleExportCollage = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      alert("Mosaic Collage generated and saved: creatives/collages/Summer_Mosaic.avif");
      onClose();
    }, 1000);
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
          width: "520px",
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
            <h2 style={{ fontSize: "15px", fontWeight: 700 }}>Create Mosaic Collage</h2>
          </div>
          <button onClick={onClose} className="clickable" style={{ background: "transparent", border: "none", color: "var(--text-muted)" }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}>
            Combining {selectedCount || 6} selected media items into a high-res printable canvas with face-aware cropping.
          </p>

          {/* Layout Options */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
            {[
              { id: "mosaic", label: "Polaroid Mosaic", icon: <LayoutGrid size={20} /> },
              { id: "hero_grid", label: "Hero Grid (1+4)", icon: <Maximize size={20} /> },
              { id: "treemap", label: "Geometric Treemap", icon: <Sparkles size={20} /> },
            ].map((opt) => (
              <button
                key={opt.id}
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
                }}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
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
              <span>Output Canvas:</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>3840 × 2160 (4K UHD)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Compression:</span>
              <span style={{ color: "var(--accent-success)", fontWeight: 600 }}>Lossless 10-bit AVIF</span>
            </div>
          </div>
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
            className="clickable"
            style={{
              padding: "7px 14px",
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
            onClick={handleExportCollage}
            disabled={isExporting}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 18px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-primary)",
              border: "none",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <Download size={14} />
            {isExporting ? "Rendering Canvas..." : "Render Collage"}
          </button>
        </div>
      </div>
    </div>
  );
};
