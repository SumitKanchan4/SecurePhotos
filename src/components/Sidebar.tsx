import React from "react";
import { 
  LayoutDashboard,
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
  hasDividerBefore?: boolean;
}

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, isDriveConnected, activeVolume, prerequisites } = useAppStore();

  const navItems: NavItem[] = [
    { 
      id: "photos", 
      label: "Photos", 
      icon: <Images size={17} /> 
    },
    { 
      id: "stories", 
      label: "Stories", 
      icon: <Sparkles size={17} /> 
    },
    { 
      id: "albums", 
      label: "Albums", 
      icon: <FolderHeart size={17} /> 
    },
    { 
      id: "people", 
      label: "People", 
      icon: <Users size={17} /> 
    },
    { 
      id: "documents", 
      label: "Documents", 
      icon: <FileText size={17} /> 
    },
    { 
      id: "vault", 
      label: "Encrypted Vault", 
      icon: <Lock size={17} />, 
      isVault: true 
    },
    { 
      id: "dashboard", 
      label: "Dashboard", 
      icon: <LayoutDashboard size={17} />,
      hasDividerBefore: true 
    },
    { 
      id: "trash", 
      label: "Trash", 
      icon: <Trash2 size={17} /> 
    },
    { 
      id: "settings", 
      label: "Settings", 
      icon: <Settings size={17} /> 
    },
  ];

  return (
    <aside 
      style={{
        width: "220px",
        backgroundColor: "var(--bg-sidebar)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderRight: "1px solid var(--glass-border)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "14px 10px",
        userSelect: "none",
      }}
    >
      {/* Navigation List */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <React.Fragment key={item.id}>
              {item.hasDividerBefore && (
                <div 
                  style={{ 
                    height: "1px", 
                    backgroundColor: "var(--glass-border)", 
                    margin: "6px 8px",
                  }} 
                />
              )}
              <button
                onClick={() => setActiveTab(item.id)}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "9px 14px",
                borderRadius: "var(--radius-md)",
                border: isActive 
                  ? (item.isVault ? "1px solid rgba(59, 130, 246, 0.35)" : "1px solid var(--glass-border-highlight)")
                  : "1px solid transparent",
                background: isActive 
                  ? (item.isVault ? "rgba(59, 130, 246, 0.15)" : "var(--glass-pill-active)")
                  : "transparent",
                color: isActive 
                  ? (item.isVault ? "var(--accent-primary)" : "var(--text-primary)")
                  : "var(--text-secondary)",
                fontWeight: isActive ? 600 : 450,
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
          </React.Fragment>
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
          <span>{prerequisites?.backend.running ? "8K AI Engine Active" : "Initializing Engine..."}</span>
        </div>
      </div>
    </aside>
  );
};
