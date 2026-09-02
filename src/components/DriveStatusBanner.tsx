import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export const DriveStatusBanner: React.FC = () => {
  const { isDriveConnected, activeVolume } = useAppStore();

  if (isDriveConnected) {
    return null;
  }

  return (
    <div 
      className="glass-panel"
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "12px 20px",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        backgroundColor: "rgba(239, 68, 68, 0.15)",
        borderColor: "var(--accent-danger)",
        color: "var(--text-primary)",
        zIndex: 1000,
        maxWidth: "600px",
      }}
    >
      <AlertTriangle size={20} style={{ color: "var(--accent-danger)", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontWeight: 600, fontSize: "13px" }}>
          External Storage Disconnected
        </p>
        <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
          Target volume {activeVolume?.volume_name || "MediaVault"} is offline. Processing queues paused safely with zero data loss.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="clickable"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: "var(--accent-danger)",
          border: "none",
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        <RefreshCw size={12} />
        Retry
      </button>
    </div>
  );
};
