import React, { useState } from "react";
import { 
  Settings, 
  HardDrive, 
  Shield, 
  Sparkles, 
  Moon, 
  Sun, 
  FileKey, 
  BatteryMedium 
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export const SettingsView: React.FC = () => {
  const { theme, toggleTheme, activeVolume } = useAppStore();
  const [autoLockDuration, setAutoLockDuration] = useState("30");
  const [enableSpaceSaver, setEnableSpaceSaver] = useState(true);
  const [pauseOnBattery, setPauseOnBattery] = useState(true);
  const [qualityCrf, setQualityCrf] = useState(18);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px", maxWidth: "800px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
        <Settings size={22} style={{ color: "var(--accent-primary)" }} />
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700 }}>Settings & Preferences</h2>
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Configure storage paths, 4K AI processing, and Zero-Trust Vault security
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Section 1: Storage & External Drive */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <HardDrive size={18} style={{ color: "var(--accent-primary)" }} />
            <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Active Storage Location</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--text-muted)" }}>Mounted Volume:</span>
              <span style={{ fontWeight: 600 }}>{activeVolume?.volume_name || "Samsung_T7"} ({activeVolume?.drive_letter || "E:\\"})</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--text-muted)" }}>Hardware Volume UUID:</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-primary)" }}>
                {activeVolume?.volume_serial || "7F2A-91C4"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
              <span style={{ color: "var(--text-muted)" }}>Storage Directory Layout:</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>originals/YYYY/MM/DD/ (&lt; 500 items/folder)</span>
            </div>
          </div>
        </div>

        {/* Section 2: 4K AI Space-Saver & Super-Resolution */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <Sparkles size={18} style={{ color: "var(--accent-primary)" }} />
            <h3 style={{ fontSize: "14px", fontWeight: 700 }}>4K AI Super-Resolution & Space Saver</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>Enable 4K Space-Saver Mode</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Reconstructs photos to 4K UHD and transcodes to visually lossless AVIF (saves 50–70% disk space)
                </p>
              </div>
              <input 
                type="checkbox" 
                checked={enableSpaceSaver} 
                onChange={(e) => setEnableSpaceSaver(e.target.checked)} 
                style={{ width: "16px", height: "16px", accentColor: "var(--accent-primary)" }}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <BatteryMedium size={16} style={{ color: "var(--accent-warning)" }} />
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600 }}>Thermal & Battery Awareness</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Automatically pause heavy 4K AI upscaling when running on laptop battery
                  </p>
                </div>
              </div>
              <input 
                type="checkbox" 
                checked={pauseOnBattery} 
                onChange={(e) => setPauseOnBattery(e.target.checked)} 
                style={{ width: "16px", height: "16px", accentColor: "var(--accent-primary)" }}
              />
            </label>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span style={{ color: "var(--text-muted)" }}>AVIF Visual Quality (CRF {qualityCrf})</span>
                <span style={{ fontWeight: 600, color: "var(--accent-success)" }}>Visually Lossless</span>
              </div>
              <input 
                type="range" 
                min={12} 
                max={28} 
                value={qualityCrf} 
                onChange={(e) => setQualityCrf(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent-primary)" }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Zero-Trust Hardened Vault Security */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--accent-vault-glow)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
            <Shield size={18} style={{ color: "var(--accent-vault)" }} />
            <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Zero-Trust Vault Security</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>Auto-Lock Inactivity Timeout</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Cleanses Master Vault Key from volatile RAM when idle
                </p>
              </div>
              <select 
                value={autoLockDuration} 
                onChange={(e) => setAutoLockDuration(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  outline: "none",
                }}
              >
                <option value="30">30 Seconds (Default)</option>
                <option value="60">1 Minute</option>
                <option value="300">5 Minutes</option>
              </select>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: "1px solid var(--border-subtle)" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 600 }}>24-Word Emergency Recovery Key</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  BIP-39 mnemonic backup for zero-loss password resets
                </p>
              </div>
              <button
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                }}
              >
                <FileKey size={12} />
                View Recovery Kit
              </button>
            </div>
          </div>
        </div>

        {/* Section 4: Appearance & Themes */}
        <div 
          className="glass-panel"
          style={{
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Desktop Theme Mode</h3>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                Active: {theme === "dark" ? "Dark Obsidian" : "Light Titanium"} (Shortcut: T)
              </p>
            </div>

            <button
              onClick={toggleTheme}
              className="clickable"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              Switch to {theme === "dark" ? "Light Titanium" : "Dark Obsidian"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
