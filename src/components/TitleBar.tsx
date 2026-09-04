import React from "react";
import { 
  Search, 
  Sun, 
  Moon, 
  Minus, 
  Square, 
  X, 
  ShieldCheck, 
  HardDrive 
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../store/useAppStore";

export const TitleBar: React.FC = () => {
  const { theme, toggleTheme, searchQuery, setSearchQuery, activeVolume, isDriveConnected } = useAppStore();

  const handleMinimize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (err) {
      console.warn("Minimize error / browser mode:", err);
    }
  };

  const handleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
    } catch (err) {
      console.warn("Maximize error / browser mode:", err);
    }
  };

  const handleClose = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (err) {
      console.warn("Close error / browser mode:", err);
    }
  };

  return (
    <header 
      data-tauri-drag-region 
      style={{
        height: "44px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        backgroundColor: "var(--bg-sidebar)",
        borderBottom: "1px solid var(--border-subtle)",
        userSelect: "none",
        zIndex: 100,
      }}
    >
      {/* Brand & App Title */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }} data-tauri-drag-region>
        <div 
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--accent-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
          }}
        >
          <ShieldCheck size={16} />
        </div>
        <span style={{ fontWeight: 600, fontSize: "13px", letterSpacing: "0.2px" }}>
          SecurePhotos <span style={{ color: "var(--accent-primary)", fontSize: "11px", fontWeight: 700 }}>0.0.7</span>
        </span>

        {/* Volume Status Pill */}
        {activeVolume && (
          <div 
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              backgroundColor: isDriveConnected ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
              color: isDriveConnected ? "var(--accent-success)" : "var(--accent-danger)",
              marginLeft: "12px",
            }}
          >
            <HardDrive size={12} />
            <span>{activeVolume.volume_name} ({activeVolume.drive_letter})</span>
          </div>
        )}
      </div>

      {/* Global Hybrid Search (Ctrl + K) */}
      <div style={{ flex: 1, maxWidth: "460px", margin: "0 20px" }}>
        <div 
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: "var(--bg-surface)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            padding: "4px 10px",
            gap: "8px",
          }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Search photos, people, tags, OCR documents... (Ctrl+K)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
            }}
          />
          <kbd 
            style={{
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              padding: "1px 5px",
              borderRadius: "var(--radius-xs)",
              backgroundColor: "var(--bg-surface-elevated)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Ctrl K
          </kbd>
        </div>
      </div>

      {/* Action Controls & Window Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {/* Theme Switcher */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme (T)`}
          className="clickable"
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <div style={{ width: "1px", height: "16px", backgroundColor: "var(--border-subtle)", margin: "0 4px" }} />

        {/* Windows Native Control Buttons */}
        <button
          onClick={handleMinimize}
          className="clickable"
          title="Minimize Window"
          style={{
            width: "32px",
            height: "28px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="clickable"
          title="Maximize / Restore Window"
          style={{
            width: "32px",
            height: "28px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Square size={12} />
        </button>
        <button
          onClick={handleClose}
          className="clickable"
          title="Close Window"
          style={{
            width: "32px",
            height: "28px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--accent-danger)";
            e.currentTarget.style.color = "#ffffff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
};
