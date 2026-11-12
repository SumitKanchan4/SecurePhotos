import React, { useState, useEffect, useRef } from "react";
import { 
  FolderDown, 
  FolderOpen, 
  UploadCloud, 
  CheckCircle2, 
  X, 
  Loader2, 
  Images, 
  Copy, 
  ArrowRightLeft, 
  ShieldCheck
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { apiFetch } from "../services/api";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onImportComplete }) => {
  const { showToast } = useAppStore();
  
  // Selection state: either specific files or an entire folder
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  
  // Safe default: "copy" (never delete user's originals without explicit choice)
  const [cleanupMode, setCleanupMode] = useState<"copy" | "move">("copy");
  
  const [isImporting, setIsImporting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [currentImportFile, setCurrentImportFile] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Escape to close modal when not importing
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImporting && !isBrowsing) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isImporting, isBrowsing, onClose]);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setSelectedFiles([]);
      setSelectedFolder(null);
      setCleanupMode("copy");
      setImportProgress(0);
      setCurrentImportFile("");
      setIsImporting(false);
      setIsBrowsing(false);
    }
  }, [isOpen]);

  // Native Tauri drag-and-drop listener for full filesystem paths
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | null = null;
    try {
      import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => {
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "over") {
            setIsDragging(true);
          } else if (event.payload.type === "drop") {
            setIsDragging(false);
            const droppedPaths = event.payload.paths;
            if (droppedPaths && droppedPaths.length > 0) {
              // If single dropped item without file extension, treat as directory
              if (droppedPaths.length === 1 && !droppedPaths[0].match(/\.[a-zA-Z0-9]+$/)) {
                setSelectedFolder(droppedPaths[0]);
                setSelectedFiles([]);
              } else {
                setSelectedFiles(droppedPaths);
                setSelectedFolder(null);
              }
            }
          } else {
            setIsDragging(false);
          }
        }).then((fn) => {
          unlisten = fn;
        }).catch((err) => {
          console.warn("Tauri drag-drop listener registration failed:", err);
        });
      });
    } catch (err) {
      console.warn("Tauri getCurrentWebview not available:", err);
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen]);

  // Early return MUST follow all React hook declarations
  if (!isOpen) return null;

  // Handle selecting multiple individual files (images/videos)
  const handleSelectFiles = async () => {
    if (isBrowsing || isImporting) return;
    setIsBrowsing(true);
    try {
      const files = await invoke<string[] | null>("select_import_files");
      if (files && files.length > 0) {
        setSelectedFiles(files);
        setSelectedFolder(null);
      }
    } catch (err) {
      console.warn("Native file dialog invoke fallback to input:", err);
      fileInputRef.current?.click();
    } finally {
      setIsBrowsing(false);
    }
  };

  // Handle HTML input fallback for web/drag-drop
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const filePaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // In desktop environments (WebView2/Electron), file object may contain local path
      const path = (f as any).path;
      if (path) {
        filePaths.push(path);
      }
    }
    if (filePaths.length > 0) {
      setSelectedFiles(filePaths);
      setSelectedFolder(null);
    } else {
      showToast("To select files, please restart the desktop app to activate the native file picker.", "warning");
    }
  };

  // Handle selecting an entire folder
  const handleSelectFolder = async () => {
    if (isBrowsing || isImporting) return;
    setIsBrowsing(true);
    try {
      const folder = await invoke<string | null>("select_import_folder");
      if (folder) {
        setSelectedFolder(folder);
        setSelectedFiles([]);
      }
    } catch (err) {
      console.error("Failed to select import folder:", err);
      showToast("Could not open folder picker", "warning");
    } finally {
      setIsBrowsing(false);
    }
  };

  // Clear current selection
  const handleClearSelection = () => {
    setSelectedFiles([]);
    setSelectedFolder(null);
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const filePaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const path = (f as any).path;
        if (path) {
          filePaths.push(path);
        }
      }
      if (filePaths.length > 0) {
        setSelectedFiles(filePaths);
        setSelectedFolder(null);
      }
    }
  };

  // Helper to extract folder display name
  const getFolderName = (path: string) => {
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
  };

  const hasSelection = selectedFiles.length > 0 || selectedFolder !== null;

  // Execute import
  const handleStartImport = async () => {
    if (!hasSelection || isImporting) return;
    setIsImporting(true);
    setImportProgress(15);

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    try {
      const payload: {
        source_directory?: string;
        file_paths?: string[];
        mode: string;
        delete_source: boolean;
      } = {
        mode: "managed",
        delete_source: cleanupMode === "move",
      };

      if (selectedFolder) {
        payload.source_directory = selectedFolder;
      } else if (selectedFiles.length > 0) {
        payload.file_paths = selectedFiles;
      }

      pollInterval = setInterval(async () => {
        try {
          const pRes = await apiFetch("/api/photos/import-progress");
          if (pRes.ok) {
            const pData = await pRes.json();
            if (pData.total_count > 0) {
              const pct = Math.min(95, Math.round((pData.completed_count / pData.total_count) * 100));
              setImportProgress(pct);
              if (pData.current_filename) {
                setCurrentImportFile(pData.current_filename);
              }
            }
          }
        } catch {}
      }, 300);

      const res = await apiFetch("/api/photos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (pollInterval) clearInterval(pollInterval);
      setImportProgress(100);
      if (res.ok) {
        const data = await res.json();
        setTimeout(() => {
          setIsImporting(false);
          if (data.imported > 0) {
            let msg = `Successfully imported ${data.imported} media item(s)`;
            if (data.skipped > 0) {
              msg += ` (${data.skipped} duplicate(s) already in library)`;
            }
            if (data.failed > 0) {
              msg += ` (${data.failed} item(s) could not be read)`;
            }
            showToast(msg, "success");
          } else if (data.failed > 0 && data.skipped === 0) {
            showToast(`Could not import ${data.failed} item(s) due to file access or permission errors.`, "warning");
          } else if (data.skipped > 0) {
            let msg = `All ${data.skipped} item(s) are already in your library.`;
            if (data.failed > 0) {
              msg += ` (${data.failed} failed due to file errors)`;
            }
            showToast(msg, "info");
          } else {
            showToast("No new media items to import.", "info");
          }
          onImportComplete?.();
          onClose();
        }, 400);
      } else {
        setIsImporting(false);
        let errorMsg = "Import failed or no supported media found.";
        try {
          const errData = await res.json();
          if (errData?.detail) errorMsg = errData.detail;
        } catch {}
        showToast(errorMsg, "warning");
      }
    } catch {
      if (pollInterval) clearInterval(pollInterval);
      setImportProgress(100);
      setTimeout(() => {
        setIsImporting(false);
        onClose();
      }, 500);
    }
  };

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting && !isBrowsing) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: "20px",
      }}
    >
      {/* Hidden file input for web fallback */}
      <input 
        ref={fileInputRef}
        type="file" 
        multiple 
        accept="image/*,video/*" 
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      <div 
        style={{
          width: "580px",
          maxWidth: "100%",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderRadius: "var(--radius-xl, 20px)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.15)",
          border: "1px solid var(--glass-border)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Modal Header */}
        <div 
          style={{
            padding: "20px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--glass-border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent-ink) 25%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-primary)",
              }}
            >
              <FolderDown size={20} />
            </div>
            <div>
              <h2 
                style={{ 
                  fontSize: "18px", 
                  fontWeight: 800, 
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-display)",
                  margin: 0,
                }}
              >
                Import Photos &amp; Videos
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "3px 0 0 0" }}>
                Add media to your private, on-device library
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Reassuring Zero-Cloud Privacy Badge */}
            <div
              title="SecurePhotos runs 100% on your device. Your photos are never uploaded to any remote server or cloud."
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                color: "#10b981",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.01em",
              }}
            >
              <ShieldCheck size={13} />
              <span>100% On-Device</span>
            </div>

            <button 
              onClick={onClose}
              disabled={isImporting || isBrowsing}
              className="clickable"
              title="Close (Esc)"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "var(--radius-full)",
                background: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-pill-border)",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isImporting || isBrowsing ? "not-allowed" : "pointer",
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Modal Body with Spacious 22px Gap & 28px Padding */}
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: "22px" }}>
          
          {/* Step 1: Interactive Media Dropzone & Selector */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: isDragging ? "2px dashed var(--accent-primary)" : "1.5px dashed var(--glass-border)",
              backgroundColor: isDragging 
                ? "color-mix(in srgb, var(--accent-ink) 10%, transparent)" 
                : hasSelection 
                  ? "var(--glass-pill-bg)" 
                  : "rgba(255, 255, 255, 0.02)",
              borderRadius: "var(--radius-lg)",
              padding: hasSelection ? "18px 22px" : "32px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              transition: "all 0.2s ease",
            }}
          >
            {!hasSelection ? (
              <>
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent-primary)",
                  }}
                >
                  <UploadCloud size={26} />
                </div>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                    Drag &amp; drop photos, videos, or folders here
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
                    Or choose directly from your computer
                  </p>
                </div>

                {/* Dual Pill Action Buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                  <button
                    type="button"
                    disabled={isBrowsing || isImporting}
                    onClick={handleSelectFiles}
                    className="clickable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 18px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: isBrowsing ? "wait" : "pointer",
                      boxShadow: "var(--glass-shadow)",
                    }}
                  >
                    <Images size={15} style={{ color: "var(--accent-primary)" }} />
                    <span>Choose Photos</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBrowsing || isImporting}
                    onClick={handleSelectFolder}
                    className="clickable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 18px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: isBrowsing ? "wait" : "pointer",
                      boxShadow: "var(--glass-shadow)",
                    }}
                  >
                    <FolderOpen size={15} style={{ color: "var(--accent-primary)" }} />
                    <span>Choose Folder</span>
                  </button>
                </div>
              </>
            ) : (
              /* Selected State Presentation */
              <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0, textAlign: "left" }}>
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--accent-primary)",
                      flexShrink: 0,
                    }}
                  >
                    {selectedFolder ? <FolderOpen size={20} /> : <Images size={20} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {selectedFolder ? `Folder: ${getFolderName(selectedFolder)}` : `${selectedFiles.length} media ${selectedFiles.length === 1 ? "item" : "items"} ready to import`}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "3px 0 0 0", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {selectedFolder || (selectedFiles.length <= 2 ? selectedFiles.join(", ") : `${selectedFiles.slice(0, 2).join(", ")} and ${selectedFiles.length - 2} more`)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isImporting}
                  onClick={handleClearSelection}
                  className="clickable"
                  title="Change selected items"
                  style={{
                    padding: "6px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-secondary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Step 2: What to do with original files (Humanized, zero developer jargon) */}
          <div>
            <label style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "10px", display: "block" }}>
              After importing:
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {/* Option 1: Keep Originals (Recommended) */}
              <div
                onClick={() => setCleanupMode("copy")}
                className="clickable"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "14px 16px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: cleanupMode === "copy" ? "color-mix(in srgb, var(--accent-ink) 12%, transparent)" : "rgba(255, 255, 255, 0.02)",
                  border: cleanupMode === "copy" ? "1.5px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", fontWeight: 700, fontSize: "13px", color: cleanupMode === "copy" ? "var(--accent-primary)" : "var(--text-primary)" }}>
                    <Copy size={14} />
                    <span>Keep Originals</span>
                  </div>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "rgba(16, 185, 129, 0.15)",
                      color: "#10b981",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    Recommended
                  </span>
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.45 }}>
                  Makes a copy in SecurePhotos. Your original files stay untouched right where they are.
                </p>
              </div>

              {/* Option 2: Move & Free Up Space */}
              <div
                onClick={() => setCleanupMode("move")}
                className="clickable"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "14px 16px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: cleanupMode === "move" ? "color-mix(in srgb, var(--accent-ink) 12%, transparent)" : "rgba(255, 255, 255, 0.02)",
                  border: cleanupMode === "move" ? "1.5px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", fontWeight: 700, fontSize: "13px", color: cleanupMode === "move" ? "var(--accent-primary)" : "var(--text-primary)" }}>
                    <ArrowRightLeft size={14} />
                    <span>Move &amp; Free Space</span>
                  </div>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)",
                      color: "var(--accent-primary)",
                      border: "1px solid color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                    }}
                  >
                    Saves Space
                  </span>
                </div>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.45 }}>
                  Imports to your library and safely removes originals to free up space on your computer.
                </p>
              </div>
            </div>
          </div>

          {/* Progress Bar when importing */}
          {isImporting && (
            <div style={{ marginTop: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
                  {currentImportFile ? `Importing: ${currentImportFile}` : "Importing and organizing your media..."}
                </span>
                <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)" }}>{importProgress}%</span>
              </div>
              <div style={{ height: "6px", backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                <div 
                  style={{
                    height: "100%",
                    width: `${importProgress}%`,
                    backgroundColor: "var(--accent-fill)",
                    borderRadius: "var(--radius-full)",
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
            padding: "16px 28px",
            backgroundColor: "rgba(0, 0, 0, 0.15)",
            borderTop: "1px solid var(--glass-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", fontSize: "11px" }}>
            <ShieldCheck size={13} style={{ color: "#10b981" }} />
            <span>Zero cloud uploads &bull; Completely offline</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={onClose}
              disabled={isImporting}
              className="clickable"
              style={{
                padding: "8px 18px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--glass-pill-bg)",
                border: "1px solid var(--glass-pill-border)",
                color: "var(--text-secondary)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: isImporting ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            
            <button
              onClick={handleStartImport}
              disabled={isImporting || !hasSelection}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 22px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--accent-fill)",
                border: "none",
                color: "var(--on-accent)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: isImporting || !hasSelection ? "not-allowed" : "pointer",
                opacity: !hasSelection ? 0.5 : 1,
                boxShadow: hasSelection ? "0 2px 10px color-mix(in srgb, var(--accent-ink) 35%, transparent)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              {isImporting ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
              {isImporting 
                ? "Importing..." 
                : selectedFiles.length > 0 
                  ? `Import ${selectedFiles.length} ${selectedFiles.length === 1 ? "Item" : "Items"}`
                  : selectedFolder 
                    ? "Import Folder" 
                    : "Import Media"
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
