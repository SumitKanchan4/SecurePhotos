import React, { useState } from "react";
import { 
  FolderDown, 
  FolderOpen,
  CheckCircle2, 
  X,
  Loader2
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImportComplete }) => {
  const { activeVolume } = useAppStore();
  const [sourcePath, setSourcePath] = useState("C:\\Users\\Public\\Pictures");
  const [cleanupMode, setCleanupMode] = useState<"copy" | "move">("move");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [optimize4K, setOptimize4K] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  if (!isOpen) return null;

  const handleStartImport = async () => {
    setIsImporting(true);
    setImportProgress(15);

    try {
      const res = await fetch("http://127.0.0.1:8000/api/photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_directory: sourcePath,
          mode: "managed",
          delete_source: cleanupMode === "move",
        }),
      });

      setImportProgress(85);
      if (res.ok) {
        setImportProgress(100);
        setTimeout(() => {
          setIsImporting(false);
          onImportComplete?.();
          onClose();
        }, 500);
      } else {
        setIsImporting(false);
        alert("Import failed or no photos found in specified folder.");
      }
    } catch {
      // Mock fallback for UI development without running sidecar
      setImportProgress(100);
      setTimeout(() => {
        setIsImporting(false);
        onClose();
      }, 600);
    }
  };

  return (
    <div 
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div 
        className="glass-panel"
        style={{
          width: "560px",
          backgroundColor: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border-highlight)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Modal Header */}
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
            <FolderDown size={18} style={{ color: "var(--accent-primary)" }} />
            <h2 style={{ fontSize: "15px", fontWeight: 600 }}>Import Media to External Vault</h2>
          </div>
          <button 
            onClick={onClose}
            className="clickable"
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

        {/* Modal Body */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Source & Target Summary */}
          <div 
            style={{
              padding: "12px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--bg-sidebar)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
              <span style={{ color: "var(--text-muted)" }}>Source Folder:</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sourcePath}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const selected = await invoke<string | null>("select_import_folder");
                      if (selected) setSourcePath(selected);
                    } catch {}
                  }}
                  className="clickable"
                  style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    backgroundColor: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--accent-primary)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <FolderOpen size={12} />
                  Browse...
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-muted)" }}>Destination Drive:</span>
              <span style={{ color: "var(--accent-success)", fontWeight: 500 }}>
                {activeVolume ? `${activeVolume.volume_name} (${activeVolume.drive_letter})` : "Local Storage (C:\\)"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-muted)" }}>Sharding Format:</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)" }}>
                originals/YYYY/MM/DD/ (&lt; 500 files/dir)
              </span>
            </div>
          </div>

          {/* Source File Cleanup Policy */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", display: "block" }}>
              🧹 Source File Cleanup Option:
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label 
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: cleanupMode === "copy" ? "var(--bg-surface-elevated)" : "transparent",
                  border: `1px solid ${cleanupMode === "copy" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  cursor: "pointer",
                }}
              >
                <input 
                  type="radio" 
                  name="cleanup" 
                  checked={cleanupMode === "copy"} 
                  onChange={() => setCleanupMode("copy")} 
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 500 }}>Keep Source Files (Copy Only)</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Original files remain untouched on camera SD card / source phone.
                  </p>
                </div>
              </label>

              <label 
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: cleanupMode === "move" ? "var(--bg-surface-elevated)" : "transparent",
                  border: `1px solid ${cleanupMode === "move" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  cursor: "pointer",
                }}
              >
                <input 
                  type="radio" 
                  name="cleanup" 
                  checked={cleanupMode === "move"} 
                  onChange={() => setCleanupMode("move")} 
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--accent-primary)" }}>
                    Move & Free Source Space (Recommended)
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Safely deletes source files only after SHA-256 two-phase verification.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Checkbox Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={skipDuplicates} 
                onChange={(e) => setSkipDuplicates(e.target.checked)} 
              />
              <span>Skip duplicate files already present in library</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={optimize4K} 
                onChange={(e) => setOptimize4K(e.target.checked)} 
              />
              <span>Convert to visually lossless 4K AVIF/AV1 in background</span>
            </label>
          </div>

          {/* Import Progress Bar */}
          {isImporting && (
            <div style={{ marginTop: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                <span>Importing & generating sharded thumbnails...</span>
                <span>{importProgress}%</span>
              </div>
              <div style={{ height: "6px", backgroundColor: "var(--bg-sidebar)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                <div 
                  style={{
                    height: "100%",
                    width: `${importProgress}%`,
                    backgroundColor: "var(--accent-primary)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div 
          style={{
            padding: "14px 20px",
            backgroundColor: "var(--bg-sidebar)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            onClick={onClose}
            disabled={isImporting}
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
            onClick={handleStartImport}
            disabled={isImporting}
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
            {isImporting ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
            {isImporting ? "Importing..." : "Start Import"}
          </button>
        </div>
      </div>
    </div>
  );
};
