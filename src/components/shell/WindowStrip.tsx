/**
 * WindowStrip: the slim 32 px top strip of the frameless window (redesign R1).
 *
 * Drag area for moving the window, the active search shown as a chip (the search
 * text also filters People, Albums, Documents and Trash, so it must stay visible
 * after the search palette closes), the theme toggle and the window buttons.
 */
import React from "react";
import { Minus, Moon, Search, Square, Sun, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../../store/useAppStore";

async function windowAction(action: "minimize" | "toggleMaximize" | "close"): Promise<void> {
  try {
    await getCurrentWindow()[action]();
  } catch (err) {
    console.warn(`Window ${action} unavailable (browser mode):`, err);
  }
}

const controlStyle: React.CSSProperties = {
  width: "40px",
  height: "32px",
  border: "none",
  background: "transparent",
  color: "var(--text-secondary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const WindowStrip: React.FC = () => {
  const { theme, toggleTheme, searchQuery, setSearchQuery, setSearchOpen } = useAppStore();
  const activeQuery = searchQuery.trim();

  return (
    <header
      data-tauri-drag-region
      style={{
        height: "32px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "var(--bg-app)",
        userSelect: "none",
        position: "relative",
        zIndex: 200,
      }}
    >
      <div data-tauri-drag-region style={{ flex: 1, height: "100%" }} />

      {activeQuery && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            height: "24px",
            padding: "0 4px 0 10px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--glass-pill-bg)",
            border: "1px solid var(--glass-border)",
            fontSize: "12px",
            color: "var(--text-primary)",
            maxWidth: "40vw",
          }}
        >
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Edit search (Ctrl+K)"
            style={{ display: "flex", alignItems: "center", gap: "6px", border: "none", background: "transparent", color: "inherit", fontSize: "12px", padding: 0, minWidth: 0 }}
          >
            <Search size={12} aria-hidden="true" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Search: <strong>{activeQuery}</strong>
            </span>
          </button>
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => setSearchQuery("")}
            style={{ width: "18px", height: "18px", borderRadius: "var(--radius-full)", border: "none", background: "transparent", color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div data-tauri-drag-region style={{ flex: 1, height: "100%", display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme (T)`}
          className="clickable"
          style={controlStyle}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button type="button" onClick={() => windowAction("minimize")} aria-label="Minimise window" title="Minimise" className="clickable" style={controlStyle}>
          <Minus size={14} />
        </button>
        <button type="button" onClick={() => windowAction("toggleMaximize")} aria-label="Maximise or restore window" title="Maximise / restore" className="clickable" style={controlStyle}>
          <Square size={11} />
        </button>
        <button
          type="button"
          onClick={() => windowAction("close")}
          aria-label="Close window"
          title="Close"
          className="clickable window-close"
          style={controlStyle}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
};
