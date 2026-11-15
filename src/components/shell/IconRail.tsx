/**
 * IconRail: the 64 px navigation rail that replaces the labelled sidebar (redesign R1).
 *
 * Logo, search (Ctrl+K), the nine sections as icons with hover labels, and a small
 * status dot for the library drive and the engine (details on hover). Active section:
 * lime fill with a black icon in dark, black fill with a white icon in light
 * (see --rail-active-* in index.css).
 */
import React, { useEffect } from "react";
import {
  FileText,
  FolderHeart,
  Images,
  LayoutDashboard,
  Lock,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { NavTab, useAppStore } from "../../store/useAppStore";
import appIcon from "../../assets/brand/app-icon.svg";

export interface RailItem {
  id: NavTab;
  label: string;
  icon: React.ReactNode;
  dividerBefore?: boolean;
}

export const RAIL_ITEMS: RailItem[] = [
  { id: "photos", label: "Photos", icon: <Images size={20} /> },
  { id: "stories", label: "Stories", icon: <Sparkles size={20} /> },
  { id: "albums", label: "Albums", icon: <FolderHeart size={20} /> },
  { id: "people", label: "People", icon: <Users size={20} /> },
  { id: "documents", label: "Documents", icon: <FileText size={20} /> },
  { id: "vault", label: "Private Vault", icon: <Lock size={20} /> },
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={20} />, dividerBefore: true },
  { id: "trash", label: "Trash", icon: <Trash2 size={20} /> },
  { id: "settings", label: "Settings", icon: <Settings size={20} /> },
];

/** One line of plain-language status for the drive and the engine. */
export function railStatus(
  isDriveConnected: boolean,
  engineRunning: boolean | undefined,
  hasIssue: boolean,
): { tone: "ok" | "starting" | "problem"; text: string } {
  if (!isDriveConnected) return { tone: "problem", text: "Library drive not connected" };
  if (engineRunning) return { tone: "ok", text: "Library ready · engine running" };
  if (hasIssue) return { tone: "problem", text: "Engine offline: open Settings to fix" };
  return { tone: "starting", text: "Engine starting…" };
}

export const IconRail: React.FC = () => {
  const { activeTab, setActiveTab, openSearch, isDriveConnected, prerequisites } = useAppStore();

  // Ctrl+K (Cmd+K) opens the Search page from anywhere, even while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAppStore.getState().openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const hasIssue = Boolean(
    prerequisites && (!prerequisites.vcredist?.installed || !prerequisites.python?.installed || !!prerequisites.error_message),
  );
  const status = railStatus(isDriveConnected, prerequisites?.backend.running, hasIssue);
  const dotColor = status.tone === "ok" ? "var(--accent-fill)" : status.tone === "problem" ? "var(--accent-danger)" : "var(--accent-warning)";

  return (
    <aside
      data-tauri-drag-region
      aria-label="Main navigation"
      style={{
        width: "64px",
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--rail-gap, 6px)",
        padding: "12px 0",
        backgroundColor: "var(--bg-app)",
        borderRight: "1px solid var(--glass-border)",
        userSelect: "none",
        position: "relative",
        zIndex: 150,
      }}
    >
      <img src={appIcon} alt="SecurePhotos" style={{ width: "36px", height: "36px", marginBottom: "6px" }} data-tauri-drag-region />

      <button
        type="button"
        className={`rail-btn clickable${activeTab === "search" ? " rail-btn-active" : ""}`}
        data-label="Search (Ctrl+K)"
        aria-label="Search"
        aria-current={activeTab === "search" ? "page" : undefined}
        onClick={openSearch}
      >
        <Search size={20} />
      </button>

      <div style={{ width: "28px", height: "1px", backgroundColor: "var(--glass-border)", margin: "4px 0" }} />

      <nav style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--rail-gap, 6px)" }}>
        {RAIL_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <React.Fragment key={item.id}>
              {item.dividerBefore && (
                <div style={{ width: "28px", height: "1px", backgroundColor: "var(--glass-border)", margin: "4px 0" }} />
              )}
              <button
                type="button"
                className={`rail-btn clickable${isActive ? " rail-btn-active" : ""}`}
                data-label={item.label}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveTab(item.id)}
              >
                {item.icon}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} data-tauri-drag-region />

      <button
        type="button"
        className="rail-btn clickable"
        data-label={status.text}
        aria-label={`Status: ${status.text}`}
        onClick={() => setActiveTab("settings")}
      >
        <span
          data-testid="rail-status-dot"
          data-tone={status.tone}
          style={{ width: "10px", height: "10px", borderRadius: "var(--radius-full)", backgroundColor: dotColor }}
        />
      </button>
    </aside>
  );
};
