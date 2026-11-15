import React, { useState } from "react";
import { Sparkles, Download, X, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";

interface UpdateModalProps {
  update: Update;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Enterprise Update Confirmation Modal.
 * 
 * Ensures zero unexpected updates by requiring explicit user confirmation
 * prior to initiating package download, stream-verifying signatures,
 * and restarting the desktop application.
 */
export const UpdateModal: React.FC<UpdateModalProps> = ({ update, isOpen, onClose }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadStatusText, setDownloadStatusText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  if (!isOpen) return null;

  const handleStartUpdate = async () => {
    setIsDownloading(true);
    setErrorMessage(null);
    setDownloadStatusText("Initializing verified update package...");

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      // Gracefully terminate the background engine process to release file locks on Windows
      try {
        await invoke("prepare_for_update");
      } catch (prepErr) {
        console.warn("Notice during engine pre-update shutdown:", prepErr);
      }

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            setDownloadStatusText("Downloading release payload...");
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            if (totalBytes > 0) {
              const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
              setDownloadProgress(percent);
              setDownloadStatusText(`Downloading: ${percent}% (${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`);
            } else {
              setDownloadStatusText(`Downloaded ${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB...`);
            }
            break;
          case "Finished":
            setDownloadProgress(100);
            setDownloadStatusText("Installing in-place update (your library is safely preserved)...");
            break;
        }
      });

      setIsCompleted(true);
      setDownloadStatusText("Update installed successfully! Restarting SecurePhotos...");

      // Allow visual feedback before invoking relaunch
      setTimeout(async () => {
        try {
          await invoke("relaunch_app");
        } catch {
          // Fallback reload if Tauri restart command is unavailable
          window.location.reload();
        }
      }, 1500);

    } catch (err: any) {
      console.error("Update installation error:", err);
      setIsDownloading(false);
      setErrorMessage(err?.message || "An error occurred while downloading or installing the update.");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
      }}
      onClick={!isDownloading ? onClose : undefined}
    >
      <div
        style={{
          backgroundColor: "var(--bg-surface-elevated, #1a1d29)",
          border: "1px solid var(--border-highlight, rgba(255, 255, 255, 0.16))",
          borderRadius: "var(--radius-lg, 16px)",
          width: "100%",
          maxWidth: "480px",
          overflow: "hidden",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                backgroundColor: "color-mix(in srgb, var(--accent-ink) 15%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-primary, var(--accent-ink))",
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary, #f8fafc)", margin: 0 }}>
                New Version Available
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-secondary, #94a3b8)", margin: 0 }}>
                Version v{update.version} is ready to install
              </p>
            </div>
          </div>
          {!isDownloading && (
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted, #64748b)",
                cursor: "pointer",
                padding: "4px",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div style={{ padding: "24px" }}>
          {update.body ? (
            <div
              style={{
                backgroundColor: "var(--bg-surface, #12141c)",
                border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                borderRadius: "var(--radius-md, 8px)",
                padding: "14px",
                marginBottom: "20px",
                maxHeight: "160px",
                overflowY: "auto",
                fontSize: "13px",
                color: "var(--text-secondary, #94a3b8)",
                lineHeight: "1.5",
              }}
            >
              <p style={{ fontWeight: 600, color: "var(--text-primary, #f8fafc)", marginBottom: "6px" }}>
                What's New:
              </p>
              <div style={{ whiteSpace: "pre-wrap" }}>{update.body}</div>
            </div>
          ) : (
            <p style={{ fontSize: "13px", color: "var(--text-secondary, #94a3b8)", marginBottom: "20px" }}>
              A new release of SecurePhotos with stability improvements, security updates, and performance optimizations is available.
            </p>
          )}

          {/* Progress / Status indicator */}
          {isDownloading && (
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px" }}>
                <span style={{ color: "var(--text-secondary, #94a3b8)" }}>{downloadStatusText}</span>
                {downloadProgress !== null && (
                  <span style={{ fontWeight: 600, color: "var(--accent-primary, var(--accent-ink))" }}>
                    {downloadProgress}%
                  </span>
                )}
              </div>
              <div
                style={{
                  width: "100%",
                  height: "6px",
                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: downloadProgress !== null ? `${downloadProgress}%` : "30%",
                    backgroundColor: isCompleted ? "#10b981" : "var(--accent-fill)",
                    transition: "width 0.2s ease-out",
                    animation: downloadProgress === null ? "pulse 1.5s infinite" : undefined,
                  }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "var(--radius-sm, 6px)",
                color: "#f87171",
                fontSize: "12px",
                marginBottom: "20px",
              }}
            >
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            {!isDownloading && (
              <button
                onClick={onClose}
                style={{
                  padding: "10px 18px",
                  borderRadius: "var(--radius-sm, 6px)",
                  backgroundColor: "transparent",
                  border: "1px solid var(--border-highlight, rgba(255, 255, 255, 0.16))",
                  color: "var(--text-secondary, #94a3b8)",
                  fontSize: "13px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Remind Me Later
              </button>
            )}

            {!isCompleted ? (
              <button
                onClick={handleStartUpdate}
                disabled={isDownloading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 20px",
                  borderRadius: "var(--radius-sm, 6px)",
                  backgroundColor: "var(--accent-fill)",
                  border: "none",
                  color: "var(--on-accent)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: isDownloading ? "not-allowed" : "pointer",
                  opacity: isDownloading ? 0.7 : 1,
                  boxShadow: "0 2px 10px color-mix(in srgb, var(--accent-ink) 30%, transparent)",
                }}
              >
                {isDownloading ? (
                  <>
                    <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} />
                    Updating...
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    Update Now & Restart
                  </>
                )}
              </button>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "#10b981",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={16} />
                Restarting...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

