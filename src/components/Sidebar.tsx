import React from "react";
import { 
  Images, 
  FolderHeart, 
  Users, 
  FileText, 
  Sparkles, 
  Lock, 
  Trash2, 
  Settings, 
  Zap,
  HardDrive
} from "lucide-react";
import { useAppStore, NavTab } from "../store/useAppStore";

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  isVault?: boolean;
}

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, totalPhotosCount, isDriveConnected, activeVolume, prerequisites } = useAppStore();

  const navItems: NavItem[] = [
    { 
      id: "photos", 
      label: "Photos", 
      icon: <Images size={17} />, 
      badge: totalPhotosCount > 0 ? totalPhotosCount.toLocaleString() : undefined 
    },
    { id: "albums", label: "Albums", icon: <FolderHeart size={17} /> },
    { id: "people", label: "People", icon: <Users size={17} /> },
    { id: "documents", label: "Documents", icon: <FileText size={17} /> },
    { id: "stories", label: "Stories & Insights", icon: <Sparkles size={17} /> },
    { id: "vault", label: "Encrypted Vault", icon: <Lock size={17} />, isVault: true },
    { id: "trash", label: "Trash", icon: <Trash2 size={17} /> },
    { id: "settings", label: "Settings", icon: <Settings size={17} /> },
  ];

  return (
    <aside 
      style={{
        width: "220px",
        backgroundColor: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "12px 8px",
        userSelect: "none",
      }}
    >
      {/* Navigation List */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background: isActive 
                  ? (item.isVault ? "var(--accent-vault-glow)" : "var(--accent-glow)")
                  : "transparent",
                color: isActive 
                  ? (item.isVault ? "var(--accent-vault)" : "var(--accent-primary)")
                  : "var(--text-secondary)",
                fontWeight: isActive ? 600 : 400,
                fontSize: "13px",
                textAlign: "left",
                transition: "all var(--transition-fast)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {item.icon}
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span 
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    color: isActive ? "inherit" : "var(--text-muted)",
                    backgroundColor: "var(--bg-surface)",
                    padding: "1px 6px",
                    borderRadius: "var(--radius-xs)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Status Card */}
      <div 
        style={{
          padding: "10px",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-secondary)" }}>
            <HardDrive size={13} style={{ color: isDriveConnected ? "var(--accent-success)" : "var(--accent-danger)" }} />
            <span>{activeVolume?.volume_name || "Local Storage"}</span>
          </div>
          <span style={{ fontSize: "10px", color: "var(--accent-success)", fontWeight: 600 }}>READY</span>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: prerequisites?.backend.running ? "var(--accent-success)" : "var(--text-muted)" }}>
          <Zap size={13} style={{ color: prerequisites?.backend.running ? "var(--accent-success)" : "var(--accent-primary)" }} />
          <span>{prerequisites?.backend.running ? "4K AI Engine Active" : "Initializing Engine..."}</span>
        </div>
      </div>
    </aside>
  );
};
