import React from "react";
import { useAppStore } from "../store/useAppStore";
import { CheckCircle2, Info, AlertTriangle, X } from "lucide-react";

export const ToastNotification: React.FC = () => {
  const { toast, hideToast } = useAppStore();

  if (!toast) return null;

  const getBorderColor = () => {
    switch (toast.type) {
      case "success":
        return "var(--accent-success, #10b981)";
      case "warning":
        return "var(--accent-danger, #ef4444)";
      case "info":
      default:
        return "var(--accent-primary)";
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case "success":
        return <CheckCircle2 size={16} style={{ color: "var(--accent-success, #10b981)", flexShrink: 0 }} />;
      case "warning":
        return <AlertTriangle size={16} style={{ color: "var(--accent-danger, #ef4444)", flexShrink: 0 }} />;
      case "info":
      default:
        return <Info size={16} style={{ color: "var(--accent-primary, var(--accent-ink))", flexShrink: 0 }} />;
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "28px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 18px",
        borderRadius: "var(--radius-full, 9999px)",
        backgroundColor: "rgba(16, 20, 32, 0.94)",
        border: `1px solid ${getBorderColor()}`,
        backdropFilter: "blur(14px)",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
        color: "#ffffff",
        fontSize: "12px",
        fontWeight: 500,
        maxWidth: "90vw",
        animation: "fadeInUp 0.2s ease",
      }}
    >
      {getIcon()}
      <span style={{ lineHeight: "1.4" }}>{toast.message}</span>
      <button
        type="button"
        onClick={hideToast}
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255, 255, 255, 0.6)",
          cursor: "pointer",
          padding: "2px",
          display: "flex",
          alignItems: "center",
          marginLeft: "6px",
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
};
