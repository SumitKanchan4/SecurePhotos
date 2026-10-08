import React, { useState } from "react";
import { 
  Settings, 
  Palette, 
  Shield, 
  Sparkles, 
  Film, 
  Info,
  Sun,
  Moon
} from "lucide-react";
import { useAppSettings } from "../hooks/useAppSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { VaultSettings } from "./settings/VaultSettings";
import { AISettings } from "./settings/AISettings";
import { MemoriesSettings } from "./settings/MemoriesSettings";
import { AboutSettings } from "./settings/AboutSettings";

type SettingsCategory = "appearance" | "vault" | "ai" | "memories" | "about";

interface TabItem {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
}

/**
 * SettingsView Component
 *
 * Flagship preferences panel inspired by Apple Photos desktop settings.
 * Features a clean Section 4 compliant sticky toolbar, top segmented category tabs,
 * Apple-style grouped inset cards, and persistent storage in SQLite.
 */
export const SettingsView: React.FC = () => {
  const { settings, updateSetting } = useAppSettings();
  const [activeTab, setActiveTab] = useState<SettingsCategory>("appearance");

  const tabs: TabItem[] = [
    { id: "appearance", label: "Appearance", icon: <Palette size={14} /> },
    { id: "vault", label: "Private Vault", icon: <Shield size={14} /> },
    { id: "ai", label: "AI & 8K", icon: <Sparkles size={14} /> },
    { id: "memories", label: "Memories", icon: <Film size={14} /> },
    { id: "about", label: "About", icon: <Info size={14} /> },
  ];

  return (
    <div 
      style={{ 
        flex: 1, 
        overflowY: "auto", 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        position: "relative",
        scrollbarGutter: "stable"
      }}
    >
      {/* ── Section 4 Compliant Sticky Liquid-Glass Header ──────────────────── */}
      <div 
        className="liquid-glass-toolbar"
        style={{
          margin: "14px 24px 8px 24px",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "var(--glass-surface)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--glass-shadow)",
          position: "sticky",
          top: 0,
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        {/* Left Column (flex: 1): Category Pill Badge */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px", minWidth: "120px" }}>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "rgba(59, 130, 246, 0.12)",
              color: "var(--accent-primary)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
            }}
          >
            <Settings size={12} style={{ color: "var(--accent-primary)" }} />
            Preferences
          </span>
        </div>

        {/* Center Column (flex: 0 1 auto): Clean 22px Display Title */}
        <div 
          style={{ 
            flex: "0 1 auto", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            minWidth: 0,
          }}
        >
          <h1 
            style={{ 
              fontSize: "22px", 
              fontWeight: 800, 
              letterSpacing: "-0.03em", 
              margin: 0,
              color: "var(--text-primary)",
              fontFamily: "Plus Jakarta Sans, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            Settings
          </h1>
        </div>

        {/* Right Column (flex: 1): Direct Quick Action Pills */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", minWidth: "120px" }}>
          <button
            onClick={() => updateSetting("theme", settings.theme === "dark" ? "light" : "dark")}
            className="clickable"
            title="Switch theme (Shortcut: T)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-pill-border)",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {settings.theme === "dark" ? <Sun size={14} style={{ color: "#fbbf24" }} /> : <Moon size={14} style={{ color: "#818cf8" }} />}
            <span>{settings.theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </button>
        </div>
      </div>

      {/* ── Main Container: Top Segmented Toolbar & Category Content ────────── */}
      <div 
        style={{ 
          flex: 1, 
          padding: "8px 24px 80px 24px", 
          maxWidth: "880px", 
          width: "100%", 
          margin: "0 auto", 
          display: "flex", 
          flexDirection: "column", 
          gap: "18px" 
        }}
      >
        {/* Apple-Style Segmented Category Tabs */}
        <div 
          style={{ 
            display: "flex", 
            justifyContent: "center",
            padding: "4px",
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-full)",
            boxShadow: "var(--glass-shadow)",
            width: "fit-content",
            margin: "0 auto",
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="clickable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "7px 16px",
                  borderRadius: "var(--radius-full)",
                  fontSize: "12px",
                  fontWeight: isActive ? 700 : 500,
                  backgroundColor: isActive ? "var(--glass-badge-bg)" : "transparent",
                  color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
                  border: isActive ? "1px solid var(--glass-border)" : "1px solid transparent",
                  boxShadow: isActive ? "var(--glass-shadow)" : "none",
                  cursor: "pointer",
                  transition: "all 0.16s ease",
                }}
              >
                <span style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)", display: "inline-flex" }}>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Active Category Content */}
        {activeTab === "appearance" && (
          <AppearanceSettings settings={settings} updateSetting={updateSetting} />
        )}

        {activeTab === "vault" && (
          <VaultSettings settings={settings} updateSetting={updateSetting} />
        )}

        {activeTab === "ai" && (
          <AISettings settings={settings} updateSetting={updateSetting} />
        )}

        {activeTab === "memories" && (
          <MemoriesSettings settings={settings} updateSetting={updateSetting} />
        )}

        {activeTab === "about" && (
          <AboutSettings />
        )}
      </div>
    </div>
  );
};
