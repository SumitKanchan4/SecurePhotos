import React, { useState } from "react";
import { AlertTriangle, RefreshCw, X, ExternalLink, Play } from "lucide-react";
import { SystemPrerequisites } from "../types";

interface PrerequisitesBannerProps {
  prerequisites: SystemPrerequisites | null;
  isLoading: boolean;
  onRecheck: () => Promise<void>;
  onStartEngine?: () => Promise<void>;
}

/**
 * System Prerequisites Diagnostics Banner.
 * 
 * Verifies that prerequisite system dependencies (Python 3.10+, FastAPI engine)
 * are present and provides actionable 1-click remediation guidance if absent.
 */
export const PrerequisitesBanner: React.FC<PrerequisitesBannerProps> = ({
  prerequisites,
  isLoading,
  onRecheck,
  onStartEngine,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  // If dismissed or still initializing or all systems ready, do not display warning banner
  if (isDismissed || !prerequisites || prerequisites.all_ready) {
    return null;
  }

  const { python, backend } = prerequisites;

  const handleDownloadPython = () => {
    window.open("https://www.python.org/downloads/", "_blank");
  };

  return (
    <div
      style={{
        backgroundColor: python.installed ? "rgba(245, 158, 11, 0.12)" : "rgba(239, 68, 68, 0.12)",
        borderBottom: `1px solid ${python.installed ? "rgba(245, 158, 11, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        zIndex: 50,
        transition: "all 0.2s ease-in-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: python.installed ? "#f59e0b" : "#ef4444",
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={18} />
        </div>

        <div style={{ fontSize: "13px", lineHeight: "1.4" }}>
          {!python.installed ? (
            <div>
              <span style={{ fontWeight: 600, color: "#f87171" }}>
                Missing Dependency: Python 3.10+ Required.{" "}
              </span>
              <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                SecurePhotos requires Python to execute on-device 4K AI Super-Resolution and Zero-Trust Vault cryptography.
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
          ) : !backend.running ? (
            <div>
              <span style={{ fontWeight: 600, color: "#f59e0b" }}>
                Standalone Local Mode ({python.version} detected).{" "}
              </span>
              <span style={{ color: "var(--text-secondary, #94a3b8)" }}>
                SecurePhotos is running in local client mode. The background engine will automatically manage AI super-resolution and Zero-Trust vault encryption.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        {!python.installed && (
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
          onClick={() => setIsDismissed(true)}
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
  );
};

