import React, { useState } from "react";
import { AlertTriangle, RefreshCw, X, ExternalLink, Play, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { SystemPrerequisites } from "../types";

interface PrerequisitesBannerProps {
  prerequisites: SystemPrerequisites | null;
  isLoading: boolean;
  onRecheck: () => Promise<void>;
  onStartEngine?: () => Promise<void>;
  onDismiss?: () => void;
}

/**
 * System Prerequisites Diagnostics Banner.
 * 
 * Verifies that prerequisite system dependencies (Visual C++ 2015-2022, Python 3.10+, FastAPI engine)
 * are present, displays error diagnostics if the engine terminated or failed,
 * and provides actionable 1-click remediation guidance and startup log inspection.
 */
export const PrerequisitesBanner: React.FC<PrerequisitesBannerProps> = ({
  prerequisites,
  isLoading,
  onRecheck,
  onStartEngine,
  onDismiss,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [engineLogs, setEngineLogs] = useState<string>("");
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // If dismissed or still initializing or all systems ready, do not display warning banner
  if (isDismissed || !prerequisites || prerequisites.all_ready) {
    return null;
  }

  const { python, backend, vcredist, error_message } = prerequisites;

  const handleDownloadPython = () => {
    window.open("https://www.python.org/downloads/", "_blank");
  };

  const handleDownloadVcRedist = () => {
    const url = vcredist?.download_url || "https://aka.ms/vs/17/release/vc_redist.x64.exe";
    window.open(url, "_blank");
  };

  const handleOpenLogs = async () => {
    setIsLoadingLogs(true);
    setIsLogModalOpen(true);
    try {
      const logs = await invoke<string>("get_engine_logs");
      setEngineLogs(logs || "No engine startup logs found.");
    } catch (err) {
      setEngineLogs(`Unable to retrieve engine logs: ${String(err)}`);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const isCriticalError = !vcredist?.installed || !python?.installed || !!error_message;

  return (
    <>
      <div
        style={{
          backgroundColor: isCriticalError ? "rgba(239, 68, 68, 0.12)" : "rgba(245, 158, 11, 0.12)",
          borderBottom: `1px solid ${isCriticalError ? "rgba(239, 68, 68, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          zIndex: 50,
          transition: "all 0.2s ease-in-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isCriticalError ? "#ef4444" : "#f59e0b",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={18} />
          </div>

          <div style={{ fontSize: "13px", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis" }}>
            {vcredist && !vcredist.installed ? (
              <div>
                <span style={{ fontWeight: 600, color: "#f87171" }}>
                  Missing System Runtime: Microsoft Visual C++ 2015–2022 (x64) Required.{" "}
                </span>
                <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                  On-device 8K AI super-resolution and face recognition require the official Microsoft Visual C++ runtime.
                </span>
              </div>
            ) : !python.installed ? (
              <div>
                <span style={{ fontWeight: 600, color: "#f87171" }}>
                  Missing Dependency: Python 3.10+ Runtime Required.{" "}
                </span>
                <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                  SecurePhotos requires Python to execute on-device AI Super-Resolution and Zero-Trust Vault cryptography.
                </span>
              </div>
            ) : !python.meets_minimum_version ? (
              <div>
                <span style={{ fontWeight: 600, color: "#f59e0b" }}>
                  Python Version Upgrade Recommended.{" "}
                </span>
                <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                  Detected {python.version}, but minimum required version is {python.minimum_required}+.
                </span>
              </div>
            ) : error_message ? (
              <div>
                <span style={{ fontWeight: 600, color: "#f87171" }}>
                  Engine Startup Warning:{" "}
                </span>
                <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                  {error_message}
                </span>
              </div>
            ) : !backend.running ? (
              <div>
                <span style={{ fontWeight: 600, color: "#f59e0b" }}>
                  Local Engine Offline.{" "}
                </span>
                <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                  The SecurePhotos AI engine is currently stopped. Click "Start Engine" or inspect logs to resolve.
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          {vcredist && !vcredist.installed && (
            <button
              onClick={handleDownloadVcRedist}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: "var(--radius-sm, 6px)",
                color: "#fca5a5",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ExternalLink size={13} />
              Install Visual C++ (Microsoft)
            </button>
          )}

          {!python.installed && vcredist?.installed && (
            <button
              onClick={handleDownloadPython}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: "var(--radius-sm, 6px)",
                color: "#fca5a5",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ExternalLink size={13} />
              Install Python
            </button>
          )}

          {python.installed && !backend.running && onStartEngine && (
            <button
              onClick={onStartEngine}
              disabled={isLoading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "rgba(59, 130, 246, 0.2)",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                borderRadius: "var(--radius-sm, 6px)",
                color: "#93c5fd",
                fontSize: "12px",
                fontWeight: 600,
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              <Play size={13} />
              Start Engine
            </button>
          )}

          <button
            onClick={handleOpenLogs}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              borderRadius: "var(--radius-sm, 6px)",
              color: "var(--text-secondary, #cbd5e1)",
              fontSize: "12px",
              cursor: "pointer",
            }}
            title="Inspect background engine stdout and stderr logs"
          >
            <FileText size={13} />
            View Logs
          </button>

          <button
            onClick={onRecheck}
            disabled={isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              borderRadius: "var(--radius-sm, 6px)",
              color: "var(--text-primary, #f8fafc)",
              fontSize: "12px",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} style={{ animation: isLoading ? "spin 1s linear infinite" : undefined }} />
            Recheck
          </button>

          <button
            onClick={handleDismiss}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted, #64748b)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
            title="Dismiss banner"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Diagnostics & Startup Log Modal */}
      {isLogModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => setIsLogModalOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "760px",
              maxHeight: "85vh",
              backgroundColor: "var(--glass-surface, #1e293b)",
              border: "1px solid var(--glass-border, rgba(255, 255, 255, 0.12))",
              borderRadius: "var(--radius-xl, 16px)",
              boxShadow: "var(--glass-shadow, 0 25px 50px -12px rgba(0, 0, 0, 0.5))",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <FileText size={18} style={{ color: "var(--accent-primary, #3b82f6)" }} />
                <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--text-primary, #f8fafc)" }}>
                  Backend Engine Startup Diagnostics
                </h3>
              </div>
              <button
                onClick={() => setIsLogModalOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted, #94a3b8)",
                  cursor: "pointer",
                  padding: "4px",
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content / Terminal View */}
            <div
              style={{
                padding: "16px",
                flex: 1,
                overflowY: "auto",
                backgroundColor: "rgba(0, 0, 0, 0.4)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: "12px",
                lineHeight: "1.6",
                color: "#e2e8f0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {isLoadingLogs ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-muted)" }}>
                  <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Loading engine startup stream...
                </div>
              ) : (
                engineLogs || "No log entries found. The engine may not have written output yet."
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "14px 20px",
                borderTop: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "rgba(0, 0, 0, 0.15)",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)" }}>
                Log stream bounded to 1MB &middot; Captured in data/engine_startup.log
              </span>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={handleOpenLogs}
                  style={{
                    padding: "6px 14px",
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
                    borderRadius: "var(--radius-sm, 6px)",
                    color: "var(--text-primary, #f8fafc)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Refresh Logs
                </button>
                <button
                  onClick={() => setIsLogModalOpen(false)}
                  style={{
                    padding: "6px 14px",
                    backgroundColor: "var(--accent-primary, #3b82f6)",
                    border: "none",
                    borderRadius: "var(--radius-sm, 6px)",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
