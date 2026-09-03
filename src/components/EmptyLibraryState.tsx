import React from "react";
import { 
  FolderPlus, 
  ShieldCheck, 
  Sparkles, 
  UploadCloud, 
  Lock
} from "lucide-react";

interface EmptyLibraryStateProps {
  onSelectFolder: () => void;
  onDropFiles?: (files: FileList) => void;
}

/**
 * Modern Empty Library State & First-Run Welcome Component.
 * 
 * Replaces dummy mock items with an intuitive, clean onboarding dropzone
 * that guides the user to import their first photos or external folder.
 */
export const EmptyLibraryState: React.FC<EmptyLibraryStateProps> = ({
  onSelectFolder,
  onDropFiles,
}) => {
  const [isDragOver, setIsDragOver] = React.useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropFiles?.(e.dataTransfer.files);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        textAlign: "center",
        userSelect: "none",
        backgroundColor: isDragOver ? "rgba(59, 130, 246, 0.05)" : "transparent",
        transition: "background-color 0.2s ease",
      }}
    >
      {/* Visual Welcome Illustration Container */}
      <div
        style={{
          width: "88px",
          height: "88px",
          borderRadius: "24px",
          background: isDragOver 
            ? "linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(99, 102, 241, 0.3) 100%)"
            : "linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)",
          border: isDragOver 
            ? "2px dashed var(--accent-primary, #3b82f6)" 
            : "1px solid rgba(255, 255, 255, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "24px",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.3)",
          transition: "all 0.2s ease",
        }}
      >
        {isDragOver ? (
          <UploadCloud size={40} style={{ color: "var(--accent-primary, #3b82f6)" }} />
        ) : (
          <FolderPlus size={38} style={{ color: "var(--accent-primary, #3b82f6)" }} />
        )}
      </div>

      {/* Main Title & Description */}
      <h2 
        style={{ 
          fontSize: "22px", 
          fontWeight: 700, 
          letterSpacing: "-0.3px", 
          marginBottom: "8px",
          color: "var(--text-primary, #f8fafc)",
        }}
      >
        Welcome to SecurePhotos
      </h2>
      <p 
        style={{ 
          fontSize: "13px", 
          color: "var(--text-muted, #94a3b8)", 
          maxWidth: "460px", 
          lineHeight: "1.6", 
          marginBottom: "28px" 
        }}
      >
        Your library is currently empty. Import a photo folder from your PC, SD card, or external drive to start browsing with 4K AI super-resolution and Zero-Trust vault encryption.
      </p>

      {/* Action Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "36px" }}>
        <button
          onClick={onSelectFolder}
          className="clickable"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 22px",
            borderRadius: "var(--radius-sm, 8px)",
            backgroundColor: "var(--accent-primary, #3b82f6)",
            color: "#ffffff",
            fontWeight: 600,
            fontSize: "13px",
            border: "none",
            boxShadow: "0 4px 14px rgba(59, 130, 246, 0.35)",
            cursor: "pointer",
          }}
        >
          <FolderPlus size={16} />
          Select Folder to Import
        </button>
      </div>

      {/* Feature Capability Highlights */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "16px",
          maxWidth: "640px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "var(--radius-sm, 8px)",
            backgroundColor: "var(--bg-surface, rgba(255, 255, 255, 0.03))",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
            fontSize: "12px",
            color: "var(--text-secondary, #cbd5e1)",
          }}
        >
          <Lock size={14} style={{ color: "var(--accent-vault, #a855f7)" }} />
          <span>AES-256-GCM Zero-Trust Vault</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "var(--radius-sm, 8px)",
            backgroundColor: "var(--bg-surface, rgba(255, 255, 255, 0.03))",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
            fontSize: "12px",
            color: "var(--text-secondary, #cbd5e1)",
          }}
        >
          <Sparkles size={14} style={{ color: "#f59e0b" }} />
          <span>On-Device 4K AI Super-Resolution</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "var(--radius-sm, 8px)",
            backgroundColor: "var(--bg-surface, rgba(255, 255, 255, 0.03))",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
            fontSize: "12px",
            color: "var(--text-secondary, #cbd5e1)",
          }}
        >
          <ShieldCheck size={14} style={{ color: "#10b981" }} />
          <span>100% Offline & Private</span>
        </div>
      </div>
    </div>
  );
};
