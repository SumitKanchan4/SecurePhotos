import React, { useState } from "react";
import { 
  FolderPlus, 
  ShieldCheck, 
  Sparkles, 
  UploadCloud, 
  Lock,
  HardDrive
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface EmptyLibraryStateProps {
  onSelectFolder: () => void;
  onImportMedia?: () => void;
  onDropFiles?: (files: FileList) => void;
}

/**
 * Modern Empty Library State & First-Run Welcome Component.
 * 
 * Provides an intuitive, clean onboarding dropzone with human-friendly copy
 * guiding users to import photos and videos with complete offline privacy.
 */
export const EmptyLibraryState: React.FC<EmptyLibraryStateProps> = ({
  onSelectFolder,
  onImportMedia,
  onDropFiles,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleAction = onImportMedia || onSelectFolder;

  const handleConnectExisting = async () => {
    setConnectError(null);
    setIsConnecting(true);
    try {
      const selected = await invoke<string | null>("select_import_folder");
      if (!selected) {
        setIsConnecting(false);
        return;
      }
      await invoke("reconnect_library", { newPath: selected });
      window.location.reload();
    } catch (err: any) {
      console.error("Connect library error:", err);
      setConnectError(typeof err === "string" ? err : err?.message || "Failed to connect to the specified library.");
      setIsConnecting(false);
    }
  };

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
        backgroundColor: isDragOver ? "rgba(59, 130, 246, 0.06)" : "transparent",
        transition: "background-color 0.2s ease",
      }}
    >
      {/* Visual Welcome Illustration Container */}
      <div
        style={{
          width: "88px",
          height: "88px",
          borderRadius: "26px",
          background: isDragOver 
            ? "linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(99, 102, 241, 0.3) 100%)"
            : "linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)",
          border: isDragOver 
            ? "2px dashed var(--accent-primary, #3b82f6)" 
            : "1px solid var(--glass-border, rgba(255, 255, 255, 0.1))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "24px",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)",
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
          fontSize: "24px", 
          fontWeight: 800, 
          letterSpacing: "-0.03em", 
          marginBottom: "10px",
          color: "var(--text-primary, #f8fafc)",
          fontFamily: "var(--font-display, Plus Jakarta Sans, sans-serif)",
        }}
      >
        Welcome to SecurePhotos
      </h2>
      <p 
        style={{ 
          fontSize: "14px", 
          color: "var(--text-secondary, #94a3b8)", 
          maxWidth: "480px", 
          lineHeight: "1.6", 
          marginBottom: "28px",
        }}
      >
        Import your photos and videos to get started. Your media stays safely stored on your device—100% private, offline, and beautifully organized.
      </p>

      {/* Action Buttons & Drag Hint */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={handleAction}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "11px 24px",
              borderRadius: "var(--radius-full, 9999px)",
              backgroundColor: "var(--accent-primary, #3b82f6)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "13px",
              border: "none",
              boxShadow: "0 4px 16px rgba(59, 130, 246, 0.35)",
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
          >
            <FolderPlus size={16} />
            <span>Import Photos &amp; Videos</span>
          </button>

          <button
            onClick={handleConnectExisting}
            disabled={isConnecting}
            className="clickable"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "11px 22px",
              borderRadius: "var(--radius-full, 9999px)",
              backgroundColor: "var(--glass-surface, rgba(255, 255, 255, 0.05))",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              color: "var(--text-primary, #f8fafc)",
              fontWeight: 600,
              fontSize: "13px",
              border: "1px solid var(--glass-border, rgba(255, 255, 255, 0.15))",
              cursor: isConnecting ? "wait" : "pointer",
              transition: "transform 0.15s ease, background-color 0.15s ease",
            }}
          >
            <HardDrive size={16} style={{ color: "var(--accent-primary, #3b82f6)" }} />
            <span>{isConnecting ? "Connecting..." : "Connect Existing Library"}</span>
          </button>
        </div>

        {connectError && (
          <p 
            style={{ 
              fontSize: "12px", 
              color: "var(--color-danger, #ef4444)", 
              margin: "10px 0 0 0",
              maxWidth: "480px",
              lineHeight: "1.4"
            }}
          >
            {connectError}
          </p>
        )}

        <p 
          style={{ 
            fontSize: "12px", 
            color: "var(--text-muted, #64748b)", 
            margin: "12px 0 0 0",
            letterSpacing: "-0.01em",
          }}
        >
          or drag and drop photos, videos, or folders anywhere here
        </p>
      </div>

      {/* Reassuring Feature Capability Highlights */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
          maxWidth: "640px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "7px 16px",
            borderRadius: "var(--radius-full, 9999px)",
            backgroundColor: "var(--glass-surface, rgba(255, 255, 255, 0.04))",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--glass-border, rgba(255, 255, 255, 0.08))",
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--text-secondary, #cbd5e1)",
          }}
        >
          <ShieldCheck size={14} style={{ color: "#10b981" }} />
          <span>100% Offline &amp; Private</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "7px 16px",
            borderRadius: "var(--radius-full, 9999px)",
            backgroundColor: "var(--glass-surface, rgba(255, 255, 255, 0.04))",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--glass-border, rgba(255, 255, 255, 0.08))",
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--text-secondary, #cbd5e1)",
          }}
        >
          <Sparkles size={14} style={{ color: "#fbbf24" }} />
          <span>Smart Clarity Enhancement</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "7px 16px",
            borderRadius: "var(--radius-full, 9999px)",
            backgroundColor: "var(--glass-surface, rgba(255, 255, 255, 0.04))",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--glass-border, rgba(255, 255, 255, 0.08))",
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--text-secondary, #cbd5e1)",
          }}
        >
          <Lock size={14} style={{ color: "var(--accent-primary, #3b82f6)" }} />
          <span>Protected Personal Vault</span>
        </div>
      </div>
    </div>
  );
};

