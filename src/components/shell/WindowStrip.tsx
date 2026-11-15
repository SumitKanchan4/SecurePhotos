/**
 * WindowStrip: the slim 32 px top strip of the frameless window (redesign R1).
 *
 * Drag area for moving the window, the theme toggle and the window buttons. (The search
 * chip is gone: search is its own page since R9c and never filters other pages.)
 */
import React from "react";
import { Minus, Moon, Square, Sun, X } from "lucide-react";
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
  const { theme, toggleTheme } = useAppStore();

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
